import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GitHubProvider from "next-auth/providers/github";
import prisma from "./prisma";
import { authSecret } from "./auth-secret";
import { githubSignIn } from "./github";

// Upstream's options — GitHub, the Prisma adapter (database sessions), the
// secret — built per request instead of once at module load: the secret may
// be one the database holds (lib/auth-secret.ts) and GitHub may not be
// connected yet (lib/github.ts). The API route (pages/api/auth/[...nextauth].ts)
// and every server-side session read (getServerSession) take them from here.
// Until GitHub is connected there is no provider, and next-auth's sign-in page
// is pages/auth/not-connected.tsx, which says how to connect it.
export async function authOptions(): Promise<NextAuthOptions> {
  const github = githubSignIn();
  return {
    providers: github ? [GitHubProvider(github)] : [],
    adapter: PrismaAdapter(prisma),
    secret: await authSecret(),
    ...(github ? {} : { pages: { signIn: "/auth/not-connected" } }),
  };
}
