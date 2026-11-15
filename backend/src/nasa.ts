import { nasaDailyUrl, parseNasaDaily } from "../../workflow/field-workflow/core/nasa"
import type { NasaPort } from "./support"

/** Live NASA POWER access (no API key needed). */
export const liveNasa: NasaPort = {
  async daily(cell, ymd) {
    const res = await fetch(nasaDailyUrl(cell, ymd), { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return undefined
    return parseNasaDaily(await res.json(), ymd)
  },
}
