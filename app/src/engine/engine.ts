import { CROPS } from "./crops"
import type {
  Climate, Correction, Crop, CropFit, Limiting, Priorities, Range4, Recommendation, RotationResult,
  Scores, Season, SeasonClimate, Soil, YearPlan,
} from "./types"

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MONTH_KEYS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

// ------------------------------------------------------------------ NASA POWER climatology

/** 20+ year monthly climatology for a point: temperature at 2 m and corrected precipitation. */
export function climatologyUrl(lat: number, lon: number): string {
  return (
    "https://power.larc.nasa.gov/api/temporal/climatology/point" +
    `?parameters=T2M,PRECTOTCORR&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`
  )
}

/** POWER gives rainfall as mm/day per month; we convert to mm per month. -999 means missing. */
export function parseClimatology(json: unknown): Climate {
  const p = (json as { properties?: { parameter?: Record<string, Record<string, number>> } })?.properties?.parameter
  const t = p?.T2M
  const r = p?.PRECTOTCORR
  if (!t || !r) throw new Error("NASA POWER response has no T2M / PRECTOTCORR data")
  const monthlyTempC = MONTH_KEYS.map((m) => t[m])
  const rainPerDay = MONTH_KEYS.map((m) => r[m])
  if ([...monthlyTempC, ...rainPerDay].some((v) => typeof v !== "number" || v <= -999)) {
    throw new Error("NASA POWER response is missing monthly values")
  }
  return { monthlyTempC, monthlyRainMm: rainPerDay.map((v, i) => v * DAYS_IN_MONTH[i]) }
}

// ------------------------------------------------------------------ local correction from volunteers

/** How strongly the oracle's correction is trusted: full weight at quality >= 0.6, zero at 0. */
export const correctionWeight = (c: Correction): number => Math.max(0, Math.min(1, c.quality / 0.6))

export function applyCorrection(climate: Climate, c: Correction | null): { climate: Climate; applied: boolean } {
  if (!c || c.accepted === 0 || c.quality <= 0) return { climate, applied: false }
  const w = correctionWeight(c)
  const dT = c.tempBiasC * w
  const ratio = 1 + (c.rainRatio - 1) * w
  return {
    applied: true,
    climate: {
      monthlyTempC: climate.monthlyTempC.map((v) => v + dT),
      monthlyRainMm: climate.monthlyRainMm.map((v) => v * ratio),
    },
  }
}

export function seasonClimate(climate: Climate, season: Season): SeasonClimate {
  const n = season.months.length
  if (n === 0) throw new Error("season has no months")
  const meanTempC = season.months.reduce((s, m) => s + climate.monthlyTempC[m], 0) / n
  const totalRainMm = season.months.reduce((s, m) => s + climate.monthlyRainMm[m], 0)
  const days = season.months.reduce((s, m) => s + DAYS_IN_MONTH[m], 0)
  return { meanTempC, totalRainMm, days }
}

// ------------------------------------------------------------------ crop suitability

export function trapezoid(x: number, r: Range4): number {
  if (x <= r.min || x >= r.max) return 0
  if (x >= r.optMin && x <= r.optMax) return 1
  return x < r.optMin ? (x - r.min) / (r.optMin - r.min) : (r.max - x) / (r.max - r.optMax)
}

/**
 * Suitability follows the limiting-factor idea: a crop is only as suited as its worst condition.
 * Returns 0..1 and names the condition that limits it, so advice can be explained.
 */
export function cropFit(crop: Crop, sc: SeasonClimate, soil: Soil): CropFit {
  const parts = {
    temperature: trapezoid(sc.meanTempC, crop.temp),
    rainfall: trapezoid(sc.totalRainMm, crop.rain),
    ph: trapezoid(soil.ph, crop.ph),
  }
  const entries: [Limiting, number][] = [
    ["temperature", parts.temperature],
    ["rainfall", parts.rainfall],
    ["soil pH", parts.ph],
  ]
  const [limiting, score] = entries.reduce((a, b) => (b[1] < a[1] ? b : a))
  return { score, limiting, parts }
}

// ------------------------------------------------------------------ rotation scoring

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const pct = (x: number) => `${Math.round(x * 100)}%`

export function scoreRotation(crops: Crop[], fits: CropFit[], sc: SeasonClimate, soil: Soil, maxWater: number): Scores {
  const years = crops.length
  const income = mean(crops.map((c, i) => c.relIncome * fits[i].score))

  const water = mean(
    crops.map((c) => 0.5 * Math.min(1, sc.totalRainMm / c.waterNeedMm) + 0.5 * (1 - c.waterNeedMm / maxWater)),
  )

  // Soil health: nitrogen from legumes (one legume in the sequence is enough for full marks)
  // and diversity of plant families (breaks pest and disease cycles).
  const legumeYears = crops.filter((c) => c.legume).length
  const nitrogen = Math.min(1, legumeYears / 1)
  const diversity = new Set(crops.map((c) => c.family)).size / years
  const lowCarbon = soil.organicCarbonPct < 1.0 // low organic carbon: nitrogen and residues matter more
  const soilScore = lowCarbon ? 0.75 * nitrogen + 0.25 * diversity : 0.6 * nitrogen + 0.4 * diversity

  const risk = Math.min(...fits.map((f) => f.score)) // the worst year decides how risky a plan is

  const distinct = new Set(crops.map((c) => c.id)).size
  const simplicity = years > 1 ? 1 - (distinct - 1) / (years - 1) : 1

  return { income, water, soil: soilScore, risk, simplicity }
}

export function weightedTotal(s: Scores, p: Priorities): number {
  const sum = p.income + p.water + p.soil + p.risk + p.simplicity
  const w = sum > 0 ? p : { income: 1, water: 1, soil: 1, risk: 1, simplicity: 1 }
  const wsum = w.income + w.water + w.soil + w.risk + w.simplicity
  return (w.income * s.income + w.water * s.water + w.soil * s.soil + w.risk * s.risk + w.simplicity * s.simplicity) / wsum
}

function explain(years: YearPlan[], scores: Scores, sc: SeasonClimate, soil: Soil): string[] {
  const lines = years.map(
    (y) => `Year ${y.year}: ${y.crop.name}, suitability ${pct(y.fit.score)}` +
      (y.fit.score < 1 ? ` (limited by ${y.fit.limiting})` : ""),
  )
  const legumes = years.filter((y) => y.crop.legume).map((y) => y.crop.name)
  lines.push(
    legumes.length
      ? `Soil: ${legumes.join(" and ")} fix nitrogen for the crops that follow` +
          (soil.organicCarbonPct < 1 ? "; this matters because organic carbon is low" : "")
      : "Soil: no legume in this sequence, so no nitrogen benefit",
  )
  lines.push(
    `Water: this season brings about ${Math.round(sc.totalRainMm)} mm of rain; water score ${pct(scores.water)}`,
  )
  return lines
}

// ------------------------------------------------------------------ the recommendation

export function recommend(args: {
  climate: Climate
  correction: Correction | null
  season: Season
  soil: Soil
  priorities: Priorities
  crops?: Crop[]
  years?: number
  top?: number
  minFit?: number
}): Recommendation {
  const { season, soil, priorities } = args
  const crops = args.crops ?? CROPS
  const years = args.years ?? 3
  const top = args.top ?? 3
  const minFit = args.minFit ?? 0.25

  const { climate, applied } = applyCorrection(args.climate, args.correction)
  const sc = seasonClimate(climate, season)
  const maxWater = Math.max(...crops.map((c) => c.waterNeedMm))

  const fitOf = new Map(crops.map((c) => [c.id, cropFit(c, sc, soil)] as const))
  const viable = crops.filter((c) => (fitOf.get(c.id)?.score ?? 0) >= minFit)

  // Enumerate every sequence of viable crops where neighbours are from different plant families.
  const results: RotationResult[] = []
  const walk = (seq: Crop[]) => {
    if (seq.length === years) {
      const fits = seq.map((c) => fitOf.get(c.id)!)
      const scores = scoreRotation(seq, fits, sc, soil, maxWater)
      const plans = seq.map((crop, i) => ({ year: i + 1, crop, fit: fits[i] }))
      results.push({ years: plans, scores, total: weightedTotal(scores, priorities), explanation: explain(plans, scores, sc, soil) })
      return
    }
    for (const c of viable) {
      if (seq.length > 0 && seq[seq.length - 1].family === c.family) continue
      walk([...seq, c])
    }
  }
  walk([])

  results.sort(
    (a, b) => b.total - a.total || a.years.map((y) => y.crop.id).join().localeCompare(b.years.map((y) => y.crop.id).join()),
  )

  const notes = [
  "Suitability uses seasonal mean temperature, annual/seasonal rainfall, and soil pH only. Pests, irrigation, and specific crop varieties are not modelled.",
  "Temperature, rainfall, and soil pH thresholds are sourced from the FAO ECOCROP database; crop water demand and relative income remain general estimates to be calibrated with local extension and market data.",
  ]

  if (viable.length === 0) notes.unshift("No crop in the table is viable for this season and soil. Try another season window.")
  else if (results.length === 0) notes.unshift("Not enough viable crops from different plant families to build a rotation.")

  return {
    season,
    seasonClimate: sc,
    correctionApplied: applied,
    dataQuality: applied ? "nasa-plus-volunteers" : "nasa-only",
    rotations: results.slice(0, top),
    notes,
  }
}
