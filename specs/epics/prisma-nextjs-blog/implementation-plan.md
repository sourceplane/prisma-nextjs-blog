# prisma-nextjs-blog — implementation plan

Three milestones, each one reviewed pull request (PR0 is the repository's
first commit and its spec), each green before it merges.

## PR0 — the spec (PR-1)

The repository is born: `intent.yaml` with the placeholder workspace
`ws_CHANGE_ME`, `ci.yml` (byte for byte turso-starter's, with the comment
lines admin-dashboard's own copy changes), the shared TypeScript and ESLint
configuration, the wiring renderer and migration helpers, the spec index,
this doc set and the task contracts.

## PR1 — the blog on Workers and Supabase (PR-2)

- The template in `apps/web` on Next.js 16.3.8, the Pages Router kept: the
  Prisma schema with `runtime = "workerd"`, `lib/prisma.ts` (a client per
  request through `HYPERDRIVE`), the webpack externals rule for the query
  compiler's wasm, `bundlePagesRouterDependencies`, `pg` direct.
- next-auth 4 built per request (`lib/auth.ts`): the secret from
  `lib/auth-secret.ts`, GitHub from `lib/github.ts` only when its OAuth App
  is set, the not-connected sign-in page until then; `getServerSession` in
  every server read; `lib/own-post.ts` for publish and delete.
- The data pages on `getServerSideProps`, the session in their props; a
  missing post is a 404; react-markdown 10.
- `lib/site.ts` (the name seam), `pages/api/health.ts`.
- `wrangler.template.jsonc` (`AUTH_TRUST_HOST`) + `wiring.fixture.json`,
  `component.yaml` (the GitHub keys and `SECRET` as optional secrets pushed
  as Worker secrets, the smoke), `tooling/wire/worker-secrets.mjs`.
- `packages/db`: `010_blog`, `020_row_level_security`, `030_app_secrets`;
  the Supabase and Hyperdrive roots (caching off); `infra/db-migrate`.
- `tests/web` (the client per request, next-auth's options, the cookie
  secret, GitHub's switch, the pages, who may create, publish and delete, the
  health check, the wrangler config) and `tests/db` (the manifest, the Prisma
  parity, the constraints, the secret, row-level security, on PGlite).

## PR2 — a baseline (PR-3)

admin-dashboard's machinery on this tree: `blueprint.yaml`,
`repo-blueprint.yaml` (five brokered keys), `.baseline/` (identity, the
product's README with "Connecting GitHub sign-in", task contracts), the
rename engine (the template's page and repository masked), the bootstrap
helpers, the record renderer (probing `/`, `/api/health` and
`/api/auth/providers`), `docs/phases/`, the context pack, and `testing/` —
the leak and placement gates (the GitHub refs and `SECRET` optional in the
product's own plan), and the e2e tier that migrates the stage database
through a stand-in Supabase API, then serves the built Worker over it: the
feed, Log in with GitHub not connected, an author's draft written,
published and deleted while another writer is refused, and the Data API's
roles refused.
