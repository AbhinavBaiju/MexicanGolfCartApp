#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Production Deployment for Mexican Golf Carts App...${NC}"

# Check for required tools
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ Error: npm is not installed.${NC}"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo -e "${RED}❌ Error: npx is not installed.${NC}"
    exit 1
fi

# 1. Install Dependencies
echo -e "${CYAN}--------------------------------------------------${NC}"
echo -e "${CYAN}📦 Installing User Dependencies...${NC}"
echo -e "${CYAN}--------------------------------------------------${NC}"
npm install
echo -e "${GREEN}✅ Dependencies installed.${NC}"

# 2. Cloudflare Worker Deployment
echo -e "${CYAN}--------------------------------------------------${NC}"
echo -e "${CYAN}🌩️  Deploying Cloudflare Worker (Backend)...${NC}"
echo -e "${CYAN}--------------------------------------------------${NC}"
cd worker
npm run deploy
cd ..
echo -e "${GREEN}✅ Cloudflare Worker Deployed.${NC}"

# 3. Admin Dashboard (Cloudflare Pages)
echo -e "${CYAN}--------------------------------------------------${NC}"
echo -e "${CYAN}📊 Deploying Admin Dashboard (Cloudflare Pages)...${NC}"
echo -e "${CYAN}--------------------------------------------------${NC}"
cd apps/admin

# Check for .env
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: apps/admin/.env is missing. It is required for the build.${NC}"
    echo "Please create it with: VITE_SHOPIFY_API_KEY=your_api_key"
    exit 1
fi

echo "🔨 Building Admin App..."
npm run build

echo "🚀 Uploading to Cloudflare Pages..."
cd ../.. # Go back to root to run wrangler pages deploy
npx wrangler pages deploy apps/admin/dist --project-name mexican-golf-cart-admin --branch master
echo -e "${GREEN}✅ Admin Dashboard Deployed.${NC}"

# 4. Shopify App (Extensions & Config)
echo -e "${CYAN}--------------------------------------------------${NC}"
echo -e "${CYAN}🛍️  Deploying Shopify App (Extensions & Config)...${NC}"
echo -e "${CYAN}--------------------------------------------------${NC}"
cd apps/shopify/mexican-golf-cart
echo -e "${CYAN}ℹ️  Note: You may be prompted to confirm a new version release by the Shopify CLI.${NC}"
npm run deploy
cd ../../..
echo -e "${GREEN}✅ Shopify App Deployed.${NC}"

echo -e "${CYAN}--------------------------------------------------${NC}"
echo -e "${GREEN}🎉 All systems deployed to PRODUCTION successfully!${NC}"
echo -e "${CYAN}--------------------------------------------------${NC}"
