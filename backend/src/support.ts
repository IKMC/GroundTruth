import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Hex } from "viem"
import type { CellInfo, NasaDay, SignedReading } from "../../workflow/field-workflow/core/types"

// ------------------------------------------------------------------ config

export type AppConfig = {
  genesisDate: string
  adminKey: string
  demoReplay: boolean
  corsOrigin: string
  cells: CellInfo[]
  /** Reject readings observed more than this many seconds before they arrive (ignored in demo replay). */
  maxReadingAgeSeconds: number
  rateLimitPerMinute: number
}

/** The same cells the workflow uses. Keep in sync with workflow/field-workflow/config.*.json. */
export const DEFAULT_CELLS: CellInfo[] = [
  { id: "cell-a", lat: 12.0, lon: 8.5 },
  { id: "cell-b", lat: 11.5, lon: 9.0 },
  { id: "cell-c", lat: 10.5, lon: 7.5 },
]

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    genesisDate: env.GENESIS_DATE ?? "2026-10-01",
    adminKey: env.ADMIN_KEY ?? "change-me",
    demoReplay: (env.DEMO_REPLAY ?? "false") === "true",
    corsOrigin: env.CORS_ORIGIN ?? "*",
    cells: DEFAULT_CELLS,
    maxReadingAgeSeconds: 24 * 3600,
    rateLimitPerMinute: 60,
  }
}

// ------------------------------------------------------------------ store

export type EpochRecord = {
  readings: SignedReading[]
  committedHash?: Hex
  commitTx?: Hex
  proofs?: Record<string, { amountWei: string; proof: Hex[] }>
  rewardRoot?: Hex
}

type StoreData = { epochs: Record<string, EpochRecord> }

/** Tiny JSON-file store. Good enough for a demo; swap for Postgres in production. */
export class Store {
  private data: StoreData = { epochs: {} }
  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8")) as StoreData
  }
  get(epoch: number): EpochRecord {
    return (this.data.epochs[String(epoch)] ??= { readings: [] })
  }
  has(epoch: number): boolean {
    return String(epoch) in this.data.epochs
  }
  save() {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file) // atomic replace, never a half-written file
  }
}

// ------------------------------------------------------------------ ports (replaceable in tests)

export interface ChainPort {
  commitBatch(epoch: number, hash: Hex): Promise<Hex>
  lastCommittedEpoch(): Promise<number>
  lastSettledEpoch(): Promise<number>
  rewardRoot(epoch: number): Promise<Hex>
  /** FIELD budget the reward pool could back just before the epoch settled. */
  budgetAtSettlement(epoch: number): Promise<bigint>
}

export interface NasaPort {
  daily(cell: CellInfo, ymd: string): Promise<NasaDay | undefined>
}
