import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// `next dev` reaches the Hyperdrive binding through wrangler's local
// platform proxy (render apps/web/wrangler.jsonc first: `pnpm run wire:fixture`).
initOpenNextCloudflareForDev()

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The Workers runtime has no image optimiser.
    unoptimized: true,
  },
  // Pages Router dependencies are bundled into each page, not left as
  // `require()`s: @opennextjs/cloudflare re-bundles the server from
  // .next/standalone, and under pnpm the packages next-auth and styled-jsx
  // pull in (jose, @panva/hkdf, styled-jsx/style) are only in
  // node_modules/.pnpm, where that second bundle cannot resolve them.
  bundlePagesRouterDependencies: true,
  // The Prisma client (prisma/schema.prisma, `runtime = "workerd"`) imports
  // its query compiler as `./query_compiler_fast_bg.wasm?module`, a compiled
  // WebAssembly module — what a Worker must use, since it may not compile
  // WebAssembly at run time. webpack cannot load that request, and must not:
  // it is left as an import of the file's absolute path, which
  // @opennextjs/cloudflare keeps and wrangler bundles as a module.
  webpack(config, { isServer }) {
    if (isServer) {
      const prior = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)
      config.externals = [
        ...prior,
        ({ context, request }, callback) =>
          request && /\.wasm\?module$/.test(request)
            ? callback(null, `import ${path.resolve(context, request)}`)
            : callback(),
      ]
    }
    return config
  },
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
}

export default nextConfig
