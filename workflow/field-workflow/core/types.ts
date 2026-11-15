import type { Hex } from "viem"

/** A reading as a volunteer signs it. All numbers are integers in TENTHS so the signed text is unambiguous. */
export type Reading = {
  volunteer: Hex // wallet address of the volunteer
  cellId: string // one of the configured cells, e.g. "cell-a"
  observedAt: number // unix seconds
  rainX10: number // rainfall over the day, tenths of mm
  tempX10: number // mean air temperature, tenths of degrees C
  moistureX10: number | null // soil moisture percent x10 (optional: NASA POWER cannot give this)
}

export type SignedReading = Reading & { signature: Hex }

export type CellInfo = { id: string; lat: number; lon: number }

/** NASA POWER daily values for a cell, in tenths. */
export type NasaDay = { tempX10: number; rainX10: number }

export type Params = {
  /** Reading must be within this many tenths-C of the NASA daily mean (grid is coarse, so wide). */
  nasaTempTolX10: number
  /** Rain must be within max(abs, rel% of NASA) of NASA. */
  nasaRainAbsTolX10: number
  nasaRainRelPct: number
  /** Peer agreement: distance from the median of band-passing readings. */
  peerTempTolX10: number
  peerRainAbsTolX10: number
  peerRainRelPct: number
  /** Minimum band-passing readings before a cell is attested at all. */
  minQuorum: number
  /** At most this many readings per cell earn rewards per epoch. */
  maxRewardedPerCell: number
  /** Bias shrinkage constant: bias * n / (n + K). */
  shrinkK: number
  /** Reward for one accepted reading, in FIELD wei, before weights. */
  baseRewardWei: bigint
  /** Extra weight in percent points for a soil-moisture reading / a sparsely covered cell. */
  moistureBonusPct: number
  sparseBonusPct: number
  sparseBelow: number
}

export type RejectReason =
  | "bad-signature"
  | "unknown-cell"
  | "outside-epoch"
  | "out-of-bounds"
  | "duplicate"
  | "outside-nasa-band"
  | "no-quorum"
  | "disagrees-with-peers"
  | "reward-cap"

export type Verdict = { reading: SignedReading; accepted: boolean; reason?: RejectReason }

export type CellOutcome = {
  cellId: string
  tempBiasX10: number
  rainRatioBps: number
  moistureX100: number
  qualityBps: number
  accepted: number
}

export type EpochInput = {
  epoch: number
  genesisDate: string // "YYYY-MM-DD" (UTC). Epoch 1 is this day.
  cells: CellInfo[]
  readings: SignedReading[]
  nasa: Record<string, NasaDay | undefined> // by cellId
  budgetWei: bigint // FIELD that the reward pool can back this epoch
  params: Params
}

export type EpochOutcome = {
  batchHash: Hex
  verdicts: Verdict[]
  cells: CellOutcome[]
  rewards: { address: Hex; amountWei: bigint }[]
  totalRewardsWei: bigint
  rewardRoot: Hex
  proofs: Record<string, { amountWei: string; proof: Hex[] }> // keyed by lowercase address
  reportHex: Hex
}
