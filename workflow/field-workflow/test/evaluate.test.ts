import { describe, expect, it } from "vitest"
import { evaluateEpoch } from "../core/evaluate"
import { decodeReport, cellIdToBytes32 } from "../core/encode"
import { leafHash, verifyProof } from "../core/merkle"
import { DEFAULT_PARAMS } from "../core/params"
import { input, sign, wallet, win } from "./helpers"

const honest = async (n: number, temps = [262, 265, 268, 264, 266, 267, 263]) =>
  Promise.all(Array.from({ length: n }, (_, i) => sign(wallet(i), { tempX10: temps[i % temps.length], rainX10: 30 + i * 4 })))
const reasonOf = (out: ReturnType<typeof evaluateEpoch>, who: string) =>
  out.verdicts.find((v) => v.reading.volunteer.toLowerCase() === who.toLowerCase())

describe("evaluateEpoch: honest data", () => {
  it("accepts agreeing readings and computes shrunk local corrections", async () => {
    const out = evaluateEpoch(input(await honest(5)))
    expect(out.verdicts.every((v) => v.accepted)).toBe(true)
    const cell = out.cells[0]
    expect(cell.accepted).toBe(5)
    // volunteer median temp 265 vs NASA 250 = +15, shrunk by 5/(5+2) -> trunc(10.7) = 10
    expect(cell.tempBiasX10).toBe(10)
    expect(cell.qualityBps).toBeGreaterThan(8_000)
    // volunteer median rain 3.8 mm vs NASA 4.0 mm: raw ratio (38+10)/(40+10) = 0.96 -> 9600 bps,
    // shrunk toward 1.0 by 5/7: 10000 + trunc(-400 * 5/7) = 9715
    expect(cell.rainRatioBps).toBe(9_715)
  })

  it("is deterministic: input order does not change the report bytes", async () => {
    const rs = await honest(5)
    const a = evaluateEpoch(input(rs)).reportHex
    const b = evaluateEpoch(input([...rs].reverse())).reportHex
    expect(a).toBe(b)
  })

  it("rewards: moisture and sparse-cell bonuses apply", async () => {
    const withMoisture = await sign(wallet(0), { moistureX10: 300 })
    const plain = [await sign(wallet(1)), await sign(wallet(2))]
    const out = evaluateEpoch(input([withMoisture, ...plain]))
    const amt = (w: string) => out.rewards.find((r) => r.address.toLowerCase() === w.toLowerCase())!.amountWei
    // n=3 < sparseBelow(4): sparse +50. moisture +50 on top for wallet 0.
    expect(amt(wallet(1).address)).toBe((DEFAULT_PARAMS.baseRewardWei * 150n) / 100n)
    expect(amt(wallet(0).address)).toBe((DEFAULT_PARAMS.baseRewardWei * 200n) / 100n)
  })
})

describe("evaluateEpoch: attacks and bad data", () => {
  it("rejects a reading far outside the NASA band", async () => {
    const liar = await sign(wallet(9), { tempX10: 450 })
    const out = evaluateEpoch(input([...(await honest(4)), liar]))
    expect(reasonOf(out, wallet(9).address)?.reason).toBe("outside-nasa-band")
  })

  it("rejects a plausible-looking liar that disagrees with peers", async () => {
    const liar = await sign(wallet(9), { tempX10: 320 }) // inside NASA band (70 < 80) but 55 from peers
    const out = evaluateEpoch(input([...(await honest(4)), liar]))
    expect(reasonOf(out, wallet(9).address)?.reason).toBe("disagrees-with-peers")
    expect(out.cells[0].accepted).toBe(4)
  })

  it("rejects a forged signature (signed by someone else)", async () => {
    const forged = await sign(wallet(9), {}, wallet(0).address) // wallet 9 signs, claims to be wallet 0
    const out = evaluateEpoch(input([...(await honest(4)).slice(1), forged]))
    expect(out.verdicts.find((v) => v.reading === forged)?.reason).toBe("bad-signature")
  })

  it("rejects duplicates, wrong day, unknown cell and impossible values", async () => {
    const base = await honest(4)
    const dup = await sign(wallet(0), { tempX10: 266 })
    const late = await sign(wallet(10), { observedAt: win.endUnix + 10 })
    const nowhere = await sign(wallet(11), { cellId: "cell-zzz" })
    const absurd = await sign(wallet(12), { rainX10: 9_000 })
    const out = evaluateEpoch(input([...base, dup, late, nowhere, absurd]))
    const r = (rd: typeof dup) => out.verdicts.find((v) => v.reading === rd)?.reason
    expect(r(dup)).toBe("duplicate")
    expect(r(late)).toBe("outside-epoch")
    expect(r(nowhere)).toBe("unknown-cell")
    expect(r(absurd)).toBe("out-of-bounds")
  })

  it("pays nobody and attests nothing without quorum", async () => {
    const out = evaluateEpoch(input(await honest(2)))
    expect(out.cells[0]).toMatchObject({ qualityBps: 0, accepted: 0, tempBiasX10: 0, rainRatioBps: 10_000 })
    expect(out.rewards).toHaveLength(0)
    expect(out.rewardRoot).toBe(`0x${"00".repeat(32)}`)
  })

  it("caps rewarded readings per cell", async () => {
    const out = evaluateEpoch(input(await honest(7)))
    expect(out.cells[0].accepted).toBe(5)
    expect(out.verdicts.filter((v) => v.reason === "reward-cap")).toHaveLength(2)
  })

  it("scales rewards down to the budget and never exceeds it", async () => {
    const budget = 3n * 10n ** 18n
    const out = evaluateEpoch(input(await honest(5), { budgetWei: budget }))
    expect(out.totalRewardsWei).toBeLessThanOrEqual(budget)
    expect(out.totalRewardsWei).toBeGreaterThan(0n)
    const zero = evaluateEpoch(input(await honest(5), { budgetWei: 0n }))
    expect(zero.rewards).toHaveLength(0)
  })

  it("throws when NASA data is missing so the caller skips the epoch", async () => {
    const readings = await honest(4)
    expect(() => evaluateEpoch(input(readings, { nasa: {} }))).toThrow(/missing NASA/)
  })
})

describe("report encoding and proofs", () => {
  it("round-trips through ABI decode", async () => {
    const out = evaluateEpoch(input(await honest(5)))
    const [epoch, hash, root, total, cells] = decodeReport(out.reportHex)
    expect(epoch).toBe(1n)
    expect(hash).toBe(out.batchHash)
    expect(root).toBe(out.rewardRoot)
    expect(total).toBe(out.totalRewardsWei)
    expect(cells[0].cellId).toBe(cellIdToBytes32("cell-a"))
    expect(cells[0].tempBiasX10).toBe(out.cells[0].tempBiasX10)
  })

  it("every volunteer proof verifies against the root", async () => {
    const out = evaluateEpoch(input(await honest(5)))
    expect(out.rewards).toHaveLength(5)
    for (const r of out.rewards) {
      const p = out.proofs[r.address.toLowerCase()]
      expect(verifyProof(p.proof, out.rewardRoot, leafHash(r.address, BigInt(p.amountWei)))).toBe(true)
    }
    // a wrong amount must fail
    const r0 = out.rewards[0]
    expect(verifyProof(out.proofs[r0.address.toLowerCase()].proof, out.rewardRoot, leafHash(r0.address, r0.amountWei + 1n))).toBe(false)
  })
})
