import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/prisma.ts: one PrismaClient per request on the Worker — over that
// request's HYPERDRIVE connection string — shared by everything the request
// does, and a new one for the next request; DATABASE_URL without a Cloudflare
// context. The default export forwards to the current request's client.
const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => getCloudflareContext() }));
const adapters: string[] = [];
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor({ connectionString }: { connectionString: string }) {
      adapters.push(connectionString);
    }
  },
}));
let made = 0;
vi.mock("@/prisma/generated/client.ts", () => ({
  PrismaClient: class {
    n = ++made;
    post = { count: async () => this.n };
  },
}));

beforeEach(() => {
  vi.resetModules();
  getCloudflareContext.mockReset();
  adapters.length = 0;
  made = 0;
  delete process.env.DATABASE_URL;
});

describe("the Prisma client (lib/prisma.ts)", () => {
  it("is one client per request, over the request's Hyperdrive connection", async () => {
    const env = { HYPERDRIVE: { connectionString: "postgres://hyperdrive/db" } };
    const first = { ctx: {}, env };
    const second = { ctx: {}, env };
    const { getPrisma, default: prisma } = await import("@/lib/prisma");
    getCloudflareContext.mockReturnValue(first);
    const a = getPrisma();
    expect(getPrisma()).toBe(a);
    expect(await prisma.post.count()).toBe(1);
    getCloudflareContext.mockReturnValue(second);
    expect(getPrisma()).not.toBe(a);
    expect(await prisma.post.count()).toBe(2);
    expect(adapters).toEqual(["postgres://hyperdrive/db", "postgres://hyperdrive/db"]);
  });

  it("uses DATABASE_URL outside a Worker (next dev, scripts)", async () => {
    getCloudflareContext.mockImplementation(() => {
      throw new Error("no context");
    });
    process.env.DATABASE_URL = "postgres://local/db";
    const { getPrisma } = await import("@/lib/prisma");
    expect(getPrisma()).toBe(getPrisma());
    expect(adapters).toEqual(["postgres://local/db"]);
  });
});
