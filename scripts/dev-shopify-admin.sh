#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ADMIN_DIR="$ROOT_DIR/apps/admin"

PORT_VALUE="${PORT:-3000}"
export VITE_WORKER_ADMIN_BASE_URL="${VITE_WORKER_ADMIN_BASE_URL:-https://mexican-golf-cart-worker-dev.explaincaption.workers.dev}"

cd "$ADMIN_DIR"
npm run dev -- --host 0.0.0.0 --port "$PORT_VALUE" --strictPort
