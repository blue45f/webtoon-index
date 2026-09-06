import { describe, expect, it } from "vitest";

import {
  appendCanvasOperation,
  createEmptyOperationJournal,
  createJournalCheckpoint,
  formatRecoveryDiagnostics,
  getOperationsToReplay,
  resolveSaveSyncStatus,
} from "./studio-operation-recovery-coordinator";

describe("studio-operation-recovery-coordinator", () => {
  describe("Operation Appending & Checkpointing", () => {
    it("appends canvas operations with monotonic sequence numbers", () => {
      let journal = createEmptyOperationJournal("doc-123");
      expect(journal.lastSequence).toBe(0);

      journal = appendCanvasOperation(journal, "stroke", "G펜 획", { points: [10, 20] }, 1000);
      expect(journal.lastSequence).toBe(1);
      expect(journal.operations).toHaveLength(1);
      expect(journal.operations[0].sequence).toBe(1);
      expect(journal.operations[0].type).toBe("stroke");

      journal = appendCanvasOperation(journal, "layer", "채색 레이어 추가", { layerId: "l2" }, 1100);
      expect(journal.lastSequence).toBe(2);
      expect(journal.operations).toHaveLength(2);
      expect(journal.operations[1].sequence).toBe(2);
    });

    it("creates checkpoints and identifies un-checkpointed replay operations", () => {
      let journal = createEmptyOperationJournal("doc-abc");
      journal = appendCanvasOperation(journal, "stroke", "스케치 획", {}, 100);
      journal = appendCanvasOperation(journal, "stroke", "선화 획", {}, 200);

      // Checkpoint at sequence 2
      journal = createJournalCheckpoint(journal, { canvasState: "snapshot-2" }, 250);
      expect(journal.lastCheckpoint?.sequence).toBe(2);

      // Immediately after checkpoint, 0 replay operations needed
      expect(getOperationsToReplay(journal)).toHaveLength(0);

      // New operations post-checkpoint
      journal = appendCanvasOperation(journal, "text", "대사 입력", { text: "와아!" }, 300);
      journal = appendCanvasOperation(journal, "effect", "드롭 섀도 적용", {}, 400);

      const replayOps = getOperationsToReplay(journal);
      expect(replayOps).toHaveLength(2);
      expect(replayOps[0].sequence).toBe(3);
      expect(replayOps[1].sequence).toBe(4);
    });
  });

  describe("Save & Sync Status Center", () => {
    it("computes real-time status and diagnostics string", () => {
      let journal = createEmptyOperationJournal("webtoon-ep1");
      journal = appendCanvasOperation(journal, "stroke", "펜 터치", {}, 1000);

      const status = resolveSaveSyncStatus(journal, true, true);
      expect(status.localDurable).toBe(true);
      expect(status.pendingOperationsCount).toBe(1);
      expect(status.cloudSyncStatus).toBe("pending");
      expect(status.summaryText).toContain("복구 저널");

      const diagnostics = formatRecoveryDiagnostics(journal, status);
      expect(diagnostics).toContain("webtoon-ep1");
      expect(diagnostics).toContain("Active (OPFS/SQLite)");
      expect(diagnostics).toContain("펜 터치");
    });

    it("reports offline status when disconnected", () => {
      const journal = createEmptyOperationJournal("doc-offline");
      const status = resolveSaveSyncStatus(journal, false, true);
      expect(status.cloudSyncStatus).toBe("offline");
      expect(status.summaryText).toContain("오프라인 모드");
    });
  });
});
