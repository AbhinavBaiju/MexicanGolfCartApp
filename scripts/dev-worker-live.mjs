#!/usr/bin/env node

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const workerDir = path.join(repoRoot, "worker");
const workerEnv = process.env.WORKER_ENV || "dev";
const debounceMs = Number(process.env.WORKER_REDEPLOY_DEBOUNCE_MS || 800);

const watchTargets = [
  { target: path.join(workerDir, "src"), recursive: true },
  { target: path.join(workerDir, "migrations"), recursive: true },
];

let activeDeploy = null;
let isDeploying = false;
let queuedDeploy = false;
let debounceTimer = null;
let isShuttingDown = false;
const watchers = [];

function log(message) {
  console.log(`[worker-live] ${message}`);
}

function logError(message) {
  console.error(`[worker-live] ${message}`);
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

function runDeploy() {
  if (isShuttingDown) {
    return;
  }

  if (isDeploying) {
    queuedDeploy = true;
    return;
  }

  queuedDeploy = false;
  isDeploying = true;

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
