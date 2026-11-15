/** Monthly climate for one location. Index 0 = January. */
export type Climate = {
  monthlyTempC: number[] // mean air temperature per month
  monthlyRainMm: number[] // total rainfall per month
}

/** Local correction factors attested on-chain by the volunteer + NASA oracle. */
export type Correction = {
  tempBiasC: number // volunteers minus NASA, degrees C
  rainRatio: number // volunteers / NASA, 1.0 = no difference
  quality: number // 0..1, from the oracle's qualityBps
  accepted: number // number of volunteer readings behind it
  epoch: number
}

/** A growing window made of calendar months (0 = January). May-Sep is [4,5,6,7,8]. */
export type Season = { id: string; label: string; months: number[] }

export type Soil = { ph: number; organicCarbonPct: number }

/** Relative importance of each goal. Normalised internally, so only the proportions matter. */
export type Priorities = { income: number; water: number; soil: number; risk: number; simplicity: number }

/** A trapezoid: 0 outside [min, max], 1 inside [optMin, optMax], linear in between. */
export type Range4 = { min: number; optMin: number; optMax: number; max: number }

export type Crop = {
  id: string
  name: string
  family: string // botanical family, used for the disease-break rule
  legume: boolean // fixes nitrogen
  temp: Range4 // mean temperature over the season, degrees C
  rain: Range4 // total rainfall over the season, mm
  ph: Range4
  waterNeedMm: number // typical seasonal water requirement
  relIncome: number // 0..1 relative income potential (placeholder, set from local prices)
}

export type SeasonClimate = { meanTempC: number; totalRainMm: number; days: number }

export type Limiting = "temperature" | "rainfall" | "soil pH"

export type CropFit = { score: number; limiting: Limiting; parts: { temperature: number; rainfall: number; ph: number } }

export type YearPlan = { year: number; crop: Crop; fit: CropFit }

export type Scores = { income: number; water: number; soil: number; risk: number; simplicity: number }

export type RotationResult = {
  years: YearPlan[]
  scores: Scores
  total: number // 0..1 weighted
  explanation: string[]
}

export type Recommendation = {
  season: Season
  seasonClimate: SeasonClimate
  correctionApplied: boolean
  dataQuality: "nasa-only" | "nasa-plus-volunteers"
  rotations: RotationResult[]
  notes: string[]
}
