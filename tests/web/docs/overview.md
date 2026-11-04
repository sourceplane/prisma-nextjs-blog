# web-tests

The app's tests (the per-request Prisma client, Hyperdrive first; the feed, drafts and post pages; who may create, publish and delete; the cookie secret and next-auth's options with GitHub connected or not; the /api/health database check; the committed wrangler config)

The test suite for **web**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/web`          |
| Package      | `@app/web-tests`     |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
