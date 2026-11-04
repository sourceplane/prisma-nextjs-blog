#!/usr/bin/env bash
# TIER 2 — the product a bootstrap produces builds, migrates, deploys (dry),
# serves the blog from its migrated database, and lets a signed-in author
# write, publish and delete — and nobody else.
#
# placement.test.sh proves the tree a bootstrap ends with is the right tree,
# and that its own plan converges in the right order. This proves it WORKS,
# by doing to it what its own pipelines will:
#
#   1. at the 01-product landing (the commit its PR merges), install with the
#      lockfile the product ships, render the wrangler fixture (which must
#      change nothing: the render is committed), typecheck, lint, test, build.
#      The landing itself is checked in the build box with `orun validate`
#      and `orun plan` alone (`checks: local`), and its PR runs `plan` alone
#      (an `orun/BASE-*` branch), so THIS is where a product those steps
#      refuse is caught: before the tag, not after a build has merged it;
#   2. a Postgres of its own on a random port, with Supabase's roles — the
#      database a Supabase project would be: `postgres` a login role WITHOUT
#      superuser or BYPASSRLS, `anon` and `authenticated` with the Data API's
#      default grants (testing/lib/local-postgres.sh) — and a stand-in for the
#      ONE Supabase Management API endpoint the migration runner calls
#      (testing/lib/fake-supabase-api.py), connected as `postgres`;
#   3. the db-migrate lane's own steps, rendered by `orun plan` for a push to
#      main and run IN THE TREE THE RUNNER STAGES for the job: install, build
#      @saas/db, apply — the blog's tables (posts, and next-auth's users,
#      accounts, sessions and verification tokens), row-level security on
#      every table in `public`, and the cookie secret in app_private — then
#      apply again, which must apply nothing, and the pull-request profile's
#      offline plan. The tables exist before the app serves a single request;
#   4. the web lane's own steps for stage, rendered for a pull request (the
#      verify profile carries deploy-dry-run; the deploy profile does not) and
#      run in its staged job tree: install, `verify-app-structure` (the
#      committed wrangler.jsonc must exist BEFORE the build, in a tree with no
#      build output), `build-app` — which re-renders the config from the
#      stage wiring document it is handed, as the deploy does — then
#      `verify-build-output` and `deploy-dry-run`;
#   5. the built Worker under `wrangler dev`, its HYPERDRIVE binding pointed at
#      that Postgres (the binding stubbed to the local database, as Hyperdrive
#      would hand the Worker the Supabase one). Eight concurrent FIRST
#      requests to the feed — each one's next-auth options reading the cookie
#      secret from the database as a fresh isolate's first request does:
#      every one renders the feed, and nothing is written. Then the
#      component's OWN `smokeCommand`, verbatim; every route the product
#      promises (the feed under the product's name, "Log in" saying GitHub is
#      not connected, next-auth's own endpoints, the drafts page refusing an
#      anonymous visitor, a missing post's 404, `/api/health`, which only the
#      Worker answers, and a page script); then a signed-in author — a
#      database session, as next-auth's Prisma adapter writes one after GitHub
#      sign-in — writing a draft, reading it on the drafts and post pages,
#      publishing it to the feed and deleting it, while another signed-in
#      writer is refused both, and an anonymous visitor every write;
#   6. the Data API's view of the same database: every table in `public` has
#      row-level security, and `anon` and `authenticated` — granted everything
#      Supabase grants them — read none of the posts, sessions or OAuth
#      accounts and can write no post, and cannot reach the cookie secret at
#      all, while the app, as the tables' owner and nothing more, reads them
#      all.
#
# What it cannot do is the platform's half: create the repository, mint the
# brokered tokens, create a real Supabase project and Hyperdrive config
# (Terraform is validated, not applied, in this repository), deploy for real
# and probe workers.dev. That is a bootstrap against a workspace
# (BOOTSTRAP.md); everything short of it is here.
#
# Needs: orun, node, pnpm, python3 (+PyYAML), git, curl, psql and a
# PostgreSQL server install (initdb, pg_ctl), and the network for
# `pnpm install` (or a warm store). A few minutes: three installs, two builds.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=lib/bootstrap.sh
source "$here/lib/bootstrap.sh"
# shellcheck source=lib/local-postgres.sh
source "$here/lib/local-postgres.sh"

for bin in orun node pnpm python3 git curl psql; do
  command -v "$bin" >/dev/null || { echo "e2e.test.sh needs $bin on PATH" >&2; exit 1; }
done
pg_bin >/dev/null || { echo "e2e.test.sh needs a PostgreSQL server install (initdb, pg_ctl)" >&2; exit 1; }

scratch="$(mktemp -d)"
pgdir="$(mktemp -d)"
dev_pid=""
api_pid=""
# wrangler dev runs under pnpm, node and two workerd processes; a TERM to the
# first does not reach the rest, and waiting on it then never returns. So each
# server is started as its own process group (setsid) and the group stopped.
stop_group() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
}
cleanup() {
  stop_group "$dev_pid"
  stop_group "$api_pid"
  pg_down "$pgdir"
  [ -n "$pgdir" ] && [ -d "$pgdir" ] && rm -rf "$pgdir"
  [ -n "$scratch" ] && [ -d "$scratch" ] && rm -rf "$scratch"
}
trap cleanup EXIT
free_port() { python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"; }
values="$here/fixtures/acme.json"
repo="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['reponame'])" "$values")"
export CI=1 WRANGLER_SEND_METRICS=false NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1

# The landing's own checks, step for step — what the product's Checks
# workflow ran on a pull request before the product carried ci.yml alone —
# run here at once on the whole tree.
LANDING_CHECKS=(
  "pnpm install --frozen-lockfile"
  "pnpm run wire:fixture"
  "pnpm typecheck"
  "pnpm lint"
  "pnpm test"
  "pnpm build"
)
checks() { # DIR LOG
  local dir="$1" log="$2" cmd
  for cmd in "${LANDING_CHECKS[@]}"; do
    echo "   \$ $cmd" | tee -a "$log"
    if ! (cd "$dir" && bash -c "$cmd") >> "$log" 2>&1; then
      echo "FAIL: \`$cmd\` failed in $dir" >&2; tail -40 "$log" >&2; return 1
    fi
  done
}

# One job of a plan, written out as the runner would run it: each `run:` step
# (the `use:` actions are setup-node and setup-pnpm, which this machine has)
# as a numbered script, the job's env, and the component path the steps run
# in. Steps are picked BY ID when given, else every `run:` step in order.
extract_job() { # PLAN JOB-ID OUT-DIR [STEP-ID…]
  python3 - "$@" <<'PY'
import json, pathlib, sys
plan, jid, out, *want = sys.argv[1:]
job = next((j for j in json.load(open(plan))["jobs"] if j["id"] == jid), None)
if job is None:
    sys.exit(f"the plan has no job {jid}")
out = pathlib.Path(out); out.mkdir(parents=True)
steps = [s for s in job["steps"] if s.get("run")]
if want:
    by = {s["id"]: s for s in steps}
    missing = [w for w in want if w not in by]
    if missing:
        sys.exit(f"{jid} has no step(s) {missing}")
    steps = [by[w] for w in want]
for i, s in enumerate(steps):
    (out / f"{i:02d}.sh").write_text(s["run"])
    (out / f"{i:02d}.id").write_text(s["id"])
(out / "path").write_text(job.get("path") or ".")
with (out / "env").open("w") as f:
    for k, v in (job.get("env") or {}).items():
        f.write(f"export {k}={json.dumps(v)}\n")
PY
}
run_job() { # STEPS-DIR WORK-TREE ENV LOG-PREFIX
  local steps="$1" work="$2" envname="$3" logp="$4" s id
  for s in "$steps"/[0-9][0-9].sh; do
    id="$(cat "${s%.sh}.id")"
    echo "   ▸ $id"
    if ! (cd "$work/$(cat "$steps/path")" && source "$steps/env" && export ORUN_ENVIRONMENT="$envname" \
          && bash -e "$s") > "$logp-$id.log" 2>&1; then
      echo "FAIL: the lane's $id step" >&2; tail -40 "$logp-$id.log" >&2; return 1
    fi
  done
}

echo "── the offline bootstrap (testing/lib/bootstrap.sh)"
tree="$scratch/$repo"
bootstrap_offline "$root" "$tree" "$values" "$scratch/logs" > "$scratch/bootstrap.log" 2>&1 || {
  echo "FAIL: the offline bootstrap stopped" >&2; tail -40 "$scratch/bootstrap.log" >&2; exit 1; }
echo "   2 phases placed and landed"

# ── 1. the product's own pull request ──────────────────────────────────────
echo "── 01-product's landing: install, the fixture render, typecheck, lint, test, build"
s01="$(git -C "$tree" rev-parse HEAD~1)"
at01="$scratch/at-01/$repo"
git -C "$tree" worktree add -q "$at01" "$s01"
checks "$at01" "$scratch/checks.log"
dirty="$(git -C "$at01" status --porcelain)"
[ -z "$dirty" ] || { echo "FAIL: the checks changed tracked files — the committed wrangler.jsonc is not the fixture render:" >&2; echo "$dirty" >&2; exit 1; }
echo "   the checks left the tree as committed (wire:fixture rendered the committed wrangler.jsonc)"

# ── 2. a database, and the one API the migration runner calls ──────────────
echo "── a local Postgres and the Supabase Management API stand-in"
pgurl="$(pg_up "$pgdir" "$(free_port)")" || { echo "FAIL: Postgres did not start" >&2; exit 1; }
api_port="$(free_port)"
ref="localproject"
setsid python3 "$here/lib/fake-supabase-api.py" "$api_port" "$pgurl" --ref "$ref" > "$scratch/api.log" 2>&1 < /dev/null &
api_pid=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$api_port/" && break; sleep 0.3; done
# Said out loud rather than found later as the runner's bare "fetch failed":
# the stand-in must be up, and stay up, before a lane is pointed at it.
api_up() { kill -0 "$api_pid" 2>/dev/null && curl -s -o /dev/null "http://127.0.0.1:$api_port/"; }
api_up || { echo "FAIL: the Management API stand-in is not answering on :$api_port" >&2; cat "$scratch/api.log" >&2; exit 1; }
echo "   $pgurl; the API on :$api_port"

# The two plans the lanes below run from, each in the product's own tree: a
# push to main at the 01-product commit (the db-migrate lane's APPLY profile),
# and a pull request over the finished product against an empty base (the web
# lane's VERIFY profile, which carries deploy-dry-run, and db-migrate's PLAN).
(cd "$at01" && orun plan --intent intent.yaml --trigger github-push-main --env stage --output "$scratch/plan-main.json") > "$scratch/plan-main.log" 2>&1 \
  || { echo "FAIL: orun plan (push to main)" >&2; tail -15 "$scratch/plan-main.log" >&2; exit 1; }
git -C "$tree" worktree remove --force "$at01"
mkdir -p "$scratch/pr"
git clone -q "$tree" "$scratch/pr/$repo"
prtree="$scratch/pr/$repo"
git -C "$prtree" checkout -q --orphan empty
git -C "$prtree" rm -rqf .
git -C "$prtree" -c user.email=t@example.invalid -c user.name=t commit -qm empty --allow-empty
git -C "$prtree" checkout -q main
(cd "$prtree" && orun plan --intent intent.yaml --trigger github-pull-request --base empty --head HEAD --env stage \
   --output "$scratch/plan-pr.json") > "$scratch/plan-pr.log" 2>&1 \
  || { echo "FAIL: orun plan (pull request)" >&2; tail -15 "$scratch/plan-pr.log" >&2; exit 1; }
# This tier runs the bootstrap floor, newer than the orun the product's CI
# pins, and both read the per-edge `modeRules`: on a pull request — which
# applies and deploys nothing — the infrastructure edges that order a push to
# main are advisory, so no lane waits on another. (placement.test.sh checks
# the push to main's order.)
python3 - "$scratch/plan-pr.json" <<'PY'
import json, sys
jobs = {j["component"]: j for j in json.load(open(sys.argv[1]))["jobs"] if j["environment"] == "stage"}
chain = ["supabase", "cloudflare-hyperdrive", "db-migrate", "web"]
for a, b in zip(chain, chain[1:]):
    ja, jb = jobs[a], jobs[b]
    if ja["id"] in (jb.get("dependsOn") or []) or ja["id"] not in (jb.get("advisoryDependsOn") or []):
        sys.exit(f"FAIL: on a pull request {b}@stage must name {a}@stage as advisory, not wait on it")
print("   pull request: " + " → ".join(chain) + ", every edge advisory")
PY

# ── 3. the db-migrate lane, in its staged job tree ─────────────────────────
echo "── the stage db-migrate lane: install, build @saas/db, apply — then apply again, and the PR's plan"
extract_job "$scratch/plan-main.json" db-migrate.stage.migrate "$scratch/steps-migrate" \
  install-dependencies build-db-package "Migration Apply"
extract_job "$scratch/plan-main.json" db-migrate.stage.migrate "$scratch/steps-migrate-again" "Migration Apply"
extract_job "$scratch/plan-pr.json" db-migrate.stage.migrate "$scratch/steps-migrate-plan" "Migration Plan"
# Staged from the fresh clone (a CI checkout: no build output, no
# node_modules); its migrations are the 01-product commit's, byte for byte.
mwork="$prtree/.orun/runs/e2e/db-migrate.stage.migrate/work"
python3 "$here/lib/stage-job.py" "$prtree" "$mwork"
# The component's secretEnv, as the lane resolves it: the supabase apply's
# published credentials and the brokered access token. SUPABASE_API_URL is
# the one value no lane has — it points the runner at the stand-in.
export SUPABASE_ACCESS_TOKEN=e2e-token SUPABASE_PROJECT_REF="$ref" SUPABASE_DB_PASSWORD=postgres \
       SUPABASE_DB_URL="$pgurl" SUPABASE_API_URL="http://127.0.0.1:$api_port"
api_up || { echo "FAIL: the Management API stand-in stopped before the lane ran" >&2; cat "$scratch/api.log" >&2; exit 1; }
run_job "$scratch/steps-migrate" "$mwork" stage "$scratch/migrate" \
  || { echo "   the stand-in's log:" >&2; tail -20 "$scratch/api.log" >&2; exit 1; }
applied() { python3 -c "import json,sys;t=open(sys.argv[1]).read();print(' '.join(json.loads(t[t.index('{'):t.rindex('}')+1])['applied']))" "$1"; }
want="000_control_baseline 010_blog 020_row_level_security 030_app_secrets"
[ "$(applied "$scratch/migrate-Migration Apply.log")" = "$want" ] \
  || { echo "FAIL: the first apply applied '$(applied "$scratch/migrate-Migration Apply.log")', not '$want'" >&2; exit 1; }
echo "   applied $want"
run_job "$scratch/steps-migrate-again" "$mwork" stage "$scratch/migrate-again"
[ -z "$(applied "$scratch/migrate-again-Migration Apply.log")" ] \
  || { echo "FAIL: a second apply applied '$(applied "$scratch/migrate-again-Migration Apply.log")'" >&2; exit 1; }
echo "   a second apply applied nothing (the ledger holds $(psql "$pgurl" -XAtc 'select count(*) from _migrations.applied') migrations)"
tables="$(psql "$pgurl" -XAtc "select string_agg(c.relname || ':' || c.relrowsecurity || ':' || pg_get_userbyid(c.relowner), ' ' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")"
[ "$tables" = "Post:true:postgres accounts:true:postgres sessions:true:postgres users:true:postgres verificationtokens:true:postgres" ] \
  || { echo "FAIL: after the migrations the blog's five tables should exist, with RLS, owned by postgres — got '$tables'" >&2; exit 1; }
[ "$(psql "$pgurl" -XAtc 'select count(*) from "Post"')" = 0 ] \
  || { echo "FAIL: a fresh database should hold no posts (upstream seeds by hand)" >&2; exit 1; }
key="$(psql "$pgurl" -XAtc "select count(*) || ' ' || coalesce(max(length(value)), 0) || ' ' || bool_and(value ~ '^[0-9a-f]{64}$') from app_private.secrets where name = 'auth_secret'")"
[ "$key" = "1 64 true" ] || [ "$key" = "1 64 t" ] \
  || { echo "FAIL: after the migrations app_private.secrets should hold one 64-hex auth_secret — got '$key'" >&2; exit 1; }
echo "   the blog's five tables exist before the app serves: row-level security on, owned by postgres, empty; a cookie secret of its own in app_private"
run_job "$scratch/steps-migrate-plan" "$mwork" stage "$scratch/migrate-plan"
[ "$(applied "$scratch/migrate-plan-Migration Plan.log")" = "$want" ] \
  || { echo "FAIL: the pull request's offline plan did not verify every migration" >&2; exit 1; }
echo "   the pull request's plan step verifies every migration's checksum offline"
unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD SUPABASE_DB_URL SUPABASE_API_URL
rm -rf "$mwork"

# ── 4. the web lane's steps, for stage ─────────────────────────────────────
echo "── the stage web lane: install, verify-app-structure, build-app, verify-build-output, deploy-dry-run"
extract_job "$scratch/plan-pr.json" web.stage.verify-deploy "$scratch/steps-web" \
  install-workspace-dependencies verify-app-structure build-app verify-build-output deploy-dry-run
work="$prtree/.orun/runs/e2e/web.stage.verify-deploy/work"
# The job's private tree, staged as orun stages it — no build output, no
# node_modules: under stack-tectonic 0.19.0 the job installs inside it.
python3 "$here/lib/stage-job.py" "$prtree" "$work"
[ ! -e "$work/apps/web/.open-next" ] && [ -f "$work/apps/web/wrangler.jsonc" ] \
  || { echo "FAIL: the staged tree is not a fresh checkout with the committed wrangler.jsonc" >&2; exit 1; }
echo "   staged: $(realpath --relative-to="$prtree" "$work") — no build output, the committed wrangler.jsonc"
# The stage wiring document, as the cloudflare-hyperdrive apply publishes it
# and the lane resolves it (secretEnv WIRING_CLOUDFLARE_HYPERDRIVE_STAGE).
hd_id="e2e0000000000000000000000000c0de"
export WIRING_CLOUDFLARE_HYPERDRIVE_STAGE="{\"hyperdrive_id\":\"$hd_id\",\"hyperdrive_name\":\"stg-$repo-stage\"}"
run_job "$scratch/steps-web" "$work" stage "$scratch/web"
unset WIRING_CLOUDFLARE_HYPERDRIVE_STAGE
build_log="$(ls "$scratch"/web-build-app.log)"
# webpack, not Turbopack: the Prisma client's `.wasm?module` import is left
# for wrangler by a webpack externals rule (apps/web/next.config.mjs).
grep -q 'Next.js 16.3.8 (webpack)' "$build_log" \
  || { echo "FAIL: the staged build did not run Next.js 16.3.8 on webpack" >&2; grep -m3 'Next.js' "$build_log" >&2; exit 1; }
grep -q "\"id\": \"$hd_id\"" "$work/apps/web/wrangler.jsonc" \
  || { echo "FAIL: build-app did not re-render wrangler.jsonc from the stage wiring document" >&2; exit 1; }
[ "$(node -e 'const fs=require("fs");process.stdout.write(String(fs.readdirSync(process.argv[1]).length))' "$work/node_modules")" -gt 0 ] && [ ! -L "$work/node_modules" ] \
  || { echo "FAIL: the job's install did not land inside its own tree" >&2; exit 1; }
echo "   the staged build ran on webpack, inside its own tree, bound to the stage Hyperdrive id it was handed"

# ── 5. serve it over the migrated database ────────────────────────────────
echo "── wrangler dev over the built Worker, its HYPERDRIVE binding on the local Postgres"
[ ! -e "$work/apps/web/.dev.vars" ] || { echo "FAIL: the staged tree carries a .dev.vars" >&2; exit 1; }
port="$(free_port)"
(cd "$work/apps/web" && CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$pgurl" \
   exec setsid pnpm exec wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port "$port" \
   --name "$repo-web-stage" --show-interactive-dev-session=false) > "$scratch/dev.log" 2>&1 < /dev/null &
dev_pid=$!
url="http://127.0.0.1:$port"
# Ready when the Worker answers its database check, which reads no session
# and so no cookie secret: the feed requests below are still an isolate's
# first.
for _ in $(seq 1 90); do
  curl -s -o /dev/null "$url/api/health" && break
  kill -0 "$dev_pid" 2>/dev/null || { echo "FAIL: wrangler dev exited" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }
  sleep 1
done
curl -s -o /dev/null "$url/api/health" || { echo "FAIL: wrangler dev never answered" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }

echo "   ▸ eight concurrent first requests to the feed, each one's next-auth options reading the cookie secret"
python3 - "$url" <<'PY' || { echo "FAIL: the concurrent first requests; wrangler dev said:" >&2; tail -40 "$scratch/dev.log" >&2; exit 1; }
import concurrent.futures, re, sys, urllib.request
base = sys.argv[1]
def get(_):
    with urllib.request.urlopen(base + "/", timeout=120) as r:
        return r.status, r.read().decode()
with concurrent.futures.ThreadPoolExecutor(8) as pool:
    results = list(pool.map(get, range(8)))
# styled-jsx scopes the template's markup with a class (`<h1 class="jsx-…">`).
bad = [s for s, b in results if s != 200 or not re.search(r"<h1[^>]*>Public Feed</h1>", b)]
if bad:
    sys.exit(f"  ✕ {len(bad)} of 8 first requests did not render the feed: {bad[:3]}")
print("   all 8 rendered the feed")
PY
[ "$(psql "$pgurl" -XAtc 'select (select count(*) from "Post") + (select count(*) from users) + (select count(*) from sessions)')" = 0 ] \
  || { echo "FAIL: serving the feed wrote to the database" >&2; exit 1; }
echo "   the database is still empty: the feed only reads"

echo "   ▸ the component's own smokeCommand, DEPLOYED_URL=$url"
smoke="$(python3 -c "import yaml,sys;print(yaml.safe_load(open(sys.argv[1]))['spec']['parameters']['smokeCommand'])" "$tree/apps/web/component.yaml")"
DEPLOYED_URL="$url" bash -c "$smoke" || { echo "FAIL: the deploy's smoke refused the product" >&2; tail -20 "$scratch/dev.log" >&2; exit 1; }

echo "   ▸ every route the product promises, and two writers on the same blog"
# Two signed-in writers, as next-auth's Prisma adapter leaves them after a
# GitHub sign-in: a user, its GitHub account and a database session — and an
# expired session. Over http — wrangler dev — next-auth names the cookie
# without the `__Secure-` prefix.
psql "$pgurl" -X -q -v ON_ERROR_STOP=1 -c "
  insert into users (id, name, email, updated_at) values
    ('e2e-ada', 'Ada O''Lovelace & Co', 'ada@example.invalid', now()),
    ('e2e-bob', 'Bob', 'bob@example.invalid', now());
  insert into accounts (id, user_id, type, provider, provider_account_id) values
    ('e2e-a1', 'e2e-ada', 'oauth', 'github', '1001'), ('e2e-a2', 'e2e-bob', 'oauth', 'github', '1002');
  insert into sessions (id, session_token, user_id, expires) values
    ('e2e-s1', 'e2e-token-ada', 'e2e-ada', now() + interval '1 day'),
    ('e2e-s2', 'e2e-token-bob', 'e2e-bob', now() + interval '1 day'),
    ('e2e-s3', 'e2e-token-old', 'e2e-ada', now() - interval '1 day');" \
  || { echo "FAIL: could not write the two writers' sessions" >&2; exit 1; }
python3 - "$url" "$values" "$pgurl" <<'PY' || { echo "FAIL: the routes; wrangler dev said:" >&2; tail -40 "$scratch/dev.log" >&2; exit 1; }
import html, http.client, json, re, subprocess, sys, time, urllib.error, urllib.request
base, values, pgurl = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]
name = values["productname"]
ADA, BOB, OLD = ("next-auth.session-token=e2e-token-ada", "next-auth.session-token=e2e-token-bob",
                 "next-auth.session-token=e2e-token-old")
problems = []
def bad(m): problems.append(m)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
plain = urllib.request.build_opener(NoRedirect)

def headers_of(msg):
    # Lower-cased, with EVERY Set-Cookie kept: next-auth sets several at once.
    out = {k.lower(): v for k, v in msg.items()}
    out["set-cookie"] = "\n".join(msg.get_all("Set-Cookie") or [])
    return out

def req(path, cookie=None, method="GET", body=None, follow=True):
    # A request whose CONNECTION drops (not one that answers an error) is
    # asked again, twice at most, and says so: `wrangler dev` on a loaded
    # machine has dropped one.
    headers = {"cookie": cookie} if cookie else {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    opener = urllib.request.build_opener() if follow else plain
    for attempt in range(3):
        try:
            r = urllib.request.Request(base + path, data=data, headers=headers, method=method)
            with opener.open(r, timeout=60) as resp:
                return resp.status, headers_of(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, headers_of(e.headers), e.read()
        except (http.client.RemoteDisconnected, ConnectionResetError) as e:
            if attempt == 2 or method != "GET":
                raise
            print(f"   ({method} {path}: the connection dropped ({e.__class__.__name__}) — asking again)")
            time.sleep(1)
def page(path, cookie=None):
    # React separates adjacent text nodes with `<!-- -->` ("By <!-- -->Ada");
    # the text a reader sees has none. Compared DECODED: the names carry `'`
    # and `&`.
    s, h, body = req(path, cookie)
    return s, html.unescape(body.decode().replace("<!-- -->", ""))
def psql(sql):
    return subprocess.run(["psql", pgurl, "-XAtc", sql], capture_output=True, text=True, check=True).stdout.strip()
# styled-jsx scopes the template's markup with a class (`<h2 class="jsx-…">`).
def has(tag, text, doc):
    return re.search(rf"<{tag}[^>]*>{re.escape(text)}</{tag}>", doc) is not None
def headings(doc):
    return re.findall(r"<h2[^>]*>(.*?)</h2>", doc)

# ── the feed, under the product's own name ──────────────────────────────────
s, home = page("/")
if s != 200 or not has("h1", "Public Feed", home):
    bad(f"/ answered {s} without the feed")
title = re.search(r"<title[^>]*>(.*?)</title>", home, re.S)
if not title or title.group(1) != name:
    bad(f"the feed's <title> is {title and title.group(1)!r}, not {name!r}")
if "Fullstack Blog" in home:
    bad("the feed still carries the baseline's name")
if headings(home):
    bad(f"a fresh feed lists posts: {headings(home)}")
if 'href="/api/auth/signin"' not in home:
    bad("a signed-out visitor's header has no Log in link")

# ── sign-in: GitHub not connected, and next-auth's own endpoints ──────────
s, h, _ = req("/api/auth/signin", follow=False)
if s not in (302, 307) or "/auth/not-connected" not in h.get("location", ""):
    bad(f"/api/auth/signin answered {s} {h.get('location')!r}, not a redirect to the not-connected page")
s, login = page("/api/auth/signin")
if s != 200 or "Sign-in is not connected yet" not in login or "GITHUB_ID" not in login:
    bad(f"/api/auth/signin does not land on the page saying GitHub is not connected ({s})")
s, _, body = req("/api/auth/providers")
if s != 200 or json.loads(body) != {}:
    bad(f"/api/auth/providers answered {s} {body[:120]!r}, not {{}} (no GitHub OAuth App)")
s, h, body = req("/api/auth/csrf")
if s != 200 or len(json.loads(body).get("csrfToken", "")) < 32 or "next-auth.csrf-token=" not in h.get("set-cookie", ""):
    bad(f"/api/auth/csrf answered {s} {body[:80]!r}: next-auth has no secret to sign with")
s, _, body = req("/api/auth/session")
if s != 200 or json.loads(body) != {}:
    bad(f"/api/auth/session without a cookie answered {s} {body[:120]!r}")

# ── the pages a visitor reaches ───────────────────────────────────────────
s, drafts = page("/drafts")
if s != 403 or "You need to be authenticated to view this page." not in drafts:
    bad(f"/drafts without a session answered {s}, not 403 with upstream's message")
s, _ = page("/p/no-such-post")
if s != 404:
    bad(f"/p/no-such-post answered {s}, not 404")
s, _ = page("/no-such-page")
if s != 404:
    bad(f"/no-such-page answered {s}, not 404")
s, create = page("/create")
if s != 200 or not has("h1", "New Draft", create):
    bad(f"/create answered {s}")
script = re.search(r'<script src="(/_next/static/[^"]+\.js)"', home)
if not script:
    bad("the feed loads no page script")
else:
    s, h, body = req(script.group(1))
    if s != 200 or "javascript" not in h.get("content-type", "") or not body:
        bad(f"{script.group(1)} answered {s} {h.get('content-type')}")

# ── what only the Worker answers ──────────────────────────────────────────
s, h, body = req("/api/health")
if s != 200 or json.loads(body) != {"ok": True, "database": "reachable", "schema": "migrated"} \
        or h.get("cache-control") != "no-store":
    bad(f"/api/health answered {s} {body[:120]!r} ({h.get('cache-control')})")

# ── a signed-in author, from draft to published to deleted ─────────────────
s, _, body = req("/api/auth/session", ADA)
if s != 200 or json.loads(body).get("user", {}).get("email") != "ada@example.invalid":
    bad(f"Ada's database session is not a session: {s} {body[:160]!r}")
s, _, body = req("/api/auth/session", OLD)
if s != 200 or json.loads(body) != {}:
    bad(f"an expired database session was read as a session: {s} {body[:160]!r}")
# …and next-auth's adapter deletes it as it reads it, as upstream's does.
if psql("select count(*) from sessions where session_token = 'e2e-token-old'") != "0":
    bad("the expired session is still in the database after next-auth read it")
s, _, body = req("/api/post", None, "POST", {"title": "Anonymous", "content": "x"})
if s != 401:
    bad(f"an anonymous POST /api/post answered {s}, not 401")
s, _, body = req("/api/post", ADA, "POST", {"title": "Hello from Workers", "content": "Written with **Prisma** on Supabase"})
post = json.loads(body) if s == 200 else {}
pid = post.get("id")
if s != 200 or post.get("published") is not False or post.get("authorId") != "e2e-ada":
    bad(f"Ada's draft was not created: {s} {body[:160]!r}")
if pid:
    s, mine = page("/drafts", ADA)
    if s != 200 or not has("h1", "My Drafts", mine) or headings(mine) != ["Hello from Workers"]:
        bad(f"Ada's drafts do not list her draft, rendered signed in ({s}): {headings(mine)}")
    s, theirs = page("/drafts", BOB)
    if s != 200 or headings(theirs):
        bad(f"Bob's drafts list Ada's draft ({s}): {headings(theirs)}")
    s, home = page("/")
    if headings(home):
        bad(f"a draft is on the public feed: {headings(home)}")
    s, view = page(f"/p/{pid}", ADA)
    if s != 200 or not has("h2", "Hello from Workers (Draft)", view) or "<strong>Prisma</strong>" not in view \
            or "By Ada O'Lovelace & Co" not in view or ">Publish</button>" not in view or ">Delete</button>" not in view:
        bad(f"/p/{pid} does not show Ada her draft, its Markdown and its buttons ({s})")
    s, view = page(f"/p/{pid}", BOB)
    if s != 200 or ">Publish</button>" in view or ">Delete</button>" in view:
        bad(f"/p/{pid} offers Bob the author's buttons ({s})")
    for method, path in (("PUT", f"/api/publish/{pid}"), ("DELETE", f"/api/post/{pid}")):
        s, _, _ = req(path, None, method)
        if s != 401:
            bad(f"an anonymous {method} {path} answered {s}, not 401")
        s, _, _ = req(path, BOB, method)
        if s != 403:
            bad(f"Bob's {method} {path} on Ada's post answered {s}, not 403")
    s, _, _ = req("/api/publish/no-such-post", ADA, "PUT")
    if s != 404:
        bad(f"publishing a post that does not exist answered {s}, not 404")
    if psql(f"""select published::text || ' ' || "authorId" from "Post" where id = '{pid}'""") != "false e2e-ada":
        bad("a refused write changed Ada's draft")
    s, _, body = req(f"/api/publish/{pid}", ADA, "PUT")
    if s != 200 or json.loads(body).get("published") is not True:
        bad(f"Ada could not publish her own post: {s} {body[:120]!r}")
    s, home = page("/")
    if headings(home) != ["Hello from Workers"] or "By Ada O'Lovelace & Co" not in home:
        bad(f"the published post is not on the public feed under its author: {headings(home)}")
    s, view = page(f"/p/{pid}")
    if s != 200 or not has("h2", "Hello from Workers", view) or ">Delete</button>" in view:
        bad(f"/p/{pid} signed out is not the published post without buttons ({s})")
    s, _, body = req(f"/api/post/{pid}", ADA, "DELETE")
    if s != 200 or json.loads(body).get("id") != pid:
        bad(f"Ada could not delete her own post: {s} {body[:120]!r}")
    s, _ = page(f"/p/{pid}")
    if s != 404:
        bad(f"a deleted post answered {s}, not 404")
    if psql('select count(*) from "Post"') != "0":
        bad("the deleted post is still in the database")

# ── the blog reads the database (locally on every request: no Hyperdrive cache)
psql("""insert into "Post" (id, title, content, published, "authorId") values
        ('e2e-behind', 'Written Behind Its Back', 'x', true, 'e2e-bob')""")
s, home = page("/")
if headings(home) != ["Written Behind Its Back"] or "By Bob" not in home:
    bad(f"a post written behind the app's back is not on the next render: {headings(home)}")
psql("""delete from "Post" where id = 'e2e-behind'""")

if problems:
    for p in problems:
        print(f"  ✕ {p}", file=sys.stderr)
    sys.exit(1)
print(f"   / as {name!r}, empty; Log in landing on 'not connected'; next-auth's providers, csrf and "
      f"session; /drafts 403, a missing post 404, /create, a page script; /api/health; Ada's draft "
      f"created, listed, viewed with its buttons, published to the feed and deleted, while Bob and an "
      f"anonymous visitor were refused every write and an expired session read as none, and deleted; a post "
      f"written behind its back found on the next render")
PY

# ── 6. what Supabase's Data API would see ──────────────────────────────────
echo "── the Data API's roles (anon, authenticated) against the same database"
psql "$pgurl" -X -q -v ON_ERROR_STOP=1 -c "insert into \"Post\" (id, title, content, published, \"authorId\") values ('e2e-rls', 'Published', 'x', true, 'e2e-ada')" \
  || { echo "FAIL: could not write the published post the roles look for" >&2; exit 1; }
psql "$pgurl" -X -q -v ON_ERROR_STOP=1 -At > "$scratch/rls.out" 2> "$scratch/rls.err" <<'SQL' \
  || { echo "FAIL: the row-level security checks" >&2; cat "$scratch/rls.err" >&2; exit 1; }
SELECT 'app role: superuser=' || rolsuper || ' bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname = current_user;
SELECT 'public tables without RLS: ' || count(*) FILTER (WHERE NOT c.relrowsecurity) || ' of ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT 'not owned by the app: ' || count(*) FILTER (WHERE pg_get_userbyid(c.relowner) <> current_user)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT 'app sees posts sessions accounts: ' || (SELECT count(*) FROM "Post") || ' ' || (SELECT count(*) FROM sessions) || ' ' || (SELECT count(*) FROM accounts);
SET ROLE anon;
SELECT 'anon sees posts sessions accounts: ' || (SELECT count(*) FROM "Post") || ' ' || (SELECT count(*) FROM sessions) || ' ' || (SELECT count(*) FROM accounts);
RESET ROLE;
SET ROLE authenticated;
SELECT 'authenticated sees posts sessions accounts: ' || (SELECT count(*) FROM "Post") || ' ' || (SELECT count(*) FROM sessions) || ' ' || (SELECT count(*) FROM accounts);
RESET ROLE;
SQL
sed 's/^/   /' "$scratch/rls.out"
grep -qx "app role: superuser=false bypassrls=false" "$scratch/rls.out" \
  && grep -qx "public tables without RLS: 0 of 5" "$scratch/rls.out" \
  && grep -qx "not owned by the app: 0" "$scratch/rls.out" \
  || { echo "FAIL: the app's role, the tables' owner or their row-level security is not what Supabase's would be" >&2; exit 1; }
# Two live sessions: next-auth deleted the expired third when it read it.
grep -qx "app sees posts sessions accounts: 1 2 2" "$scratch/rls.out" || { echo "FAIL: the app does not see its own rows" >&2; exit 1; }
for line in "anon sees posts sessions accounts: 0 0 0" "authenticated sees posts sessions accounts: 0 0 0"; do
  grep -qx "$line" "$scratch/rls.out" || { echo "FAIL: expected '$line'" >&2; exit 1; }
done
# A write through the Data API's roles is refused by row-level security, and
# the cookie secret is not theirs to read at all.
for role in anon authenticated; do
  if psql "$pgurl" -X -q -At -c "SET ROLE $role; INSERT INTO \"Post\" (id, title, published) VALUES ('$role', '$role', true)" > "$scratch/rls-write.log" 2>&1; then
    echo "FAIL: $role wrote a post through row-level security" >&2; exit 1
  fi
  grep -q "row-level security" "$scratch/rls-write.log" \
    || { echo "FAIL: $role's write was refused for another reason:" >&2; cat "$scratch/rls-write.log" >&2; exit 1; }
  if psql "$pgurl" -X -q -At -c "SET ROLE $role; SELECT value FROM app_private.secrets" > "$scratch/rls-key.log" 2>&1; then
    echo "FAIL: $role read the cookie secret" >&2; exit 1
  fi
  grep -q "permission denied" "$scratch/rls-key.log" \
    || { echo "FAIL: $role's read of the cookie secret was refused for another reason:" >&2; cat "$scratch/rls-key.log" >&2; exit 1; }
done
echo "   anon and authenticated, granted what Supabase grants them, read the published post, the sessions and the GitHub accounts as 0, write no post, and cannot reach the cookie secret"

echo "e2e.test.sh: ok"
