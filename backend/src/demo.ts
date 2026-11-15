import type { NasaDay } from "../../workflow/field-workflow/core/types"

/**
 * Demo values for the seed script.
 *
 * Honest volunteers measure roughly what NASA says, plus a small local difference (about +0.5 C and +10%
 * rain) and a little instrument noise. Centering on NASA's real value matters: if demo readings are made
 * up without looking at NASA, the "correction" is huge and unrealistic.
 */
const TEMP_SPREAD = [-3, -1, 0, 2, 4, -2, 3] // tenths of a degree
const RAIN_SPREAD = [-2, 0, 1, 3, 2, -1, 1] // tenths of a mm
const LEGACY_TEMPS = [262, 265, 268, 264, 266, 263, 267]

export type DemoValues = { tempX10: number; rainX10: number }

export function honestValues(nasa: NasaDay | undefined, i: number): DemoValues {
  if (!nasa) return { tempX10: LEGACY_TEMPS[i % LEGACY_TEMPS.length], rainX10: 30 + (i % 5) * 4 } // no NASA data: generic numbers
  return {
    tempX10: nasa.tempX10 + 5 + TEMP_SPREAD[i % TEMP_SPREAD.length],
    rainX10: Math.max(0, Math.round(nasa.rainX10 * 1.1) + RAIN_SPREAD[i % RAIN_SPREAD.length]),
  }
}

/** A liar that passes NASA's wide band (+7 C) but is far from the honest group, so peers out-vote it. */
export function liarValues(nasa: NasaDay | undefined): DemoValues {
  if (!nasa) return { tempX10: 320, rainX10: 40 }
  return { tempX10: nasa.tempX10 + 70, rainX10: nasa.rainX10 }
}