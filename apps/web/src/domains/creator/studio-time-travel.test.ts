import { describe, expect, it } from "vitest";

import {
  branchAtEvent,
  createStudioTimeTravelLedger,
  extractMakingOfKeyframes,
  filterEvents,
  recordProductionEvent,
} from "./studio-time-travel";

describe("Studio Time Travel Studio & Decision Log", () => {
  it("records events and maintains sequence indexing", () => {
    let ledger = createStudioTimeTravelLedger({ id: "tt_1", episodeId: "ep_1" });
    expect(ledger.events).toHaveLength(0);

    ledger = recordProductionEvent(ledger, {
      id: "ev_1",
      type: "stroke-draw",
      userId: "artist_1",
      userRole: "lineart",
      targetId: "layer_line_1",
      summary: "주인공 얼굴 펜선 작화",
      timestampMs: 1_000,
    });

    ledger = recordProductionEvent(ledger, {
      id: "ev_2",
      type: "dialogue-edit",
      userId: "writer_1",
      userRole: "letterer",
      targetId: "balloon_1",
      summary: "대사 수정: '안녕' -> '오랜만이야'",
      decisionLog: "친밀감을 강조하기 위해 수정",
      marker: "milestone",
      timestampMs: 2_000,
    });

    expect(ledger.events).toHaveLength(2);
    expect(ledger.events[0].sequenceIndex).toBe(0);
    expect(ledger.events[1].sequenceIndex).toBe(1);
    expect(ledger.events[1].decisionLog).toBe("친밀감을 강조하기 위해 수정");
  });

  it("branches from historic sequence points", () => {
    let ledger = createStudioTimeTravelLedger({ id: "tt_2", episodeId: "ep_1" });
    ledger = recordProductionEvent(ledger, {
      id: "e1",
      type: "layer-create",
      userId: "u1",
      userRole: "admin",
      targetId: "l1",
      summary: "초기 레이어",
      timestampMs: 100,
    });
    ledger = recordProductionEvent(ledger, {
      id: "e2",
      type: "3d-camera-change",
      userId: "u1",
      userRole: "3d",
      targetId: "c1",
      summary: "카메라 로우앵글",
      timestampMs: 200,
    });

    // Branch from event 0
    ledger = branchAtEvent(ledger, 0, "alternate-camera-exploration", "director_1", 300);
    expect(ledger.branches).toHaveLength(1);
    expect(ledger.branches[0].branchName).toBe("alternate-camera-exploration");
    expect(ledger.branches[0].createdFromSequenceIndex).toBe(0);

    // Duplicate branch name throws
    expect(() => branchAtEvent(ledger, 0, "alternate-camera-exploration", "u1", 400)).toThrow();
  });

  it("filters events by type, user and markers", () => {
    let ledger = createStudioTimeTravelLedger({ id: "tt_3", episodeId: "ep_1" });
    ledger = recordProductionEvent(ledger, { id: "e1", type: "stroke-draw", userId: "u1", userRole: "line", targetId: "t1", summary: "펜선", timestampMs: 10 });
    ledger = recordProductionEvent(ledger, { id: "e2", type: "dialogue-edit", userId: "u2", userRole: "text", targetId: "t2", summary: "대사", marker: "approved", timestampMs: 20 });

    const user1Events = filterEvents(ledger, { userId: "u1" });
    expect(user1Events).toHaveLength(1);

    const markerEvents = filterEvents(ledger, { markerOnly: true });
    expect(markerEvents).toHaveLength(1);
    expect(markerEvents[0].id).toBe("e2");
  });

  it("extracts making-of keyframes at sampled intervals and markers", () => {
    let ledger = createStudioTimeTravelLedger({ id: "tt_4", episodeId: "ep_1" });
    ledger = recordProductionEvent(ledger, { id: "e1", type: "stroke-draw", userId: "u1", userRole: "line", targetId: "t1", summary: "시작", timestampMs: 0 });
    ledger = recordProductionEvent(ledger, { id: "e2", type: "stroke-draw", userId: "u1", userRole: "line", targetId: "t1", summary: "빠른 연속 드로잉", timestampMs: 5_000 });
    ledger = recordProductionEvent(ledger, { id: "e3", type: "publish-snapshot", userId: "u1", userRole: "admin", targetId: "t1", summary: "출고 마커", marker: "publish", timestampMs: 10_000 });
    ledger = recordProductionEvent(ledger, { id: "e4", type: "stroke-draw", userId: "u1", userRole: "line", targetId: "t1", summary: "30초 후", timestampMs: 40_000 });

    const keyframes = extractMakingOfKeyframes(ledger, 30_000);
    // e1 (first), e3 (marker), e4 (>=30s interval)
    expect(keyframes).toHaveLength(3);
    expect(keyframes.map((k) => k.sequenceIndex)).toEqual([0, 2, 3]);
  });
});
