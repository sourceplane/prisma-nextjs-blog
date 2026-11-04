import { beforeEach, describe, expect, it } from "vitest";
import { githubSignIn } from "@/lib/github";

// lib/github.ts: GitHub sign-in exists only when its OAuth App's client id
// and secret are BOTH set — Worker secrets on a deployment, the environment
// here.
describe("githubSignIn (lib/github.ts)", () => {
  beforeEach(() => {
    delete process.env.GITHUB_ID;
    delete process.env.GITHUB_SECRET;
  });

  it("is null with neither", () => {
    expect(githubSignIn()).toBeNull();
  });

  it("is null with only one of the two", () => {
    process.env.GITHUB_ID = "an-id";
    expect(githubSignIn()).toBeNull();
    delete process.env.GITHUB_ID;
    process.env.GITHUB_SECRET = "a-secret";
    expect(githubSignIn()).toBeNull();
  });

  it("treats blank values as unset", () => {
    process.env.GITHUB_ID = "";
    process.env.GITHUB_SECRET = "  ";
    expect(githubSignIn()).toBeNull();
  });

  it("is the pair, trimmed, with both", () => {
    process.env.GITHUB_ID = " an-id ";
    process.env.GITHUB_SECRET = "a-secret";
    expect(githubSignIn()).toEqual({ clientId: "an-id", clientSecret: "a-secret" });
  });
});
