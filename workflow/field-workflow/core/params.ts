import type { Params } from "./types"

/** Defaults. Every number here is a tunable assumption, explained in docs/03-WORKFLOW.md. */
export const DEFAULT_PARAMS: Params = {
  nasaTempTolX10: 80, // +/- 8.0 C of NASA daily mean
  nasaRainAbsTolX10: 150, // 15 mm
  nasaRainRelPct: 150,
  peerTempTolX10: 30, // +/- 3.0 C of the peer median
  peerRainAbsTolX10: 100, // 10 mm
  peerRainRelPct: 50,
  minQuorum: 3,
  maxRewardedPerCell: 5,
  shrinkK: 2,
  baseRewardWei: 2n * 10n ** 18n, // 2 FIELD
  moistureBonusPct: 50,
  sparseBonusPct: 50,
  sparseBelow: 4,
}
