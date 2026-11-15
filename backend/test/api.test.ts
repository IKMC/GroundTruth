import request from "supertest"
import { beforeEach, describe, expect, it } from "vitest"
import type { Hex } from "viem"
import { createApp } from "../src/app"
import { Store, configFromEnv, type ChainPort, type NasaPort } from "../src/support"
import { batchHash } from "../../workflow/field-workflow/core/canonical"
import { evaluateEpoch } from "../../workflow/field-workflow/core/evaluate"
import { leafHash, verifyProof } from "../../workflow/field-workflow/core/merkle"
import { epochWindow } from "../../workflow/field-workflow/core/nasa"
import { DEFAULT_PARAMS } from "../../workflow/field-workflow/core/params"
import { GENESIS, NASA_A, sign, wallet, win } from "../../workflow/field-workflow/test/helpers"

const ADMIN = { "x-admin-key": "test-admin" }
const config = { ...configFromEnv({}), genesisDate: GENESIS, adminKey: "test-admin", demoReplay: true }

/** In-memory stand-ins for the blockchain and NASA. */
function mocks() {
  const state = { committed: 0, settled: 0, root: `0x${"00".repeat(32)}` as Hex, budget: 10n ** 24n, commits: [] as [number, Hex][] }
  const chain: ChainPort = {
    async commitBatch(epoch, hash) {
      state.commits.push([epoch, hash])
      state.committed = epoch
      return `0x${"ab".repeat(32)}` as Hex
    },
    async lastCommittedEpoch() { return state.committed },
    async lastSettledEpoch() { return state.settled },
    async rewardRoot() { return state.root },
    async budgetAtSettlement() { return state.budget },
  }
  const nasa: NasaPort = { async daily(cell) { return cell.id === "cell-a" ? NASA_A : { tempX10: 240, rainX10: 0 } } }
  return { state, chain, nasa }
}

let m: ReturnType<typeof mocks>
let app: ReturnType<typeof createApp>
beforeEach(() => {
  m = mocks()
  app = createApp({ config, store: new Store(null), chain: m.chain, nasa: m.nasa, now: () => win.startUnix + 7_200 })
})

const post = (r: object) => request(app).post("/readings").send(r)

describe("POST /readings", () => {
  it("accepts a correctly signed reading", async () => {
    const r = await sign(wallet(0))
    const res = await post(r)
    expect(res.status).toBe(201)
    expect(res.body.epoch).toBe(1)
  })

  it("rejects a signature that does not match the claimed volunteer", async () => {
    const forged = await sign(wallet(1), {}, wallet(0).address)
    const res = await post(forged)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/signature/)
  })

  it("rejects malformed bodies, unknown cells and duplicates", async () => {
    expect((await post({ hello: "world" })).status).toBe(400)
    expect((await post(await sign(wallet(0), { cellId: "nowhere" }))).status).toBe(400)
    const r = await sign(wallet(0))
    expect((await post(r)).status).toBe(201)
    const again = await post(await sign(wallet(0), { rainX10: 41 }))
    expect(again.status).toBe(409)
  })

  it("enforces the anti-copy time rules when demo replay is off", async () => {
    const t = win.startUnix + 86_400 + 7_200 // "now" is 02:00 on day 2 of the programme
    const strict = createApp({ config: { ...config, demoReplay: false }, store: new Store(null), now: () => t })
    const send = (r: object) => request(strict).post("/readings").send(r)

    const future = await sign(wallet(0), { observedAt: t + 4_000 })
    expect((await send(future)).body.error).toMatch(/future/)

    const old = await sign(wallet(1), { observedAt: win.startUnix + 3_600 }) // 25h old
    expect((await send(old)).body.error).toMatch(/too old/)

    const fresh = await sign(wallet(2), { observedAt: t - 200 })
    expect((await send(fresh)).status).toBe(201)
  })

  it("rate-limits a single client", async () => {
    const limited = createApp({
      config: { ...config, rateLimitPerMinute: 2 },
      store: new Store(null),
      now: () => win.startUnix + 7_200,
    })
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await request(limited).post("/readings").send({})).status)
    expect(codes).toEqual([400, 400, 429, 429])
  })
})

describe("GET /batch and the commitment flow", () => {
  it("serves a deterministic batch whose hash matches the shared core", async () => {
    const rs = [await sign(wallet(2)), await sign(wallet(0)), await sign(wallet(1))]
    for (const r of rs) await post(r)
    const res = await request(app).get("/batch?epoch=1")
    expect(res.body.readings).toHaveLength(3)
    expect(res.body.batchHash).toBe(batchHash(1, rs))
  })

  it("admin commit needs the key, pins the hash on-chain and closes the epoch", async () => {
    await post(await sign(wallet(0)))
    expect((await request(app).post("/admin/commit").send({ epoch: 1 })).status).toBe(401)

    const res = await request(app).post("/admin/commit").set(ADMIN).send({ epoch: 1 })
    expect(res.status).toBe(200)
    expect(m.state.commits).toHaveLength(1)
    expect(m.state.commits[0][1]).toBe(res.body.batchHash)

    expect((await post(await sign(wallet(5)))).status).toBe(409) // epoch closed
    expect((await request(app).post("/admin/commit").set(ADMIN).send({ epoch: 1 })).status).toBe(409)
  })
})

describe("finalize and proofs", () => {
  async function committedEpochWith(n: number) {
    const temps = [262, 265, 268, 264, 266]
    const readings = await Promise.all(
      Array.from({ length: n }, (_, i) => sign(wallet(i), { tempX10: temps[i % 5], rainX10: 30 + i * 4 })),
    )
    for (const r of readings) expect((await post(r)).status).toBe(201)
    await request(app).post("/admin/commit").set(ADMIN).send({ epoch: 1 })
    return readings
  }

  it("serves verifiable proofs once its root equals the on-chain root", async () => {
    const readings = await committedEpochWith(5)
    // what the DON would have produced and put on-chain
    const expected = evaluateEpoch({
      epoch: 1, genesisDate: GENESIS, cells: config.cells, readings,
      nasa: { "cell-a": NASA_A }, budgetWei: m.state.budget, params: DEFAULT_PARAMS,
    })
    m.state.settled = 1
    m.state.root = expected.rewardRoot

    const fin = await request(app).post("/admin/finalize").set(ADMIN).send({ epoch: 1 })
    expect(fin.status).toBe(200)
    expect(fin.body.rewarded).toBe(5)

    for (const v of readings) {
      const p = await request(app).get(`/proofs/1/${v.volunteer}`)
      expect(p.status).toBe(200)
      expect(verifyProof(p.body.proof, m.state.root, leafHash(v.volunteer, BigInt(p.body.amountWei)))).toBe(true)
    }
    expect((await request(app).get(`/proofs/1/${wallet(9).address}`)).status).toBe(404)
  })

  it("refuses to serve proofs when the roots differ", async () => {
    await committedEpochWith(5)
    m.state.settled = 1
    m.state.root = `0x${"11".repeat(32)}`
    const fin = await request(app).post("/admin/finalize").set(ADMIN).send({ epoch: 1 })
    expect(fin.status).toBe(409)
    expect(fin.body.error).toBe("root mismatch")
    expect((await request(app).get(`/proofs/1/${wallet(0).address}`)).status).toBe(404)
  })

  it("will not finalize before on-chain settlement or without a commitment", async () => {
    await committedEpochWith(3)
    expect((await request(app).post("/admin/finalize").set(ADMIN).send({ epoch: 1 })).status).toBe(409)
    expect((await request(app).post("/admin/finalize").set(ADMIN).send({ epoch: 2 })).status).toBe(409)
  })

  it("exposes epoch status and cells", async () => {
    await committedEpochWith(3)
    const s = await request(app).get("/epochs/1")
    expect(s.body).toMatchObject({ epoch: 1, readings: 3, finalized: false })
    expect(s.body.window.ymd).toBe(epochWindow(GENESIS, 1).ymd)
    expect((await request(app).get("/cells")).body.cells).toHaveLength(3)
  })
})
