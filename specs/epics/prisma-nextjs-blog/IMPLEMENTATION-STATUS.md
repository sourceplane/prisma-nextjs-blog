# prisma-nextjs-blog — implementation status

| Milestone | State | Landed |
|---|---|---|
| PR0 — the spec | ✅ | PR-1 |
| PR1 — the blog on Workers and Supabase | ✅ | PR-2 |
| PR2 — a baseline | planned | PR-3 |

## Departures from the upstream template

Everything not listed here is the template as it is at `6a9c488`.

| # | What | Why |
|---|---|---|
| 1 | `/`, `/drafts` and `/p/[id]`: `getStaticProps` → `getServerSideProps`, `revalidate` dropped, and each returns the session in its props | There is no database at build (upstream's `/` queried it at build). Upstream's `/p/[id]` had no `getStaticPaths`, which Next refuses for a dynamic static page, and `/drafts` read a `req` that `getStaticProps` never receives, so it always answered 403. Handing the page the session renders it signed in on the first paint, instead of "Authenticating ..." |
| 2 | `/p/[id]` answers 404 for a post that does not exist | Upstream passed `null` as the page's props |
| 3 | The schema is applied by db-migrate from `packages/db` (`010_blog` is `prisma/migrations/20220408154015_init` made idempotent), plus `020_row_level_security` and `030_app_secrets`; `prisma/migrations` is kept for a local database | The runner reaches Supabase through its Management API, and CI holds no database URL for `prisma migrate deploy` |
| 4 | `lib/prisma.ts`: one client for the process → one per request over `PrismaPg` from the `HYPERDRIVE` binding (a Proxy behind the same `import prisma`); the generator gains `runtime = "workerd"` | No socket outlives a request on Workers; a Worker cannot compile WebAssembly at run time |
| 5 | Server code: `getSession({ req })` → `getServerSession(req, res, options)`; the options are built per request (`authOptions()`, async) | `getSession` on the server fetches the Worker's own `/api/auth/session` over HTTP; the secret may come from the database and GitHub may not be connected |
| 6 | `SECRET` optional: unset, the secret `030_app_secrets` generated (`lib/auth-secret.ts`) | Nothing to type at bootstrap |
| 7 | `GITHUB_ID`/`GITHUB_SECRET` optional (`lib/github.ts`); unset, no provider and next-auth's sign-in page is `pages/auth/not-connected.tsx` | The OAuth App is the owner's to create; next-auth's own page with no provider is a blank form |
| 8 | Publish and delete check the post is the visitor's own first (`lib/own-post.ts`: 404 / 403) | Upstream let any signed-in visitor publish or delete any post |
| 9 | `lib/site.ts` (`SITE_NAME`) and a `<title>` in `Layout` | One rename seam; upstream had no page title |
| 10 | `prisma.config.ts` sets the datasource only when `DATABASE_URL` is set | `prisma generate` at build has no database, and `env("DATABASE_URL")` refused to load the config without one |
| 11 | Next.js 13.5.11 → 16.3.8, React 18.3 → 19.3, react-markdown 8.0.7 → 10.1.0, `@types/react` 17 → 19; `pg` a direct dependency | OpenNext's supported Next; react-markdown 8 ships `.ts` sources using React 18's global `JSX`; bundled by webpack, `pg-cloudflare` resolved to its Node stub |
| 12 | `next.config.mjs` (upstream has none): `bundlePagesRouterDependencies`, the webpack externals rule for `*.wasm?module`, `images.unoptimized`, `output: 'standalone'`, the trace root at the workspace root; `open-next.config.ts`, `wrangler.template.jsonc` (`AUTH_TRUST_HOST`), `cloudflare-env.d.ts` added; `next build --webpack` | OpenNext's build of a Pages Router app under pnpm, and the Prisma client's compiled wasm |
| 13 | `tsconfig.json`: `moduleResolution: bundler`, `jsx: react-jsx`, `allowImportingTsExtensions`, target ES2022 (`strict: false` kept) | Next 16's requirements; the generated client imports `.ts` paths |
| 14 | `eslint.config.mjs` (none upstream) in eslint-config-next 16's flat form, `react/no-children-prop` off | Upstream's `<ReactMarkdown children={…} />`, as written |
| 15 | `docker-compose.yml`, `renovate.json`, `package-lock.json` and upstream's `db:up`/`db:down` scripts dropped; `db:migrate` and `db:seed` added | A pnpm workspace; the Supabase CLI is the local database |
| 16 | The app lives in `apps/web` of a pnpm workspace; `.env.example` rewritten for the local database and the optional keys; `LICENSE.md` beside it states MIT as the template's `package.json` declares it | The reference's shape; upstream ships no LICENSE file |

## Departures from the reference (admin-dashboard)

| # | What | Why |
|---|---|---|
| 1 | GitHub's OAuth App and `SECRET` are Worker SECRETS pushed by the deploy (cms-drupal's `tooling/wire/worker-secrets.mjs`), not values inlined into the server bundle | No bundle carries a secret |
| 2 | Hyperdrive caching off | The blog reads its own writes at once |
| 3 | No seed migration; the e2e writes the two writers' sessions as next-auth's adapter would, and drives a draft from creation to deletion | Upstream's deploy seeds nothing |
| 4 | webpack instead of Turbopack; the e2e checks the build ran on webpack | The Prisma client's `.wasm?module` import |
| 5 | The rename engine masks the template's page and its repository | Both spell this baseline's slug |

## Verified

- `pnpm typecheck`, `lint`, `test` (tests/web 39, tests/db 19) and `build`
  green; the Worker is 2653 KiB gzipped (Workers Free).
- Under `wrangler dev` over a PGlite stand-in with `packages/db`'s
  migrations: the feed, drafts (403 signed out), a missing post (404), the
  not-connected sign-in page, `/api/health`; signed in through a database
  session, a draft created, viewed with its buttons, published to the feed
  and deleted, while another writer got 403 and an anonymous visitor 401;
  with an OAuth App's id and secret set, sign-in redirected to GitHub's
  authorize URL. The spike ran the full OAuth code exchange on workerd
  against a stand-in for GitHub.
- Every contract tier, the leak gate and the placement tier pass locally on
  orun v2.89.0. The e2e tier needs a PostgreSQL server (initdb, pg_ctl,
  psql), which this build's machine did not have: it ran on Baseline CI,
  where every pull request ran it before it merged.
