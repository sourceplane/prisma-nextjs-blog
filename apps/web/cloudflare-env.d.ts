// The bindings wrangler.jsonc declares, as the Worker (and `next dev` through
// the platform proxy) sees them.
interface CloudflareEnv {
  HYPERDRIVE: Hyperdrive
  ASSETS: Fetcher
  AUTH_TRUST_HOST: string
}
