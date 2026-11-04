# prisma-nextjs-blog — design

## The template

Vercel's Fullstack Blog with Next.js + Prisma
([prisma/fullstack-prisma-nextjs-blog](https://github.com/prisma/fullstack-prisma-nextjs-blog))
is a Next.js 13.5 Pages Router app: a public feed of published posts, a
signed-in writer's drafts, a post page rendering Markdown with Publish and
Delete buttons for its author, and a new-draft form — all in styled-jsx.
Prisma 7 reads and writes everything through `@prisma/adapter-pg`, one
`PrismaClient` for the process. next-auth 4 signs writers in with GitHub,
keeping its users, GitHub accounts and sessions in the same database through
`@next-auth/prisma-adapter` (database sessions). Its owner runs `prisma
migrate deploy` against `DATABASE_URL`, optionally `prisma db seed` for
sample users and posts, and sets `SECRET`, `NEXTAUTH_URL`, `GITHUB_ID` and
`GITHUB_SECRET`.

## How it maps to Cloudflare and Supabase

| Vercel | Here | Why |
|---|---|---|
| Next.js hosting | One Worker (`.open-next/worker.js`) + Static Assets, built by `@opennextjs/cloudflare` (`next build --webpack`) | The reference's shape; webpack for the Prisma client's wasm (below) |
| One `PrismaClient` for the process | `lib/prisma.ts`: a client per request over `PrismaPg` from the `HYPERDRIVE` binding's connection string, keyed by the request's ExecutionContext; upstream's `import prisma` is a Proxy onto it | The Workers runtime refuses to reuse a socket across requests |
| The client generated for Node.js | `runtime = "workerd"`: the query compiler imported as a compiled WebAssembly module (`.wasm?module`), which a webpack externals rule leaves for wrangler to bundle | A Worker may not compile WebAssembly at run time |
| `prisma migrate deploy` | `packages/db`'s `010_blog` (upstream's migration, idempotent), `020_row_level_security` and `030_app_secrets`, applied by `infra/db-migrate` before the Worker deploys; tests/db holds `010_blog` to `prisma migrate diff` for `schema.prisma` | db-migrate reaches Supabase through its Management API; CI holds no database URL |
| `SECRET`, set by the owner | `030_app_secrets` generates 64 hex characters into `app_private.secrets` once per database; `lib/auth-secret.ts` reads it (once per isolate) unless `SECRET` is set | A product comes up with nothing typed |
| `GITHUB_ID`, `GITHUB_SECRET` | Optional Orun secrets per environment, pushed to the Worker as Worker secrets at deploy (`tooling/wire/worker-secrets.mjs`); unset, next-auth has no provider and its sign-in page says how to connect GitHub | Only the owner can create an OAuth App, and the product must deploy before they do |
| `NEXTAUTH_URL` | `AUTH_TRUST_HOST=true` (a Worker var): the origin from each request | The Worker answers on workers.dev and any domain its owner adds |
| `getSession({ req })` in server code | `getServerSession(req, res, options)` | `getSession` on the server is an HTTP request to the Worker's own hostname |
| `getStaticProps` (+ `revalidate: 10`) | `getServerSideProps`, the session handed to the page | No database at build; upstream's `/p/[id]` had no `getStaticPaths` and `/drafts` read a `req` `getStaticProps` never gets |
| Publish and delete for any signed-in visitor | `lib/own-post.ts`: the post's author only (404, 403) | On a public site any GitHub account could act on anyone's post |
| Next.js 13.5, React 18, react-markdown 8 | Next.js 16.3.8, React 19.3, react-markdown 10 | OpenNext's supported Next; react-markdown 8 ships `.ts` sources written for React 18's global `JSX` |

Every table in `public` has row-level security and no policy, and the
cookie secret is in `app_private`, so Supabase's Data API — which serves
`public` to the project's public anon key — reads nothing: not a post, not
a session token in `sessions`, not an OAuth token in `accounts`. The app
connects as the tables' owner and is not subject to it.

## The repository

postgres-drizzle-starter's shape, as admin-dashboard runs it:
`infra/terraform/supabase` (one project per deployed environment, its
credentials lease-published), `infra/terraform/cloudflare-hyperdrive` (one
config over it, its id published as `WIRING_CLOUDFLARE_HYPERDRIVE`; caching
off, so the blog reads its own writes), `packages/db` (`@saas/db`: the
migrations and Lumen's runner, through Supabase's Management API),
`infra/db-migrate`, `apps/web` (type `cloudflare-workers-assets-turbo`,
depending on Hyperdrive and db-migrate, enforced on main), `tests/web` and
`tests/db`. The product's name is one seam, `SITE_NAME` in
`apps/web/lib/site.ts`: the page title (upstream has none). Vercel's page
for the template and its repository both spell this baseline's slug
(`…/fullstack-prisma-nextjs-blog`), so the rename engine masks them
(`UPSTREAM` in `tooling/rebrand/rebrand.mjs`).

## The build

`prisma generate`, `next build --webpack`, `opennextjs-cloudflare build`,
then the static-assets cache populated. `/create`, `/404` and
`/auth/not-connected` are pre-rendered; every other page renders per
request. The build takes no origin and no secret: GitHub's OAuth App and
`SECRET` are kept out of it (`env -u`) and pushed to the Worker as Worker
secrets on a deploy lane. The Worker is about 2.6 MiB gzipped — Workers
Free, with Prisma's 3.4 MB query compiler most of it.

`repo-blueprint.yaml` is admin-dashboard's: one landing (`01-product`), one
convergence that applies the Supabase project, the Hyperdrive config and
the migrations, and deploys stage and prod side by side, then `02-docs`,
the record, which also probes whether GitHub sign-in is connected. The
smoke checks the public feed and `/api/health`.

## Alternatives rejected

- **Auth.js v5 in place of next-auth 4.** The template is next-auth 4 with
  `@next-auth/prisma-adapter`, and the spike ran its whole GitHub OAuth flow
  on workerd (authorize redirect, code exchange, userinfo, the adapter's
  writes) against a stand-in for GitHub. Moving to v5 would rewrite every
  server-side session read and the adapter for no runtime gain.
- **`prisma migrate deploy` in a deploy lane.** It needs a direct database
  URL in CI; db-migrate already applies SQL through the Management API with
  a checksummed ledger. Prisma's own migration stays for local databases,
  and tests/db holds the two to the same statements.
- **Keep Hyperdrive's read cache.** "Create" sends the writer to their
  drafts; a cached read would show the list without the draft just written.
- **Seed the template's sample posts in a migration.** Upstream's deploy
  seeds nothing (its seed is run by hand); sample authors with no accounts
  would leave posts nobody could delete.
- **GitHub keys inlined into the server bundle** (admin-dashboard's way).
  cms-drupal's `worker-secrets.mjs` pushes them as Worker secrets from the
  deploy lane instead, so no bundle carries them.

## Out of scope

- Editing a post: upstream has no edit, only publish and delete.
- Other sign-in providers: upstream has GitHub only.
