#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$ROOT_DIR/scripts/lib/utils.sh"

ENVIRONMENT="production"
DRY_RUN=0
SKIP_WORKER=0
SKIP_ADMIN=0
SKIP_SHOPIFY=0
SKIP_MIGRATIONS=0

usage() {
  cat <<'USAGE'
Usage: scripts/deploy.sh [options]

Options:
  --env <name>           Deployment environment (default: production)
  --skip-worker          Skip Cloudflare Worker deploy
  --skip-admin           Skip Admin (Cloudflare Pages) deploy
  --skip-shopify         Skip Shopify app deploy (app config + extensions)
  --skip-migrations      Skip D1 migrations
  --dry-run              Print commands without executing
  -h, --help             Show help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --skip-worker)
      SKIP_WORKER=1
      shift
      ;;
    --skip-admin)
      SKIP_ADMIN=1
      shift
      ;;
    --skip-shopify)
      SKIP_SHOPIFY=1
      shift
      ;;
    --skip-migrations)
      SKIP_MIGRATIONS=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

CONFIG_FILE="$ROOT_DIR/scripts/config/${ENVIRONMENT}.env"
assert_file_exists "$CONFIG_FILE"
log "Loading config: $CONFIG_FILE"
set -a
source "$CONFIG_FILE"
set +a

ADMIN_ENV_VALUE="${ADMIN_ENV_VALUE:-$SHOPIFY_API_KEY}"

if [[ -z "${SHOPIFY_API_KEY:-}" ]]; then
  die "SHOPIFY_API_KEY is required in $CONFIG_FILE"
fi

if [[ -z "${SHOPIFY_API_SECRET:-}" ]]; then
  die "SHOPIFY_API_SECRET is required in $CONFIG_FILE"
fi

require_cmd node
require_cmd npm
require_cmd npx

WRANGLER_CMD="wrangler"
if ! have_cmd "$WRANGLER_CMD"; then
  WRANGLER_CMD="npx wrangler"
fi

SHOPIFY_CMD="shopify"
if ! have_cmd "$SHOPIFY_CMD"; then
  SHOPIFY_CMD="npx shopify"
fi

WORKER_DIR="${WORKER_DIR:-$ROOT_DIR/worker}"
ADMIN_DIR="${ADMIN_DIR:-$ROOT_DIR/apps/admin}"
SHOPIFY_DIR="${SHOPIFY_DIR:-$ROOT_DIR/apps/shopify/mexican-golf-cart}"

ADMIN_ENV_FILE="${ADMIN_ENV_FILE:-$ADMIN_DIR/.env}"
ADMIN_ENV_KEY="${ADMIN_ENV_KEY:-VITE_SHOPIFY_API_KEY}"

WORKER_ENV_FLAG=""
if [[ -n "${WORKER_ENV:-}" ]]; then
  WORKER_ENV_FLAG="--env ${WORKER_ENV}"
fi

log "Environment: $ENVIRONMENT"

if [[ "$SKIP_WORKER" -eq 0 ]]; then
  log "Checking Worker secrets"
  secrets_tmp="$(mktemp -t worker_secrets.XXXXXX)"
  if ! (cd "$WORKER_DIR" && $WRANGLER_CMD secret list $WORKER_ENV_FLAG) >"$secrets_tmp" 2>/dev/null; then
    die "wrangler secret list failed. Ensure you are logged in (npx wrangler login)."
  fi
  search="$(search_cmd)"
  if ! $search -q "SHOPIFY_API_SECRET" "$secrets_tmp"; then
    die "Missing Worker secret SHOPIFY_API_SECRET. Run: npx wrangler secret put SHOPIFY_API_SECRET"
  fi
  rm -f "$secrets_tmp"
fi

if [[ "$SKIP_ADMIN" -eq 0 ]]; then
  if [[ -n "${ADMIN_ENV_VALUE:-}" ]]; then
    if [[ ! -f "$ADMIN_ENV_FILE" ]]; then
      log "Creating admin env file: $ADMIN_ENV_FILE"
      mkdir -p "$(dirname "$ADMIN_ENV_FILE")"
      printf '%s=%s\n' "$ADMIN_ENV_KEY" "$ADMIN_ENV_VALUE" >"$ADMIN_ENV_FILE"
    fi
    assert_file_contains "$ADMIN_ENV_FILE" "^${ADMIN_ENV_KEY}=${ADMIN_ENV_VALUE}$" "$ADMIN_ENV_KEY in $ADMIN_ENV_FILE"
  else
    assert_file_exists "$ADMIN_ENV_FILE"
    assert_file_contains "$ADMIN_ENV_FILE" "^[[:space:]]*${ADMIN_ENV_KEY}=" "$ADMIN_ENV_KEY in $ADMIN_ENV_FILE"
  fi
fi

if [[ -n "${EXPECTED_SHOPIFY_APP_URL:-}" ]]; then
  assert_file_contains "$ROOT_DIR/worker/wrangler.toml" "SHOPIFY_APP_URL = \"${EXPECTED_SHOPIFY_APP_URL}\"" "SHOPIFY_APP_URL in worker/wrangler.toml"
fi

if [[ -n "${EXPECTED_APPLICATION_URL:-}" ]]; then
  assert_file_contains "$ROOT_DIR/apps/shopify/mexican-golf-cart/shopify.app.toml" "application_url = \"${EXPECTED_APPLICATION_URL}\"" "application_url in shopify.app.toml"
fi

if [[ -n "${EXPECTED_SHOPIFY_API_KEY:-}" ]]; then
  assert_file_contains "$ROOT_DIR/apps/shopify/mexican-golf-cart/shopify.app.toml" "client_id = \"${EXPECTED_SHOPIFY_API_KEY}\"" "client_id in shopify.app.toml"
  assert_file_contains "$ROOT_DIR/worker/wrangler.toml" "SHOPIFY_API_KEY = \"${EXPECTED_SHOPIFY_API_KEY}\"" "SHOPIFY_API_KEY in worker/wrangler.toml"
fi

if [[ "$SKIP_WORKER" -eq 0 ]]; then
  log "Deploying Worker"
  run "(cd \"$WORKER_DIR\" && npm install)"
  if [[ "$SKIP_MIGRATIONS" -eq 0 ]]; then
    if [[ -z "${WORKER_DB_NAME:-}" ]]; then
      die "WORKER_DB_NAME is required in $CONFIG_FILE"
    fi
  run "(cd \"$WORKER_DIR\" && $WRANGLER_CMD d1 migrations apply \"$WORKER_DB_NAME\" --remote $WORKER_ENV_FLAG)"
  fi
  run "(cd \"$WORKER_DIR\" && $WRANGLER_CMD deploy src/index.ts ${WORKER_DEPLOY_ARGS:-} $WORKER_ENV_FLAG)"
fi

if [[ "$SKIP_ADMIN" -eq 0 ]]; then
  log "Deploying Admin (Cloudflare Pages)"
  run "(cd \"$ADMIN_DIR\" && npm install)"
  run "(cd \"$ADMIN_DIR\" && npm run build)"
  if [[ -z "${ADMIN_PAGES_PROJECT:-}" ]]; then
    die "ADMIN_PAGES_PROJECT is required in $CONFIG_FILE"
  fi
  if [[ -z "${ADMIN_PAGES_BRANCH:-}" ]]; then
    die "ADMIN_PAGES_BRANCH is required in $CONFIG_FILE"
  fi
  run "$WRANGLER_CMD pages deploy \"$ADMIN_DIR/dist\" --project-name \"$ADMIN_PAGES_PROJECT\" --branch \"$ADMIN_PAGES_BRANCH\""
fi

if [[ "$SKIP_SHOPIFY" -eq 0 ]]; then
  log "Deploying Shopify app (config + extensions)"
  run "(cd \"$SHOPIFY_DIR\" && npm install)"
  run "(cd \"$SHOPIFY_DIR\" && $SHOPIFY_CMD app deploy)"
fi

log "Deployment finished."
