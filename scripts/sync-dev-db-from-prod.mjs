#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const PREFIX = "[dev-db-sync]";
const repoRoot = process.cwd();
const workerDir = path.join(repoRoot, "worker");
const devEnvPath = path.join(repoRoot, "scripts", "config", "dev.env");

const copyOrder = [
  "shops",
  "locations",
  "products",
  "inventory_day",
  "bookings",
  "booking_items",
  "booking_days",
  "agreements",
  "signed_agreements",
  "webhook_events",
];

const truncateOrder = [
  "signed_agreements",
  "agreements",
  "booking_days",
  "booking_items",
  "bookings",
  "inventory_day",
  "products",
  "locations",
  "webhook_events",
  "shops",
];

function log(message) {
  console.log(`${PREFIX} ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function stripQuotes(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function expandVars(value, vars) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key) => {
    const resolved = vars[key];
    return resolved === undefined ? "" : resolved;
  });
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!key) {
      continue;
    }
    parsed[key] = stripQuotes(trimmed.slice(eq + 1));
  }

  const resolved = { ...parsed };
  for (let i = 0; i < 4; i += 1) {
    let changed = false;
    for (const [key, current] of Object.entries(resolved)) {
      const next = expandVars(current, { ...process.env, ...resolved });
      if (next !== current) {
        resolved[key] = next;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return resolved;
}

function resolveConfigValue(config, key, fallback) {
  const envValue = process.env[key];
  if (envValue !== undefined && envValue !== "") {
    return envValue;
  }
  const configValue = config[key];
  if (configValue !== undefined && configValue !== "") {
    return configValue;
  }
  return fallback;
}

function runCommand(command, args, options = {}) {
  const { captureStdout = false, passthrough = true } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workerDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (passthrough) {
          process.stdout.write(text);
        }
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (passthrough) {
          process.stderr.write(text);
        }
      });
    }

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code) => {
      if (code !== 0) {
        const output = `${stdout}\n${stderr}`;
        reject(
          new Error(
            `Command failed (${command} ${args.join(" ")}) with exit code ${String(code)}.\n${output}`.trim(),
          ),
        );
        return;
      }
      resolve(captureStdout ? stdout : "");
    });
  });
}

async function runWrangler(args, options = {}) {
  return runCommand("npx", ["wrangler", ...args], options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonPayload(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return trimmed;
  }
  const start = trimmed.indexOf("[");
  if (start >= 0) {
    return trimmed.slice(start);
  }
  fail(`Unable to parse JSON output from Wrangler. Output was: ${raw}`);
}

async function queryTableCount(databaseName, table, remoteFlag) {
  const sql = `SELECT COUNT(*) AS count FROM "${table}";`;
  const output = await runWrangler(
    ["d1", "execute", databaseName, remoteFlag, "--json", "--command", sql],
    { captureStdout: true, passthrough: false },
  );
  const payload = JSON.parse(extractJsonPayload(output));
  const countValue = payload?.[0]?.results?.[0]?.count;
  const count = Number(countValue);
  if (!Number.isFinite(count)) {
    fail(`Unexpected count result for ${databaseName}.${table}`);
  }
  return count;
}

async function exportTable(databaseName, table, remoteFlag, outputPath) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runWrangler([
        "d1",
        "export",
        databaseName,
        remoteFlag,
        "--no-schema",
        "--table",
        table,
        "--output",
        outputPath,
      ]);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isExportLock = message.includes("Currently processing a long-running export");
      if (!isExportLock || attempt === maxAttempts) {
        throw error;
      }
      const waitMs = attempt * 4000;
      log(
        `Export for "${table}" is temporarily locked by another export. Retrying in ${waitMs / 1000}s (${attempt}/${maxAttempts})...`,
      );
      await sleep(waitMs);
    }
  }
}

async function main() {
  const config = readEnvFile(devEnvPath);
  const syncEnabled = parseBoolean(resolveConfigValue(config, "DEV_DB_SYNC_ENABLED", "1"), true);
  if (!syncEnabled) {
    log("DEV_DB_SYNC_ENABLED=0, skipping database sync.");
    return;
  }

  const sourceDb = resolveConfigValue(config, "DEV_DB_SYNC_SOURCE_DB_NAME", "mexican-golf-cart-db-prod");
  const targetDb = resolveConfigValue(
    config,
    "DEV_DB_SYNC_TARGET_DB_NAME",
    resolveConfigValue(config, "WORKER_DB_NAME", "mexican-golf-cart-db-dev"),
  );
  const remoteMode = parseBoolean(resolveConfigValue(config, "DEV_DB_SYNC_REMOTE", "1"), true);
  const remoteFlag = remoteMode ? "--remote" : "--local";

  if (sourceDb === targetDb) {
    fail(`Source and target databases must differ (both are "${sourceDb}").`);
  }

  log(`Syncing tables from ${sourceDb} -> ${targetDb} (${remoteMode ? "remote" : "local"} mode).`);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dev-db-sync-"));
  const exportFiles = [];

  try {
    for (const table of copyOrder) {
      const exportPath = path.join(tempDir, `export-${table}.sql`);
      log(`Exporting table "${table}" from ${sourceDb}...`);
      await exportTable(sourceDb, table, remoteFlag, exportPath);
      exportFiles.push({ table, path: exportPath });
    }

    const importLines = [
      "-- Generated by scripts/sync-dev-db-from-prod.mjs",
      "PRAGMA defer_foreign_keys=TRUE;",
      ...truncateOrder.map((table) => `DELETE FROM "${table}";`),
      "DELETE FROM sqlite_sequence WHERE name IN ('shops','locations');",
    ];

    for (const file of exportFiles) {
      const content = await readFile(file.path, "utf8");
      const inserts = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("INSERT INTO "));

      if (inserts.length > 0) {
        importLines.push(`-- ${file.table}`);
        importLines.push(...inserts);
      }
    }

    const importFilePath = path.join(tempDir, "compiled-sync.sql");
    await writeFile(importFilePath, `${importLines.join("\n")}\n`, "utf8");

    log(`Importing compiled snapshot into ${targetDb}...`);
    await runWrangler(["d1", "execute", targetDb, remoteFlag, "--file", importFilePath]);

    const sourceCounts = {};
    const targetCounts = {};
    for (const table of copyOrder) {
      sourceCounts[table] = await queryTableCount(sourceDb, table, remoteFlag);
      targetCounts[table] = await queryTableCount(targetDb, table, remoteFlag);
      if (sourceCounts[table] !== targetCounts[table]) {
        fail(
          `Row count mismatch for table "${table}" (source=${sourceCounts[table]}, target=${targetCounts[table]}).`,
        );
      }
    }

    for (const table of ["shops", "bookings", "booking_items", "booking_days"]) {
      if ((targetCounts[table] ?? 0) <= 0) {
        fail(`Critical table "${table}" is empty after sync.`);
      }
    }

    log(
      `Sync complete. shops=${targetCounts.shops}, bookings=${targetCounts.bookings}, booking_items=${targetCounts.booking_items}, booking_days=${targetCounts.booking_days}.`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${PREFIX} ERROR: ${message}`);
  process.exit(1);
});
