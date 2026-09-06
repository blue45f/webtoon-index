import { describe, expect, it } from "vitest";

import {
  parseStudioAutosave,
  serializeStudioAutosave,
  studioAutosaveHasContent,
  studioSharedAutosaveCompatibility,
  type StudioAutosavePayload,
} from "./studio-autosave";
import {
  appendStudioPagesHistorySnapshot,
  createStudioLifecycleEmergencyAutosave,
  createStudioPendingStrokeEmergencyAutosave,
  projectStudioPendingStrokes,
} from "./studio-pending-stroke-durability";

function basePayload(pagesList: StudioAutosavePayload["pagesList"]): StudioAutosavePayload {
  return {
    version: 2,
    savedAt: "2026-07-18T00:00:00.000Z",
    pagesList,
  };
}

describe("pending stroke durability", () => {
  it("안정 편집만 있어도 debounce 전에 lifecycle 영수증을 가진 복구본을 만든다", () => {
    const result = createStudioLifecycleEmergencyAutosave({
      payload: basePayload([{ id: "page-1", elements: [{ id: "stable-edit" }] }]),
      pending: null,
      reason: "route-change",
      savedAt: "2026-07-18T01:02:03.000Z",
      documentScope: { kind: "local" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.status).toBe("no-pending");
    expect(result.payload.lifecycleDurability).toEqual({
      kind: "lifecycle-snapshot",
      reason: "route-change",
      savedAt: "2026-07-18T01:02:03.000Z",
    });
    expect(result.payload.pagesList[0]?.elements).toEqual([{ id: "stable-edit" }]);
    expect(
      parseStudioAutosave(serializeStudioAutosave(result.payload))?.lifecycleDurability
    ).toEqual(result.payload.lifecycleDurability);
  });

  it("마지막 요소 삭제처럼 빈 결과가 된 dirty snapshot도 lifecycle 영수증으로 복구 가능하다", () => {
    const result = createStudioLifecycleEmergencyAutosave({
      payload: basePayload([{ id: "page-1", elements: [] }]),
      pending: null,
      reason: "pagehide",
      savedAt: "2026-07-18T01:02:03.500Z",
      documentScope: { kind: "local" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(studioAutosaveHasContent(result.payload)).toBe(true);
    expect(
      studioAutosaveHasContent(parseStudioAutosave(serializeStudioAutosave(result.payload))!)
    ).toBe(true);
  });

  it("lifecycle 복구는 대기 획을 투영하고 안정 상태·대기 획 영수증을 함께 남긴다", () => {
    const result = createStudioLifecycleEmergencyAutosave({
      payload: basePayload([{ id: "page-1", elements: [{ id: "stable-edit" }] }]),
      pending: { pageId: "page-1", strokes: [{ id: "pending-stroke" }] },
      reason: "pointerup",
      savedAt: "2026-07-18T01:02:04.000Z",
      documentScope: { kind: "local" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.pagesList[0]?.elements).toEqual([
      { id: "stable-edit" },
      { id: "pending-stroke" },
    ]);
    expect(result.payload.lifecycleDurability).toMatchObject({
      kind: "lifecycle-snapshot",
      reason: "pointerup",
      pendingStrokePageId: "page-1",
      pendingStrokeIds: ["pending-stroke"],
    });
    expect(result.payload.pendingStrokeDurability?.strokeIds).toEqual(["pending-stroke"]);
  });

  it("같은 task의 교차 페이지 커밋 두 개를 최신 ref history에 순서대로 보존한다", () => {
    const initial = [[
      { id: "page-1", elements: [] as Array<{ id: string }> },
      { id: "page-2", elements: [] as Array<{ id: string }> },
    ]];
    const pendingPage = [
      { id: "page-1", elements: [{ id: "deferred" }] },
      initial[0]![1]!,
    ];
    const first = appendStudioPagesHistorySnapshot(initial, 0, pendingPage);
    const immediatePage = [
      first.history[first.historyIndex]![0]!,
      { id: "page-2", elements: [{ id: "immediate" }] },
    ];
    const second = appendStudioPagesHistorySnapshot(
      first.history,
      first.historyIndex,
      immediatePage
    );

    expect(second.history).toHaveLength(3);
    expect(second.history[1]?.[0]?.elements).toEqual([{ id: "deferred" }]);
    expect(second.history[1]?.[1]?.elements).toEqual([]);
    expect(second.history[2]?.[0]?.elements).toEqual([{ id: "deferred" }]);
    expect(second.history[2]?.[1]?.elements).toEqual([{ id: "immediate" }]);
    expect(second.historyIndex).toBe(2);
  });

  it("가벼운 편집은 옛 200개 상한을 넘어 계속 쌓인다 — 예산 근처에도 못 간다", () => {
    const seed = { id: "page", elements: [{ id: "seed" }] };
    let result = appendStudioPagesHistorySnapshot([], -1, [seed]);

    for (let i = 0; i < 605; i += 1) {
      const previous = result.history[result.historyIndex]![0]!;
      const pages = [{ ...previous, elements: [...previous.elements, { id: `stroke-${i}` }] }];
      result = appendStudioPagesHistorySnapshot(result.history, result.historyIndex, pages);
    }

    // 오늘의 상한이었다면 여기서 200 이고 처음 406단계가 조용히 사라졌다.
    expect(result.history).toHaveLength(606);
    expect(result.historyIndex).toBe(605);
    expect(result.history[0]?.[0]?.elements).toEqual([{ id: "seed" }]);
    expect(result.evictedCount).toBe(0);
    expect(result.retainedBytes).toBeLessThan(result.budgetBytes);
  });

  it("개수 방벽은 예산이 헐거워도 배열 길이를 묶고, 그때도 앞에서만 자른다", () => {
    const maxEntries = 24;
    let result = appendStudioPagesHistorySnapshot([], -1, [
      { id: "page", elements: [{ id: "seed" }] },
    ], { maxEntries });

    for (let i = 0; i < 60; i += 1) {
      const previous = result.history[result.historyIndex]![0]!;
      const pages = [{ ...previous, elements: [...previous.elements, { id: `stroke-${i}` }] }];
      result = appendStudioPagesHistorySnapshot(
        result.history,
        result.historyIndex,
        pages,
        { maxEntries }
      );
    }

    expect(result.history).toHaveLength(maxEntries);
    expect(result.historyIndex).toBe(maxEntries - 1);
    expect(result.evictedForBudget).toBe(false);
    expect(result.history.at(-1)?.[0]?.elements.at(-1)).toEqual({ id: "stroke-59" });
  });

  it("무거운 커밋 하나가 예산을 넘기면 앞에서 여러 단계를 한 번에 버린다", () => {
    const retention = { budgetBytes: 8_000, minEntries: 2 };
    type HeavyPage = { id: string; elements: { id: string; points?: number[] }[] };
    let result = appendStudioPagesHistorySnapshot<HeavyPage>([], -1, [
      { id: "page", elements: [{ id: "stroke", points: [0, 0] }] },
    ], retention);

    for (let i = 0; i < 8; i += 1) {
      const previous = result.history[result.historyIndex]![0]!;
      const pages = [{ ...previous, elements: [...previous.elements, { id: `light-${i}` }] }];
      result = appendStudioPagesHistorySnapshot(
        result.history,
        result.historyIndex,
        pages,
        retention
      );
    }
    const depthBefore = result.history.length;
    expect(result.evictedCount).toBe(0);

    // 3,000 샘플 획 하나를 다시 굽는 커밋 — 이 하나가 예산을 여러 엔트리분 넘긴다.
    const base = result.history[result.historyIndex]![0]!;
    const heavy = [{
      ...base,
      elements: base.elements.map((element, index) =>
        index === 0 ? { ...element, points: Array.from({ length: 6_000 }, () => 1) } : element
      ),
    }];
    result = appendStudioPagesHistorySnapshot(
      result.history,
      result.historyIndex,
      heavy,
      retention
    );

    expect(result.evictedForBudget).toBe(true);
    expect(result.evictedCount).toBeGreaterThan(1);
    expect(result.history).toHaveLength(depthBefore + 1 - result.evictedCount);
    expect(result.historyIndex).toBe(result.history.length - 1);
    expect(result.history.at(-1)).toBe(heavy);
    expect(result.appendedEntryBytes).toBeGreaterThan(48_000);
  });

  it("undo 뒤 새 커밋은 redo 분기를 잘라내고 현재 snapshot 뒤에만 추가한다", () => {
    const history = [
      [{ id: "p", elements: [{ id: "0" }] }],
      [{ id: "p", elements: [{ id: "1" }] }],
      [{ id: "p", elements: [{ id: "discard-redo" }] }],
    ];
    const result = appendStudioPagesHistorySnapshot(
      history,
      1,
      [{ id: "p", elements: [{ id: "new-branch" }] }]
    );

    expect(result.history).toHaveLength(3);
    expect(result.history[2]?.[0]?.elements).toEqual([{ id: "new-branch" }]);
  });

  it("대상 페이지만 복사하고 원본 스냅샷은 변경하지 않는다", () => {
    const first = { id: "page-1", elements: [{ id: "old-1" }], bg: "#fff" };
    const second = { id: "page-2", elements: [{ id: "old-2" }], bg: "#eee" };
    const pages = [first, second];
    const stroke = { id: "stroke-1", type: "draw", points: [1, 2] };

    const result = projectStudioPendingStrokes(pages, {
      pageId: "page-2",
      strokes: [stroke],
    });

    expect(result.status).toBe("projected");
    expect(result.pagesList).not.toBe(pages);
    expect(result.pagesList[0]).toBe(first);
    expect(result.pagesList[1]).not.toBe(second);
    expect(result.pagesList[1]?.elements).toEqual([{ id: "old-2" }, stroke]);
    expect(second.elements).toEqual([{ id: "old-2" }]);
  });

  it("기존 요소와 배치 내부의 중복 ID를 모두 제거해 재실행해도 멱등적이다", () => {
    const pages = [{ id: "page-1", elements: [{ id: "old" }, { id: "already" }] }];
    const pending = {
      pageId: "page-1",
      strokes: [
        { id: "already", type: "draw" },
        { id: "new", type: "draw" },
        { id: "new", type: "draw", variant: 2 },
        { id: "", type: "draw" },
      ],
    };

    const first = projectStudioPendingStrokes(pages, pending);
    const replay = projectStudioPendingStrokes(first.pagesList, pending);

    expect(first.status).toBe("projected");
    expect(first.appliedStrokeIds).toEqual(["new"]);
    expect(first.duplicateStrokeIds).toEqual(["already", "new"]);
    expect(first.invalidStrokeIndexes).toEqual([3]);
    expect(replay.status).toBe("no-new-strokes");
    expect(replay.pagesList).toBe(first.pagesList);
    expect(first.pagesList[0]?.elements).toHaveLength(3);
  });

  it("누락되거나 중복된 페이지 ID에는 스트로크를 임의로 붙이지 않는다", () => {
    const missingPages = [{ id: "page-1", elements: [] }];
    const duplicatePages = [
      { id: "page-1", elements: [] },
      { id: "page-1", elements: [] },
    ];
    const pending = { pageId: "page-1", strokes: [{ id: "stroke-1" }] };

    const missing = projectStudioPendingStrokes(missingPages, {
      ...pending,
      pageId: "missing",
    });
    const ambiguous = projectStudioPendingStrokes(duplicatePages, pending);

    expect(missing).toMatchObject({ status: "page-missing", pagesList: missingPages });
    expect(ambiguous).toMatchObject({ status: "page-ambiguous", pagesList: duplicatePages });
  });

  it("공동 작품의 정확한 work/revision과 원인 영수증을 비상 자동저장에 기록한다", () => {
    const result = createStudioPendingStrokeEmergencyAutosave({
      payload: basePayload([{ id: "page-1", elements: [{ id: "old" }] }]),
      pending: { pageId: "page-1", strokes: [{ id: "stroke-1", type: "draw" }] },
      reason: "route-change",
      savedAt: "2026-07-18T01:02:03.000Z",
      documentScope: { kind: "shared", workId: "shared-work", revision: 7 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      savedAt: "2026-07-18T01:02:03.000Z",
      sourceWorkId: "shared-work",
      sourceRevision: 7,
      pendingStrokeDurability: {
        kind: "pending-strokes",
        reason: "route-change",
        pageId: "page-1",
        strokeIds: ["stroke-1"],
        savedAt: "2026-07-18T01:02:03.000Z",
      },
    });
    expect(
      studioSharedAutosaveCompatibility(result.payload, {
        workId: "shared-work",
        revision: 7,
      })
    ).toEqual({ compatible: true, reason: "match" });
  });

  it("공동 작품의 오래된 source revision을 현재 revision으로 조용히 바꾸지 않는다", () => {
    const result = createStudioPendingStrokeEmergencyAutosave({
      payload: {
        ...basePayload([{ id: "page-1", elements: [] }]),
        sourceWorkId: "shared-work",
        sourceRevision: 6,
      },
      pending: { pageId: "page-1", strokes: [{ id: "stroke-1" }] },
      reason: "unmount",
      savedAt: "2026-07-18T01:02:03.000Z",
      documentScope: { kind: "shared", workId: "shared-work", revision: 7 },
    });

    expect(result).toMatchObject({ ok: false, reason: "source-metadata-mismatch" });
  });

  it("로컬 문서에는 공동 작품 source 메타데이터가 섞이지 않는다", () => {
    const result = createStudioPendingStrokeEmergencyAutosave({
      payload: {
        ...basePayload([{ id: "page-1", elements: [] }]),
        sourceWorkId: "stale-shared-work",
        sourceRevision: 2,
      },
      pending: { pageId: "page-1", strokes: [{ id: "stroke-1" }] },
      reason: "pagehide",
      savedAt: "2026-07-18T01:02:03.000Z",
      documentScope: { kind: "local" },
    });

    expect(result).toMatchObject({ ok: false, reason: "source-metadata-mismatch" });
  });

  it("비상 영수증을 직렬화·파싱 왕복에서 보존하고 손상된 영수증은 버린다", () => {
    const result = createStudioPendingStrokeEmergencyAutosave({
      payload: basePayload([{ id: "page-1", elements: [] }]),
      pending: { pageId: "page-1", strokes: [{ id: "stroke-1" }] },
      reason: "visibility-hidden",
      savedAt: "2026-07-18T01:02:03.000Z",
      documentScope: { kind: "local" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = parseStudioAutosave(serializeStudioAutosave(result.payload));
    const malformed = parseStudioAutosave(
      JSON.stringify({
        pagesList: [{ id: "page-1", elements: [{ id: "stroke-1" }] }],
        pendingStrokeDurability: {
          kind: "pending-strokes",
          reason: "unknown",
          pageId: "page-1",
          strokeIds: ["stroke-1"],
          savedAt: "2026-07-18T01:02:03.000Z",
        },
      })
    );

    expect(parsed?.pendingStrokeDurability).toEqual(result.payload.pendingStrokeDurability);
    expect(malformed?.pendingStrokeDurability).toBeUndefined();
  });

  it("새로 합칠 스트로크가 없으면 기존 자동저장을 덮어쓸 페이로드를 만들지 않는다", () => {
    const result = createStudioPendingStrokeEmergencyAutosave({
      payload: basePayload([{ id: "page-1", elements: [{ id: "stroke-1" }] }]),
      pending: { pageId: "page-1", strokes: [{ id: "stroke-1" }] },
      reason: "unmount",
      savedAt: "2026-07-18T01:02:03.000Z",
      documentScope: { kind: "local" },
    });

    expect(result).toMatchObject({ ok: false, reason: "no-new-strokes" });
  });
});
