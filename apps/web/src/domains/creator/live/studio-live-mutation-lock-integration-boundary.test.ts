import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

// 병합 명령은 layer/studio-layer-operations 로 추출됐다 — 통합 소스로 페이지+추출 본문을 함께 스캔한다.
// 리스 3인방(begin/beginAsync/end)은 984251d8c 에서 createStudioLiveResourceLeaseController 로 옮겨졌다.
// 추출 본문을 앞에 둬야 거기서 시작한 슬라이스가 호스트 쪽 끝 토큰까지 나아간다.
const leaseControllerSource = readFileSync(
  new URL("./createStudioLiveResourceLeaseController.ts", import.meta.url),
  "utf8",
);
const pageSource = [leaseControllerSource, readStudioCuttoonEditorSource()].join("\n");

function sourceBetween(startToken: string, endToken: string): string {
  const start = pageSource.indexOf(startToken);
  const end = pageSource.indexOf(endToken, start + startToken.length);
  expect(start, `missing start token: ${startToken}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing end token: ${endToken}`).toBeGreaterThan(start);
  return pageSource.slice(start, end);
}

describe("StudioPage authoritative mutation-lock integration boundary", () => {
  it("commits async edits only after the all-or-nothing coordinator succeeds", () => {
    const acquire = sourceBetween(
      "const beginAsync = async (",
      "const begin = (",
    );

    expect(acquire).toContain("replaceStudioLiveMutationLocks({");
    expect(acquire).toContain("previouslyHeld: heldResourcesRef.current");
    expect(acquire).toContain("nextResources: resources");
    expect(acquire).toContain("if (result.ok) releaseStudioLiveMutationLocks(room, result.held)");
    expect(acquire).toContain("heldResourcesRef.current = [...result.held]");
    expect(acquire).toContain("if (!result.ok)");
    expect(acquire.indexOf("heldResourcesRef.current = [...result.held]")).toBeLessThan(
      acquire.lastIndexOf("return true"),
    );
  });

  it("keeps non-server gestures fail-closed while allowing optimistic server lease warmup", () => {
    const begin = sourceBetween(
      "const begin = (",
      "const end = (): void => {",
    );

    expect(begin).toContain('if (room.mode !== "server")');
    expect(begin).toContain("selfHoldsStudioLiveLock(locks, resource, room.participant.sessionId)");
    expect(begin).toContain("void beginAsync(elementIds)");
    expect(begin).toContain("const key = JSON.stringify(resources)");
    expect(begin).toContain("return true;");
  });

  it("routes canvas drag and text edits through the intent-aware soft-lock gate", () => {
    expect(pageSource).toContain("gateStudioCanvasMutation({");
    expect(pageSource).toContain('intent: StudioCanvasMutationIntent = "transform"');
    expect(pageSource).toContain('intent: StudioCanvasMutationIntent = "drag"');
    expect(pageSource).toContain('beginLiveResourceEditAsync([id], "text-edit")');
    // 호스트는 컨트롤러가 돌려준 세 함수를 그대로 기존 이름에 바인딩한다.
    expect(pageSource).toContain("begin: beginLiveResourceEdit,");
    expect(pageSource).toContain("beginAsync: beginLiveResourceEditAsync,");
    expect(pageSource).toContain("end: endLiveResourceEdit,");
  });

  it("uses the async gate for durable actions and invalidates leases on end or room change", () => {
    const merge = sourceBetween(
      "async function commitLayerMergePlan(",
      "function handleLayerNavigatorAction(",
    );
    const text = sourceBetween("async function startEditText(", "function commitEditText(");
    const end = sourceBetween("const end = (): void => {", "return { begin, beginAsync, end };");
    // Intentional change: the room-rotation body moved into live/studio-collaboration-wiring's
    // module-level rotateStudioLiveCollaborationRoom helper (react-compiler rejects mutating
    // injected hook-argument refs inside the compiled hook).
    const roomChange = sourceBetween(
      "function rotateStudioLiveCollaborationRoom(",
      "interface StudioCollaborationAccessGeneration",
    );

    expect(merge).toContain("await beginLiveResourceEditAsync(result.plan.removeIds)");
    expect(text).toContain('await beginLiveResourceEditAsync([id], "text-edit")');
    // 리스 컨트롤러는 주입된 ref 이름을 쓰고, 방 교체 쪽은 호스트 ref 이름을 그대로 쓴다.
    expect(end).toContain("++mutationGenerationRef.current");
    expect(end).toContain("releaseStudioLiveMutationLocks(");
    expect(roomChange).toContain("++studioLiveMutationGenerationRef.current");
    expect(roomChange).toContain("releaseStudioLiveMutationLocks(");
    expect(roomChange).toContain("studioLivePendingMutationRef.current = null");
  });
});
