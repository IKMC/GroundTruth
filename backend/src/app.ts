import { timingSafeEqual } from "node:crypto"
import cors from "cors"
import express, { type NextFunction, type Request, type Response } from "express"
import { isAddress, type Hex } from "viem"
import { batchHash, readingMessage, sortReadings } from "../../workflow/field-workflow/core/canonical"
import { evaluateEpoch } from "../../workflow/field-workflow/core/evaluate"
import { epochOfTimestamp, epochWindow } from "../../workflow/field-workflow/core/nasa"
import { DEFAULT_PARAMS } from "../../workflow/field-workflow/core/params"
import { recoverSigner } from "../../workflow/field-workflow/core/signature"
import type { NasaDay, Params, SignedReading } from "../../workflow/field-workflow/core/types"
import type { AppConfig, ChainPort, NasaPort, Store } from "./support"

export type Deps = {
  config: AppConfig
  store: Store
  chain?: ChainPort
  nasa?: NasaPort
  params?: Params
  now?: () => number // unix seconds, injectable for tests
}

/**
 * Error text that is safe to show or log. RPC libraries put the full provider URL, including the
 * API key, inside their error messages, so every URL is removed and only the first line is kept.
 */
export function safeErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : "internal error"
  return raw.split("\n")[0].replace(/https?:\/\/\S+/gi, "[url removed]").slice(0, 300)
}

const HEX_SIG = /^0x[0-9a-fA-F]{130}$/

/** Returns a SignedReading, or a string describing what is wrong with the body. */
function parseReading(body: unknown): SignedReading | string {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== "object") return "body must be a JSON object"
  const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x)
  if (typeof b.volunteer !== "string" || !isAddress(b.volunteer)) return "volunteer must be an address"
  if (typeof b.cellId !== "string" || b.cellId.length === 0 || b.cellId.length > 32) return "cellId must be 1-32 chars"
  if (!isInt(b.observedAt)) return "observedAt must be an integer (unix seconds)"
  if (!isInt(b.rainX10)) return "rainX10 must be an integer (tenths of mm)"
  if (!isInt(b.tempX10)) return "tempX10 must be an integer (tenths of C)"
  if (b.moistureX10 !== null && !isInt(b.moistureX10)) return "moistureX10 must be an integer or null"
  if (typeof b.signature !== "string" || !HEX_SIG.test(b.signature)) return "signature must be a 65-byte hex string"
  return {
    volunteer: b.volunteer as Hex,
    cellId: b.cellId,
    observedAt: b.observedAt,
    rainX10: b.rainX10,
    tempX10: b.tempX10,
    moistureX10: b.moistureX10 as number | null,
    signature: b.signature as Hex,
  }
}

const asEpoch = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? n : null
}

export function createApp(deps: Deps) {
  const { config, store, chain, nasa } = deps
  const params = deps.params ?? DEFAULT_PARAMS
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  const app = express()

  app.use(cors({ origin: config.corsOrigin }))
  app.use(express.json({ limit: "20kb" }))

  // Fixed-window limiter per IP on reading intake: cheap protection against spam.
  const hits = new Map<string, { count: number; reset: number }>()
  const limit = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown"
    const t = now()
    const h = hits.get(key)
    if (!h || h.reset <= t) hits.set(key, { count: 1, reset: t + 60 })
    else if (++h.count > config.rateLimitPerMinute) return void res.status(429).json({ error: "rate limit" })
    next()
  }

  const admin = (req: Request, res: Response, next: NextFunction) => {
    const given = Buffer.from(String(req.header("x-admin-key") ?? ""))
    const wanted = Buffer.from(config.adminKey)
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      return void res.status(401).json({ error: "admin key required" })
    }
    next()
  }

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response) => {
      Promise.resolve(fn(req, res)).catch((e: unknown) => {
        const message = safeErrorMessage(e)
        console.error(`request failed: ${message}`)
        res.status(500).json({ error: message })
      })
    }

  // ------------------------------------------------------------------ public

  app.get("/health", (_req, res) => void res.json({ ok: true }))
  app.get("/cells", (_req, res) => void res.json({ genesisDate: config.genesisDate, cells: config.cells }))

  app.post("/readings", limit, (req, res) => {
    const parsed = parseReading(req.body)
    if (typeof parsed === "string") return void res.status(400).json({ error: parsed })
    const r = parsed

    if (!config.cells.some((c) => c.id === r.cellId)) return void res.status(400).json({ error: "unknown cell" })

    const signer = recoverSigner(readingMessage(r), r.signature)
    if (!signer || signer.toLowerCase() !== r.volunteer.toLowerCase()) {
      return void res.status(400).json({ error: "signature does not match volunteer" })
    }

    const epoch = epochOfTimestamp(config.genesisDate, r.observedAt)
    if (epoch < 1) return void res.status(400).json({ error: "observation predates the programme" })

    if (!config.demoReplay) {
      // Readings must be reported soon after observation: NASA publishes the same day days later,
      // so an honest volunteer always reports BEFORE NASA data exists. This is the anti-copy rule.
      const t = now()
      if (r.observedAt > t + 300) return void res.status(400).json({ error: "observation is in the future" })
      if (t - r.observedAt > config.maxReadingAgeSeconds) return void res.status(400).json({ error: "reading is too old" })
    }

    const rec = store.get(epoch)
    if (rec.committedHash) return void res.status(409).json({ error: "epoch already committed" })
    const dup = rec.readings.some(
      (x) => x.volunteer.toLowerCase() === r.volunteer.toLowerCase() && x.cellId === r.cellId,
    )
    if (dup) return void res.status(409).json({ error: "one reading per volunteer per cell per epoch" })

    rec.readings.push(r)
    store.save()
    res.status(201).json({ epoch })
  })

  /** What the DON fetches. Deterministic: sorted, and frozen once committed. */
  app.get("/batch", (req, res) => {
    const epoch = asEpoch(req.query.epoch)
    if (epoch === null) return void res.status(400).json({ error: "epoch must be an integer >= 1" })
    const rec = store.has(epoch) ? store.get(epoch) : { readings: [] as SignedReading[], committedHash: undefined }
    const readings = sortReadings(rec.readings)
    res.json({ epoch, readings, batchHash: batchHash(epoch, readings), committedHash: rec.committedHash ?? null })
  })

  app.get("/epochs/:epoch", (req, res) => {
    const epoch = asEpoch(req.params.epoch)
    if (epoch === null) return void res.status(400).json({ error: "bad epoch" })
    const rec = store.has(epoch) ? store.get(epoch) : undefined
    res.json({
      epoch,
      readings: rec?.readings.length ?? 0,
      committedHash: rec?.committedHash ?? null,
      commitTx: rec?.commitTx ?? null,
      finalized: Boolean(rec?.proofs),
      window: epochWindow(config.genesisDate, epoch),
    })
  })

  app.get("/proofs/:epoch/:address", (req, res) => {
    const epoch = asEpoch(req.params.epoch)
    const addr = req.params.address
    if (epoch === null || !isAddress(addr)) return void res.status(400).json({ error: "bad epoch or address" })
    const p = store.has(epoch) ? store.get(epoch).proofs?.[addr.toLowerCase()] : undefined
    if (!p) return void res.status(404).json({ error: "no reward proof for this address" })
    res.json({ epoch, address: addr, ...p })
  })

  // ------------------------------------------------------------------ admin

  /** Pin the batch on-chain BEFORE the DON settles it. After this the epoch accepts no more readings. */
  app.post(
    "/admin/commit",
    admin,
    wrap(async (req, res) => {
      if (!chain) return void res.status(503).json({ error: "chain not configured" })
      const epoch = asEpoch(req.body?.epoch)
      if (epoch === null) return void res.status(400).json({ error: "epoch must be an integer >= 1" })
      const rec = store.get(epoch)
      if (rec.committedHash) return void res.status(409).json({ error: "already committed" })

      const hash = batchHash(epoch, rec.readings)
      const tx = await chain.commitBatch(epoch, hash)
      rec.committedHash = hash
      rec.commitTx = tx
      store.save()
      res.json({ epoch, batchHash: hash, tx, readings: rec.readings.length })
    }),
  )

  /**
   * After the DON settled an epoch, recompute rewards here with the same shared code and check that
   * our Merkle root equals the one the DON put on-chain. Only then do we serve proofs.
   * (NASA later revises near-real-time values, which is why we do this right after settlement.)
   */
  app.post(
    "/admin/finalize",
    admin,
    wrap(async (req, res) => {
      if (!chain || !nasa) return void res.status(503).json({ error: "chain or NASA access not configured" })
      const epoch = asEpoch(req.body?.epoch)
      if (epoch === null) return void res.status(400).json({ error: "epoch must be an integer >= 1" })
      const rec = store.get(epoch)
      if (!rec.committedHash) return void res.status(409).json({ error: "epoch was never committed" })
      if ((await chain.lastSettledEpoch()) < epoch) return void res.status(409).json({ error: "not settled on-chain yet" })

      const win = epochWindow(config.genesisDate, epoch)
      const nasaByCell: Record<string, NasaDay | undefined> = {}
      for (const cell of config.cells) {
        if (!rec.readings.some((r) => r.cellId === cell.id)) continue
        const day = await nasa.daily(cell, win.ymd)
        if (!day) return void res.status(502).json({ error: `NASA data unavailable for ${cell.id}` })
        nasaByCell[cell.id] = day
      }

      const budgetWei = await chain.budgetAtSettlement(epoch)
      const out = evaluateEpoch({
        epoch,
        genesisDate: config.genesisDate,
        cells: config.cells,
        readings: rec.readings,
        nasa: nasaByCell,
        budgetWei,
        params,
      })
      if (out.batchHash !== rec.committedHash) return void res.status(409).json({ error: "batch changed after commit" })

      const onChain = await chain.rewardRoot(epoch)
      if (out.rewardRoot.toLowerCase() !== onChain.toLowerCase()) {
        return void res.status(409).json({ error: "root mismatch", onChain, computed: out.rewardRoot })
      }
      rec.proofs = out.proofs
      rec.rewardRoot = out.rewardRoot
      store.save()
      res.json({ epoch, rewardRoot: out.rewardRoot, rewarded: out.rewards.length })
    }),
  )

  return app
}