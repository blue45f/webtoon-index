import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./StudioAssetMenuPanel.tsx", import.meta.url),
  "utf8"
);
const loadingFallbackSource = source.slice(
  source.indexOf("function StudioAssetMarketplaceLoading()"),
  source.indexOf("export interface StudioAssetMenuPanelProps")
);

describe("Studio asset marketplace lazy boundary", () => {
  it("keeps all marketplace panels out of the initial asset-menu module graph", () => {
    expect(source).not.toMatch(
      /import\s+\{[^}]*StudioCommunityMarketplacePanel[^}]*\}\s+from/u
    );
    expect(source).not.toMatch(
      /import\s+\{[^}]*StudioCreatorPackMarketplacePanel[^}]*\}\s+from/u
    );
    expect(source).not.toMatch(
      /import\s+\{[^}]*StudioOriginalAssetMarketplacePanel[^}]*\}\s+from/u
    );
    expect(source).toContain('import("./StudioCommunityMarketplacePanel")');
    expect(source).toContain('import("./StudioCreatorPackMarketplacePanel")');
    expect(source).toContain('import("./StudioOriginalAssetMarketplacePanel")');
    expect(source).toContain("createStudioIntentLazyLoader");
    expect(source).toContain("lazyRetry");
  });

  it("preloads on intent and retains an accessible, stable loading surface", () => {
    expect(source).toContain("onPointerEnter={preloadStudioAssetMarketplacePanels}");
    expect(source).toContain("onPointerDown={preloadStudioAssetMarketplacePanels}");
    expect(source).toContain("onFocus={preloadStudioAssetMarketplacePanels}");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('data-studio-asset-marketplace-loading="true"');
    expect(source).toContain('data-studio-asset-marketplace-skeleton-row=');
    expect(source).toContain("motion-reduce:animate-none");
    expect(loadingFallbackSource).not.toContain("animate-spin");
    expect(loadingFallbackSource).not.toContain("Loader2");
    expect(source).toContain('data-studio-asset-marketplace-lazy-boundary="true"');
  });
});
