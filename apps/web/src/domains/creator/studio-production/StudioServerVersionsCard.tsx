import { RefreshCw, RotateCcw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  loadStudioServerRevisions,
  restoreStudioServerRevision,
  serverRevisionWorkId,
  type StudioServerRevisionState,
} from "./studio-production-server-revisions";

import { buttonClass } from "@/shared/components/ui/button-utils";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

type LoadingState = "idle" | "loading" | "ready" | "error" | "restoring";

export function StudioServerVersionsCard({ scopeKey }: { readonly scopeKey: string }) {
  const workId = serverRevisionWorkId(scopeKey);
  const [state, setState] = useState<StudioServerRevisionState | null>(null);
  const [status, setStatus] = useState<LoadingState>(workId ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workId) return;
    setStatus("loading");
    setError(null);
    try {
      const next = await loadStudioServerRevisions(scopeKey);
      setState(next);
      setStatus(next ? "ready" : "idle");
    } catch (cause) {
      setState(null);
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "서버 원고 버전을 불러오지 못했습니다.");
    }
  }, [scopeKey, workId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const restore = async (revision: number) => {
    if (!state || status === "restoring" || revision === state.currentRevision) return;
    const accepted = globalThis.confirm(
      `서버 원고를 revision ${revision} 상태로 복원할까요? 현재 서버 원고는 새 revision으로 보존됩니다.`,
    );
    if (!accepted) return;
    setStatus("restoring");
    setError(null);
    try {
      const nextRevision = await restoreStudioServerRevision(state, revision);
      const refreshed = await loadStudioServerRevisions(scopeKey);
      setState(refreshed);
      setStatus(refreshed ? "ready" : "idle");
      if (refreshed?.currentRevision !== nextRevision) {
        setError("복원은 완료됐지만 최신 revision 확인이 지연되고 있습니다. 새로고침해 주세요.");
      }
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "서버 원고 버전을 복원하지 못했습니다.");
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-sm" data-studio-server-versions>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Server className="size-4 text-accent" aria-hidden="true" />
            <h2 className="text-sm font-bold text-fg">서버 원고 버전</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-2">
            실제 원고 snapshot의 owner-only 서버 revision입니다. 위 로컬 작업·검수 체크포인트와 별개입니다.
          </p>
        </div>
        {workId ? (
          <button
            type="button"
            className={buttonClass({ variant: "outline", size: "sm" })}
            onClick={() => void refresh()}
            disabled={status === "loading" || status === "restoring"}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            새로고침
          </button>
        ) : null}
      </header>

      {!workId ? (
        <div className="rounded-xl border border-dashed border-line p-5 text-sm text-fg-2">
          서버 버전은 저장된 작품의 <code>work:</code> 범위에서만 제공됩니다. 초안과 리믹스 화면은 로컬 체크포인트만 사용합니다.
        </div>
      ) : null}

      {workId && status === "loading" ? (
        <p className="rounded-xl border border-line bg-panel p-4 text-sm text-fg-2" role="status">
          서버 revision을 확인하고 있습니다…
        </p>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-fg" role="alert">
          <p>{error}</p>
          <button type="button" className="mt-3 font-semibold text-accent" onClick={() => void refresh()}>
            다시 확인
          </button>
        </div>
      ) : null}

      {state ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent-soft p-3 text-xs">
            <span className="font-semibold">현재 서버 revision</span>
            <strong className="font-mono text-sm">r{state.currentRevision}</strong>
          </div>
          {state.revisions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-5 text-sm text-fg-2">
              저장된 서버 revision 이력이 없습니다.
            </div>
          ) : state.revisions.map((revision) => {
            const current = revision.revision === state.currentRevision;
            return (
              <article
                key={revision.revision}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono text-sm font-bold">r{revision.revision}</h3>
                    {current ? <span className="text-xs font-semibold text-accent">현재</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-fg-2">
                    {DATE_TIME_FORMATTER.format(new Date(revision.createdAt))}
                    {revision.restoredFromRevision ? ` · r${revision.restoredFromRevision}에서 복원` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={buttonClass({ variant: "outline", size: "sm" })}
                  disabled={current || status === "restoring"}
                  onClick={() => void restore(revision.revision)}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  서버 복원
                </button>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
