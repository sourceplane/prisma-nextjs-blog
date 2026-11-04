import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

// Vitest globalSetup: lib/prisma.ts imports the Prisma client the build
// generates and nothing commits. Under turbo, `@app/web#generate` has already
// run (tests/web/turbo.json); run on its own (`npx vitest`), generate it here —
// only when it is missing, so a client another task is reading is never
// rewritten under it.
export default function setup(): void {
  const web = path.resolve(__dirname, "../../../apps/web");
  if (existsSync(path.join(web, "prisma/generated/client.ts"))) return;
  execFileSync(path.join(web, "node_modules/.bin/prisma"), ["generate"], { cwd: web, stdio: "pipe" });
}
