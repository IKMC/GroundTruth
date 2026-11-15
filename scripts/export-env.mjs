#!/usr/bin/env node
/**
 * Turns a Foundry deployment into ready-to-paste environment variables.
 *
 *   node scripts/export-env.mjs <chainId>        e.g. 11155111 for Sepolia, 31337 for anvil
 *
 * Reads contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json (written by `forge script ... --broadcast`).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const chainId = process.argv[2]
if (!chainId) {
  console.error("usage: node scripts/export-env.mjs <chainId>")
  process.exit(1)
}

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "contracts", "broadcast", "Deploy.s.sol", chainId, "run-latest.json")
let run
try {
  run = JSON.parse(readFileSync(file, "utf8"))
} catch {
  console.error(`Could not read ${file}\nDeploy first: see docs/06-RUNBOOK.md`)
  process.exit(1)
}

const addr = {}
for (const tx of run.transactions ?? []) {
  if (tx.transactionType === "CREATE" && tx.contractName) addr[tx.contractName] = tx.contractAddress
}
const missing = ["MockUSDC", "Subscription", "FieldToken", "FieldOracle"].filter((n) => !addr[n])
if (missing.length) {
  console.error(`Deployment output is missing: ${missing.join(", ")}. Did every transaction succeed?`)
  process.exit(1)
}
const failed = (run.receipts ?? []).filter((r) => r.status !== "0x1")
if (failed.length) {
  console.error(`${failed.length} transaction(s) in this deployment failed. Fix that before using these addresses.`)
  process.exit(1)
}

// The oracle's creation receipt gives the block the backend should start scanning logs from.
const oracleTx = (run.transactions ?? []).find((t) => t.contractName === "FieldOracle")
const oracleReceipt = (run.receipts ?? []).find((r) => r.transactionHash === oracleTx?.hash)
const deployBlock = oracleReceipt ? parseInt(oracleReceipt.blockNumber, 16) : 0

console.log(`# --- backend/.env ---
ORACLE_ADDRESS=${addr.FieldOracle}
DEPLOY_BLOCK=${deployBlock}

# --- app/.env ---
VITE_CHAIN_ID=${chainId}
VITE_ORACLE=${addr.FieldOracle}
VITE_TOKEN=${addr.FieldToken}
VITE_SUBSCRIPTION=${addr.Subscription}
VITE_USDC=${addr.MockUSDC}

# --- workflow/field-workflow/config.staging.json ---
# "oracleAddress": "${addr.FieldOracle}"
`)
