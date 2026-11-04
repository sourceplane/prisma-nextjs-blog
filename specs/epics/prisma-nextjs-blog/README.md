# prisma-nextjs-blog — Vercel's Fullstack Blog with Next.js + Prisma on Cloudflare

**The template's blog as it is — the public feed, drafts, posts in Markdown,
GitHub sign-in through next-auth, every read and write through Prisma — on
one Cloudflare Worker, its Postgres a Supabase project behind Hyperdrive,
the schema and the cookie secret applied before the Worker deploys; and the
baseline that makes a copy of it somebody else's product in one landing.**

| | |
|---|---|
| Status | ✅ Shipped (`baseline-v1`) — proven offline in Baseline CI; not yet live (risk PR-A) |
| Upstream | [prisma/fullstack-prisma-nextjs-blog](https://github.com/prisma/fullstack-prisma-nextjs-blog) (MIT, declared in its `package.json`), Vercel's [Fullstack Blog with Next.js + Prisma](https://vercel.com/templates/next.js/fullstack-prisma-nextjs-blog), at `6a9c488` |
| Reference | [postgres-drizzle-starter](https://github.com/sourceplane/postgres-drizzle-starter) — Supabase through Hyperdrive, migrations, db-migrate, row-level security; [admin-dashboard](https://github.com/sourceplane/admin-dashboard) — next-auth on Workers over Supabase, the secret generated in the database |
| Key | `PR` |

## Read in this order

1. [design.md](design.md) — the template, how each Vercel piece maps to
   Cloudflare and Supabase, the repository and the build, and the
   alternatives rejected.
2. [implementation-plan.md](implementation-plan.md) — the milestones.
3. [risks-and-open-questions.md](risks-and-open-questions.md) — what is not
   proven, and what was accepted.
4. [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) — what shipped, and
   every departure from the upstream template.

## Milestones

| Milestone | What it lands | Task |
|---|---|---|
| PR0 — the spec | the repository, its intent, CI, tooling and spec index; this doc set | PR-1 |
| PR1 — the blog on Workers and Supabase | the template in `apps/web`, its Prisma schema, row-level security and cookie secret as migrations, the Supabase and Hyperdrive roots, the tests | PR-2 |
| PR2 — a baseline | the console card, the build document, the context pack and the baseline's tests | PR-3 |
