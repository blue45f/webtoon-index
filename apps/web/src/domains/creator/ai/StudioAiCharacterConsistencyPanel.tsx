// AI 캐릭터 일관성 생성 패널 — 캔버스에서 선택한 "기준 캐릭터" 이미지를 참고 이미지로 함께 전송해,
// 같은 캐릭터가 새로운 상황에 있는 모습을 생성한다(젠툰 벤치마크 — docs/studio-competitor-features.md
// §2 "캐릭터 일관성 유지 생성" 참고). IP-Adapter/캐릭터 LoRA 같은 전문 기법이 아니라 "참고 이미지 +
// 텍스트 프롬프트"를 Images Edits API로 보내는 근사치라 완벽한 동일 인물 재현은 보장하지 않는다 —
// 그 기대치를 마지막 안내 문구로 명시한다.
//
// StudioAiBackgroundPanel/StudioAiColorizePanel과 동일하게 프레젠테이션 전용(무상태, 전부 prop) —
// 실제 generateConsistentCharacterImage() 호출·AI 생성형 콘텐츠 최초 사용 고지 게이팅·캔버스 삽입은
// 전부 부모(StudioPage.tsx)가 수행한다. "기준 캐릭터"는 이 컴포넌트가 스스로 고르지 않는다 —
// 캔버스에서 선택된 요소가 이미지 타입인지 여부(hasReference)와 그 src(referenceThumbnail)를 부모가
// 그대로 넘겨준다(선택 상태는 StudioPage.tsx가 이미 소유한 `selected`의 파생값이라 이중 소유를
// 피한다).
import { Loader2, MousePointer2, UserRoundCheck } from "lucide-react";

export function StudioAiCharacterConsistencyPanel({
  configured,
  hasReference,
  referenceThumbnail,
  prompt,
  onPromptChange,
  busy,
  error,
  onGenerate,
  onRequestSelectReference,
}: {
  configured: boolean;
  /** 캔버스에서 선택된 요소가 이미지 타입이라 기준 캐릭터로 쓸 수 있는 상태인지. */
  hasReference: boolean;
  /** hasReference일 때 미리보기로 보여줄 선택된 이미지의 src(data URL 등). */
  referenceThumbnail: string | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  /** 캔버스 선택 모드로 전환해 기준 캐릭터 이미지를 고르게 한다. */
  onRequestSelectReference: () => void;
}) {
  const canGenerate = configured && hasReference && !busy && prompt.trim().length > 0;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel/50 p-3">
      <div className="flex items-center gap-1.5 text-sm font-bold text-fg">
        <UserRoundCheck size={14} className="text-accent" aria-hidden />
        AI 캐릭터 일관성 생성
      </div>

      {!configured && (
        <p className="rounded-md border border-line bg-card/70 px-2 py-1.5 text-[0.63rem] leading-relaxed text-fg-3">
          기준 이미지와 상황 프롬프트는 먼저 준비할 수 있어요. 실행하려면 위{" "}
          <span className="font-semibold text-fg-2">AI 어시스트 설정</span>에서 이미지 API를 연결하세요.
        </p>
      )}

      {!hasReference && (
        <div
          className="rounded-md border border-line bg-card/70 p-2 text-[0.63rem] leading-relaxed text-fg-3"
          role="status"
          aria-live="polite"
        >
          <p>
            캔버스에서 기준으로 쓸 <span className="font-semibold text-fg-2">캐릭터 이미지</span>를 먼저
            선택하세요.
          </p>
          <button
            type="button"
            onClick={onRequestSelectReference}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/45 bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            aria-label="기준 이미지 선택하기"
          >
            <MousePointer2 size={14} aria-hidden />
            기준 이미지 선택하기
          </button>
          <p className="mt-1.5 text-[0.6rem] text-fg-3">Esc를 누르면 선택을 취소할 수 있어요.</p>
        </div>
      )}

      {hasReference && referenceThumbnail && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-card/70 px-2 py-1.5">
          <img src={referenceThumbnail} alt="기준 캐릭터 미리보기" className="h-9 w-9 shrink-0 rounded object-cover" />
          <p className="text-[0.63rem] leading-relaxed text-fg-3">이 이미지를 기준 캐릭터로 사용해요.</p>
        </div>
      )}

      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value.slice(0, 500))}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canGenerate) onGenerate();
        }}
        placeholder="예: 이 캐릭터가 비 오는 골목에서 우산을 쓰고 서 있는 모습"
        rows={2}
        disabled={busy}
        className="h-14 w-full resize-none rounded-md border border-line bg-panel px-2 py-1 text-[0.65rem] leading-snug text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent disabled:opacity-60"
      />

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <UserRoundCheck size={14} />}
        {busy ? "생성하는 중…" : "같은 캐릭터로 생성"}
      </button>

      {error && <p className="text-xs text-bad">{error}</p>}

      <p className="text-[0.6rem] leading-relaxed text-fg-3">
        참고 이미지 기반 근사치예요 — 매번 완벽히 동일한 얼굴을 보장하진 않아요. 생성된 이미지는 캔버스에
        새 이미지 요소로 추가돼요(기준 이미지는 그대로 남아요).
      </p>
    </div>
  );
}
