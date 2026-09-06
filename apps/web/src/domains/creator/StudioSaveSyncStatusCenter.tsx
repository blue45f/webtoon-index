/**
 * Studio Save & Sync Status Center (저장 및 동기화 상태 센터)
 *
 * CLIP STUDIO PAINT Ver.5.0.0 & External Review TS-SAVE-007 / TS-UX-008 Parity:
 * - Persistent real-time monitor for local OPFS/SQLite durability, uncommitted operation journal count,
 *   recovery checkpoints, and cloud synchronization status.
 * - Non-intrusive status pill with expandable diagnostic popover.
 */

import { CheckCircle2, Clock, Cloud, CloudOff, Copy, Database, HardDrive, RefreshCw, X } from "lucide-react";
import { useState } from "react";

import {
  formatRecoveryDiagnostics,
  resolveSaveSyncStatus,
  type StudioOperationJournalState,
} from "./studio-operation-recovery-coordinator";

export interface StudioSaveSyncStatusCenterProps {
  readonly journal: StudioOperationJournalState;
  readonly isOnline?: boolean;
  readonly isOpfsActive?: boolean;
  readonly onForceCheckpoint?: () => void;
}

export function StudioSaveSyncStatusCenter({
  journal,
  isOnline = true,
  isOpfsActive = true,
  onForceCheckpoint,
}: StudioSaveSyncStatusCenterProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = resolveSaveSyncStatus(journal, isOnline, isOpfsActive);

  const handleCopyDiagnostics = () => {
    const report = formatRecoveryDiagnostics(journal, status);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(report).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getStatusColor = () => {
    if (!status.localDurable) return "bg-danger";
    if (status.cloudSyncStatus === "offline") return "bg-warning";
    if (status.pendingOperationsCount > 0) return "bg-accent";
    return "bg-success";
  };

  return (
    <div data-studio-save-sync-status-center className="relative inline-block text-xs">
      {/* Compact Status Pill */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="저장 및 동기화 상태 열기"
        className="flex items-center gap-1.5 rounded-full border border-line bg-card/90 px-2.5 py-1 text-[0.68rem] font-medium text-fg shadow-sm backdrop-blur hover:bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className={`inline-block size-2 rounded-full ${getStatusColor()}`} aria-hidden />
        <span>
          {status.pendingOperationsCount > 0
            ? `${status.pendingOperationsCount}개 작업 보존 중`
            : "저장 완료"}
        </span>
      </button>

      {/* Popover Card */}
      {open && (
        <div
          role="dialog"
          aria-label="저장 및 동기화 상태 상세"
          className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-line bg-card p-3.5 shadow-xl text-fg"
        >
          <div className="flex items-center justify-between border-b border-line/50 pb-2">
            <span className="font-semibold text-fg-2">저장 및 동기화 상태</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="rounded p-0.5 text-fg-3 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="mt-2.5 space-y-2 text-[0.68rem]">
            <div className="flex items-center justify-between rounded-lg bg-panel/60 p-2">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-accent" />
                <div>
                  <div className="font-semibold">로컬 지속성 (OPFS)</div>
                  <div className="text-[0.62rem] text-fg-3">
                    {status.localDurable ? "정상 활성화 (Crash Safe)" : "비활성화 (메모리 전용)"}
                  </div>
                </div>
              </div>
              {status.localDurable ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <span className="text-[0.62rem] text-danger font-semibold">위험</span>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg bg-panel/60 p-2">
              <div className="flex items-center gap-2">
                <HardDrive className="size-4 text-accent" />
                <div>
                  <div className="font-semibold">작업 단위 저널 (Journal)</div>
                  <div className="text-[0.62rem] text-fg-3">
                    총 {journal.lastSequence}개 동작 / {status.pendingOperationsCount}개 미체크포인트
                  </div>
                </div>
              </div>
              <span className="font-mono text-fg-2">#{journal.lastSequence}</span>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-panel/60 p-2">
              <div className="flex items-center gap-2">
                {status.cloudSyncStatus === "offline" ? (
                  <CloudOff className="size-4 text-warning" />
                ) : (
                  <Cloud className="size-4 text-accent" />
                )}
                <div>
                  <div className="font-semibold">클라우드 동기화</div>
                  <div className="text-[0.62rem] text-fg-3">
                    {status.cloudSyncStatus === "synced" && "최신 상태로 동기화됨"}
                    {status.cloudSyncStatus === "pending" && "동기화 대기 중"}
                    {status.cloudSyncStatus === "offline" && "오프라인 (로컬 보존 중)"}
                  </div>
                </div>
              </div>
              <span className="text-[0.62rem] uppercase font-semibold text-fg-3">
                {status.cloudSyncStatus}
              </span>
            </div>

            <div className="flex items-center gap-1 text-[0.62rem] text-fg-3 pt-1">
              <Clock className="size-3" />
              <span>
                마지막 체크포인트: {new Date(status.lastCheckpointAt).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-line/50 pt-2">
            {onForceCheckpoint && (
              <button
                type="button"
                onClick={onForceCheckpoint}
                className="flex items-center gap-1 rounded bg-raised px-2 py-1 text-[0.65rem] font-medium text-fg-2 hover:bg-accent-soft hover:text-accent"
              >
                <RefreshCw className="size-3" />
                <span>체크포인트 생성</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleCopyDiagnostics}
              className="flex items-center gap-1 rounded bg-raised px-2 py-1 text-[0.65rem] font-medium text-fg-2 hover:bg-accent-soft hover:text-accent"
            >
              <Copy className="size-3" />
              <span>{copied ? "복사됨!" : "진단 정보 복사"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
