import { describe, expect, it } from "vitest";

import {
  acknowledgeHandoff,
  approveHandoff,
  calculateHandoffLeadTime,
  createStageHandoffPackage,
  rejectHandoff,
  submitHandoffForReview,
} from "./studio-stage-handoff";

describe("Studio Stage Handoff Package Coordinator", () => {
  it("orchestrates handoff lifecycle: create -> ack -> submit -> approve", () => {
    const t0 = 1_000_000;
    const pkg = createStageHandoffPackage({
      id: "pkg_1",
      episodeId: "ep_1",
      sourceStage: "3d-layout",
      targetStage: "lineart",
      authorUserId: "artist_3d",
      assigneeUserId: "artist_line",
      targetPanelIds: ["p1", "p2"],
      instructions: "3D 배경 원근에 맞추어 주인공 펜선 작업 부탁드립니다.",
      checklist: ["인물 펜선 완료", "배경 오클루전 확인"],
      nowMs: t0,
    });

    expect(pkg.status).toBe("created");
    expect(pkg.checklist).toHaveLength(2);

    // 1. Acknowledge (10 mins later)
    const tAck = t0 + 10 * 60_000;
    const acked = acknowledgeHandoff(pkg, "artist_line", tAck);
    expect(acked.status).toBe("in-progress");

    // 2. Submit without checking all items -> should throw
    expect(() => submitHandoffForReview(acked, ["item_1"], tAck + 60_000)).toThrow();

    // 3. Submit with all items checked (120 mins after ack)
    const tSub = tAck + 120 * 60_000;
    const submitted = submitHandoffForReview(acked, ["item_1", "item_2"], tSub);
    expect(submitted.status).toBe("submitted");

    // 4. Approve (30 mins after sub)
    const tAppr = tSub + 30 * 60_000;
    const approved = approveHandoff(submitted, "artist_3d", tAppr, "완벽합니다!");
    expect(approved.status).toBe("approved");

    // 5. Check lead times
    const metrics = calculateHandoffLeadTime(approved);
    expect(metrics.ackLatencyMinutes).toBe(10);
    expect(metrics.workDurationMinutes).toBe(120);
    expect(metrics.reviewDurationMinutes).toBe(30);
    expect(metrics.totalLeadTimeMinutes).toBe(160);
  });

  it("handles rejection and resubmission workflow", () => {
    const t0 = 1_000_000;
    let pkg = createStageHandoffPackage({
      id: "pkg_2",
      episodeId: "ep_1",
      sourceStage: "lineart",
      targetStage: "color",
      authorUserId: "lead_artist",
      assigneeUserId: "colorist_1",
      targetPanelIds: ["p3"],
      instructions: "야간 톤 채색",
      nowMs: t0,
    });

    pkg = acknowledgeHandoff(pkg, "colorist_1", t0 + 5_000);
    pkg = submitHandoffForReview(pkg, [], t0 + 50_000);

    // Reject
    pkg = rejectHandoff(pkg, "lead_artist", "조명이 너무 밝습니다. 어둡게 조정 필요", t0 + 60_000);
    expect(pkg.status).toBe("rejected");
    expect(pkg.reviewNote).toContain("조명이 너무 밝습니다");

    // Resubmit
    pkg = submitHandoffForReview(pkg, [], t0 + 80_000);
    expect(pkg.status).toBe("submitted");
  });
});
