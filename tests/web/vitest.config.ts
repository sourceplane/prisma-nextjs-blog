import { defineConfig } from "vitest/config";
import * as path from "node:path";

const web = path.resolve(__dirname, "../../apps/web");

export default defineConfig({
  resolve: {
    alias: {
      // The modules under test import these through apps/web's own copies;
      // pointing the tests at those same copies is what makes `vi.mock(...)`
      // of them apply to the app's imports too.
      "@opennextjs/cloudflare": path.resolve(web, "node_modules/@opennextjs/cloudflare"),
      "next-auth/next": path.resolve(web, "node_modules/next-auth/next/index.js"),
      "@prisma/adapter-pg": path.resolve(web, "node_modules/@prisma/adapter-pg"),
      "@": web,
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // lib/prisma.ts imports the generated Prisma client, which the build
    // generates and nothing commits: generate it first.
    globalSetup: ["src/generate-prisma.ts"],
  },
});
