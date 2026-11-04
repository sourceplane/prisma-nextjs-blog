import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";

// The template's three write routes — create (POST /api/post), publish
// (PUT /api/publish/:id) and delete (DELETE /api/post/:id) — as upstream wrote
// them, plus the one check upstream lacked: publish and delete act only on
// the signed-in visitor's own post (lib/own-post.ts). The session and the
// Prisma client are mocked: what is tested is who may do what.
const getServerSession = vi.fn();
vi.mock("next-auth/next", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: async () => ({}) }));
const post = { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() };
vi.mock("@/lib/prisma", () => ({ default: { post } }));

const ADA = { user: { name: "Ada", email: "ada@example.org" }, expires: "2099-01-01" };
const BOB = { user: { name: "Bob", email: "bob@example.org" }, expires: "2099-01-01" };

function call(req: Partial<NextApiRequest>) {
  const res = { statusCode: 200, body: undefined as unknown };
  const api = {
    status: (code: number) => ((res.statusCode = code), api),
    json: (body: unknown) => ((res.body = body), api),
    send: (body: unknown) => ((res.body = body), api),
  };
  return { req: req as NextApiRequest, res, api: api as unknown as NextApiResponse };
}

beforeEach(() => {
  getServerSession.mockReset();
  for (const fn of Object.values(post)) fn.mockReset();
});

describe("POST /api/post (create a draft)", () => {
  it("refuses an anonymous visitor (401) and writes nothing", async () => {
    getServerSession.mockResolvedValue(null);
    const { default: handle } = await import("@/pages/api/post/index");
    const { req, res, api } = call({ method: "POST", body: { title: "t", content: "c" } });
    await handle(req, api);
    expect(res.statusCode).toBe(401);
    expect(post.create).not.toHaveBeenCalled();
  });

  it("creates the draft under the signed-in author's email, as upstream", async () => {
    getServerSession.mockResolvedValue(ADA);
    post.create.mockResolvedValue({ id: "p1", title: "t", content: "c", published: false });
    const { default: handle } = await import("@/pages/api/post/index");
    const { req, res, api } = call({ method: "POST", body: { title: "t", content: "c" } });
    await handle(req, api);
    expect(post.create).toHaveBeenCalledWith({
      data: { title: "t", content: "c", author: { connect: { email: "ada@example.org" } } },
    });
    expect(res.body).toMatchObject({ id: "p1", published: false });
  });
});

describe("PUT /api/publish/:id", () => {
  it("refuses an anonymous visitor (401)", async () => {
    getServerSession.mockResolvedValue(null);
    const { default: handle } = await import("@/pages/api/publish/[id]");
    const { req, res, api } = call({ method: "PUT", query: { id: "p1" } });
    await handle(req, api);
    expect(res.statusCode).toBe(401);
    expect(post.update).not.toHaveBeenCalled();
  });

  it("is 404 for a post that does not exist", async () => {
    getServerSession.mockResolvedValue(ADA);
    post.findUnique.mockResolvedValue(null);
    const { default: handle } = await import("@/pages/api/publish/[id]");
    const { req, res, api } = call({ method: "PUT", query: { id: "nope" } });
    await handle(req, api);
    expect(res.statusCode).toBe(404);
    expect(post.update).not.toHaveBeenCalled();
  });

  it("refuses someone else's post (403) — upstream published it", async () => {
    getServerSession.mockResolvedValue(BOB);
    post.findUnique.mockResolvedValue({ author: { email: "ada@example.org" } });
    const { default: handle } = await import("@/pages/api/publish/[id]");
    const { req, res, api } = call({ method: "PUT", query: { id: "p1" } });
    await handle(req, api);
    expect(res.statusCode).toBe(403);
    expect(post.update).not.toHaveBeenCalled();
  });

  it("refuses a post with no author (403)", async () => {
    getServerSession.mockResolvedValue(ADA);
    post.findUnique.mockResolvedValue({ author: null });
    const { default: handle } = await import("@/pages/api/publish/[id]");
    const { req, res, api } = call({ method: "PUT", query: { id: "p1" } });
    await handle(req, api);
    expect(res.statusCode).toBe(403);
  });

  it("publishes the author's own post", async () => {
    getServerSession.mockResolvedValue(ADA);
    post.findUnique.mockResolvedValue({ author: { email: "ada@example.org" } });
    post.update.mockResolvedValue({ id: "p1", published: true });
    const { default: handle } = await import("@/pages/api/publish/[id]");
    const { req, res, api } = call({ method: "PUT", query: { id: "p1" } });
    await handle(req, api);
    expect(post.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { published: true } });
    expect(res.body).toEqual({ id: "p1", published: true });
  });
});

describe("DELETE /api/post/:id", () => {
  it("refuses an anonymous visitor (401)", async () => {
    getServerSession.mockResolvedValue(null);
    const { default: handle } = await import("@/pages/api/post/[id]");
    const { req, res, api } = call({ method: "DELETE", query: { id: "p1" } });
    await handle(req, api);
    expect(res.statusCode).toBe(401);
    expect(post.delete).not.toHaveBeenCalled();
  });

  it("refuses someone else's post (403) — upstream deleted it", async () => {
    getServerSession.mockResolvedValue(BOB);
    post.findUnique.mockResolvedValue({ author: { email: "ada@example.org" } });
    const { default: handle } = await import("@/pages/api/post/[id]");
    const { req, res, api } = call({ method: "DELETE", query: { id: "p1" } });
    await handle(req, api);
    expect(res.statusCode).toBe(403);
    expect(post.delete).not.toHaveBeenCalled();
  });

  it("deletes the author's own post", async () => {
    getServerSession.mockResolvedValue(ADA);
    post.findUnique.mockResolvedValue({ author: { email: "ada@example.org" } });
    post.delete.mockResolvedValue({ id: "p1" });
    const { default: handle } = await import("@/pages/api/post/[id]");
    const { req, res, api } = call({ method: "DELETE", query: { id: "p1" } });
    await handle(req, api);
    expect(post.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(res.body).toEqual({ id: "p1" });
  });

  it("throws for any other method, as upstream", async () => {
    getServerSession.mockResolvedValue(ADA);
    const { default: handle } = await import("@/pages/api/post/[id]");
    const { req, api } = call({ method: "PATCH", query: { id: "p1" } });
    await expect(handle(req, api)).rejects.toThrow(/PATCH method is not supported/);
  });
});
