import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./AdminCommunityPage.tsx", import.meta.url),
  "utf8",
);

describe("AdminCommunityPage Creator Market moderation integration", () => {
  it("mounts the dedicated Creator Market board inside the existing admin gate", () => {
    expect(source).toContain(
      'import { CreatorMarketplaceModerationBoard } from "./components/CreatorMarketplaceModerationBoard";',
    );
    const adminGate = source.indexOf('gate.kind === "admin"');
    const creatorMarketBoard = source.indexOf("<CreatorMarketplaceModerationBoard />");
    const legacyAssetBoard = source.indexOf("<AssetModerationBoard />");

    expect(adminGate).toBeGreaterThan(-1);
    expect(creatorMarketBoard).toBeGreaterThan(adminGate);
    expect(legacyAssetBoard).toBeGreaterThan(creatorMarketBoard);
  });
});
