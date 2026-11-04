# @app/web — the blog on Cloudflare Workers

Vercel's [Fullstack Blog with Next.js + Prisma](https://vercel.com/templates/next.js/fullstack-prisma-nextjs-blog)
template, https://github.com/prisma/fullstack-prisma-nextjs-blog: a public
feed of published posts, drafts, a post page in Markdown, and GitHub
sign-in through [next-auth](https://next-auth.js.org) with its Prisma
adapter, every read and write through [Prisma](https://www.prisma.io), on
the Pages Router. Here it is built by
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) into one
Worker plus Static Assets, and its Postgres is reached through the Worker's
`HYPERDRIVE` binding.

| File | What it does |
|---|---|
| `lib/site.ts` | The product's name: the page `<title>` |
| `prisma/schema.prisma` | Upstream's models — `Post`, and next-auth's `User`, `Account`, `Session`, `VerificationToken` — with the client generated for the Workers runtime (`runtime = "workerd"`) |
| `lib/prisma.ts` | A `PrismaClient` per request over `@prisma/adapter-pg` — the `HYPERDRIVE` binding's connection string on the Worker, `DATABASE_URL` without a Cloudflare context — behind upstream's `import prisma` |
| `lib/auth.ts` | Upstream's next-auth options (GitHub, the Prisma adapter, the secret), built per request |
| `lib/auth-secret.ts` | The cookie secret: `SECRET` when set, else the one the database generated (`app_private.secrets`) |
| `lib/github.ts` | GitHub sign-in, once its OAuth App's id and secret are both Worker secrets |
| `lib/own-post.ts` | Publish and delete act only on the signed-in visitor's own post (404, 403 otherwise) |
| `pages/`, `components/` | Upstream's pages and components; the data pages read per request (`getServerSideProps`) and hand the session to the page |
| `pages/auth/not-connected.tsx` | next-auth's sign-in page until GitHub is connected: says how to connect it |
| `pages/api/health.ts` | 200 only when the database answers through the binding, the blog's tables exist with row-level security and the cookie secret is there |
| `prisma/migrations`, `prisma.config.ts`, `prisma/seed.ts` | The Prisma CLI, for a local database (`pnpm db:migrate`, `pnpm db:seed`); the deployed databases are migrated by db-migrate from `packages/db` — the same schema |
| `wrangler.template.jsonc` → `wrangler.jsonc` | The Worker's config; the render is committed (`pnpm run wire:fixture`) |

```bash
pnpm db:migrate     # upstream's migration, into DATABASE_URL (the Supabase CLI's localhost:54322, say)
pnpm db:seed        # optional: the template's sample users and posts
pnpm dev            # prisma generate + next dev, with the Worker's bindings through wrangler's platform proxy
pnpm generate && pnpm build && pnpm preview   # the built Worker under wrangler dev (under turbo, `generate` runs first by itself)
```
