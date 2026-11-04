import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { manifest } from "@saas/db/manifest";

// What a fresh environment's database holds once db-migrate has run, before
// the Worker serves its first request: the blog's tables, empty (upstream
// seeds sample posts only by hand, `prisma db seed`, and so does this), with
// the constraints the app and next-auth's adapter rely on, and a cookie
// secret of its own (030) — each migration idempotent, so a second apply
// changes none of it. Every migration, in the manifest's order, on a real
// Postgres in process (PGlite).
const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");
const sqlOf = (rel: string) => readFileSync(path.join(migrationsDir, rel), "utf8");

async function migrate(db: PGlite) {
  for (const entry of manifest.migrations) {
    await db.exec(sqlOf(entry.path));
  }
}

describe("a freshly migrated database", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await migrate(db);
  }, 60_000);

  it("holds the blog's tables, empty", async () => {
    for (const table of ['"Post"', "users", "accounts", "sessions", "verificationtokens"]) {
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      expect(rows[0]!.n, table).toBe(0);
    }
  });

  it("keeps a post when its author goes, and a user's sessions and accounts go with the user", async () => {
    await db.exec(`
      insert into users (id, name, email, updated_at) values ('u1', 'Ada', 'ada@example.org', now());
      insert into accounts (id, user_id, type, provider, provider_account_id) values ('a1', 'u1', 'oauth', 'github', '42');
      insert into sessions (id, session_token, user_id, expires) values ('s1', 'tok', 'u1', now() + interval '1 day');
      insert into "Post" (id, title, "authorId") values ('p1', 'Hello', 'u1');
      delete from users where id = 'u1';`);
    const post = await db.query<{ authorId: string | null; published: boolean }>(`select "authorId", published from "Post" where id = 'p1'`);
    expect(post.rows).toEqual([{ authorId: null, published: false }]);
    for (const table of ["accounts", "sessions"]) {
      const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      expect(rows[0]!.n, table).toBe(0);
    }
    await db.exec(`delete from "Post"`);
  });

  it("refuses a second account for the same GitHub user and a second user with the same email", async () => {
    await db.exec(`
      insert into users (id, email, updated_at) values ('u1', 'ada@example.org', now());
      insert into accounts (id, user_id, type, provider, provider_account_id) values ('a1', 'u1', 'oauth', 'github', '42');`);
    await expect(
      db.exec(`insert into accounts (id, user_id, type, provider, provider_account_id) values ('a2', 'u1', 'oauth', 'github', '42')`),
    ).rejects.toThrow(/duplicate key/);
    await expect(db.exec(`insert into users (id, email, updated_at) values ('u2', 'ada@example.org', now())`)).rejects.toThrow(
      /duplicate key/,
    );
    await db.exec("delete from users");
  });

  it("holds a 64-hex cookie secret in app_private, outside the Data API's public", async () => {
    const { rows } = await db.query<{ value: string }>("select value from app_private.secrets where name = 'auth_secret'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes nothing on a second apply: the same tables, the same secret", async () => {
    await db.exec(`insert into users (id, email, updated_at) values ('u9', 'kept@example.org', now())`);
    const before = await db.query<{ value: string }>("select value from app_private.secrets where name = 'auth_secret'");
    await migrate(db);
    const after = await db.query<{ value: string }>("select value from app_private.secrets where name = 'auth_secret'");
    expect(after.rows).toEqual(before.rows);
    const kept = await db.query<{ n: number }>("select count(*)::int as n from users");
    expect(kept.rows[0]!.n).toBe(1);
  });

  it("generates a different secret in every database", async () => {
    const other = new PGlite();
    await migrate(other);
    const a = await db.query<{ value: string }>("select value from app_private.secrets");
    const b = await other.query<{ value: string }>("select value from app_private.secrets");
    expect(b.rows[0]!.value).not.toBe(a.rows[0]!.value);
  }, 60_000);
});
