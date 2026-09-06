import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const body = readFileSync(
  new URL("./StudioInspectorAsideBody.tsx", import.meta.url),
  "utf8",
);
const sync = readFileSync(
  new URL("./StudioInspectorContextRouteSync.tsx", import.meta.url),
  "utf8",
);

describe("inspector context route boundary", () => {
  it("mounts one layout-effect synchronizer at the inspector body boundary", () => {
    expect(body.match(/<StudioInspectorContextRouteSync\b/g)).toHaveLength(1);
    expect(body).toContain("contentMode={inspectorContentMode}");
    expect(body).toContain("selectedType={selected?.type ?? null}");
    expect(body).toContain("onChange={changeInspectorLayout}");
    expect(sync).toContain("useLayoutEffect");
    expect(sync).toContain("resolveStudioInspectorContextRoute");
  });
});
