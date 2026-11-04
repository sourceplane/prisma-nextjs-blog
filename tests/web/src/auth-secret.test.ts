import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/auth-secret.ts: the secret next-auth signs its cookies with is SECRET
// when one is set, and otherwise the one the environment's database
// generated for itself (migration 030_app_secrets) — read once per isolate.
// The Prisma client is mocked: what is tested is which secret wins and when
// the database is asked.
const queryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({ default: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));

const STORED = "a".repeat(64);

describe("the cookie secret (lib/auth-secret.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
    queryRaw.mockReset();
    delete process.env.SECRET;
  });

  it("is SECRET when one is set, without asking the database", async () => {
    process.env.SECRET = "an-owner-set-secret-of-enough-length";
    const { authSecret } = await import("@/lib/auth-secret");
    expect(await authSecret()).toBe("an-owner-set-secret-of-enough-length");
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("is the stored secret otherwise, read once per isolate", async () => {
    queryRaw.mockResolvedValue([{ value: STORED }]);
    const { authSecret } = await import("@/lib/auth-secret");
    expect(await authSecret()).toBe(STORED);
    expect(await authSecret()).toBe(STORED);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect((queryRaw.mock.calls[0]![0] as string[]).join("?")).toMatch(/from app_private\.secrets where name = 'auth_secret'/);
  });

  it("treats an empty SECRET (an .env line left blank) as unset", async () => {
    process.env.SECRET = " ";
    queryRaw.mockResolvedValue([{ value: STORED }]);
    const { authSecret } = await import("@/lib/auth-secret");
    expect(await authSecret()).toBe(STORED);
  });

  it("refuses to run with neither, naming the migration that writes it", async () => {
    queryRaw.mockResolvedValue([]);
    const { authSecret } = await import("@/lib/auth-secret");
    await expect(authSecret()).rejects.toThrow(/030_app_secrets/);
  });
});
