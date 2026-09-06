import { expect, test } from "vitest";

import { studioBrushDynamicsSettingsForBrushId } from "./studio-brush-dynamics";

test("taper envelopes across dry family", () => {
  for (const id of ["dry-media", "crayon", "charcoal"]) {
    const s = studioBrushDynamicsSettingsForBrushId(id);
    console.log(id, JSON.stringify(s?.taper));
    console.log(id, "widthMap=", JSON.stringify(s?.width.mappings));
  }
  expect(true).toBe(true);
});
