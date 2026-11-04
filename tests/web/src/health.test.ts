import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

// /api/health (pages/api/health.ts): ok only when the database is reachable
// and migrated — the blog's five tables with row-level security on, and the
// secret 030_app_secrets generates.
const queryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({ default: { $queryRaw: (...args: unknown[]) => queryRaw(...args) } }));

const TABLES = ["Post", "users", "accounts", "sessions", "verificationtokens"];

function call() {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const api = {
    setHeader: (k: string, v: string) => ((res.headers[k] = v), api),
    status: (code: number) => ((res.statusCode = code), api),
    json: (body: unknown) => ((res.body = body), api),
  };
  return { res, api: api as unknown as NextApiResponse };
}

describe("/api/health", () => {
  beforeEach(() => queryRaw.mockReset());

  it("is ok with every table under RLS and the secret present", async () => {
    queryRaw
      .mockResolvedValueOnce(TABLES.map((name) => ({ name, rls: true })))
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([{ present: true }]);
    const { default: health } = await import("@/pages/api/health");
    const { res, api } = call();
    await health({} as NextApiRequest, api);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, database: "reachable", schema: "migrated" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is 503 when a table lacks row-level security", async () => {
    queryRaw.mockResolvedValueOnce(TABLES.map((name) => ({ name, rls: name !== "sessions" })));
    const { default: health } = await import("@/pages/api/health");
    const { res, api } = call();
    await health({} as NextApiRequest, api);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ok: false, database: "reachable", schema: "missing" });
  });

  it("is 503 when the migrations never ran", async () => {
    queryRaw.mockResolvedValueOnce([]);
    const { default: health } = await import("@/pages/api/health");
    const { res, api } = call();
    await health({} as NextApiRequest, api);
    expect(res.statusCode).toBe(503);
  });

  it("is 503 when the generated secret is missing", async () => {
    queryRaw
      .mockResolvedValueOnce(TABLES.map((name) => ({ name, rls: true })))
      .mockResolvedValueOnce([{ present: true }])
      .mockResolvedValueOnce([{ present: false }]);
    const { default: health } = await import("@/pages/api/health");
    const { res, api } = call();
    await health({} as NextApiRequest, api);
    expect(res.statusCode).toBe(503);
  });

  it("is 503 and says unreachable when the database is", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: health } = await import("@/pages/api/health");
    const { res, api } = call();
    await health({} as NextApiRequest, api);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ ok: false, database: "unreachable" });
  });
});
