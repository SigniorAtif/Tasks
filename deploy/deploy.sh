#!/usr/bin/env bash
# Deploys one image tag (a git commit SHA) to this box:
#
#   ~/tasks/deploy.sh <sha>
#
# It expects compose.prod.yaml, Caddyfile and .env in its own folder. The steps (D-066),
# each of which stops the deploy if it fails:
#   1. pull the image for <sha>
#   2. dump the database into backups/ (the undo button for data)
#   3. apply the new image's migrations, in a one-off container
#   4. swap the containers to the new image and wait for their health checks
#   5. ask /healthz which commit is running, until it answers <sha>
# If step 4 or 5 fails, the API goes back to the tag that ran before. Migrations are never
# undone: they only ever add things (expand/contract), so the previous API still works on
# the new schema.
#
# Safe to re-run with the same tag: it takes a fresh dump and changes nothing else.

set -euo pipefail
# Everything this script creates (dumps, the history log) is readable by its owner only.
umask 077

readonly smoke_timeout=${SMOKE_TIMEOUT:-120} # seconds to wait for /healthz to show <sha>
readonly keep_dumps=${KEEP_DUMPS:-10}        # how many pre-deploy dumps to keep
readonly backup_dir=backups

deploy_started=false

log() { printf '%s deploy: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() {
  log "$*"
  if [[ $deploy_started == true ]]; then record failed; fi
  exit 1
}
compose() { docker compose -f compose.prod.yaml "$@"; }
# Reads KEY=value from .env (values are unquoted, see env.example).
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }

# ---- Arguments and preconditions -------------------------------------------------------

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <image-tag>   (the git commit SHA to deploy)" >&2
  exit 2
fi
readonly new_tag=$1
# Docker's rule for tags. Anything else is a typo, or text trying to sneak into a command.
if [[ ! $new_tag =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "not a valid image tag: $new_tag" >&2
  exit 2
fi

cd "$(dirname "$0")"
[[ -f .env ]] || die "no .env next to this script; create it from env.example"

# One deploy at a time. The lock is released when this script exits, however it exits.
exec 9> .deploy.lock
flock --nonblock 9 || die "another deploy is already running"

# The tag running now: the one to go back to if this deploy fails.
previous_tag=$(env_value TAG)
image=$(env_value IMAGE)
image=${image:-ghcr.io/signioratif/tasks}

# Compose reads TAG from the environment before .env, so from here on every compose
# command uses the new tag, while .env keeps naming the old one until the deploy succeeds.
export TAG=$new_tag

# One line per deploy attempt in deploy-history.log: time, tag, ok or failed.
record() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$new_tag" "$1" >> deploy-history.log; }

rollback() {
  if [[ -z $previous_tag || $previous_tag == "$new_tag" ]]; then
    log "no earlier tag to roll back to; leaving the containers as they are"
    return
  fi
  log "rolling back to $previous_tag"
  if TAG=$previous_tag compose up --detach --wait --wait-timeout 120 api; then
    log "rolled back: $previous_tag is serving again"
  else
    log "ROLLBACK FAILED: check 'docker compose -f compose.prod.yaml ps' and the logs"
  fi
}

# For failures after the new containers started: go back, then stop.
fail() {
  log "$*"
  rollback
  die "deploy of $new_tag failed"
}

log "deploying $new_tag (running now: ${previous_tag:-nothing})"
deploy_started=true

# ---- 1. Pull ---------------------------------------------------------------------------
# A tag is one commit's build and never changes, so download it only if it's missing.
log "pulling $image:$new_tag"
compose pull --quiet --policy missing api || die "couldn't pull $image:$new_tag"

# ---- 2. Pre-deploy dump ----------------------------------------------------------------
compose up --detach --wait --wait-timeout 120 db || die "the database didn't start"
mkdir -p "$backup_dir"
dump="$backup_dir/tasks-$(date -u +%Y%m%dT%H%M%SZ)-before-$new_tag.sql.gz"
log "dumping the database to $dump"
# Written under a temporary name first, so a half-written file never looks like a backup.
if ! compose exec -T db pg_dump --username=tasks --dbname=tasks | gzip > "$dump.partial"; then
  rm -f "$dump.partial"
  die "the dump failed; nothing was changed"
fi
mv "$dump.partial" "$dump"
# Keep the newest $keep_dumps. Names start with a UTC timestamp, so name order is age order.
find "$backup_dir" -maxdepth 1 -name 'tasks-*.sql.gz' | sort -r |
  tail -n "+$((keep_dumps + 1))" | xargs -r rm -f --

# ---- 3. Migrate ------------------------------------------------------------------------
log "applying migrations from $new_tag"
compose run --rm migrate || die "migrations failed; the running API is unchanged"

# ---- 4. Swap ---------------------------------------------------------------------------
log "starting $new_tag"
compose up --detach --wait --wait-timeout 120 --remove-orphans ||
  fail "the new containers didn't become healthy"

# ---- 5. Smoke test ---------------------------------------------------------------------
# Ask the API, from inside its own container, for its status code and commit.
running() {
  compose exec -T api node -e \
    "fetch('http://127.0.0.1:3000/healthz').then(async (r) => console.log(r.status, (await r.json()).sha))" \
    2> /dev/null
}
deadline=$((SECONDS + smoke_timeout))
until [[ $(running || true) == "200 $new_tag" ]]; do
  ((SECONDS < deadline)) || fail "/healthz didn't report $new_tag within ${smoke_timeout}s"
  sleep 3
done

# ---- Success ---------------------------------------------------------------------------
# Remember the new tag in .env, so plain `docker compose` commands use it too.
if grep -q '^TAG=' .env; then
  sed -i "s/^TAG=.*/TAG=$new_tag/" .env
else
  printf 'TAG=%s\n' "$new_tag" >> .env
fi
record ok

# Delete the images of older deploys, keeping this one and the previous one (the
# rollback target). Each one would otherwise keep using disk space.
docker image ls "$image" --format '{{.Tag}}' |
  grep -vxF -e "$new_tag" -e "${previous_tag:-$new_tag}" -e '<none>' |
  sed "s|^|$image:|" | xargs -r docker image rm > /dev/null || true

log "done: $new_tag is live"
