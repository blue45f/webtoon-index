import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("studio live collaboration reload boundary", () => {
  it("keeps hard reload behind a manual recovery action", () => {
    const providerSource = readFileSync(
      new URL("./StudioLiveCollaborationProvider.tsx", import.meta.url),
      "utf8",
    );
    const reloadCalls = providerSource.match(/globalThis\.location\.reload\(\)/g);
    expect(reloadCalls).toHaveLength(1);

    const reloadCallIndex = providerSource.indexOf("globalThis.location.reload()");
    expect(reloadCallIndex).toBeGreaterThan(-1);
    expect(providerSource.slice(0, reloadCallIndex)).toContain(
      "const reloadAuthoritative = () => {",
    );
    expect(providerSource.slice(reloadCallIndex)).toContain(
      "globalThis.location.reload();",
    );
  });

  it("renders the hard reload button only in recovery-required mode", () => {
    const panelSource = readFileSync(
      new URL("./StudioLiveCollaborationPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(panelSource).toContain(
      "{syncSnapshot?.phase === \"recovery-required\" && recovery ? (",
    );
    const recoverySectionStart = panelSource.indexOf(
      "{syncSnapshot?.phase === \"recovery-required\" && recovery ? (",
    );
    expect(recoverySectionStart).toBeGreaterThan(-1);

    const recoverySectionEnd = panelSource.indexOf(
      "{serverAvailable &&",
      recoverySectionStart,
    );
    expect(recoverySectionEnd).toBeGreaterThan(recoverySectionStart);

    const recoverySection = panelSource.slice(
      recoverySectionStart,
      recoverySectionEnd,
    );
    expect(recoverySection).toContain("onClick={onReloadAuthoritative}");
    expect(recoverySection).toContain("> 서버 원고 다시 열기");
  });
});
