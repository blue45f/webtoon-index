// AI 색상 팔레트 추천 패널 — 장르/무드를 짧게 설명하면 그 장면에 어울리는 색상 팔레트(5~6색 + 각 색의
// 용도 설명) 후보를 받는다(studio-ai-client.ts suggestColorPalette 문서 참고). 결과가 색상 데이터라
// StudioDialogueSuggestPanel과 동일한 이유로 AI 생성형 콘텐츠 최초 사용 고지(runWithAiNotice) 대상이
// 아니다(이미지가 아니라 구조화 데이터).
//
// StudioDialogueSuggestPanel과 동일하게 프레젠테이션 전용(무상태, 전부 prop)이다 — 실제
// suggestColorPalette() 호출, "내 팔레트에 저장"(studio-palette-library.createPalette/savePalette)은
// 전부 부모(StudioPage.tsx)가 수행한다. 저장된 팔레트는 새 타입을 발명하지 않고 기존
// StudioPaletteLibraryPanel이 관리하는 것과 완전히 같은 StudioNamedPalette 구조로 들어간다 — 이
// 패널은 그 타입조차 몰라도 된다(onSaveToLibrary에 PaletteSuggestion만 그대로 넘긴다).
import { Check, Loader2, Palette, Save, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import type { PaletteSuggestion } from "./studio-palette-suggest";

export function StudioPaletteSuggestPanel({
  configured,
  moodText,
  onMoodTextChange,
  busy,
  error,
  suggestion,
  savedMessage,
  onGenerate,
  onSaveToLibrary,
}: {
  configured: boolean;
  moodText: string;
  onMoodTextChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  suggestion: PaletteSuggestion | null;
  /** onSaveToLibrary 호출 후 부모가 채워주는 성공 피드백(예: "저장했어요"). null이면 표시 안 함. */
  savedMessage: string | null;
  onGenerate: () => void;
  onSaveToLibrary: (suggestion: PaletteSuggestion) => void;
}) {
  const canGenerate = configured && !busy && moodText.trim().length > 0;
  // 팝오버 높이가 화면보다 작으면 결과·에러가 fold 아래에 생긴다. 도착 시 스크롤로
  // 눈앞에 가져와야 "요청은 갔는데 아무 일도 없었다"로 오해하지 않는다.
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const hasFeedback = Boolean(suggestion || error);
  useEffect(() => {
    if (hasFeedback) feedbackRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [hasFeedback]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-fg-1">
        <Palette size={14} />
        AI 색상 팔레트 추천
      </div>

      {!configured && (
        <p className="rounded-md border border-line bg-card/70 px-2 py-1.5 text-[0.63rem] leading-relaxed text-fg-3">
          로그인해 서버 AI를 사용하거나 <span className="font-semibold text-fg-2">AI 어시스트 설정</span>
          에서 내 API 키를 등록하면 쓸 수 있어요.
        </p>
      )}

      <textarea
        value={moodText}
        onChange={(e) => onMoodTextChange(e.target.value.slice(0, 200))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGenerate) onGenerate();
        }}
        placeholder="예: 스릴러, 어둡고 차가운 느낌 / 청춘로맨스, 파스텔톤"
        rows={2}
        disabled={!configured || busy}
        className="h-14 w-full resize-none rounded-md border border-line bg-panel px-2 py-1 text-[0.65rem] leading-snug text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent disabled:opacity-60"
      />

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {busy ? "배색을 구상하는 중…" : "팔레트 추천받기"}
      </button>

      <div ref={feedbackRef}>
        {error && <p className="text-xs text-bad">{error}</p>}

        {suggestion && suggestion.colors.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-card/70 p-2">
            <p className="text-[0.68rem] font-medium text-fg-2">{suggestion.name || "이름 없는 팔레트"}</p>
            <div className="flex flex-wrap gap-2">
              {suggestion.colors.map((c, i) => (
                <div key={`${c.hex}-${i}`} className="flex flex-col items-center gap-0.5">
                  <div
                    className="h-7 w-7 rounded border border-line"
                    style={{ background: c.hex }}
                    title={c.role ? `${c.hex} — ${c.role}` : c.hex}
                  />
                  <span className="max-w-14 truncate text-center text-[0.55rem] text-fg-3" title={c.role || c.hex}>
                    {c.role || c.hex}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onSaveToLibrary(suggestion)}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-line bg-panel px-2 py-1.5 text-[0.63rem] font-medium text-fg-2 transition-colors hover:bg-raised"
            >
              <Save size={11} /> 내 팔레트에 저장
            </button>
            {savedMessage && (
              <p className="flex items-center gap-1 text-[0.6rem] text-good" role="status">
                <Check size={10} /> {savedMessage}
              </p>
            )}
          </div>
        )}
      </div>

      <p className="text-[0.6rem] leading-relaxed text-fg-3">
        장르·무드를 설명하면 어울리는 색상 팔레트 후보를 제안받아요. 저장하면 &quot;스타일&quot; 탭의 내
        팔레트 라이브러리에서 바로 꺼내 쓸 수 있어요.
      </p>
    </div>
  );
}
