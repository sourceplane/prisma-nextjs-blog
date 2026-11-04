import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/auth.ts: upstream's next-auth options, built per request — GitHub only
// once its OAuth App is connected, the Prisma adapter (database sessions),
// and the secret lib/auth-secret.ts resolves.
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/auth-secret", () => ({ authSecret: async () => "s".repeat(64) }));

describe("authOptions (lib/auth.ts)", () => {
  beforeEach(() => {
    delete process.env.GITHUB_ID;
    delete process.env.GITHUB_SECRET;
  });

  it("has no provider and a sign-in page that says why, before GitHub is connected", async () => {
    const { authOptions } = await import("@/lib/auth");
    const options = await authOptions();
    expect(options.providers).toEqual([]);
    expect(options.pages?.signIn).toBe("/auth/not-connected");
    expect(options.secret).toBe("s".repeat(64));
  });

  it("signs in with GitHub once both of its values are set, on next-auth's own page", async () => {
    process.env.GITHUB_ID = "an-id";
    process.env.GITHUB_SECRET = "a-secret";
    const { authOptions } = await import("@/lib/auth");
    const options = await authOptions();
    expect(options.providers.map((p) => p.id)).toEqual(["github"]);
    expect((options.providers[0] as { options?: { clientId?: string } }).options?.clientId).toBe("an-id");
    expect(options.pages).toBeUndefined();
  });

  it("keeps upstream's database sessions: the Prisma adapter", async () => {
    const { authOptions } = await import("@/lib/auth");
    const adapter = (await authOptions()).adapter;
    expect(adapter).toBeDefined();
    expect(typeof adapter?.createSession).toBe("function");
    expect(typeof adapter?.getSessionAndUser).toBe("function");
  });
});
