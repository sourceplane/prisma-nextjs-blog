import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/client.ts";

// One PrismaClient per request. Upstream kept one client for the process (on
// `global` in development): on Workers a socket cannot outlive the request
// that opened it, so a module-level client fails the second request an
// isolate serves. On the Worker the connection string is the HYPERDRIVE
// binding's (Cloudflare pools and caches the Supabase connection); without a
// Cloudflare context (`next dev` without wrangler, scripts) it is
// DATABASE_URL, as the template had it.
//
// The client is keyed by the request's ExecutionContext, so every query one
// request makes shares one client and pool, and the default export is a Proxy
// onto the current request's client: upstream's `import prisma from
// "../lib/prisma"` call sites, and the Prisma adapter next-auth is given
// (lib/auth.ts), are unchanged.
const clients = new WeakMap<object, PrismaClient>();
let local: PrismaClient | undefined;

function connect(connectionString: string | undefined): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getPrisma(): PrismaClient {
  let context: ReturnType<typeof getCloudflareContext> | undefined;
  try {
    context = getCloudflareContext();
  } catch {
    // no Cloudflare context
  }
  if (!context) {
    local ??= connect(process.env.DATABASE_URL);
    return local;
  }
  const env = context.env;
  const ctx = context.ctx as object;
  let client = clients.get(ctx);
  if (!client) {
    client = connect(env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL);
    clients.set(ctx, client);
  }
  return client;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export default prisma;
