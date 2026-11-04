# Epics

Orun-style work programs. Each epic is a folder carrying `epic.yaml` (the
declaration the platform reads: slug, key prefix, milestones with exit
criteria and task keys) beside its doc set. The pull request that adds the
folder is the adoption; the merge creates the epic in the workspace.

| Epic | Cluster | Status | What it is |
|------|---------|--------|------------|
| [`prisma-nextjs-blog/`](./prisma-nextjs-blog/) | **PR** | ✅ Shipped (`baseline-v1`); not yet live | Vercel's Fullstack Blog with Next.js + Prisma — a feed, drafts, posts and GitHub sign-in through next-auth, read and written with Prisma — on Cloudflare Workers with Supabase Postgres through Hyperdrive, and an Orun baseline that instantiates it in one landing (PR2) |

As-built ≠ intent: what shipped lives in each epic's `IMPLEMENTATION-STATUS.md`.
