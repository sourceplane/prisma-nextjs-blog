// GitHub sign-in (next-auth's GitHub provider), when its OAuth App is
// connected.
//
// The template has visitors sign in with a GitHub OAuth App whose client id
// and secret its owner creates and sets as GITHUB_ID and GITHUB_SECRET. A
// product built from nothing has no OAuth App yet, and it must still deploy,
// serve and pass its smoke test — so until both are set the blog runs without
// sign-in: next-auth has no provider, every visitor is signed out, the feed
// and posts render, and the sign-in page says how to connect GitHub instead of
// offering a button that cannot work.
//
// Both are Worker SECRETS read at request time, never in a bundle: per
// environment they are this repository's Orun secrets GITHUB_ID and
// GITHUB_SECRET, which the deploy pushes to the Worker (apps/web/component.yaml
// `optionalSecretEnv` and tooling/wire/worker-secrets.mjs). Locally, .dev.vars
// or .env.local.
export type GitHubSignIn = { clientId: string; clientSecret: string };

export function githubSignIn(): GitHubSignIn | null {
  const clientId = process.env.GITHUB_ID?.trim();
  const clientSecret = process.env.GITHUB_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
