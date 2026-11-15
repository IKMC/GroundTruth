import { describe, expect, it } from "vitest"
import { CROPS } from "../crops"
import {
  applyCorrection, cropFit, parseClimatology, recommend, seasonClimate, trapezoid, weightedTotal,
} from "../engine"
import type { Climate, Correction, Priorities, Season } from "../types"

/** SYNTHETIC fixture, not real NASA data: a warm site with one rainy season (May-Sep). */
const CLIMATE: Climate = {
  monthlyTempC: [25, 27, 30, 31, 29, 27, 26, 25, 26, 28, 27, 25],
  monthlyRainMm: [0, 0, 10, 40, 120, 170, 220, 260, 180, 60, 5, 0],
}
const SEASON: Season = { id: "main", label: "Main season", months: [4, 5, 6, 7, 8] }
const SOIL = { ph: 6.3, organicCarbonPct: 1.4 }
const EVEN: Priorities = { income: 1, water: 1, soil: 1, risk: 1, simplicity: 1 }
const only = (k: keyof Priorities): Priorities => ({ income: 0, water: 0, soil: 0, risk: 0, simplicity: 0, [k]: 1 })
const run = (over: Partial<Parameters<typeof recommend>[0]> = {}) =>
  recommend({ climate: CLIMATE, correction: null, season: SEASON, soil: SOIL, priorities: EVEN, ...over })

describe("trapezoid", () => {
  const r = { min: 10, optMin: 20, optMax: 30, max: 40 }
  it("is 0 outside, 1 inside the optimum, linear on the slopes", () => {
    expect(trapezoid(5, r)).toBe(0)
    expect(trapezoid(10, r)).toBe(0)
    expect(trapezoid(25, r)).toBe(1)
    expect(trapezoid(15, r)).toBeCloseTo(0.5)
    expect(trapezoid(35, r)).toBeCloseTo(0.5)
    expect(trapezoid(40, r)).toBe(0)
  })
})

describe("NASA POWER climatology parsing", () => {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
  const body = (t: number, r: number) => ({
    properties: { parameter: {
      T2M: Object.fromEntries(months.map((m) => [m, t])),
      PRECTOTCORR: Object.fromEntries(months.map((m) => [m, r])),
    } },
  })
  it("converts mm/day to mm/month using month lengths", () => {
    const c = parseClimatology(body(25, 2))
    expect(c.monthlyTempC[0]).toBe(25)
    expect(c.monthlyRainMm[0]).toBe(62) // 31 days x 2
    expect(c.monthlyRainMm[1]).toBe(56) // 28 days x 2
  })
  it("throws on missing data and -999", () => {
    expect(() => parseClimatology({})).toThrow()
    expect(() => parseClimatology(body(-999, 2))).toThrow(/missing/)
  })
})

describe("local correction from volunteers", () => {
  const corr = (over: Partial<Correction> = {}): Correction =>
    ({ tempBiasC: 1, rainRatio: 0.8, quality: 0.9, accepted: 5, epoch: 3, ...over })

  it("is not applied without data or quality", () => {
    expect(applyCorrection(CLIMATE, null).applied).toBe(false)
    expect(applyCorrection(CLIMATE, corr({ accepted: 0 })).applied).toBe(false)
    expect(applyCorrection(CLIMATE, corr({ quality: 0 })).applied).toBe(false)
  })
  it("applies fully at high quality", () => {
    const { climate, applied } = applyCorrection(CLIMATE, corr())
    expect(applied).toBe(true)
    expect(climate.monthlyTempC[0]).toBeCloseTo(26)
    expect(climate.monthlyRainMm[7]).toBeCloseTo(208)
  })
  it("is shrunk at low quality", () => {
    const { climate } = applyCorrection(CLIMATE, corr({ quality: 0.3 })) // half weight
    expect(climate.monthlyTempC[0]).toBeCloseTo(25.5)
    expect(climate.monthlyRainMm[7]).toBeCloseTo(260 * 0.9)
  })
})

describe("season climate and crop fit", () => {
  it("averages temperature and sums rainfall over the season months", () => {
    const sc = seasonClimate(CLIMATE, SEASON)
    expect(sc.meanTempC).toBeCloseTo(26.6)
    expect(sc.totalRainMm).toBe(950)
    expect(sc.days).toBe(153)
  })
  it("names the limiting factor", () => {
    const sc = seasonClimate(CLIMATE, SEASON)
    const maize = CROPS.find((c) => c.id === "maize")!
    expect(cropFit(maize, sc, { ph: 6.3, organicCarbonPct: 1 }).limiting).toBe("rainfall") // 950 mm is just over optimum
    const acid = cropFit(maize, sc, { ph: 4.0, organicCarbonPct: 1 })
    expect(acid.limiting).toBe("soil pH")
    expect(acid.score).toBe(0)
  })
})

describe("recommend", () => {
  it("returns ranked rotations that respect the family rule and minimum fit", () => {
    const rec = run()
    expect(rec.rotations).toHaveLength(3)
    for (let i = 1; i < rec.rotations.length; i++) expect(rec.rotations[i - 1].total).toBeGreaterThanOrEqual(rec.rotations[i].total)
    for (const rot of rec.rotations) {
      for (let i = 1; i < rot.years.length; i++) expect(rot.years[i].crop.family).not.toBe(rot.years[i - 1].crop.family)
      expect(Math.min(...rot.years.map((y) => y.fit.score))).toBeGreaterThanOrEqual(0.25)
      expect(rot.explanation.length).toBeGreaterThan(3)
    }
  })

  it("is deterministic", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })

  it("priorities steer the result: soil health puts a legume in the plan", () => {
    const rec = run({ priorities: only("soil") })
    expect(rec.rotations[0].years.some((y) => y.crop.legume)).toBe(true)
    expect(rec.rotations[0].scores.soil).toBeGreaterThan(0.7)
  })

  it("priorities steer the result: simplicity prefers repeating two crops (A-B-A)", () => {
    const rec = run({ priorities: only("simplicity") })
    const ids = rec.rotations[0].years.map((y) => y.crop.id)
    expect(new Set(ids).size).toBe(2)
  })

  it("low organic carbon increases the weight of nitrogen in the soil score", () => {
    const legumeHeavy = (oc: number) =>
      run({ soil: { ph: 6.3, organicCarbonPct: oc }, priorities: only("soil") }).rotations[0].scores.soil
    expect(legumeHeavy(0.5)).toBeGreaterThanOrEqual(legumeHeavy(2))
  })

  it("volunteer correction changes the evidence and can change the outcome", () => {
    const base = run()
    const dry: Correction = { tempBiasC: 0, rainRatio: 0.3, quality: 1, accepted: 5, epoch: 1 }
    const corrected = run({ correction: dry })
    expect(base.dataQuality).toBe("nasa-only")
    expect(corrected.dataQuality).toBe("nasa-plus-volunteers")
    expect(corrected.correctionApplied).toBe(true)
    expect(corrected.seasonClimate.totalRainMm).toBeCloseTo(285)
    expect(JSON.stringify(corrected.rotations.map((r) => r.years.map((y) => y.crop.id)))).not.toBe(
      JSON.stringify(base.rotations.map((r) => r.years.map((y) => y.crop.id))),
    )
  })

  it("explains itself when nothing is viable", () => {
    const cold: Climate = { monthlyTempC: Array(12).fill(2), monthlyRainMm: Array(12).fill(10) }
    const rec = run({ climate: cold })
    expect(rec.rotations).toHaveLength(0)
    expect(rec.notes[0]).toMatch(/No crop/)
  })
})

describe("weighted total", () => {
  const s = { income: 1, water: 0, soil: 0.5, risk: 0.5, simplicity: 0 }
  it("normalises weights and falls back to equal weights", () => {
    expect(weightedTotal(s, { income: 2, water: 0, soil: 0, risk: 0, simplicity: 0 })).toBe(1)
    expect(weightedTotal(s, { income: 0, water: 0, soil: 0, risk: 0, simplicity: 0 })).toBeCloseTo(0.4)
  })
})
