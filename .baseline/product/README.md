# prisma-nextjs-blog

Vercel's [Fullstack Blog with Next.js + Prisma](https://vercel.com/templates/next.js/fullstack-prisma-nextjs-blog)
template ([prisma/fullstack-prisma-nextjs-blog](https://github.com/prisma/fullstack-prisma-nextjs-blog))
— a public feed, drafts, a post page in Markdown and GitHub sign-in through
next-auth, all read and written with Prisma — on **Cloudflare Workers +
Static Assets** through [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare),
with its Postgres a **Supabase** project's database reached through
**Cloudflare Hyperdrive**. Terraform provisions both per environment and
Orun's `db-migrate` applies the schema and the secret next-auth signs its
cookies with, all on every merge to `main`.

## Live deployment

<!-- 02-docs:begin -->
Not recorded yet. The bootstrap's last phase writes the live URLs, the
workspace, what the database check reports, whether GitHub sign-in is
connected and the secrets the product uses into
[ai/context/deployment.md](ai/context/deployment.md); how the product deploys
and how to operate it is in
[ai/context/operations.md](ai/context/operations.md).
<!-- 02-docs:end -->

## What is here

| Surface | Where |
|---|---|
| The product's name (the page title) | `apps/web/lib/site.ts` |
| The blog: the feed, drafts, a post, the new-draft form, the header | `apps/web/pages`, `apps/web/components` |
| The write routes, and the check that a post is the visitor's own | `apps/web/pages/api/post`, `apps/web/pages/api/publish`, `apps/web/lib/own-post.ts` |
| next-auth: its options, the cookie secret, GitHub sign-in, the not-connected page | `apps/web/lib/auth.ts`, `apps/web/lib/auth-secret.ts`, `apps/web/lib/github.ts`, `apps/web/pages/api/auth`, `apps/web/pages/auth/not-connected.tsx` |
| The Prisma schema, its CLI config and the per-request client (Hyperdrive first, `DATABASE_URL` fallback) | `apps/web/prisma/schema.prisma`, `apps/web/prisma.config.ts`, `apps/web/lib/prisma.ts` |
| The database check the deploy smoke-tests | `apps/web/pages/api/health.ts` |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.template.jsonc` → `wrangler.jsonc`, `component.yaml`, `tooling/wire/worker-secrets.mjs` |
| The schema, row-level security and the cookie secret as migrations, and their runner | `packages/db` (`@saas/db`); `apps/web/prisma/migrations` is the schema's Prisma migration, for a local database |
| The Supabase project, the Hyperdrive config, the migration step | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `infra/db-migrate` |
| Tests | `tests/web`, `tests/db` (vitest) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # re-render apps/web/wrangler.jsonc from its template (it is committed)
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # prisma generate + next build + opennextjs-cloudflare build → apps/web/.open-next
```

The build needs no database: the blog's pages read it per request.

## Running it locally

You need a Postgres on `localhost:54322` — the Supabase CLI's default
(`supabase start`) — or any Postgres whose URL you put in `DATABASE_URL`
(`apps/web/.env.local`; `.env.example` lists the keys).

1. **Schema.** The Prisma CLI applies `apps/web/prisma/migrations` to
   `DATABASE_URL`:

   ```bash
   DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres pnpm --filter @app/web db:migrate
   DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres pnpm --filter @app/web db:seed   # optional: the template's sample users and posts
   ```

   What CI applies to the real databases is `packages/db/src/migrations`:
   the same schema, row-level security on every table, and a secret the
   database generates for next-auth (`app_private.secrets`). Locally, set
   `SECRET` in `.env.local` instead, or run those migrations too.

2. **Run.** Either Next's dev server, which gets the Worker's bindings
   through `getCloudflareContext()` (the `HYPERDRIVE` binding points at
   `localhost:54322` through `wrangler.jsonc`'s `localConnectionString`):

   ```bash
   pnpm --filter @app/web dev          # http://localhost:3000
   ```

   or the built Worker under `wrangler dev`:

   ```bash
   pnpm build
   pnpm --filter @app/web preview      # http://localhost:8787
   ```

   `/api/health` says whether the database is reachable and migrated. For
   GitHub sign-in locally, put an OAuth App's id and secret in
   `apps/web/.env.local` (or `.dev.vars` for `wrangler dev`) as `GITHUB_ID`
   and `GITHUB_SECRET`; its callback URL is
   `http://localhost:3000/api/auth/callback/github`.

## Connecting GitHub sign-in

The blog deploys and serves before it has any sign-in: until its Worker has
a GitHub OAuth App, next-auth has no provider, every visitor is signed out,
the feed and every published post read as usual, and "Log in" says how to
connect GitHub. To turn it on, per deployed environment:

1. **Create a GitHub OAuth App** (GitHub → Settings → Developer settings →
   OAuth Apps → New OAuth App). Its homepage URL is the environment's URL,
   and its **authorization callback URL** is that URL plus
   `/api/auth/callback/github` — for stage,
   `https://prisma-nextjs-blog-web-stage.your-workers-subdomain.workers.dev/api/auth/callback/github`.
   Generate a client secret.
2. **Give the Worker the app**, as this repository's Orun secrets for that
   environment. The deploy pushes them to the Worker as Worker secrets,
   read at request time and never in a bundle; stage and prod each name
   their own:

   ```bash
   orun secrets set GITHUB_ID      --env stage   # prompts for the value
   orun secrets set GITHUB_SECRET  --env stage
   orun secrets set GITHUB_ID      --env prod
   orun secrets set GITHUB_SECRET  --env prod
   ```

3. **Redeploy the blog**: the deploy is what pushes a secret to the Worker,
   and setting one deploys nothing. Use **Deploy by hand** below, or change
   the stamp on the last line of `apps/web/component.yaml`
   (`# orun: redeploy …`) and merge. From that deploy on, "Log in" offers
   **Sign in with GitHub**, and a signed-in writer gets **New post** and
   **My drafts**.

Sessions are rows in the `sessions` table (next-auth's Prisma adapter, as
upstream). The secret next-auth signs its CSRF and state cookies with is
one each environment's database generated for itself when the migrations
first ran (`app_private.secrets`), so there is no `SECRET` to set. To choose
your own, set `SECRET` as an Orun secret for the environment and redeploy;
it wins over the generated one.

## How it deploys

Merges to `main` converge through [Orun](https://github.com/sourceplane/orun):
`.github/workflows/ci.yml` plans the changed components and runs each lane
against the workspace in `intent.yaml`. Per environment the order is
enforced — **the Supabase project, then the Hyperdrive config over its
database, then the migrations, then the Worker** — because each reads what
the one before it published: the project's ref and password, the Hyperdrive
id the Worker binds, the tables and the cookie secret the blog reads.
`stage` deploys first and `prod` once stage has converged on the same
commit; `dev` only verifies. Every deploy is smoke-tested over HTTP: the
public feed, and `/api/health`, which answers only when the Worker reaches a
migrated database.

The pipeline holds one credential, GitHub's own `GITHUB_TOKEN`. The
Cloudflare tokens and account id and the Supabase access token and org id
are brokered per run from the workspace's connections; the Supabase
project's credentials and the Hyperdrive id are published by the Terraform
applies as orun secrets. Nothing provider-shaped is stored in the repository
or in GitHub. The only secrets the blog itself takes are GitHub sign-in's
(and `SECRET`, if you choose one), and those are yours to add.

Every table in `public` has row-level security and no policy, so Supabase's
Data API (which serves `public` to the project's anon key) returns none of
it — not a post, not a session token, not an OAuth token — and the cookie
secret is in `app_private`, a schema the Data API does not expose; the app
connects as the tables' owner and is not affected.

**Deploy by hand.** Orunbase's **Deploy** button on a component, or **Run
workflow** on the CI workflow in GitHub's Actions tab (on `main`), runs
`ci.yml` for the environment and components you pick, and each one deploys
exactly as a merge would deploy it. Leave the component blank to redeploy
every component in that environment, with nothing changed: after rotating a
secret, say. A component with nothing to run in that environment (a test
suite in `prod`) is left out with a notice.

## Changing the schema

`apps/web/prisma/schema.prisma` is the source of the Prisma client, and a
schema change is two migrations with the same statements: Prisma's, for a
local database (`pnpm --filter @app/web exec prisma migrate dev --name …`),
and the next numbered `packages/db/src/migrations/NNN_name/up.sql`, written
idempotent, for the deployed ones (then `pnpm --filter @saas/db run
manifest:fix`). `tests/db` holds the deployed schema to what Prisma writes
for `schema.prisma`.

## Custom domain

The app answers on workers.dev from its first deploy. To serve it on your
own domain, attach the domain to the Worker in Cloudflare (Workers & Pages →
`prisma-nextjs-blog-web-prod` → Settings → Domains & Routes). Nothing in the
build names the origin — next-auth reads it from each request — so the blog
follows the domain at once. If GitHub sign-in is connected, change the OAuth
App's callback URL to the domain's `/api/auth/callback/github`.

The repository also names the domain in one place, `BASE_DOMAIN` under each
environment's `env:` in `intent.yaml`, which the product was born with as the
reserved placeholder `prisma-nextjs-blog.example.com`. Nothing builds a URL
from it, so replacing it moves nothing by itself; it records the domain.

## CI

| Workflow | What it runs |
|---|---|
| `ci.yml` | the Orun pipeline, and the only workflow: `orun plan --changed`, then one job per lane. A pull request runs the verify lanes — the app built and dry-deployed for each environment, both Terraform roots checked and planned, the migrations planned and their checksums verified — with nothing applied or deployed. They do not typecheck, lint or run the tests: run `pnpm typecheck`, `pnpm lint` and `pnpm test` before you push (Getting started, above). A merge applies, migrates and deploys stage → prod |

## Credits

The blog is Vercel's Fullstack Blog with Next.js + Prisma template, by Prisma
([prisma/fullstack-prisma-nextjs-blog](https://github.com/prisma/fullstack-prisma-nextjs-blog),
MIT — `apps/web/LICENSE.md`).
