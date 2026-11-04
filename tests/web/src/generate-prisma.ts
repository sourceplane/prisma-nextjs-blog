import { execFileSync } from "node:child_process";
import * as path from "node:path";

// Vitest globalSetup: `prisma generate` in apps/web (what its build and
// typecheck run first), so lib/prisma.ts's import of prisma/generated resolves.
export default function setup(): void {
  const web = path.resolve(__dirname, "../../../apps/web");
  execFileSync(path.join(web, "node_modules/.bin/prisma"), ["generate"], { cwd: web, stdio: "pipe" });
}
