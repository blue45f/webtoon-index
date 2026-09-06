// AI 대사/나레이션 제안 패널 — 장면 상황을 짧게 설명하면 자연스러운 대사·나레이션 후보 여러 개를
// 받는다(studio-ai-client.ts suggestDialogueLines 문서 참고). 결과가 이미지가 아니라 텍스트라
// StudioAiCompositionPanel과 같은 이유로 AI 생성형 콘텐츠 최초 사용 고지(runWithAiNotice) 대상이
// 아니다.
//
// StudioAiBackgroundPanel/StudioAiCharacterConsistencyPanel과 동일하게 프레젠테이션 전용(무상태,
// 전부 prop)이다 — 실제 suggestDialogueLines() 호출, 기존 대사 맥락 수집(collectDialogueItems),
// 캔버스 반영(dialogueScript 갱신·selected 요소 패치)은 전부 부모(StudioPage.tsx)가 수행한다. 이
// 패널을 자기완결형(StudioAiCompositionPanel처럼)으로 만들지 않은 이유: 후보 삽입 두 경로
// (스크립트에 추가 / 선택 요소에 바로 삽입) 모두 부모가 이미 소유한 상태(dialogueScript, 선택된
// 캔버스 요소)에 개입해야 해서, 상태를 이 컴포넌트 내부로 가져오면 오히려 부모와 자식 둘 다 같은
// 값을 따로 들고 동기화해야 하는 이중 소유가 생긴다.
import { Loader2, MessageSquareQuote, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import { formatDialogueSuggestionLine, type DialogueSuggestionCandidate } from "./lettering/studio-dialogue-suggest";

export function StudioDialogueSuggestPanel({
  configured,
  situationText,
  onSituationTextChange,
  hasContext,
  includeContext,
  onIncludeContextChange,
  busy,
  error,
  candidates,
  onGenerate,
  canInsertToSelected,
  onAddToScript,
  onInsertToSelected,
}: {
  configured: boolean;
  situationText: string;
  onSituationTextChange: (value: string) => void;
  /** 캔버스 현재 페이지에 이미 배치된 대사가 있어 "맥락으로 포함" 체크박스를 보여줄 수 있는지. */
  hasContext: boolean;
  /** hasContext일 때만 의미 있음 — 기존 대사를 시스템 프롬프트 맥락으로 함께 보낼지. */
  includeContext: boolean;
  onIncludeContextChange: (value: boolean) => void;
  busy: boolean;
  error: string | null;
  candidates: DialogueSuggestionCandidate[] | null;
  onGenerate: () => void;
  /** 캔버스에서 선택된 요소가 말풍선/텍스트라 후보를 바로 그 요소에 삽입할 수 있는 상태인지. */
  canInsertToSelected: boolean;
  /** 후보를 "대사 한 번에" 스크립트(말풍선 탭)에 미니 문법 한 줄로 추가. */
  onAddToScript: (candidate: DialogueSuggestionCandidate) => void;
  /** canInsertToSelected일 때만 호출 가능 — 선택된 말풍선/텍스트 요소의 텍스트를 후보로 바로 교체. */
  onInsertToSelected: (candidate: DialogueSuggestionCandidate) => void;
}) {
  const canGenerate = configured && !busy && situationText.trim().length > 0;
  // 팔레트 패널과 동일 — 결과·에러가 fold 아래에 생기지 않게 도착 시 nearest 스크롤.
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const hasFeedback = Boolean(candidates || error);
  useEffect(() => {
    if (hasFeedback) feedbackRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [hasFeedback]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-fg-1">
        <MessageSquareQuote size={14} />
        AI 대사/나레이션 제안
      </div>

      {!configured && (
        <p className="rounded-md border border-line bg-card/70 px-2 py-1.5 text-[0.63rem] leading-relaxed text-fg-3">
          로그인해 서버 AI를 사용하거나 <span className="font-semibold text-fg-2">AI 어시스트 설정</span>
          에서 내 API 키를 등록하면 쓸 수 있어요.
        </p>
      )}

      <textarea
        value={situationText}
        onChange={(e) => onSituationTextChange(e.target.value.slice(0, 500))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGenerate) onGenerate();
        }}
        placeholder="예: 오랜만에 만난 옛 친구를 알아보고 반가워하는 장면"
        rows={2}
        disabled={!configured || busy}
        className="h-14 w-full resize-none rounded-md border border-line bg-panel px-2 py-1 text-[0.65rem] leading-snug text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent disabled:opacity-60"
      />

      {hasContext && (
        <label className="flex items-center gap-1.5 text-[0.63rem] text-fg-3">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => onIncludeContextChange(e.target.checked)}
            disabled={!configured || busy}
            className="h-3 w-3 accent-accent"
          />
          이 페이지에 이미 배치된 대사를 맥락으로 포함
        </label>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {busy ? "구상하는 중…" : "대사 제안 받기"}
      </button>

      <div ref={feedbackRef}>
        {error && <p className="text-xs text-bad">{error}</p>}

        {candidates && candidates.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {candidates.map((candidate, i) => {
              const line = formatDialogueSuggestionLine(candidate);
              return (
                <div key={`${i}-${line}`} className="flex flex-col gap-1 rounded-lg border border-line bg-card/70 p-2">
                  <p className="whitespace-pre-wrap text-[0.68rem] leading-relaxed text-fg-2">{line}</p>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onAddToScript(candidate)}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[0.63rem] font-medium text-fg-2 transition-colors hover:bg-raised"
                    >
                      <Plus size={11} /> 대사 스크립트에 추가
                    </button>
                    {canInsertToSelected && (
                      <button
                        type="button"
                        onClick={() => onInsertToSelected(candidate)}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[0.63rem] font-medium text-fg-2 transition-colors hover:bg-raised"
                      >
                        <MessageSquareQuote size={11} /> 선택한 말풍선에 삽입
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[0.6rem] leading-relaxed text-fg-3">
        여러 개의 초안 후보예요 — 마음에 드는 걸 골라 다듬어 쓰세요. &quot;대사 스크립트에 추가&quot;는
        말풍선 탭의 &quot;대사 한 번에&quot; 입력창에 채워 넣어요.
      </p>
    </div>
  );
}
