#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const workerDir = path.join(repoRoot, "worker");
const workerEnv = process.env.WORKER_ENV || "dev";
const debounceMs = Number(process.env.WORKER_REDEPLOY_DEBOUNCE_MS || 800);
const skipMigrations = process.env.WORKER_SKIP_MIGRATIONS === "1";
const skipSecretSync = process.env.WORKER_SKIP_SECRET_SYNC === "1";

const configPath = path.join(repoRoot, "scripts", "config", `${workerEnv}.env`);
const config = readKeyValueEnv(configPath);
const workerDbName = process.env.WORKER_DB_NAME || config.WORKER_DB_NAME || inferDbName(workerEnv);
const shopifyApiSecret = process.env.SHOPIFY_API_SECRET || config.SHOPIFY_API_SECRET || "";

const watchTargets = [
  { target: path.join(workerDir, "src"), recursive: true },
  { target: path.join(workerDir, "migrations"), recursive: true },
  { target: path.join(workerDir, "wrangler.toml"), recursive: false },
];
if (existsSync(configPath)) {
  watchTargets.push({ target: configPath, recursive: false });
}

let activeDeploy = null;
let isDeploying = false;
let queuedDeploy = false;
let debounceTimer = null;
let isShuttingDown = false;
let secretSynced = false;
const watchers = [];

function log(message) {
  console.log(`[worker-live] ${message}`);
}

function logError(message) {
  console.error(`[worker-live] ${message}`);
}

function inferDbName(envName) {
  if (envName === "dev") {
    return "mexican-golf-cart-db-dev";
  }
  if (envName === "staging") {
    return "mexican-golf-cart-db-staging";
  }
  return "mexican-golf-cart-db-prod";
}

function readKeyValueEnv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const values = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    const withoutQuotes =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    values[key] = withoutQuotes;
  }
  return values;
}

function runCommand(args, options = {}) {
  const { input } = options;
  return new Promise((resolve) => {
    const child = spawn("npx", args, {
      cwd: workerDir,
      stdio: ["pipe", "inherit", "inherit"],
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.once("error", (error) => {
      logError(`Command failed to start (npx ${args.join(" ")}): ${error.message}`);
      resolve(false);
    });

    child.once("exit", (code) => {
      resolve(code === 0);
    });
  });
}

async function ensureSecret() {
  if (skipSecretSync) {
    return true;
  }
  if (secretSynced) {
    return true;
  }
  if (!shopifyApiSecret) {
    logError(
      `Missing SHOPIFY_API_SECRET. Set env var SHOPIFY_API_SECRET or add it to ${path.relative(repoRoot, configPath)}.`
    );
    return false;
  }

  log(`Syncing SHOPIFY_API_SECRET for env=${workerEnv}...`);
  const ok = await runCommand(["wrangler", "secret", "put", "SHOPIFY_API_SECRET", "--env", workerEnv], {
    input: `${shopifyApiSecret}\n`,
  });
  if (!ok) {
    logError("Failed to sync SHOPIFY_API_SECRET.");
    return false;
  }

  secretSynced = true;
  return true;
}

async function applyMigrations() {
  if (skipMigrations) {
    return true;
  }
  if (!workerDbName) {
    logError("Unable to resolve WORKER_DB_NAME for migrations.");
    return false;
  }

  log(`Applying migrations to ${workerDbName} (env=${workerEnv})...`);
  const ok = await runCommand([
    "wrangler",
    "d1",
    "migrations",
    "apply",
    workerDbName,
    "--remote",
    "--env",
    workerEnv,
  ]);
  if (!ok) {
    logError("Migration apply failed.");
  }
  return ok;
}

function scheduleDeploy() {
  if (isShuttingDown || isDeploying) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runDeploy();
  }, debounceMs);
}

function queueDeploy(reason) {
  queuedDeploy = true;
  log(`Detected change (${reason}).`);
  scheduleDeploy();
}

async function runDeploy() {
  if (isShuttingDown) {
    return;
  }

  if (isDeploying) {
    queuedDeploy = true;
    return;
  }

  queuedDeploy = false;
  isDeploying = true;

  const secretReady = await ensureSecret();
  if (!secretReady) {
    isDeploying = false;
    if (queuedDeploy) {
      scheduleDeploy();
    }
    return;
  }

  const migrationsReady = await applyMigrations();
  if (!migrationsReady) {
    isDeploying = false;
    if (queuedDeploy) {
      scheduleDeploy();
    }
    return;
  }

  const args = ["wrangler", "deploy", "src/index.ts", "--env", workerEnv];
  log(`Deploying worker with env=${workerEnv}...`);

  const child = spawn("npx", args, {
    cwd: workerDir,
    stdio: "inherit",
  });

  activeDeploy = child;
  let finished = false;

  const finish = (code, signal) => {
    if (finished) {
      return;
    }
    finished = true;
    isDeploying = false;
    activeDeploy = null;

    if (code === 0) {
      log("Deploy complete.");
    } else {
      const detail = signal ? `signal ${signal}` : `exit code ${String(code)}`;
      logError(`Deploy failed (${detail}).`);
    }

    if (isShuttingDown) {
      process.exit(code === 0 ? 0 : 1);
      return;
    }

    if (queuedDeploy) {
      log("Applying queued changes...");
      scheduleDeploy();
    }
  };

  child.once("error", (error) => {
    logError(`Failed to start deploy process: ${error.message}`);
    finish(1);
  });

  child.once("exit", (code, signal) => {
    finish(code ?? 1, signal ?? null);
  });
}

function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  log("Shutting down...");

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  if (activeDeploy) {
    activeDeploy.kill("SIGINT");
    setTimeout(() => {
      if (activeDeploy) {
        activeDeploy.kill("SIGKILL");
      }
    }, 5000).unref();
  } else {
    process.exit(0);
  }
}

function startWatching() {
  for (const { target, recursive } of watchTargets) {
    try {
      const watcher = watch(
        target,
        { recursive },
        (_eventType, filename) => {
          const changed = filename ? String(filename) : path.basename(target);
          if (changed.includes(".DS_Store") || changed.includes(".wrangler")) {
            return;
          }
          queueDeploy(changed);
        }
      );
      watchers.push(watcher);
      log(`Watching ${path.relative(repoRoot, target)}...`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Failed to watch ${path.relative(repoRoot, target)}: ${message}`);
      process.exit(1);
    }
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startWatching();
runDeploy();
