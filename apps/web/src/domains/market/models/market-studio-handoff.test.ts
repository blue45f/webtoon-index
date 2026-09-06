import { describe, expect, it } from "vitest";

import {
  marketStudioHandoff,
  marketStudioResourceHref,
} from "./market-studio-handoff";

import type { CreatorMarketplaceResourceKind } from "@/shared/lib/creator-marketplace-resource-contract";


const RESOURCE_ID = "10000000-0000-4000-8000-000000000001";

describe("market Studio handoff", () => {
  it("uses the exact query consumed by the Studio installer", () => {
    expect(marketStudioResourceHref(RESOURCE_ID)).toBe(
      `/studio?installMarketResource=${RESOURCE_ID}&assetMarket=community`,
    );
    expect(marketStudioResourceHref("release with spaces")).toBe(
      "/studio?installMarketResource=release%20with%20spaces&assetMarket=community",
    );
  });

  it.each<[
    CreatorMarketplaceResourceKind,
    string,
    string,
  ]>([
    ["asset", "insert-current-canvas", "현재 캔버스"],
    ["brush", "install-tool-pack", "브러시 도구"],
    ["filter", "install-tool-pack", "필터 도구"],
    ["palette", "install-tool-pack", "색상 팔레트"],
    ["template", "open-template-catalog", "장면 템플릿"],
    ["3d-preset", "open-3d-background-catalog", "3D 배경"],
    ["3d-asset", "open-3d-asset-library", "3D 모델"],
  ])("maps %s to its real Studio destination", (kind, mode, destination) => {
    const handoff = marketStudioHandoff({ id: RESOURCE_ID, kind });
    expect(handoff.mode).toBe(mode);
    expect(handoff.destinationLabel).toContain(destination);
    expect(handoff.href).toContain(`installMarketResource=${RESOURCE_ID}`);
  });
});
