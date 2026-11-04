import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { manifest } from "@saas/db/manifest";
import { buildPlan, runMigrations } from "@saas/db/runner";

const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");
const web = path.resolve(__dirname, "../../../apps/web");
const prismaMigrations = path.join(web, "prisma/migrations");

// The statements of a SQL file, comments dropped and whitespace folded — and,
// so the deployed migration (idempotent: it may be re-run) compares with
// Prisma's (which is not), with its idempotency wrappers taken off: IF NOT
// EXISTS, and the `DO $$ BEGIN … EXCEPTION WHEN duplicate_object …` around
// each foreign key.
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/DO \$\$ BEGIN\s+([\s\S]*?;)\s*EXCEPTION\s+WHEN duplicate_object THEN null;\s*END \$\$;/g, "$1")
    .replace(/ IF NOT EXISTS/g, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((s) => s !== 'CREATE SCHEMA "public"');
}

describe("the migration manifest (packages/db)", () => {
  it("starts with the control migration and names every file with its checksum", () => {
    expect(manifest.migrations[0]?.id).toBe("000_control_baseline");
    for (const entry of manifest.migrations) {
      const file = readFileSync(path.join(migrationsDir, entry.path));
      expect(createHash("sha256").update(file).digest("hex"), entry.id).toBe(entry.checksum);
    }
  });

  it("is the blog's schema, row-level security and the generated secret, in that order", () => {
    expect(manifest.migrations.map((m) => m.id)).toEqual([
      "000_control_baseline",
      "010_blog",
      "020_row_level_security",
      "030_app_secrets",
    ]);
  });

  it("plans every migration as pending offline", async () => {
    const result = await runMigrations(manifest, { mode: "plan", migrationsDir, adapter: null });
    expect(result.failed).toBeNull();
    expect(result.applied).toEqual(manifest.migrations.map((m) => m.id));
  });

  it("skips what the database already recorded", () => {
    const applied = new Map([[manifest.migrations[0]!.id, manifest.migrations[0]!.checksum]]);
    const plan = buildPlan(manifest, applied, migrationsDir);
    expect(plan.alreadyApplied).toEqual([manifest.migrations[0]!.id]);
    expect(plan.pending.map((m) => m.id)).toEqual(manifest.migrations.slice(1).map((m) => m.id));
    expect(plan.checksumMismatches).toEqual([]);
  });
});

describe("010_blog and the Prisma schema", () => {
  const ours = statements(readFileSync(path.join(migrationsDir, "010_blog/up.sql"), "utf8"));

  it("is upstream's Prisma migration, statement for statement", () => {
    const dirs = readdirSync(prismaMigrations, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(dirs.map((d) => d.name)).toEqual(["20220408154015_init"]);
    const twin = readFileSync(path.join(prismaMigrations, "20220408154015_init/migration.sql"), "utf8");
    expect(ours).toEqual(statements(twin));
  });

  it("is what Prisma writes for apps/web/prisma/schema.prisma today", () => {
    // `prisma migrate diff` from an empty database to the schema: the SQL the
    // schema stands for, with no database involved. A model edited without a
    // migration fails here.
    const sql = execFileSync(
      path.join(web, "node_modules/.bin/prisma"),
      ["migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"],
      // A URL the schema engine needs to load the config but never connects to.
      { cwd: web, encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused" } },
    );
    expect(ours).toEqual(statements(sql));
  }, 60_000);

  it("can be re-run: every CREATE skips what exists, every foreign key ignores its duplicate", () => {
    const sql = readFileSync(path.join(migrationsDir, "010_blog/up.sql"), "utf8");
    expect(sql.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(5);
    expect(sql.match(/CREATE UNIQUE INDEX IF NOT EXISTS/g)).toHaveLength(5);
    expect(sql.match(/WHEN duplicate_object THEN null;/g)).toHaveLength(3);
    expect(statements(sql).filter((s) => /^(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(s))).toEqual([]);
  });
});
