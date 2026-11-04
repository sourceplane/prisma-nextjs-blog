import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Upstream code as written: react-markdown's `<ReactMarkdown
    // children={…} />` in the feed and on the post page.
    rules: {
      "react/no-children-prop": "off",
    },
  },
  globalIgnores([".next/**", ".open-next/**", "next-env.d.ts", "cloudflare-env.d.ts", "prisma/generated/**"]),
]);
