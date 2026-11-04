import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI's config. The commands that reach a database (`prisma migrate
// deploy`, `prisma db seed`: pnpm db:migrate / db:seed) need DATABASE_URL;
// `prisma generate`, which the build runs, does not — and the Worker's build
// has none, its database being the HYPERDRIVE binding. Upstream read it with
// `env("DATABASE_URL")`, which refuses to load the config at all without it.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx ./prisma/seed.ts",
  },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
