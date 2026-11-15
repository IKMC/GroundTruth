import { formatUnits } from "viem"

const trim = (s: string, digits: number) => {
  const [i, f = ""] = s.split(".")
  const frac = f.slice(0, digits).replace(/0+$/, "")
  return frac ? `${i}.${frac}` : i
}

export const formatField = (wei: bigint) => trim(formatUnits(wei, 18), 2)
export const formatUsdc = (units: bigint) => trim(formatUnits(units, 6), 2)
export const errorMessage = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e)
  return m.split("\n")[0].slice(0, 220)
}
