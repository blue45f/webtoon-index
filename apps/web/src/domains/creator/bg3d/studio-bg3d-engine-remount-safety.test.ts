import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Canvas remount 이 아티스트 작업을 지우지 않는다는 보장.
 *
 * 엔진 선호 변경과 실패한 WebGPU의 명시적 재시도는 `canvasKey` 를 바꿔 R3F Canvas 를 다시
 * 마운트한다. 그 순간 renderer 아이덴티티가 바뀌는데, 편집기의 초기 장면 복원 effect 가 그
 * 아이덴티티를 의존성으로 갖는다. 아무 구분 없이 다시 돌면 히스토리를 비우고 모달을 열었던
 * 시점의 장면으로 되돌려 **그동안의 편집을 조용히 날린다** — 예외도 로그도 남지 않는다.
 *
 * 추출된 훅들은 `@ts-nocheck` 에 거대한 host bag 을 쓰므로 이 저장소는 이런 불변식을 소스 형태로
 * 지킨다(같은 파일군의 shot integration boundary 와 동일한 방식).
 */
const restoreSource = readFileSync(
  new URL("./useStudioBg3dEditorRestoreEffects.ts", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("./studio-bg3d-editor-layout-view-model.ts", import.meta.url),
  "utf8",
);

describe("BG3D canvas remount safety", () => {
  it("separates a renderer remount from initial-scene restoration", () => {
    expect(restoreSource).toContain("const isRendererRemount");
    expect(restoreSource).toContain("restoredSourceRef");

    // 판정은 renderer 가 아니라 모달 세션과 초기 장면 입력으로 한다. renderer 를 넣으면 remount
    // 자체가 "새 복원"으로 보여 다시 파괴적 경로를 타게 된다.
    const identity = restoreSource.slice(
      restoreSource.indexOf("const isRendererRemount"),
      restoreSource.indexOf("restoredSourceRef.current = {"),
    );
    expect(identity).toContain("previous.session === session");
    expect(identity).toContain("previous.initialScene === initialScene");
    expect(identity).not.toContain("modelRenderer");
  });

  it("rebuilds only the model cache on a remount, never the scene state", () => {
    const remountBranch = restoreSource.slice(
      restoreSource.indexOf("if (isRendererRemount) {"),
      restoreSource.indexOf("const restoreController = new AbortController();"),
    );
    expect(remountBranch.length).toBeGreaterThan(0);

    // renderer 에 실제로 묶인 것은 모델 캐시뿐이다(KTX2 transcode 대상 포맷이 backend 마다 다름).
    expect(remountBranch).toContain("disposeModelCache(modelRootCacheRef.current)");
    expect(remountBranch).toContain("admitAndCacheModel");
    // 현재 문서 기준으로 다시 만든다 — 초기 장면이 아니라.
    expect(remountBranch).toContain("physicsRuntimeSourceRef.current");
    expect(remountBranch).not.toContain("initialScene");

    // 아티스트 작업에 해당하는 것은 하나도 건드리지 않는다.
    for (const destructive of [
      "historyRef.current = []",
      "historyIndexRef.current = -1",
      "setPrimitives(",
      "setCustomModels(",
      "setSceneBaseDocument(",
      "setCanUndo(false)",
    ]) {
      expect(remountBranch).not.toContain(destructive);
    }
  });

  it("refuses to start an immersive session while WebGPU owns the canvas", () => {
    // 몰입형 브리지는 `WebGLRenderer.xr` 을 구동한다. 시작을 허용하면 네이티브 세션 요청이 먼저
    // 나가고, 그 뒤 엔진 정책이 WebGPU 계획을 사용 불가로 만들며 controller 를 파괴한다.
    const reason = layoutSource.slice(
      layoutSource.indexOf("const webXrDisabledReason"),
      layoutSource.indexOf("const webXrDisabledReason") + 600,
    );
    expect(reason).toContain('engineRuntime?.plan?.backend === "webgpu"');
    expect(reason).toContain("WebGL2");
  });
});
