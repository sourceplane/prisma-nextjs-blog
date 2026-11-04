# prisma-nextjs-blog — operating contract (for humans and agents)

This is the standing guide to how this product is deployed and operated.
Instance facts (live URLs, workspace, what the database check reports, the
secrets it uses) live in [deployment.md](deployment.md), rendered from
probed reality by the bootstrap's `02-docs` phase; this file is the contract
that stays true between deployments. It is written to give an agent with
repository read access enough context to reason about and operate the product
without any other source.

## What this system is

Vercel's Fullstack Blog with Next.js + Prisma template — a public feed,
drafts, posts in Markdown and GitHub sign-in through next-auth with its
Prisma adapter, every read and write through Prisma — on Cloudflare Workers,
with its Postgres a Supabase project reached through Cloudflare Hyperdrive,
expressed as an Orun component-native desired-state repo. Seven components:

- **`infra/terraform/supabase`** (`supabase`) — one Supabase project per
  environment. Its apply publishes `SUPABASE_PROJECT_REF`,
  `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL` onto the environment's secret
  rung.
- **`infra/terraform/cloudflare-hyperdrive`** (`cloudflare-hyperdrive`) — one
  Hyperdrive config per environment over that database. Its apply publishes
  `WIRING_CLOUDFLARE_HYPERDRIVE` (the config's id and name).
- **`infra/db-migrate`** (`db-migrate`) — applies `packages/db`'s migrations
  to the environment's database through Supabase's Management API: the
  blog's tables (posts, and next-auth's users, accounts, sessions and
  verification tokens), row-level security, and the cookie secret
  (`app_private.secrets`). Each migration is recorded with its checksum in
  `_migrations.applied`; only the missing ones apply.
- **`packages/db`** (`db`, the package `@saas/db` — the name the db-migrate
  composition builds) — the migrations and their runner.
- **`apps/web`** (`web`) — the app: Next.js (Pages Router) built by
  `@opennextjs/cloudflare` into one Worker plus Static Assets. It reaches
  Postgres through its `HYPERDRIVE` binding, one `PrismaClient` per request
  (`lib/prisma.ts`, the client generated for the Workers runtime); next-auth
  keeps database sessions through its Prisma adapter and signs its cookies
  with the secret the database holds (`lib/auth-secret.ts`).
- **`tests/web`**, **`tests/db`** — vitest suites, verified on the `dev` rung.

Environments: **`stage`** and **`prod`** are deployed; **`dev` is
verify-only by design** — lanes build and test, nothing deploys.

## Identity and tenancy

Every remote operation runs against ONE Orun workspace, declared in
`intent.yaml` under `execution.state.workspace` — committed, enforced, and
what CI uses. Do not remove it; headless credentials depend on it. If it
reads `ws_SET_ME`, the bootstrap had no workspace to write: set the real one
before anything else.

## How deployment works

1. Merge (or push) to `main`.
2. CI (`.github/workflows/ci.yml`) runs `orun plan --changed` — only
   components whose files changed are planned — then runs each planned lane
   with `orun run --remote-state`, authenticated by GitHub OIDC (the
   exchange resolves this repository's linked workspace server-side).
3. Per environment, in this order — each edge `mode: enforced` on a push to
   main, advisory on a pull request (which deploys nothing):
   **`supabase` → `cloudflare-hyperdrive` → `db-migrate` → `web`.** A job
   resolves its secrets when it starts, so each one reads what the apply
   before it published. The app's deploy re-renders `apps/web/wrangler.jsonc`
   from `WIRING_CLOUDFLARE_HYPERDRIVE` before it builds, deploys
   `prisma-nextjs-blog-web-<env>` (pushing any GitHub sign-in secrets the
   owner has set to it as Worker secrets first), and smoke-tests it: the
   public feed (its posts query, read through the binding) and
   `/api/health`, which answers 200 only when the database is reachable
   through Hyperdrive and migrated.
4. `prod` deploys after `stage` has converged on the same commit
   (`environments.prod.promotion` in intent.yaml).
5. **The convergence run is the deployment.** A green run means every
   planned lane applied. Failed lanes are retried with
   `gh run rerun --failed`, which resumes the same execution.

Caveats that matter:

- A push that touches no component files plans zero lanes — that run is
  green and deployed nothing. Never treat "latest run green" as "product
  converged"; probe the URLs instead.
- `apps/web/wrangler.jsonc` is committed as the render of
  `wrangler.template.jsonc` from `wiring.fixture.json` (a placeholder
  Hyperdrive id): edit the template and run `pnpm run wire:fixture`. The
  deploy lanes render the real one in their own job tree; never commit a
  real id.
- **The schema and the cookie secret are the migrations'.** The blog never
  creates a table; db-migrate does, before the Worker deploys, from
  `packages/db/src/migrations` (`010_blog` is upstream's Prisma migration,
  made idempotent). A fresh blog has no posts, as upstream's deploy has
  none: the template's sample users and posts are `prisma db seed`, run by
  hand. If the tables are missing, every page fails and `/api/health`
  answers 503 `schema: missing`.
- **The cookie secret** is `SECRET` when it is set (an Orun secret, pushed
  to the Worker as a Worker secret at deploy), otherwise the 64-hex secret
  migration `030_app_secrets` generated into `app_private.secrets` — once
  per database, so stage and prod each have their own and it is never in
  the repository, a log or a deploy artifact. The Worker reads it once per
  isolate. Sessions are rows in `sessions`, so changing the secret signs
  nobody out.
- **GitHub sign-in is the owner's to connect.** Until `GITHUB_ID` and
  `GITHUB_SECRET` are set for an environment AND the blog is redeployed
  there, next-auth has no provider: every visitor is signed out, the feed
  and published posts read as usual, and "Log in" lands on a page that says
  how to connect GitHub. The deploy pushes them to the Worker as Worker
  secrets (`tooling/wire/worker-secrets.mjs`), never into a bundle, so
  setting them changes nothing until a redeploy.
- **Only a post's author publishes or deletes it.** Upstream's routes let
  any signed-in visitor act on any post; here they answer 404 for a missing
  post and 403 for someone else's (`lib/own-post.ts`).
- **Hyperdrive does not cache** (the `cloudflare-hyperdrive` root sets
  `caching.disabled`): the blog reads its own writes at once — "Create" lands
  on the writer's drafts — and a cached read would show the list without
  the draft just written. Hyperdrive still pools the connections.
- Every table in `public` has row-level security and no policy. Supabase's
  Data API serves `public` to the anon key, so this is what keeps posts,
  session tokens and OAuth tokens out of it; the app is unaffected because it
  connects as `postgres`, the tables' owner. Give a new table `ENABLE ROW
  LEVEL SECURITY` in its migration; never `FORCE` it, and never add a policy
  for `anon` without meaning to publish that table.
- A migration is immutable once applied: its checksum is in
  `packages/db/src/manifest.ts` and in the database's ledger. Change the
  schema with a NEW migration (in `packages/db/src/migrations`, and its
  Prisma twin in `apps/web/prisma/migrations` for local databases).

## Secrets model

- **Brokered provider secrets**, minted per run from the workspace's
  connections — no long-lived values at rest, nothing to rotate by hand:
  `CLOUDFLARE_API_TOKEN` (Workers deploy), `CLOUDFLARE_HYPERDRIVE_TOKEN`
  (Hyperdrive — the deploy token deliberately cannot touch it),
  `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN` (project create and
  migrations) and `SUPABASE_ORG_ID`.
- **Published by the applies** onto the stage and prod rungs:
  `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`,
  `WIRING_CLOUDFLARE_HYPERDRIVE`.
- **The owner's, optional**: `GITHUB_ID` and `GITHUB_SECRET`, this
  repository's Orun secrets per environment (`orun secrets set … --env
  <env>`), pushed to the Worker as Worker secrets by its deploy — a GitHub
  OAuth App whose callback URL is the environment's
  `/api/auth/callback/github`. `SECRET`, the same way, only to choose the
  cookie secret yourself.
- **Generated in the database**: the cookie secret (`app_private.secrets`),
  by migration `030_app_secrets`; `app_private` is not a schema Supabase's
  Data API exposes.
- Inspect by NAME only: `orun secrets list --org <ws> --project` and
  `--env stage|prod`. No tooling in this repository prints a secret value,
  and no document in `ai/context/` may contain one.

## Verifying the system

```bash
# the app and its database path on each environment (also recorded, probed, in deployment.md)
curl -s -o /dev/null -w '%{http_code}\n' https://prisma-nextjs-blog-web-stage.your-workers-subdomain.workers.dev/
curl -s https://prisma-nextjs-blog-web-prod.your-workers-subdomain.workers.dev/api/health

# workspace readiness (integrations + repository link)
orun integrations list --org <ws> --json && orun cloud check --org <ws>
```

## Common operations

| task | how |
|---|---|
| deploy a change | merge to `main`; watch the run; failed lanes → `gh run rerun --failed` |
| deploy by hand | Orunbase's Deploy button, or `gh workflow run ci.yml --ref main -f environment=<env> [-f component=<a,b>]` — the named components (blank: every one) run in that environment as a merge runs them; started off `main` it is refused |
| change the schema | edit `apps/web/prisma/schema.prisma`, `pnpm --filter @app/web exec prisma migrate dev --name <name>` against a local database (Prisma's migration), then the same statements, idempotent and with `ENABLE ROW LEVEL SECURITY` for a new table, as a new `packages/db/src/migrations/<nnn>_<name>/up.sql` and its manifest entry (`pnpm --filter @saas/db run manifest:fix` for its checksum); merge — db-migrate applies it before the app deploys. `pnpm test` fails on a table in `public` without row-level security, and on a deployed schema that is not what Prisma writes for `schema.prisma` |
| add sample posts | `DATABASE_URL=<the environment's direct URL> pnpm --filter @app/web db:seed` (the template's seed), or write them through the blog once sign-in is connected |
| connect GitHub sign-in | create a GitHub OAuth App per environment (callback URL `<env URL>/api/auth/callback/github`), `orun secrets set GITHUB_ID --env <env>` and `GITHUB_SECRET`, then redeploy `web` (README, "Connecting GitHub sign-in") |
| choose the cookie secret | `orun secrets set SECRET --env <env>` (32+ random bytes), then redeploy `web`; nobody is signed out |
| redeploy without a change | edit the last line of the component's `component.yaml` (`# orun: redeploy <reason> <stamp>`) and merge — it is a deploy trigger, nothing reads it |
| serve a custom domain | attach it to the Worker in Cloudflare (README, "Custom domain") — the blog follows it at once, since next-auth reads the origin from each request; move the GitHub OAuth App's callback URL onto it, replace the placeholder `prisma-nextjs-blog.example.com` in `intent.yaml`'s `BASE_DOMAIN` with it (a record; nothing builds a URL from it), and merge |
| headless credentials | `ORUN_TOKEN` (workspace-scoped) + `GITHUB_TOKEN` |

The deployment record is the bootstrap's `02-docs` phase. Re-running it (the
Orun console's Retry on that phase, or `orun new … --phase 02-docs`)
re-probes the URLs and re-renders [deployment.md](deployment.md); it is
idempotent.

## Evolution

Structural changes (a second Worker, a queue, another data store) follow the
same contract that deployed the product: add a component under `apps/`,
`infra/` or `packages/` with a `component.yaml` — declaring `dependsOn` on
any infrastructure whose published secrets it reads, enforced on main — land
it as a pull request, and the convergence run applies it.
