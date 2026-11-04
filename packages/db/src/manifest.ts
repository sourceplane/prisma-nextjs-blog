import type { MigrationManifest } from "./types.js";

// Every migration the runner applies, in order, with the sha256 of its file.
// `pnpm --filter @saas/db run manifest:check` verifies the checksums;
// `manifest:fix` rewrites them after a migration file changes (only ever
// before that migration has been applied anywhere — an applied migration's
// checksum is immutable).
export const manifest: MigrationManifest = {
  version: 1,
  migrations: [
    {
      id: "000_control_baseline",
      context: "control",
      path: "000_control/up.sql",
      checksum:
        "2a5d7f30684c99e3ff441ca8a2c38038dedd1bab4db4a40e92cd36bb22be297f",
      description:
        "Baseline control migration — creates the migration tracking schema",
    },
    {
      id: "010_blog",
      context: "app",
      path: "010_blog/up.sql",
      checksum:
        "bf8203413fd3b83d62971d9a8ebf9441c375f40bf9b8e7b691e2829034b1c269",
      description:
        "The template's posts and next-auth's users, accounts, sessions and verification tokens, as apps/web/prisma/schema.prisma declares them (upstream's prisma/migrations init, made idempotent) — applied before the Worker serves instead of by `prisma migrate deploy`",
    },
    {
      id: "020_row_level_security",
      context: "app",
      path: "020_row_level_security/up.sql",
      checksum:
        "2b637b30b562d5148b0dee7fc963c68c5c4d953a0838007198d3f7f48f45b19b",
      description:
        "Row-level security, with no policies, on every table in public — closed to Supabase's Data API (anon, authenticated), open to the app, which owns them; refuses to run if the app's role would be locked out",
    },
    {
      id: "030_app_secrets",
      context: "app",
      path: "030_app_secrets/up.sql",
      checksum:
        "d01c8c6930f7a04fdf78d4293116f1a85abe082b93dc6312d60d1dc616fde5ce",
      description:
        "app_private.secrets, and the secret next-auth signs its cookies with in a fresh environment (apps/web/lib/auth-secret.ts)",
    },
  ],
};
