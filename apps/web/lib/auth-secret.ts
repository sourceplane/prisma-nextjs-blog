// The secret next-auth signs its CSRF and state cookies with (lib/auth.ts).
//
// Upstream reads SECRET, which its owner generates and sets. A deployed Worker
// built from nothing has no owner-set secret yet, and next-auth refuses to run
// in production without one. So the secret is the first of these that exists:
//
//   1. SECRET — a Worker secret in a deployment, .dev.vars or .env.local
//      locally. Setting it is how an owner rotates the key.
//   2. the secret this environment's database generated for itself. Migration
//      030_app_secrets writes 64 random hex characters into
//      app_private.secrets the first time it runs, so it is never in a
//      repository, a CI log or a deploy artifact, and stage and prod each have
//      their own. `app_private` is not a schema Supabase's Data API exposes.
//
// Sessions themselves are rows in the `sessions` table (the Prisma adapter's
// database sessions, as upstream), so rotating the key signs nobody out.
//
// The stored secret is read once per isolate and kept as a plain string: it
// does not change under a running Worker, and a string (unlike a client or a
// socket) is safe to share between requests.
import prisma from "./prisma";

let stored: string | undefined;

export async function authSecret(): Promise<string> {
  const configured = process.env.SECRET?.trim();
  if (configured) {
    return configured;
  }
  if (stored) {
    return stored;
  }
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    select value from app_private.secrets where name = 'auth_secret'`;
  const value = rows[0]?.value;
  if (!value) {
    throw new Error(
      "No SECRET is set and the database holds no auth_secret: apply the migrations (030_app_secrets) or set SECRET",
    );
  }
  stored = value;
  return value;
}
