# db-tests

The migrations' tests (the manifest and its checksums, the blog schema the same statements as the Prisma migration and as Prisma's SQL for schema.prisma, the constraints next-auth relies on and the generated cookie secret, and row-level security on every table in public after every migration, on an in-process Postgres)

The test suite for **db**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/db`           |
| Package      | `@app/db-tests`      |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
