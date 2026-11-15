import type { CellInfo, NasaDay } from "./types"

const DAY = 86_400

/** The UTC day an epoch covers. Epoch 1 is `genesisDate`; epoch 2 is the next day, and so on. */
export function epochWindow(genesisDate: string, epoch: number) {
  const [y, m, d] = genesisDate.split("-").map(Number)
  const startMs = Date.UTC(y, m - 1, d + (epoch - 1))
  const dt = new Date(startMs)
  const ymd = `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`
  const startUnix = Math.floor(startMs / 1000)
  return { ymd, startUnix, endUnix: startUnix + DAY - 1 }
}

/** Which epoch a unix timestamp falls into (epoch 1 starts at genesisDate 00:00 UTC). */
export function epochOfTimestamp(genesisDate: string, unix: number): number {
  const [y, m, d] = genesisDate.split("-").map(Number)
  const genesis = Math.floor(Date.UTC(y, m - 1, d) / 1000)
  return Math.floor((unix - genesis) / DAY) + 1
}

/** NASA POWER daily point request: temperature at 2 m and corrected precipitation, AG community. */
export function nasaDailyUrl(cell: CellInfo, ymd: string): string {
  return (
    "https://power.larc.nasa.gov/api/temporal/daily/point" +
    `?parameters=T2M,PRECTOTCORR&community=AG&longitude=${cell.lon}&latitude=${cell.lat}` +
    `&start=${ymd}&end=${ymd}&format=JSON`
  )
}

/** Turn a POWER JSON response into tenths. POWER marks missing data as -999. */
export function parseNasaDaily(json: unknown, ymd: string): NasaDay | undefined {
  const p = (json as { properties?: { parameter?: Record<string, Record<string, number>> } })?.properties?.parameter
  const t = p?.T2M?.[ymd]
  const r = p?.PRECTOTCORR?.[ymd]
  if (typeof t !== "number" || typeof r !== "number") return undefined
  if (t <= -999 || r <= -999) return undefined
  return { tempX10: Math.round(t * 10), rainX10: Math.round(r * 10) }
}
