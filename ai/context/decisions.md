# prisma-nextjs-blog — decisions

The choices that shape this repository, one line each, with where the full
reasoning lives. Superseded decisions stay listed, marked, so the history
reads in order.

| # | Decision | Why | Source |
|---|---|---|---|
| 1 | A `PrismaClient` per request over `@prisma/adapter-pg` (`lib/prisma.ts`), keyed by the request's ExecutionContext, Hyperdrive's connection string first, `DATABASE_URL` without a Cloudflare context; upstream's `import prisma` kept as a Proxy onto it | The Workers runtime refuses to share a socket across requests; Hyperdrive pools on Cloudflare's side; no call site changes | `specs/epics/prisma-nextjs-blog/design.md` |
| 2 | The Prisma client generated with `runtime = "workerd"`, its `.wasm?module` import left by a webpack externals rule for wrangler to bundle; `next build --webpack` | A Worker may not compile WebAssembly at run time; webpack cannot load a `?module` request, and must not | `apps/web/next.config.mjs`, spike notes |
| 3 | `bundlePagesRouterDependencies: true` and `pg` a direct dependency | OpenNext re-bundles from `.next/standalone`, where pnpm leaves next-auth's and styled-jsx's packages unresolvable; bundled by webpack, `pg-cloudflare` resolves to its Node stub | `apps/web/next.config.mjs`, `apps/web/package.json` |
| 4 | The schema and the cookie secret are `db-migrate`'s (`packages/db`), applied before the Worker deploys; `010_blog` is upstream's Prisma migration made idempotent, held to `prisma migrate diff` by tests/db | The runner reaches Supabase through its Management API, with no database URL in CI | IMPLEMENTATION-STATUS (departure 3) |
| 5 | Row-level security on every table in `public`, with no policy; the cookie secret in `app_private` | Supabase's Data API serves `public` to the public anon key, and `sessions`/`accounts` hold session and OAuth tokens; the app connects as the tables' owner | risk PR-H |
| 6 | The cookie secret is `SECRET` if set, else the one `030_app_secrets` generated | A bootstrap cannot type a secret; each environment gets its own, typed by nobody; sessions are database rows, so it can change without signing anybody out | `apps/web/lib/auth-secret.ts` |
| 7 | GitHub sign-in is optional and the owner's: `GITHUB_ID`/`GITHUB_SECRET` as optional Orun secrets pushed to the Worker as Worker SECRETS at deploy (never in a bundle); unset, no provider and a sign-in page that says how to connect one | Only the owner can create an OAuth App, and the product must deploy before they do | `apps/web/lib/github.ts`, `apps/web/component.yaml`, `tooling/wire/worker-secrets.mjs` |
| 8 | next-auth 4 kept (the template's), with `getServerSession` in server code instead of `getSession({ req })` | next-auth 4's OAuth exchange runs on workerd (spike); `getSession` on the server is an HTTP request to the Worker's own hostname | spike notes, design.md (Alternatives) |
| 9 | Pages read per request (`getServerSideProps`) and hand the session to the page | Upstream's `getStaticProps` queried the database at build (none here) and could not read the session; `/p/[id]` had no `getStaticPaths` | IMPLEMENTATION-STATUS (departures 1, 2) |
| 10 | Publish and delete only on the visitor's own post (404/403) | Upstream's routes let any signed-in visitor act on any post | `apps/web/lib/own-post.ts`, risk PR-F |
| 11 | Hyperdrive caching off | The blog reads its own writes at once; a cached read hides the draft just written | `infra/terraform/cloudflare-hyperdrive/terraform/main.tf` |
| 12 | The build takes no origin; `AUTH_TRUST_HOST=true` | Nothing the blog renders is absolute; next-auth reads the origin from each request | `apps/web/wrangler.template.jsonc` |
| 13 | `wrangler.jsonc` committed as the fixture render; stage and prod re-render it from their wiring document | The composition checks for it before the build | `apps/web/component.yaml` |
| 14 | One landing (`01-product`) then the record (`02-docs`); every edge `mode: enforced` on main, advisory on a pull request | One convergence runs supabase → cloudflare-hyperdrive → db-migrate → web per environment | `repo-blueprint.yaml`, `testing/placement.test.sh` |
| 15 | The migrations package is named `@saas/db` | stack-tectonic's db-migrate composition builds `--filter=@saas/db` | `packages/db/package.json` |
| 16 | `ci.yml` plans nothing while `intent.yaml` names `ws_CHANGE_ME` (the `linked` step) | A bootstrap cannot set a repository variable | `.github/workflows/ci.yml` |
| 17 | stack-tectonic 0.19.0, not 0.20.0 | 0.20.0's lane-scoped install links each job's node_modules out of its tree; the reference's pin, proven with OpenNext | `intent.yaml` |
| 18 | orun is pinned only where it runs (the `orun-action` `version:` in each workflow); no kiox | One pin per place orun runs | the workflows |
| 19 | Component docs are generated from the manifests and checked in CI | A hand-written copy of the dependency graph, bindings and migrations drifts silently | `tooling/catalog/gen-component-docs.py` |
| 20 | The console card reads `subdomain` from the Cloudflare connection, and asks for no domain | It belongs to the account; the app goes live on workers.dev | `blueprint.yaml`, `tooling/rebrand/rebrand.mjs` |
| 21 | The turso-starter v8 shape on orun v2.88.0: no `checks.yml`; the brokered keys in one `secrets` reconcile; every component's generated pages attached; the task set-up in the background, each landing checked in the box (`checks: local`), the watch at 5 s | A bootstrap waits on nothing that does not need waiting for | `repo-blueprint.yaml`, `testing/phases.test.sh`, `testing/coverage.test.sh` |
| 22 | The rename engine masks the template's page and repository | `…/fullstack-prisma-nextjs-blog` spells this baseline's slug in both | `tooling/rebrand/rebrand.mjs` (`UPSTREAM`) |
