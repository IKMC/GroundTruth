import {
  CronCapability,
  EVMClient,
  HTTPClient,
  Runner,
  TxStatus,
  LATEST_BLOCK_NUMBER,
  bytesToHex,
  consensusIdenticalAggregation,
  encodeCallMsg,
  getNetwork,
  handler,
  hexToBase64,
  json,
  ok,
  type NodeRuntime,
  type Runtime,
} from "@chainlink/cre-sdk"
import { decodeFunctionResult, encodeFunctionData, parseAbi, parseUnits, zeroAddress, type Hex } from "viem"
import { epochWindow, nasaDailyUrl, parseNasaDaily } from "./core/nasa"
import { evaluateEpoch } from "./core/evaluate"
import { DEFAULT_PARAMS } from "./core/params"
import type { CellInfo, NasaDay, Params, SignedReading } from "./core/types"

/**
 * GroundTruth settlement workflow.
 *
 * Every cron tick the workflow:
 *   1. reads the oracle contract: which epoch is next, was its batch committed, how much reward budget exists;
 *   2. in NODE MODE, every DON node independently fetches the committed batch from the backend and the
 *      NASA POWER data, runs the SAME deterministic evaluateEpoch(), and returns the encoded report;
 *   3. the DON compares the nodes' answers (identical consensus) and only a result that all agree on survives;
 *   4. the agreed report is signed and delivered through the forwarder to FieldOracle.onReport.
 */

type Config = {
  schedule: string // six-field cron, seconds first
  genesisDate: string // UTC date of epoch 1, "YYYY-MM-DD"
  backendUrl: string // serves GET /batch?epoch=N
  oracleAddress: string
  chainSelectorName: string
  gasLimit: string
  cells: CellInfo[]
  baseRewardField?: string // reward for one reading in FIELD, e.g. "2"
  params?: Partial<Omit<Params, "baseRewardWei">>
}

/** Everything a node returns must be primitives so the DON can compare them for equality. */
type NodeResult = {
  status: string // "ok" | "nasa-unavailable" | "bad-batch"
  batchHash: string
  reportHex: string
  summary: string
}

const ORACLE_ABI = parseAbi([
  "function lastSettledEpoch() view returns (uint256)",
  "function lastCommittedEpoch() view returns (uint256)",
  "function batchCommitment(uint256 epoch) view returns (bytes32)",
  "function availableRewardBudget() view returns (uint256)",
])

type ViewName = "lastSettledEpoch" | "lastCommittedEpoch" | "batchCommitment" | "availableRewardBudget"

/** One read of the oracle contract. LATEST keeps it fresh; the contract re-checks everything anyway. */
const readOracle = (
  runtime: Runtime<Config>,
  evm: EVMClient,
  functionName: ViewName,
  args: readonly bigint[] = [],
): unknown => {
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: runtime.config.oracleAddress as Hex,
        data: encodeFunctionData({ abi: ORACLE_ABI, functionName, args } as never),
      }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result()
  return decodeFunctionResult({ abi: ORACLE_ABI, functionName, data: bytesToHex(reply.data) } as never)
}

/** Runs on EVERY node. Must be deterministic given the same remote data. */
const computeEpoch = (nodeRuntime: NodeRuntime<Config>, epoch: number, budgetWei: string): NodeResult => {
  const cfg = nodeRuntime.config
  const http = new HTTPClient()

  // ---- the volunteer batch (its hash was committed on-chain before this run) ----
  const batchResp = http
    .sendRequest(nodeRuntime, { url: `${cfg.backendUrl}/batch?epoch=${epoch}`, method: "GET" })
    .result()
  if (!ok(batchResp)) return { status: "bad-batch", batchHash: "", reportHex: "", summary: "backend error" }
  const batch = json(batchResp) as { readings?: SignedReading[] }
  if (!batch || !Array.isArray(batch.readings)) {
    return { status: "bad-batch", batchHash: "", reportHex: "", summary: "malformed batch" }
  }

  // ---- NASA POWER for every cell that has at least one reading ----
  const win = epochWindow(cfg.genesisDate, epoch)
  const cellIds = new Set(batch.readings.map((r) => r.cellId))
  const nasa: Record<string, NasaDay | undefined> = {}
  for (const cell of cfg.cells) {
    if (!cellIds.has(cell.id)) continue
    const resp = http.sendRequest(nodeRuntime, { url: nasaDailyUrl(cell, win.ymd), method: "GET" }).result()
    const day = ok(resp) ? parseNasaDaily(json(resp), win.ymd) : undefined
    // POWER publishes daily data with a delay. Without it we cannot cross-check, so we do not settle yet.
    if (!day) return { status: "nasa-unavailable", batchHash: "", reportHex: "", summary: `no NASA data for ${cell.id}` }
    nasa[cell.id] = day
  }

  const params: Params = {
    ...DEFAULT_PARAMS,
    ...(cfg.params ?? {}),
    baseRewardWei: cfg.baseRewardField ? parseUnits(cfg.baseRewardField, 18) : DEFAULT_PARAMS.baseRewardWei,
  }

  const out = evaluateEpoch({
    epoch,
    genesisDate: cfg.genesisDate,
    cells: cfg.cells,
    readings: batch.readings,
    nasa,
    budgetWei: BigInt(budgetWei),
    params,
  })

  const accepted = out.verdicts.filter((v) => v.accepted).length
  return {
    status: "ok",
    batchHash: out.batchHash,
    reportHex: out.reportHex,
    summary: `${accepted}/${out.verdicts.length} readings accepted, ${out.rewards.length} rewarded`,
  }
}

const onCronTrigger = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName, isTestnet: true })
  if (!network) throw new Error(`Network not found: ${cfg.chainSelectorName}`)
  const evm = new EVMClient(network.chainSelector.selector)

  // 1. Which epoch is next, and was its batch committed?
  const lastSettled = readOracle(runtime, evm, "lastSettledEpoch") as bigint
  const lastCommitted = readOracle(runtime, evm, "lastCommittedEpoch") as bigint
  const epoch = lastSettled + 1n
  if (epoch > lastCommitted) return `Skipped: epoch ${epoch} has no committed batch yet`

  const committed = readOracle(runtime, evm, "batchCommitment", [epoch]) as Hex
  const budget = readOracle(runtime, evm, "availableRewardBudget") as bigint
  runtime.log(`Settling epoch ${epoch}, committed ${committed}, reward budget ${budget} wei`)

  // 2 + 3. Every node computes; the DON requires identical answers.
  const result = runtime
    .runInNodeMode(computeEpoch, consensusIdenticalAggregation<NodeResult>())(Number(epoch), budget.toString())
    .result()

  if (result.status !== "ok") {
    runtime.log(`Not settling: ${result.status} (${result.summary})`)
    return `Skipped: ${result.status}`
  }
  if (result.batchHash.toLowerCase() !== committed.toLowerCase()) {
    // The backend served a batch that differs from what it committed. Never sign that.
    runtime.log(`Batch hash ${result.batchHash} does not match on-chain commitment ${committed}`)
    return "Skipped: batch does not match commitment"
  }
  runtime.log(`Consensus reached: ${result.summary}`)

  // 4. Sign and deliver through the forwarder.
  const report = runtime
    .report({
      encodedPayload: hexToBase64(result.reportHex),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result()

  const write = evm
    .writeReport(runtime, { receiver: cfg.oracleAddress, report, gasConfig: { gasLimit: cfg.gasLimit } })
    .result()

  if (write.txStatus === TxStatus.SUCCESS) {
    const txHash = bytesToHex(write.txHash || new Uint8Array(32))
    runtime.log(`Report delivered. tx: ${txHash}`)
    return `Settled epoch ${epoch}: ${txHash}`
  }
  throw new Error(`writeReport failed with status ${write.txStatus}`)
}

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}

main()
