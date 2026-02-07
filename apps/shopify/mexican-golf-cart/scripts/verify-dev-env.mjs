#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PREFIX = "[verify-dev-env]";

function log(message) {
  console.log(`${PREFIX} ${message}`);
}

function warn(message) {
  console.warn(`${PREFIX} ${message}`);
}

function error(message) {
  console.error(`${PREFIX} ${message}`);
}

function printTopFixes() {
  error("Suggested fixes:");
  error("1) Open the app in the same dev store selected by `shopify app dev`.");
  error("2) Ensure `cloudflared` is installed and available in PATH.");
  error("3) If present, temporarily rename `~/.cloudflared/config.yml` (or config.yaml).");
}

function checkCloudflaredBinary() {
  const result = spawnSync("cloudflared", ["--version"], {
    stdio: "ignore",
  });

  if (result.error) {
    warn("`cloudflared` is not available in PATH. Shopify Quick Tunnel can fail without it.");
    return;
  }

  if (result.status !== 0) {
    warn("`cloudflared --version` failed. Verify your cloudflared installation.");
  }
}

function checkCloudflaredConfigConflict() {
  const configDir = path.join(os.homedir(), ".cloudflared");
  const configPaths = [
    path.join(configDir, "config.yml"),
    path.join(configDir, "config.yaml"),
  ];

  const foundConfig = configPaths.find((configPath) => existsSync(configPath));
  if (!foundConfig) {
    return;
  }

  warn(
    `Detected ${foundConfig}. Cloudflare Quick Tunnels may fail when this file exists.`,
  );
  warn("If tunnel creation fails, rename it temporarily and retry dev.");
}

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

async function validateShopifyAppUrl() {
  const rawUrl = process.env.SHOPIFY_APP_URL ?? process.env.HOST;

  if (!rawUrl) {
    warn(
      "SHOPIFY_APP_URL is not set yet. Continuing; Shopify CLI usually injects it during startup.",
    );
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    error(`SHOPIFY_APP_URL is not a valid URL: ${rawUrl}`);
    printTopFixes();
    process.exitCode = 1;
    return;
  }

  if (isLocalHostname(parsedUrl.hostname)) {
    log(`Using local host ${parsedUrl.hostname}; DNS lookup skipped.`);
    return;
  }

  try {
    await lookup(parsedUrl.hostname);
    log(`Resolved ${parsedUrl.hostname} successfully.`);
  } catch {
    error(`DNS lookup failed for ${parsedUrl.hostname}.`);
    printTopFixes();
    process.exitCode = 1;
  }
}

async function main() {
  checkCloudflaredBinary();
  checkCloudflaredConfigConflict();
  await validateShopifyAppUrl();
}

main().catch((caughtError) => {
  const message =
    caughtError instanceof Error ? caughtError.message : String(caughtError);
  error(`Unexpected failure: ${message}`);
  process.exit(1);
});
