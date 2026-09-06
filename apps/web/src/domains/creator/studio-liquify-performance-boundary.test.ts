import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("studio liquify performance boundaries", () => {
  it("일반 stroke의 displacement field를 browser/main 모듈이 아니라 Worker 런타임에서 만든다", () => {
    const browser = source("./studio-liquify-browser.ts");
    const client = source("./studio-liquify-worker-client.ts");
    const worker = source("./studio-liquify.worker.ts");

    expect(browser).not.toContain("buildLiquifyDisplacementField(");
    expect(browser).toContain("stroke: {");
    expect(client).not.toContain('} from "./studio-liquify"');
    expect(client).toContain('await import("./studio-liquify")');
    expect(client).toContain("export function disposeStudioLiquifyModuleWorker()");
    expect(client).toContain("import.meta.hot.dispose(disposeStudioLiquifyModuleWorker)");
    expect(worker).toContain("buildLiquifyDisplacementField(");
  });

  it("pointer move 누적 경로에 points 전체 복사가 다시 들어오지 않는다", () => {
    const pointer = source("./studio-liquify-pointer.ts");

    expect(pointer).toContain("session.points.push(");
    expect(pointer).not.toContain("points: [...session.points");
  });

  it("pointerup bake thins the journal so long strokes stay bounded", () => {
    const page = readStudioCuttoonEditorSource();
    const sampling = source("./studio-liquify-stroke-sampling.ts");

    expect(sampling).toContain("STUDIO_LIQUIFY_APPLY_MAX_POINTS = 384");
    expect(page).toContain("thinStudioLiquifyPointsForApply");
    expect(page).toContain("studioLiquifyDragMinDistance");
  });

  it("keeps a drop-frame live warp preview path during drag", () => {
    const page = readStudioCuttoonEditorSource();
    const preview = source("./studio-liquify-live-preview.ts");
    const browser = source("./studio-liquify-browser.ts");
    const viewport = readStudioCanvasViewportStack(import.meta.url, "./canvas/");

    expect(preview).toContain("planStudioLiquifyLivePreview");
    expect(preview).toContain("roi-full-res");
    expect(browser).toContain("bakeLiquifyStrokeRoiPreview");
    expect(page).toContain("scheduleLiquifyLivePreview");
    expect(page).toContain("bakeLiquifyStrokeRoiPreview");
    expect(page).toContain("pumpLiquifyLivePreview");
    expect(viewport).toContain("liquifyPreviewImageRef");
  });
});
