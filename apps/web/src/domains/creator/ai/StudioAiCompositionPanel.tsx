// 콘티→그림 변환(장면 구성 제안) 패널 — 시나리오/대사 텍스트를 넣으면 구도·카메라앵글·인물배치
// 제안을 받는다. 완전한 "글→그림 자동생성"은 배경 생성 기능과 중복되므로 의도적으로 텍스트 조언
// 어시스트로 좁혔다(studio-ai-client.ts suggestSceneComposition 문서 참고).
//
// 배경 생성/자동 채색과 달리 **자기완결형**이다(prompt/busy/error/결과를 이 컴포넌트가 직접
// useState로 소유) — 결과가 이미지가 아니라 텍스트라 AI 생성형 콘텐츠 최초 사용 고지(이미지·AI
// 배지 전제)의 대상이 아니고, 캔버스 상태(addEl/patchEl)에도 개입하지 않아 부모와 공유할 상태가
// 없다(StudioLineCleanupPanel과 같은 "얇은 자체 완결 패널" 부류) — 이 판단의 근거는
// docs/studio-ai-assist-integration.md §5에 있다.
import { Clapperboard, Copy, Loader2, StickyNote } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  suggestSceneComposition,
  studioTextAiTransportForOperation,
  type StudioAiResult,
  type StudioAiSettings,
  type StudioTextAiProvenance,
  type StudioTextAiTransport,
} from "./studio-ai-client";

export interface StudioAiCompositionOperationSettlement {
  operationId: string;
  result: StudioAiResult<unknown>;
  textProvenance?: StudioTextAiProvenance;
}

export function StudioAiCompositionPanel({
  settings,
  transport,
  configured,
  sceneText,
  onSceneTextChange,
  onInsertAsNote,
  onOperationStart,
  onOperationSettled,
}: {
  settings: StudioAiSettings;
  transport?: StudioTextAiTransport;
  configured: boolean;
  /** Controlled scene draft (parent may inject presets). */
  sceneText?: string;
  onSceneTextChange?: (value: string) => void;
  /** 제안 텍스트를 캔버스에 메모(텍스트 요소)로 추가하고 싶을 때만 넘긴다 — 선택 사항. */
  onInsertAsNote?: (text: string) => void;
  /** 중앙 provenance가 실제 네트워크 요청 전에 pending을 남길 수 있게 한다. */
  onOperationStart?: (prompt: string) => string;
  /** 결과 본문·원문 오류 대신 구조화 결과와 안전한 실제 공급자 정보만 전달한다. */
  onOperationSettled?: (settlement: StudioAiCompositionOperationSettlement) => void;
}) {
  const [localSceneText, setLocalSceneText] = useState("");
  const sceneTextValue = sceneText ?? localSceneText;
  const setSceneTextValue = onSceneTextChange ?? setLocalSceneText;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // 팔레트·대사 패널과 동일 — 결과·에러가 팝오버 fold 아래에 생기지 않게 도착 시 nearest 스크롤.
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const hasFeedback = Boolean(suggestion || error);
  useEffect(() => {
    if (hasFeedback) feedbackRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [hasFeedback]);

  const run = async () => {
    const prompt = sceneTextValue.trim();
    if (busy || !configured || !prompt) return;
    setBusy(true);
    setError(null);
    setCopyState("idle");
    const operationId = onOperationStart?.(prompt);
    const operationTransport = operationId && transport
      ? studioTextAiTransportForOperation(transport, operationId)
      : transport;
    const result = await suggestSceneComposition(settings, prompt, operationTransport);
    if (operationId) {
      onOperationSettled?.({
        operationId,
        result,
        ...(result.ok ? { textProvenance: result.data.textProvenance } : {}),
      });
    }
    if (result.ok) {
      setSuggestion(result.data.suggestion);
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  const copySuggestion = async () => {
    if (!suggestion) return;
    try {
      await navigator.clipboard.writeText(suggestion);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-fg-1">
        <Clapperboard size={14} />
        장면 구성 제안 (콘티→그림 보조)
      </div>

      {!configured && (
        <p className="rounded-md border border-line bg-card/70 px-2 py-1.5 text-[0.63rem] leading-relaxed text-fg-3">
          장면 초안은 먼저 작성할 수 있어요. 실행하려면 로그인해 서버 AI를 사용하거나{" "}
          <span className="font-semibold text-fg-2">AI 어시스트 설정</span>에서 내 API 키를 등록하세요.
        </p>
      )}

      <textarea
        value={sceneTextValue}
        onChange={(e) => setSceneTextValue(e.target.value.slice(0, 800))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && configured) void run();
        }}
        placeholder="예: 주인공이 교실 문을 벌컥 열고 들어와 반 아이들과 눈이 마주친다. &quot;나 전학왔어.&quot;"
        rows={3}
        disabled={busy}
        className="min-h-[4.5rem] w-full resize-none rounded-lg border border-line bg-panel px-2.5 py-2 text-[0.68rem] leading-snug text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
      />

      <button
        type="button"
        onClick={() => void run()}
        disabled={!configured || busy || !sceneTextValue.trim()}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-bold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Clapperboard size={14} />}
        {busy ? "구상하는 중…" : "구도 제안 받기"}
      </button>

      <div ref={feedbackRef}>
        {error && <p className="text-xs text-bad">{error}</p>}

        {suggestion && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-card/70 p-2">
            <p className="whitespace-pre-wrap text-[0.68rem] leading-relaxed text-fg-2">{suggestion}</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void copySuggestion()}
                className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[0.63rem] font-medium text-fg-2 transition-colors hover:bg-raised"
              >
                <Copy size={11} />{" "}
                {copyState === "copied"
                  ? "복사됨"
                  : copyState === "failed"
                    ? "복사 실패"
                    : "복사"}
              </button>
              <span className="sr-only" role="status" aria-live="polite">
                {copyState === "copied"
                  ? "클립보드에 복사했어요."
                  : copyState === "failed"
                    ? "복사하지 못했어요. 텍스트를 직접 선택해 주세요."
                    : ""}
              </span>
              {onInsertAsNote && (
                <button
                  type="button"
                  onClick={() => onInsertAsNote(suggestion)}
                  className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[0.63rem] font-medium text-fg-2 transition-colors hover:bg-raised"
                >
                  <StickyNote size={11} /> 캔버스에 메모로 추가
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-[0.6rem] leading-relaxed text-fg-3">
        그림을 자동으로 만들진 않아요 — 구도·카메라앵글·인물 배치 아이디어만 텍스트로 제안해요.
      </p>
    </div>
  );
}
