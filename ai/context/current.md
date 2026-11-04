# prisma-nextjs-blog — where this repository stands

The entry page for anyone (or any agent) picking this repository up. It is
this repository's own state and does not ship to a product built from it;
the two pages that do are [operations.md](operations.md) and
[deployment.md](deployment.md).

## What it is

Vercel's Fullstack Blog with Next.js + Prisma template — a public feed,
drafts, posts in Markdown and GitHub sign-in through next-auth, every read
and write through Prisma — on Cloudflare Workers + Static Assets, with the
database a Supabase Postgres project reached through Hyperdrive, packaged as
an Orun baseline. `orun new --blueprint repo-blueprint.yaml` builds a new
product in its own repository and takes it to live on stage and prod in one
landing (`01-product`: supabase → cloudflare-hyperdrive → db-migrate → web
per environment), then records what went live (`02-docs`). GitHub sign-in
is the owner's to connect afterwards; until then the blog serves its feed
signed-out.

## Release

| | |
|---|---|
| Latest tag | `baseline-v1` — PR0 to PR2: the repository, the blog on Workers and Supabase, and the baseline (blueprint, phases, tests) |
| Proven live | Not yet: proven offline in Baseline CI only (risk PR-A) |

## Where to read

| Question | Page |
|---|---|
| What shipped, and every departure from upstream | `specs/epics/prisma-nextjs-blog/IMPLEMENTATION-STATUS.md` |
| Why it is built this way | [decisions.md](decisions.md), then `specs/epics/prisma-nextjs-blog/design.md` |
| What could still go wrong | [open-risks.md](open-risks.md), then `specs/epics/prisma-nextjs-blog/risks-and-open-questions.md` |
| How to instantiate it | `BOOTSTRAP.md`, `docs/phases/` |
| What each component is | `<component>/docs/` beside each `component.yaml` — `apps/web`, `packages/db`, `infra/db-migrate`, `infra/terraform/{supabase,cloudflare-hyperdrive}`, `tests/{web,db}` (generated; `python3 tooling/catalog/gen-component-docs.py`) |

## Next

1. Bootstrap one product from `baseline-v1` against a workspace with
   Cloudflare and Supabase connections and room for two Supabase projects
   (PR-E), connect a GitHub OAuth App on stage, sign in, write, publish and
   delete a post, and record the timings (closes PR-A).
