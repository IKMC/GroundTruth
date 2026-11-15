import { privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"
import { readingMessage } from "../core/canonical"
import { epochWindow } from "../core/nasa"
import { DEFAULT_PARAMS } from "../core/params"
import type { CellInfo, EpochInput, NasaDay, Reading, SignedReading } from "../core/types"

export const GENESIS = "2026-10-01"
export const CELLS: CellInfo[] = [
  { id: "cell-a", lat: 12.0, lon: 8.5 },
  { id: "cell-b", lat: 11.5, lon: 9.0 },
]
/** SYNTHETIC test values, not real NASA data. 25.0 C and 4.0 mm. */
export const NASA_A: NasaDay = { tempX10: 250, rainX10: 40 }

export const win = epochWindow(GENESIS, 1)

/** Deterministic throw-away test wallets. */
export const wallet = (i: number) =>
  privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, "0")}` as Hex)

export async function sign(
  signer: ReturnType<typeof wallet>,
  over: Partial<Reading> = {},
  claimed?: Hex,
): Promise<SignedReading> {
  const r: Reading = {
    volunteer: claimed ?? signer.address,
    cellId: "cell-a",
    observedAt: win.startUnix + 3_600,
    rainX10: 40,
    tempX10: 265,
    moistureX10: null,
    ...over,
  }
  const signature = await signer.signMessage({ message: readingMessage(r) })
  return { ...r, signature }
}

export function input(readings: SignedReading[], over: Partial<EpochInput> = {}): EpochInput {
  return {
    epoch: 1,
    genesisDate: GENESIS,
    cells: CELLS,
    readings,
    nasa: { "cell-a": NASA_A, "cell-b": { tempX10: 240, rainX10: 0 } },
    budgetWei: 10n ** 24n,
    params: DEFAULT_PARAMS,
    ...over,
  }
}
