#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status.

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PROJECT_ROOT="$SCRIPT_DIR"

log() { echo -e "${CYAN}[DEPLOY] $1${NC}"; }
success() { echo -e "${GREEN}[SUCCESS] $1${NC}"; }
warn() { echo -e "${YELLOW}[WARNING] $1${NC}"; }
error() { echo -e "${RED}[ERROR] $1${NC}"; exit 1; }

# Prerequisites Check
log "Checking prerequisites..."
command -v npm >/dev/null 2>&1 || error "npm is required but not installed."
command -v npx >/dev/null 2>&1 || error "npx is required but not installed."

# Check Environment Variables for Admin App
# Admin App needs VITE_SHOPIFY_API_KEY during build time
if [ -f "$PROJECT_ROOT/apps/admin/.env" ]; then
    log "Loading apps/admin/.env..."
    set -a
    source "$PROJECT_ROOT/apps/admin/.env"
    set +a
fi

if [ -z "$VITE_SHOPIFY_API_KEY" ]; then
    error "VITE_SHOPIFY_API_KEY is missing. Please set it in apps/admin/.env or export it in your environment."
fi

# 1. Install Global Dependencies (Workspaces)
log "Installing dependencies (root & workspaces)..."
cd "$PROJECT_ROOT"
npm install --prefer-offline
success "Dependencies installed."

# 2. Deploy Cloudflare Worker
log "Deploying Cloudflare Worker..."
cd "$PROJECT_ROOT/worker"
# Ensure we are logged in or have a token (assumed environment is set up)
# Pass --env="" to explicitly target the top-level production configuration and silence warnings
npx wrangler deploy --config wrangler.toml --env=""
success "Worker deployed!"

# 3. Deploy Admin Dashboard (Pages)
log "Building Admin Dashboard..."
cd "$PROJECT_ROOT/apps/admin"
# Build the admin app (Vite)
npm run build

log "Deploying Admin Dashboard to Cloudflare Pages..."
# Deploy to 'mexican-golf-cart-admin', branch 'master' to ensure prod alias
npx wrangler pages deploy dist \
    --project-name mexican-golf-cart-admin \
    --branch master \
    --commit-dirty=true

success "Admin Dashboard deployed!"

# 4. Deploy Shopify App
log "Deploying Shopify App..."
cd "$PROJECT_ROOT/apps/shopify/mexican-golf-cart"

# Ensure Shopify CLI is ensuring the app is installed/linked
# passing --force to auto-release
log "Running shopify app deploy --force..."
npx shopify app deploy --force

success "Shopify App deployed!"

# Final Summary
echo ""
log "--------------------------------------------------"
success "🎉 All systems deployed successfully!"
log "--------------------------------------------------"
echo -e "1. ${GREEN}Worker${NC}: Deployed to Cloudflare"
echo -e "2. ${GREEN}Admin${NC}:  Deployed to Cloudflare Pages"
echo -e "3. ${GREEN}Shopify${NC}: Deployed to Shopify Partners"
log "--------------------------------------------------"
