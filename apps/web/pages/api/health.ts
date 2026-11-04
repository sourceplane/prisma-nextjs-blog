import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "../../lib/prisma";

// Not upstream's: the deploy's smoke check and the bootstrap's probes read
// this. The feed proves the Worker deployed and can query; this proves what a
// page cannot say on its own — the HYPERDRIVE binding names a real config,
// Hyperdrive reaches the Supabase database, and db-migrate applied the schema:
// the blog's tables exist with row-level security on, and the secret the
// database generates for itself is there (lib/auth-secret.ts).
const TABLES = ["Post", "users", "accounts", "sessions", "verificationtokens"];

export default async function health(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("cache-control", "no-store");
  try {
    const rows = await prisma.$queryRaw<{ name: string; rls: boolean }[]>`
      select c.relname as name, c.relrowsecurity as rls
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`;
    const tables = new Map(rows.map((r) => [r.name, r.rls]));
    let ok = TABLES.every((t) => tables.get(t) === true);
    if (ok) {
      const [key] = await prisma.$queryRaw<{ present: boolean }[]>`
        select to_regclass('app_private.secrets') is not null as present`;
      ok = key?.present === true;
    }
    if (ok) {
      const [key] = await prisma.$queryRaw<{ present: boolean }[]>`
        select exists (select 1 from app_private.secrets where name = 'auth_secret') as present`;
      ok = key?.present === true;
    }
    res.status(ok ? 200 : 503).json({ ok, database: "reachable", schema: ok ? "migrated" : "missing" });
  } catch (error) {
    console.error("health: database check failed", error);
    res.status(503).json({ ok: false, database: "unreachable" });
  }
}
