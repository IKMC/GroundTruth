import { describe, expect, it } from "vitest"
import { batchHash, readingMessage } from "../core/canonical"
import { buildTree, leafHash, proofFor, verifyProof } from "../core/merkle"
import { epochOfTimestamp, epochWindow, nasaDailyUrl, parseNasaDaily } from "../core/nasa"
import { recoverSigner } from "../core/signature"
import { CELLS, sign, wallet } from "./helpers"

describe("signature recovery", () => {
  it("matches the wallet that signed", async () => {
    const r = await sign(wallet(3))
    expect(recoverSigner(readingMessage(r), r.signature)?.toLowerCase()).toBe(wallet(3).address.toLowerCase())
  })
  it("returns a different address for a tampered message and null for garbage", async () => {
    const r = await sign(wallet(3))
    const other = recoverSigner(readingMessage({ ...r, tempX10: r.tempX10 + 1 }), r.signature)
    expect(other?.toLowerCase()).not.toBe(wallet(3).address.toLowerCase())
    expect(recoverSigner("x", "0x1234")).toBeNull()
  })
})

describe("batch hash", () => {
  it("is order independent and changes with any reading or epoch", async () => {
    const a = await sign(wallet(0)); const b = await sign(wallet(1))
    expect(batchHash(1, [a, b])).toBe(batchHash(1, [b, a]))
    expect(batchHash(1, [a, b])).not.toBe(batchHash(2, [a, b]))
    expect(batchHash(1, [a, b])).not.toBe(batchHash(1, [a, { ...b, rainX10: b.rainX10 + 1 }]))
  })
  it("is non-zero for an empty batch (the contract rejects a zero commitment)", () => {
    expect(batchHash(1, [])).not.toBe(`0x${"00".repeat(32)}`)
  })
})

describe("merkle tree", () => {
  const addrs = Array.from({ length: 7 }, (_, i) => wallet(i).address)
  for (const n of [1, 2, 3, 5, 7]) {
    it(`proofs verify for ${n} leaves`, () => {
      const leaves = addrs.slice(0, n).map((a, i) => leafHash(a, BigInt(i + 1) * 10n ** 18n))
      const tree = buildTree(leaves)
      for (const l of leaves) expect(verifyProof(proofFor(tree, l), tree.root, l)).toBe(true)
      expect(verifyProof([], tree.root, leafHash(addrs[6], 1n))).toBe(false)
    })
  }
})

describe("NASA helpers", () => {
  it("builds the POWER daily point URL", () => {
    const url = nasaDailyUrl(CELLS[0], "20261001")
    expect(url).toContain("temporal/daily/point")
    expect(url).toContain("parameters=T2M,PRECTOTCORR")
    expect(url).toContain("community=AG")
    expect(url).toContain("start=20261001&end=20261001")
  })
  it("parses values into tenths and treats -999 as missing", () => {
    const ok = { properties: { parameter: { T2M: { "20261001": 25.04 }, PRECTOTCORR: { "20261001": 3.96 } } } }
    expect(parseNasaDaily(ok, "20261001")).toEqual({ tempX10: 250, rainX10: 40 })
    const missing = { properties: { parameter: { T2M: { "20261001": -999 }, PRECTOTCORR: { "20261001": 1 } } } }
    expect(parseNasaDaily(missing, "20261001")).toBeUndefined()
    expect(parseNasaDaily({}, "20261001")).toBeUndefined()
  })
  it("maps epochs to UTC days including month rollover", () => {
    expect(epochWindow("2026-10-01", 1).ymd).toBe("20261001")
    expect(epochWindow("2026-10-01", 31).ymd).toBe("20261031")
    expect(epochWindow("2026-10-01", 32).ymd).toBe("20261101")
    const w = epochWindow("2026-10-01", 1)
    expect(w.endUnix - w.startUnix).toBe(86_399)
  })
  it("epochOfTimestamp is the inverse of epochWindow", () => {
    for (const e of [1, 2, 31, 32, 100]) {
      const w = epochWindow("2026-10-01", e)
      expect(epochOfTimestamp("2026-10-01", w.startUnix)).toBe(e)
      expect(epochOfTimestamp("2026-10-01", w.endUnix)).toBe(e)
    }
    expect(epochOfTimestamp("2026-10-01", epochWindow("2026-10-01", 1).startUnix - 1)).toBe(0)
  })
})
