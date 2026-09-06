import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const studioPage = readStudioCuttoonEditorSource();

describe("Studio Hybrid DCC surface fault boundary", () => {
  it("keeps the lazy DCC subtree inside a surface-local error boundary", () => {
    const start = studioPage.indexOf("{hybridDccOpen ? (");
    const end = studioPage.indexOf("{assetRightsAuditOpen ? (", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const surface = studioPage.slice(start, end);

    const boundaryStart = surface.indexOf("<StudioSurfaceErrorBoundary");
    const suspenseStart = surface.indexOf("<Suspense");
    const dialogStart = surface.indexOf("<LazyStudioHybridDccDialog");
    const suspenseEnd = surface.indexOf("</Suspense>", dialogStart);
    const boundaryEnd = surface.indexOf("</StudioSurfaceErrorBoundary>", suspenseEnd);

    expect(boundaryStart).toBeGreaterThanOrEqual(0);
    expect(boundaryStart).toBeLessThan(suspenseStart);
    expect(suspenseStart).toBeLessThan(dialogStart);
    expect(dialogStart).toBeLessThan(suspenseEnd);
    expect(suspenseEnd).toBeLessThan(boundaryEnd);
    expect(surface).toContain("resetKey={JSON.stringify([");
    expect(surface).toContain("hybridDccWorkspaceScope");
    expect(surface).toContain('studioRoute.dccMode ?? "model"');
    expect(surface).toContain("onExit={() => setHybridDccOpen(false)}");
    expect(surface).toContain("캔버스, 문서 변경, 공동작업 연결과 실행 취소 기록");
  });
});
