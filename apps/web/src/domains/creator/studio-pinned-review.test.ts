import { describe, expect, it } from "vitest";

import {
  addPinnedReviewReply,
  createPinnedReviewThread,
  createStudioPinnedReviewBoard,
  promotePinnedReviewToTask,
  queryPinnedReviewsByPanel,
  queryPinnedReviewsByStatus,
  resolvePinnedReviewThread,
} from "./studio-pinned-review";

describe("Studio Pinned Review Thread System", () => {
  it("creates review threads pinned to panel and 3D coordinates", () => {
    let board = createStudioPinnedReviewBoard({ id: "rb_1", episodeId: "ep_1" });
    const now = 1_000_000;

    // Pin on Panel
    board = createPinnedReviewThread(board, {
      id: "th_1",
      target: { kind: "panel", panelId: "p_1", normalizedX: 0.25, normalizedY: 0.5 },
      author: { userId: "pd_kim", userName: "김PD", role: "pd" },
      title: "표정 수정 요청",
      body: "여기서 주인공 눈매를 좀 더 날카롭게 수정해주세요.",
      nowMs: now,
    });

    // Pin on 3D Object
    board = createPinnedReviewThread(board, {
      id: "th_2",
      target: { kind: "3d-object", sceneId: "sc_1", objectId: "desk_main", worldPosition: [0, 1.2, -0.5] },
      author: { userId: "director", userName: "이감독", role: "admin" },
      title: "책상 위치 조정",
      body: "카메라 앵글에 책상 모서리가 걸립니다.",
      nowMs: now,
    });

    expect(board.threads).toHaveLength(2);
    expect(queryPinnedReviewsByPanel(board, "p_1")).toHaveLength(1);
    expect(queryPinnedReviewsByPanel(board, "p_2")).toHaveLength(0);
  });

  it("handles replies, task promotion and resolution", () => {
    let board = createStudioPinnedReviewBoard({ id: "rb_2", episodeId: "ep_1" });
    const now = 1_000_000;

    board = createPinnedReviewThread(board, {
      id: "th_1",
      target: { kind: "panel", panelId: "p_1", normalizedX: 0.5, normalizedY: 0.5 },
      author: { userId: "pd_kim", userName: "김PD", role: "pd" },
      title: "톤 수정",
      body: "배경 그림자가 너무 진합니다.",
      nowMs: now,
    });

    // Add reply
    board = addPinnedReviewReply(board, "th_1", {
      id: "rep_1",
      author: { userId: "color_artist", userName: "박채색", role: "colorist" },
      body: "30% 낮추어 수정하겠습니다.",
      nowMs: now + 5_000,
    });
    expect(board.threads[0].status).toBe("in-progress");
    expect(board.threads[0].replies).toHaveLength(1);

    // Promote to Task
    const promoted = promotePinnedReviewToTask(board, "th_1", "task_color_fix_01");
    board = promoted.board;
    expect(board.threads[0].promotedTaskId).toBe("task_color_fix_01");

    // Resolve thread
    board = resolvePinnedReviewThread(board, "th_1", "pd_kim", now + 60_000, "수정 확인 완료");
    expect(board.threads[0].status).toBe("resolved");
    expect(board.threads[0].resolvedInfo?.note).toBe("수정 확인 완료");

    expect(queryPinnedReviewsByStatus(board, "resolved")).toHaveLength(1);
    expect(queryPinnedReviewsByStatus(board, "open")).toHaveLength(0);
  });
});
