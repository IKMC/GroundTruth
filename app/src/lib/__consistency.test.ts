import { describe, expect, it } from "vitest"
import { readingMessage as appMessage, cellIdToBytes32 as appCell, type Reading } from "./reading"
import { readingMessage as coreMessage } from "../../../workflow/field-workflow/core/canonical"
import { cellIdToBytes32 as coreCell } from "../../../workflow/field-workflow/core/encode"

/** If these ever differ, signatures made in the app will be rejected by the backend and the DON. */
describe("app and oracle agree byte for byte", () => {
  const r: Reading = {
    volunteer: "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
    cellId: "cell-a", observedAt: 1_790_000_000, rainX10: 42, tempX10: 267, moistureX10: null,
  }
  it("signed message text", () => {
    expect(appMessage(r)).toBe(coreMessage(r))
    expect(appMessage({ ...r, moistureX10: 300 })).toBe(coreMessage({ ...r, moistureX10: 300 }))
  })
  it("cell id encoding", () => {
    for (const id of ["cell-a", "cell-b", "cell-c", "a-much-longer-cell-name-xx"]) expect(appCell(id)).toBe(coreCell(id))
  })
})
