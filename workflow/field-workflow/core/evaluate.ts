import type { Hex } from "viem"
import { batchHash, readingMessage, sortReadings } from "./canonical"
import { encodeReport } from "./encode"
import { buildTree, leafHash, proofFor } from "./merkle"
import { epochWindow } from "./nasa"
import { recoverSigner } from "./signature"
import type {
  CellOutcome,
  EpochInput,
  EpochOutcome,
  Params,
  RejectReason,
  SignedReading,
  Verdict,
} from "./types"

// ---------------------------------------------------------------- small integer helpers
// Everything below is integer arithmetic so that every DON node computes bit-identical results.

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n % 2 === 1 ? s[(n - 1) / 2] : Math.floor((s[n / 2 - 1] + s[n / 2]) / 2)
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const ZERO_ROOT: Hex = `0x${"00".repeat(32)}`

const within = (value: number, center: number, absTol: number, relPct: number) =>
  Math.abs(value - center) <= Math.max(absTol, Math.floor((Math.abs(center) * relPct) / 100))

// ---------------------------------------------------------------- main entry point

/**
 * Validate -> fuse -> reward -> encode. Pure function: same input, same output, on every node.
 *
 * 1. Filter: signature, known cell, inside the epoch day, physical bounds, one reading per volunteer per cell.
 * 2. NASA band: reading must be plausible against NASA POWER (wide band, the grid is coarse).
 * 3. Peer agreement: of the band-passing readings, keep those near their median. A lone liar is out-voted.
 * 4. Quorum: a cell needs `minQuorum` agreeing readings, or it is not attested and nobody is paid.
 * 5. Fusion: local correction factors = volunteer median vs NASA, shrunk toward "no correction" for small n.
 * 6. Rewards: base x weights, capped by the reward budget, packed into a Merkle tree.
 */
export function evaluateEpoch(input: EpochInput): EpochOutcome {
  const { epoch, genesisDate, cells, readings, nasa, budgetWei, params } = input
  const win = epochWindow(genesisDate, epoch)
  const hash = batchHash(epoch, readings)
  const known = new Set(cells.map((c) => c.id))

  const verdicts = new Map<SignedReading, Verdict>()
  const reject = (r: SignedReading, reason: RejectReason) => verdicts.set(r, { reading: r, accepted: false, reason })

  // ---- stage 1: hard filters -------------------------------------------------------------
  const seen = new Set<string>()
  const byCell = new Map<string, SignedReading[]>()
  for (const r of sortReadings(readings)) {
    const signer = recoverSigner(readingMessage(r), r.signature)
    if (!signer || signer.toLowerCase() !== r.volunteer.toLowerCase()) { reject(r, "bad-signature"); continue }
    if (!known.has(r.cellId)) { reject(r, "unknown-cell"); continue }
    if (r.observedAt < win.startUnix || r.observedAt > win.endUnix) { reject(r, "outside-epoch"); continue }
    if (!inBounds(r)) { reject(r, "out-of-bounds"); continue }
    const key = `${r.volunteer.toLowerCase()}|${r.cellId}`
    if (seen.has(key)) { reject(r, "duplicate"); continue }
    seen.add(key)

    // ---- stage 2: NASA plausibility band ---------------------------------------------------
    const n = nasa[r.cellId]
    if (!n) throw new Error(`missing NASA data for ${r.cellId}: the caller must skip this epoch`)
    const okTemp = Math.abs(r.tempX10 - n.tempX10) <= params.nasaTempTolX10
    const okRain = within(r.rainX10, n.rainX10, params.nasaRainAbsTolX10, params.nasaRainRelPct)
    if (!okTemp || !okRain) { reject(r, "outside-nasa-band"); continue }

    byCell.set(r.cellId, [...(byCell.get(r.cellId) ?? []), r])
  }

  // Every cell that appears in the batch gets a result, attested or not.
  const cellIdsInBatch = [...new Set(readings.filter((r) => known.has(r.cellId)).map((r) => r.cellId))].sort()
  const outcomes: CellOutcome[] = []
  const rewardAccumulator = new Map<string, bigint>() // lowercase address -> wei

  for (const cellId of cellIdsInBatch) {
    const nasaDay = nasa[cellId]!
    const cands = byCell.get(cellId) ?? []

    // ---- stage 3: peer agreement ---------------------------------------------------------
    let agreeing: SignedReading[] = []
    if (cands.length >= params.minQuorum) {
      const mt = median(cands.map((c) => c.tempX10))
      const mr = median(cands.map((c) => c.rainX10))
      agreeing = cands.filter(
        (c) =>
          Math.abs(c.tempX10 - mt) <= params.peerTempTolX10 &&
          within(c.rainX10, mr, params.peerRainAbsTolX10, params.peerRainRelPct),
      )
      for (const c of cands) if (!agreeing.includes(c)) reject(c, "disagrees-with-peers")
    }

    // ---- stage 4: quorum -------------------------------------------------------------------
    if (agreeing.length < params.minQuorum) {
      for (const c of agreeing.length ? agreeing : cands) if (!verdicts.has(c)) reject(c, "no-quorum")
      outcomes.push({ cellId, tempBiasX10: 0, rainRatioBps: 10_000, moistureX100: 0, qualityBps: 0, accepted: 0 })
      continue
    }

    // Deterministic cap: earliest readings first, ties broken by address.
    const ranked = [...agreeing].sort(
      (a, b) => a.observedAt - b.observedAt || a.volunteer.toLowerCase().localeCompare(b.volunteer.toLowerCase()),
    )
    const accepted = ranked.slice(0, params.maxRewardedPerCell)
    for (const c of ranked.slice(params.maxRewardedPerCell)) reject(c, "reward-cap")
    for (const c of accepted) verdicts.set(c, { reading: c, accepted: true })

    // ---- stage 5: fusion with NASA -----------------------------------------------------------
    const n = accepted.length
    const volTemp = median(accepted.map((c) => c.tempX10))
    const volRain = median(accepted.map((c) => c.rainX10))

    const tempBias = clamp(Math.trunc(((volTemp - nasaDay.tempX10) * n) / (n + params.shrinkK)), -300, 300)
    const rawRatio = Math.floor(((volRain + 10) * 10_000) / (nasaDay.rainX10 + 10)) // +1 mm smoothing
    const rainRatio = clamp(10_000 + Math.trunc(((rawRatio - 10_000) * n) / (n + params.shrinkK)), 2_500, 40_000)

    const moist = accepted.flatMap((c) => (c.moistureX10 === null ? [] : [c.moistureX10]))
    const moistureX100 = moist.length ? median(moist) * 10 : 0

    const meanAbsDev = Math.floor(accepted.reduce((s, c) => s + Math.abs(c.tempX10 - volTemp), 0) / n)
    const agreement = Math.max(0, 4_000 - Math.floor((4_000 * meanAbsDev) / params.peerTempTolX10))
    const quantity = Math.floor((Math.min(n, params.maxRewardedPerCell) * 6_000) / params.maxRewardedPerCell)

    outcomes.push({
      cellId,
      tempBiasX10: tempBias,
      rainRatioBps: rainRatio,
      moistureX100,
      qualityBps: Math.min(10_000, quantity + agreement),
      accepted: n,
    })

    // ---- stage 6a: reward weights ---------------------------------------------------------------
    const sparse = n < params.sparseBelow ? params.sparseBonusPct : 0
    for (const c of accepted) {
      const weight = 100 + (c.moistureX10 === null ? 0 : params.moistureBonusPct) + sparse
      const amount = (params.baseRewardWei * BigInt(weight)) / 100n
      const k = c.volunteer.toLowerCase()
      rewardAccumulator.set(k, (rewardAccumulator.get(k) ?? 0n) + amount)
    }
  }

  // ---- stage 6b: budget cap and Merkle tree --------------------------------------------------------
  let entries = [...rewardAccumulator.entries()].sort(([a], [b]) => a.localeCompare(b))
  const rawTotal = entries.reduce((s, [, v]) => s + v, 0n)
  if (rawTotal > budgetWei) {
    entries = entries.map(([a, v]) => [a, rawTotal === 0n ? 0n : (v * budgetWei) / rawTotal] as [string, bigint])
  }
  entries = entries.filter(([, v]) => v > 0n)
  const rewards = entries.map(([address, amountWei]) => ({ address: address as Hex, amountWei }))
  const totalRewardsWei = rewards.reduce((s, r) => s + r.amountWei, 0n)

  const leaves = rewards.map((r) => leafHash(r.address, r.amountWei))
  const tree = buildTree(leaves)
  const proofs: EpochOutcome["proofs"] = {}
  rewards.forEach((r, i) => {
    proofs[r.address.toLowerCase()] = { amountWei: r.amountWei.toString(), proof: proofFor(tree, leaves[i]) }
  })
  const rewardRoot = rewards.length ? tree.root : ZERO_ROOT

  const reportHex = encodeReport({ epoch, batchHash: hash, rewardRoot, totalRewardsWei, cells: outcomes })
  return {
    batchHash: hash,
    verdicts: sortReadings(readings).map((r) => verdicts.get(r)!),
    cells: outcomes,
    rewards,
    totalRewardsWei,
    rewardRoot,
    proofs,
    reportHex,
  }
}

function inBounds(r: SignedReading): boolean {
  const ints = [r.rainX10, r.tempX10, r.observedAt, ...(r.moistureX10 === null ? [] : [r.moistureX10])]
  if (!ints.every(Number.isInteger)) return false
  if (r.rainX10 < 0 || r.rainX10 > 5_000) return false // 0 - 500 mm in a day
  if (r.tempX10 < -300 || r.tempX10 > 550) return false // -30 .. 55 C
  if (r.moistureX10 !== null && (r.moistureX10 < 0 || r.moistureX10 > 1_000)) return false
  return true
}

export type { Params }
