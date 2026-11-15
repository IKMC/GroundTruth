/**
 * Full-stack local test. Everything real EXCEPT the Chainlink DON itself and NASA:
 *   - a local anvil chain with the real compiled contracts,
 *   - the real backend (Express API + viem chain adapter),
 *   - the real oracle code (evaluateEpoch), run here by a script that plays the DON,
 *   - synthetic NASA numbers (the sandbox cannot reach NASA).
 *
 * Run (needs Foundry installed and `forge build` done in ../contracts):
 *   npm run e2e
 */
import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import {
  createPublicClient, createTestClient, createWalletClient, http, type Abi, type Hex,
} from "viem"
import { foundry } from "viem/chains"
import { privateKeyToAccount } from "viem/accounts"
import { createApp } from "../src/app"
import { createViemChain } from "../src/chain"
import { Store, configFromEnv, type NasaPort } from "../src/support"
import { readingMessage } from "../../workflow/field-workflow/core/canonical"
import { evaluateEpoch } from "../../workflow/field-workflow/core/evaluate"
import { DEFAULT_PARAMS } from "../../workflow/field-workflow/core/params"
import { epochWindow } from "../../workflow/field-workflow/core/nasa"
import type { SignedReading } from "../../workflow/field-workflow/core/types"

const PORT = 8546
const RPC = `http://127.0.0.1:${PORT}`
const GENESIS = "2026-10-01"

// Public anvil development keys. Never use these anywhere that holds value.
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  committer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  forwarder: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  farmer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const
const acct = (k: Hex) => privateKeyToAccount(k)
const volunteerKey = (i: number): Hex => `0x${(i + 100).toString(16).padStart(64, "0")}`

const art = (name: string) => {
  const j = JSON.parse(readFileSync(join(__dirname, `../../contracts/out/${name}.sol/${name}.json`), "utf8"))
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex }
}

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}`)
  if (!ok) failures++
}

async function startAnvil(): Promise<ChildProcess> {
  const p = spawn(process.env.ANVIL_BIN ?? "anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" })
  const pub = createPublicClient({ chain: foundry, transport: http(RPC) })
  for (let i = 0; i < 60; i++) {
    try { await pub.getChainId(); return p } catch { await new Promise((r) => setTimeout(r, 250)) }
  }
  p.kill()
  throw new Error("anvil did not start (is Foundry installed?)")
}

async function main() {
  const anvil = await startAnvil()
  try {
    const transport = http(RPC)
    const pub = createPublicClient({ chain: foundry, transport })
    const test = createTestClient({ chain: foundry, mode: "anvil", transport })
    const wallet = (k: Hex) => createWalletClient({ chain: foundry, transport, account: acct(k) })
    const deployer = wallet(KEYS.deployer)

    const send = async (hash: Hex) => {
      const r = await pub.waitForTransactionReceipt({ hash })
      if (r.status !== "success") throw new Error(`tx failed ${hash}`)
      return r
    }
    const deploy = async (name: string, args: unknown[] = []) => {
      const { abi, bytecode } = art(name)
      const r = await send(await deployer.deployContract({ abi, bytecode, args }))
      return { address: r.contractAddress as Hex, abi, block: r.blockNumber }
    }
    const write = (k: Hex, c: { address: Hex; abi: Abi }, functionName: string, args: unknown[] = []) =>
      wallet(k).writeContract({ address: c.address, abi: c.abi, functionName, args }).then(send)
    const read = <T,>(c: { address: Hex; abi: Abi }, functionName: string, args: unknown[] = []) =>
      pub.readContract({ address: c.address, abi: c.abi, functionName, args }) as Promise<T>

    console.log("\n[1] Deploying contracts to a local chain")
    const usdc = await deploy("MockUSDC")
    const sub = await deploy("Subscription", [usdc.address, 5_000_000n, BigInt(30 * 86400), 7000])
    const token = await deploy("FieldToken", [sub.address])
    const oracle = await deploy("FieldOracle", [acct(KEYS.forwarder).address, sub.address, token.address])
    await write(KEYS.deployer, token, "setOracle", [oracle.address])
    await write(KEYS.deployer, sub, "setWiring", [oracle.address, token.address])
    await write(KEYS.deployer, oracle, "setCommitter", [acct(KEYS.committer).address])
    check(true, "MockUSDC, Subscription, FieldToken, FieldOracle deployed and wired")

    console.log("\n[2] A farmer subscribes: money flows into the reward pool and treasury")
    const farmer = acct(KEYS.farmer).address
    await write(KEYS.farmer, usdc, "faucet", [farmer, 50_000_000n])
    await write(KEYS.farmer, usdc, "approve", [sub.address, 5_000_000n])
    await write(KEYS.farmer, sub, "subscribe", [1n])
    check((await read<boolean>(sub, "isActive", [farmer])) === true, "farmer subscription is active")
    check((await read<bigint>(sub, "rewardPool")) === 3_500_000n, "70% of 5 mUSDC (3.5) is in the reward pool")

    console.log("\n[3] Start the real backend and let volunteers submit signed readings")
    const synthNasa: NasaPort = {
      async daily(cell) { return cell.id === "cell-a" ? { tempX10: 250, rainX10: 40 } : { tempX10: 240, rainX10: 0 } },
    }
    const chainPort = createViemChain({
      rpcUrl: RPC, oracle: oracle.address, privateKey: KEYS.committer, deployBlock: 0n, chain: foundry,
    })
    const config = { ...configFromEnv({}), genesisDate: GENESIS, adminKey: "e2e-admin", demoReplay: true }
    const server = createApp({ config, store: new Store(null), chain: chainPort, nasa: synthNasa }).listen(0)
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const http_ = async (path: string, init?: RequestInit) => {
      const res = await fetch(`${api}${path}`, { ...init, headers: { "content-type": "application/json", "x-admin-key": "e2e-admin" } })
      return { status: res.status, body: (await res.json()) as any }
    }

    const day = epochWindow(GENESIS, 1)
    const temps = [262, 265, 268, 264, 266]
    const honest: SignedReading[] = []
    for (let i = 0; i < 5; i++) {
      const a = acct(volunteerKey(i))
      const r = { volunteer: a.address, cellId: "cell-a", observedAt: day.startUnix + 3600 * (i + 1), rainX10: 30 + i * 4, tempX10: temps[i], moistureX10: i === 0 ? 300 : null }
      honest.push({ ...r, signature: await a.signMessage({ message: readingMessage(r) }) })
    }
    // an attacker claims a plausible-but-wrong reading, and another submits NASA's own number copied
    const liarAcct = acct(volunteerKey(50))
    const lie = { volunteer: liarAcct.address, cellId: "cell-a", observedAt: day.startUnix + 7200, rainX10: 40, tempX10: 320, moistureX10: null }
    const liar: SignedReading = { ...lie, signature: await liarAcct.signMessage({ message: readingMessage(lie) }) }
    const forgedBy = acct(volunteerKey(51))
    const fake = { ...lie, volunteer: acct(volunteerKey(0)).address, cellId: "cell-a", observedAt: day.startUnix + 9000 }
    const forged: SignedReading = { ...fake, signature: await forgedBy.signMessage({ message: readingMessage(fake) }) }

    for (const r of [...honest, liar]) check((await http_("/readings", { method: "POST", body: JSON.stringify(r) })).status === 201, `reading accepted from ${r.volunteer.slice(0, 8)}…`)
    check((await http_("/readings", { method: "POST", body: JSON.stringify(forged) })).status === 400, "forged signature rejected at the door")

    console.log("\n[4] Commit the batch hash on-chain BEFORE settlement")
    const commit = await http_("/admin/commit", { method: "POST", body: JSON.stringify({ epoch: 1 }) })
    check(commit.status === 200, `batch committed (tx ${String(commit.body.tx).slice(0, 12)}…)`)
    check((await read<Hex>(oracle, "batchCommitment", [1n])) === commit.body.batchHash, "on-chain commitment equals the batch hash")
    const lateAcct = acct(volunteerKey(60))
    const late = { volunteer: lateAcct.address, cellId: "cell-a", observedAt: day.startUnix + 4000, rainX10: 30, tempX10: 265, moistureX10: null }
    const lateSigned: SignedReading = { ...late, signature: await lateAcct.signMessage({ message: readingMessage(late) }) }
    check((await http_("/readings", { method: "POST", body: JSON.stringify(lateSigned) })).status === 409, "a valid but late reading is refused: the epoch is closed")

    console.log("\n[5] Play the DON: fetch batch, validate, fuse, deliver the report through the forwarder")
    const batch = (await http_("/batch?epoch=1")).body
    const budget = await read<bigint>(oracle, "availableRewardBudget")
    const outcome = evaluateEpoch({
      epoch: 1, genesisDate: GENESIS, cells: config.cells, readings: batch.readings,
      nasa: { "cell-a": { tempX10: 250, rainX10: 40 } }, budgetWei: budget, params: DEFAULT_PARAMS,
    })
    check(outcome.batchHash === (await read<Hex>(oracle, "batchCommitment", [1n])), "DON batch hash matches the commitment")
    check(outcome.verdicts.find((v) => v.reading.volunteer === liar.volunteer)?.reason === "disagrees-with-peers", "plausible liar is out-voted by honest peers")
    await write(KEYS.forwarder, oracle, "onReport", ["0x", outcome.reportHex])
    check((await read<bigint>(oracle, "lastSettledEpoch")) === 1n, "oracle settled epoch 1")
    const cell = await read<{ tempBiasX10: number; rainRatioBps: number; accepted: number; qualityBps: number }>(
      oracle, "getCell", [`0x${Buffer.from("cell-a").toString("hex").padEnd(64, "0")}`])
    console.log(`        cell-a correction: temp ${cell.tempBiasX10 / 10} C, rain x${cell.rainRatioBps / 10000}, ${cell.accepted} readings, quality ${cell.qualityBps / 100}%`)
    check(cell.accepted === 5 && cell.qualityBps > 8000, "5 honest readings attested with high quality")

    console.log("\n[6] Backend finalizes: recomputes the Merkle root and checks it against the chain")
    const fin = await http_("/admin/finalize", { method: "POST", body: JSON.stringify({ epoch: 1 }) })
    check(fin.status === 200 && fin.body.rewarded === 5, `roots match, 5 volunteers rewarded${fin.status !== 200 ? ` (${JSON.stringify(fin.body)})` : ""}`)

    console.log("\n[7] Volunteers claim FIELD with their proofs; one redeems it for USDC")
    let minted = 0n
    for (let i = 0; i < 5; i++) {
      const a = acct(volunteerKey(i))
      await test.setBalance({ address: a.address, value: 10n ** 18n })
      const p = await http_(`/proofs/1/${a.address}`)
      await write(volunteerKey(i), oracle, "claim", [1n, BigInt(p.body.amountWei), p.body.proof])
      minted += BigInt(p.body.amountWei)
    }
    check((await read<bigint>(token, "totalSupply")) === minted, `FIELD minted equals rewards (${minted / 10n ** 18n} FIELD)`)
    check((await http_(`/proofs/1/${liar.volunteer}`)).status === 404, "the liar has no reward proof")

    const v0 = acct(volunteerKey(0)).address
    const field0 = await read<bigint>(token, "balanceOf", [v0])
    await write(volunteerKey(0), token, "redeem", [field0])
    const usdc0 = await read<bigint>(usdc, "balanceOf", [v0])
    check(usdc0 > 0n, `volunteer redeemed ${field0 / 10n ** 18n} FIELD for ${Number(usdc0) / 1e6} mUSDC`)

    const reserved = await read<bigint>(sub, "reserved")
    const pool = await read<bigint>(sub, "rewardPool")
    const supply = await read<bigint>(token, "totalSupply")
    const backing = await read<bigint>(token, "usdcValue", [supply])
    check(reserved >= backing && pool >= reserved, "backing invariant holds: every remaining FIELD is covered by reserved USDC")

    server.close()
  } finally {
    anvil.kill()
  }
  console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
