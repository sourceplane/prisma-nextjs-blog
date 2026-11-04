import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GetServerSidePropsContext } from "next";

// The three data pages, read per request (getServerSideProps) instead of
// upstream's getStaticProps: the feed (published posts), the drafts (the
// signed-in author's unpublished posts, 403 otherwise), and a post (404 when
// it does not exist). Each hands the session to the page, so the first render
// is the signed-in one.
const getServerSession = vi.fn();
vi.mock("next-auth/next", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: async () => ({}) }));
const post = { findMany: vi.fn(), findUnique: vi.fn() };
vi.mock("@/lib/prisma", () => ({ default: { post } }));

const ADA = { user: { name: "Ada", email: "ada@example.org" }, expires: "2099-01-01" };
const ctx = (extra: Partial<GetServerSidePropsContext> = {}) =>
  ({ req: {}, res: { statusCode: 200 }, query: {}, resolvedUrl: "/", ...extra }) as unknown as GetServerSidePropsContext;

beforeEach(() => {
  getServerSession.mockReset();
  post.findMany.mockReset();
  post.findUnique.mockReset();
});

describe("the feed (/)", () => {
  it("lists published posts with their author's name, and the session", async () => {
    getServerSession.mockResolvedValue(null);
    post.findMany.mockResolvedValue([{ id: "p1", title: "t", author: { name: "Ada" } }]);
    const { getServerSideProps } = await import("@/pages/index");
    const result = await getServerSideProps(ctx());
    expect(post.findMany).toHaveBeenCalledWith({
      where: { published: true },
      include: { author: { select: { name: true } } },
    });
    expect(result).toEqual({ props: { feed: [{ id: "p1", title: "t", author: { name: "Ada" } }], session: null } });
  });
});

describe("the drafts (/drafts)", () => {
  it("is 403 with no drafts for an anonymous visitor", async () => {
    getServerSession.mockResolvedValue(null);
    const { getServerSideProps } = await import("@/pages/drafts");
    const c = ctx();
    const result = await getServerSideProps(c);
    expect(c.res.statusCode).toBe(403);
    expect(result).toEqual({ props: { drafts: [], session: null } });
    expect(post.findMany).not.toHaveBeenCalled();
  });

  it("lists the signed-in author's unpublished posts", async () => {
    getServerSession.mockResolvedValue(ADA);
    post.findMany.mockResolvedValue([{ id: "d1" }]);
    const { getServerSideProps } = await import("@/pages/drafts");
    const result = await getServerSideProps(ctx());
    expect(post.findMany).toHaveBeenCalledWith({
      where: { author: { email: "ada@example.org" }, published: false },
      include: { author: { select: { name: true } } },
    });
    expect(result).toEqual({ props: { drafts: [{ id: "d1" }], session: ADA } });
  });
});

describe("a post (/p/[id])", () => {
  it("is the post, its author and the session", async () => {
    getServerSession.mockResolvedValue(ADA);
    post.findUnique.mockResolvedValue({ id: "p1", title: "t", published: true, author: { name: "Ada", email: "ada@example.org" } });
    const { getServerSideProps } = await import("@/pages/p/[id]");
    const result = await getServerSideProps(ctx({ params: { id: "p1" } }));
    expect(post.findUnique).toHaveBeenCalledWith({
      where: { id: "p1" },
      include: { author: { select: { name: true, email: true } } },
    });
    expect(result).toEqual({
      props: { id: "p1", title: "t", published: true, author: { name: "Ada", email: "ada@example.org" }, session: ADA },
    });
  });

  it("is a 404, not a crash, for a post that does not exist", async () => {
    post.findUnique.mockResolvedValue(null);
    const { getServerSideProps } = await import("@/pages/p/[id]");
    expect(await getServerSideProps(ctx({ params: { id: "nope" } }))).toEqual({ notFound: true });
  });
});
