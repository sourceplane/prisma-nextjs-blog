# prisma-nextjs-blog — open risks

What is not yet proven or not yet decided. The full write-up of every risk,
including the accepted and resolved ones, is
`specs/epics/prisma-nextjs-blog/risks-and-open-questions.md`; this page
lists only what is still live, so it should be short.

| ID | Risk | State | What closes it |
|---|---|---|---|
| PR-A | No live bootstrap yet: the repository created and linked, the five keys minted, real Terraform applies of the Supabase projects and Hyperdrive configs, a `db-migrate` apply against a real Supabase project, a real `wrangler deploy` with Worker secrets pushed, GitHub sign-in against a real OAuth App and the probes are all unproven | OPEN | One bootstrap from a tag against a workspace with Cloudflare and Supabase connections, then a GitHub OAuth App connected on stage |

Accepted, and worth knowing before you change them: PR-B (the Worker is
about 2.6 MiB gzipped — Prisma's query compiler is 3.4 MB of it — under
Workers Free's 3 MiB with little room), PR-C (next-auth 4 on Next.js 16 and
workerd, proven in a spike, not by its maintainers), PR-D (a schema change
is two migrations, Prisma's and db-migrate's, held together by tests/db),
PR-E (two Supabase projects per product — an owner prerequisite on the free
plan), PR-H (the cookie secret lives in the database).
