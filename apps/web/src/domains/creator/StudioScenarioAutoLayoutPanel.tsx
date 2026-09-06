/**
 * Studio Scenario Auto Layout Panel — 시나리오(스토리 아이디어) 텍스트 한 줄 입력으로 장면 분할 →
 * 컷(프레임) 생성 → 이미지 생성(캐릭터 일관성 유지) → 말풍선 배치까지 자동 완성하는 전체화면 모달
 * (투닝/투툰/WeToon 벤치마크, docs/studio-competitor-features.md §4 로드맵 참고).
 *
 * StudioStoryboardGridPanel/StudioScrollPreviewPanel과 동일한 "전체화면 모달(open/onClose)" 규약을
 * 따른다 — 스토리 입력 + 여러 장면 미리보기 카드(썸네일+대사)를 동시에 보여줘야 해서, 다른 AI 기능들이
 * 쓰는 320px 폭 툴바 팝오버(AI 어시스트)에는 들어가지 않는다.
 *
 * **document.body에 포탈로 렌더한다**(components/auth/auth-modal.tsx와 동일 이유) — 이 앱의 라우트
 * 콘텐츠 래퍼(route-stage)가 `isolation:isolate`를 걸어놔서, 그 안에서 z-index를 아무리 높여도(예:
 * 기존 StoryboardGrid/ScrollPreview/Timelapse 등이 쓰는 z-[80]) 사이트 전역 고정 헤더(z-50, route-stage
 * 밖의 형제 — z-index는 같은 스태킹 컨텍스트 안에서만 비교된다) 뒤로 가려진다. 실제로 헤드리스 브라우저로
 * 검증하다가 발견한 버그: 포탈 없이 z-80으로만 렌더했을 때 이 패널의 제목표시줄이 사이트 헤더 뒤에 완전히
 * 가려졌다(다른 4개 기존 z-80 모달도 같은 결함이 있을 가능성이 높지만, 이번 스코프는 이 패널 자체 수정으로
 * 한정한다 — 문서에 별도 기록). AI 최초 사용 고지(AiAssetNotice)도 이 패널이 열린 채로 트리거되므로
 * 함께 포탈 렌더로 옮겼다(이 패널을 포탈만 하고 고지는 그대로 두면, 고지가 이 패널 뒤에 가려 확인
 * 버튼을 누를 수 없다).
 *
 * 이 컴포넌트는 상태를 소유하지 않는다(완전히 controlled) — 실제 generateScenarioScenes/
 * generateBackgroundImage/generateConsistentCharacterImage 호출·순차 오케스트레이션·AI 생성형 콘텐츠
 * 최초 사용 고지 게이팅·캔버스 커밋은 전부 부모(StudioPage.tsx)가 수행한다. 이 패널은 그 진행 상태를
 * 보여주고 사용자 입력(스토리 텍스트·장면 수 힌트)과 액션(생성/취소/적용/다시 만들기)만 전달한다.
 */
import {
  AlertTriangle,
  Clapperboard,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  StudioAiImageReferencePackEditor,
  STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX,
  type StudioAiImageReferenceAssetOption,
} from "./ai/StudioAiImageReferencePackEditor";
import { SCENARIO_SCENE_COUNT_MAX, SCENARIO_SCENE_COUNT_MIN } from "./studio-scenario-scenes";
import { studioServerAiProviderLabel } from "./studio-server-ai-client";
import { SCENARIO_BEAT_LABELS, SCENARIO_BEAT_TYPES, type ScenarioBeatType } from "./studio-story-beats";
import { StudioContinuityMetadataEditor } from "./StudioContinuityMetadataEditor";

import type { StudioTextAiProvenance } from "./ai/studio-ai-client";
import type { StudioAiImageReferenceDocument } from "./ai/studio-ai-image-reference-roles";
import type { ScenarioPreviewItem } from "./studio-scenario-layout";

import { cn } from "@/shared/lib/utils";

const SCENE_COUNT_OPTIONS = Array.from(
  { length: SCENARIO_SCENE_COUNT_MAX - SCENARIO_SCENE_COUNT_MIN + 1 },
  (_, i) => SCENARIO_SCENE_COUNT_MIN + i
);

const STORY_TEXT_MAX = 2000;

export interface StudioScenarioAutoLayoutPanelProps {
  open: boolean;
  onClose: () => void;
  /** 장면 텍스트 구성은 서버 DeepSeek 또는 BYOK 텍스트 모델 중 하나만 있어도 가능하다. */
  textConfigured: boolean;
  /** 이미지 생성은 DeepSeek 텍스트 transport와 분리되어 BYOK 이미지 설정을 요구한다. */
  imageConfigured: boolean;
  imageReferenceDocument: StudioAiImageReferenceDocument;
  imageReferenceAssetOptions: readonly StudioAiImageReferenceAssetOption[];
  imageReferencesLoading: boolean;
  imageReferenceMissingCount: number;
  onImageReferenceDocumentChange: (value: StudioAiImageReferenceDocument) => void;
  storyText: string;
  onStoryTextChange: (value: string) => void;
  /** 2~10 사이 유효 값이면 "정확히 N개"로 요청, undefined("자동")면 모델이 3~8개 사이로 판단. */
  sceneCountHint: number | undefined;
  onSceneCountHintChange: (value: number | undefined) => void;
  /** 검토한 장면을 현재 페이지 뒤에 붙일지, 현재 페이지 다음의 새 페이지로 만들지 선택한다. */
  applyTarget: "current-page" | "new-page";
  onApplyTargetChange: (value: "current-page" | "new-page") => void;
  /** 장면 분할(텍스트) 또는 이미지 순차 생성 중 하나라도 진행 중이면 true. */
  busy: boolean;
  /** "장면 구성 생성 중…" / "이미지 생성 중…" 등 현재 단계 라벨(busy가 아니면 null). */
  stageLabel: string | null;
  /** 이미지 순차 생성 단계의 진행 상황(장면 분할 단계에서는 null). */
  progress: { done: number; total: number } | null;
  /** 장면 분할 실패 등 파이프라인 전체를 막는 에러(장면별 이미지 실패는 preview 항목별 imageError로). */
  error: string | null;
  /** 장면 분할이 완료되면 채워진다(이미지는 순차로 채워지는 중일 수 있음) — null이면 아직 결과 없음. */
  preview: ScenarioPreviewItem[] | null;
  /** 장면 설계에 사용된 텍스트 모델 이력. 키·프롬프트·응답 본문은 포함하지 않는다. */
  textProvenance: StudioTextAiProvenance | null;
  onGenerate: () => void;
  /** 검토·수정이 끝난 장면 중 이미지가 없는 항목만 순차 생성한다. */
  onGenerateImages: () => void;
  onChangeScene: (
    index: number,
    patch: {
      beatType?: ScenarioBeatType;
      summary?: string;
      imagePrompt?: string;
      dialogue?: string;
      continuity?: ScenarioPreviewItem["continuity"];
    }
  ) => void;
  onRemoveScene: (index: number) => void;
  onRegenerateScene: (index: number) => void;
  regeneratingIndex: number | null;
  /** 현재 네트워크 요청을 중단한다(busy일 때만 노출) — 이미 생성된 장면까지는 preview에 남는다. */
  onCancel: () => void;
  /** preview를 캔버스에 커밋한다(성공한 장면은 이미지 포함, 실패한 장면은 배경 없는 빈 컷으로). */
  onApply: () => void;
  /** preview를 버리고 입력 단계로 돌아간다(캔버스는 건드리지 않는다). */
  onDiscard: () => void;
}

function StageThumbnail({ item, generating }: { item: ScenarioPreviewItem; generating: boolean }) {
  if (item.imageDataUrl) {
    return <img src={item.imageDataUrl} alt="" className="size-full object-cover" />;
  }
  if (generating) {
    return (
      <div className="grid size-full place-items-center text-fg-3">
        <Loader2 size={18} className="animate-spin" aria-hidden />
      </div>
    );
  }
  if (item.imageError) {
    return (
      <div className="grid size-full place-items-center p-1.5 text-center text-bad" title={item.imageError}>
        <AlertTriangle size={16} aria-hidden />
      </div>
    );
  }
  return <div className="size-full" aria-hidden />;
}

export function StudioScenarioAutoLayoutPanel({
  open,
  onClose,
  textConfigured,
  imageConfigured,
  imageReferenceDocument,
  imageReferenceAssetOptions,
  imageReferencesLoading,
  imageReferenceMissingCount,
  onImageReferenceDocumentChange,
  storyText,
  onStoryTextChange,
  sceneCountHint,
  onSceneCountHintChange,
  applyTarget,
  onApplyTargetChange,
  busy,
  stageLabel,
  progress,
  error,
  preview,
  textProvenance,
  onGenerate,
  onGenerateImages,
  onChangeScene,
  onRemoveScene,
  onRegenerateScene,
  regeneratingIndex,
  onCancel,
  onApply,
  onDiscard,
}: StudioScenarioAutoLayoutPanelProps) {
  // ESC로 닫기 — StudioStoryboardGridPanel/StudioScrollPreviewPanel과 동일 관례. busy 중에도 닫을 수
  // 있다(생성 상태는 이 패널이 아니라 StudioPage가 들고 있어, 닫아도 진행 중인 순차 생성은 계속되고
  // 다시 열면 그 진행 상황을 그대로 이어서 볼 수 있다 — "백그라운드 생성"이 자연스러운 부작용이다).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const hasImageReferences = imageReferenceDocument.references.length > 0;
  const [imageReferencesOpen, setImageReferencesOpen] = useState(hasImageReferences);
  if (!open) return null;

  const canGenerate = textConfigured && !busy && regeneratingIndex === null && storyText.trim().length > 0;
  const hasPreview = !!preview && preview.length > 0;
  const generatingIndex = busy && progress ? progress.done : -1;
  const editingLocked = busy || regeneratingIndex !== null;
  const missingImageCount = preview?.filter((item) => !item.imageDataUrl).length ?? 0;
  const imageReferencesBlocked =
    hasImageReferences
    && (
      imageReferencesLoading
      || imageReferenceMissingCount > 0
      || imageReferenceDocument.references.length > STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX
    );
  const imageGenerationReady = imageConfigured && !imageReferencesBlocked;

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="시나리오 자동 생성"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Clapperboard size={16} className="text-accent" aria-hidden />
          <h2 className="text-sm font-bold text-fg">시나리오 자동 생성</h2>
          <span className="text-xs text-fg-3">스토리 → 장면 검토 → 선택적 이미지 생성 → 편집 가능한 컷</span>
          <button
            type="button"
            aria-label="닫기"
            title="닫기 (Esc)"
            onClick={onClose}
            className="ml-auto grid size-11 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-accent-soft hover:text-accent sm:size-8"
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!textConfigured && (
            <p className="mb-3 rounded-md border border-line bg-card/70 px-2.5 py-2 text-xs leading-relaxed text-fg-3">
              로그인해 서버 AI를 사용하거나, 위 <span className="font-semibold text-fg-2">AI 어시스트 설정</span>에서
              내 텍스트 API 키를 등록하면 장면 구성을 만들 수 있어요.
            </p>
          )}

          <label htmlFor="scenario-story-text" className="mb-1 block text-xs font-medium text-fg-2">
            스토리 아이디어
          </label>
          <textarea
            id="scenario-story-text"
            value={storyText}
            onChange={(e) => onStoryTextChange(e.target.value.slice(0, STORY_TEXT_MAX))}
            placeholder="예: 주인공이 학교 가는 길에 오랜만에 친구를 만나 반갑게 인사를 나눈다."
            rows={4}
            disabled={editingLocked}
            className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent disabled:opacity-60"
          />
          <div className="mt-1 flex items-center justify-between text-[0.65rem] text-fg-3">
            <span>{storyText.length} / {STORY_TEXT_MAX}자</span>
          </div>

          <details
            open={imageReferencesOpen}
            onToggle={(event) => setImageReferencesOpen(event.currentTarget.open)}
            className="mt-3 min-w-0 overflow-hidden rounded-xl border border-line bg-card/55"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-fg-2 marker:hidden">
              <ImagePlus size={14} className="shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate">AI 이미지 참조 팩</span>
              <span className="shrink-0 rounded-full border border-line bg-panel px-2 py-0.5 text-[0.65rem] tabular-nums text-fg-3">
                {imageReferenceDocument.references.length}개
              </span>
            </summary>
            <div className="min-w-0 border-t border-line p-2.5">
              <StudioAiImageReferencePackEditor
                document={imageReferenceDocument}
                assetOptions={imageReferenceAssetOptions}
                loading={imageReferencesLoading}
                disabled={editingLocked}
                onChange={onImageReferenceDocumentChange}
              />
              {imageReferenceMissingCount > 0 ? (
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[0.7rem] leading-relaxed text-bad"
                >
                  연결된 참조 에셋 {imageReferenceMissingCount}개를 찾을 수 없습니다. 삭제된 참조를
                  제거하거나 프로젝트 에셋을 다시 추가하면 이미지 생성을 계속할 수 있어요.
                </p>
              ) : null}
              {imageReferenceDocument.references.length > STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX ? (
                <p
                  role="alert"
                  className="mt-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[0.7rem] leading-relaxed text-bad"
                >
                  AI 이미지 참조는 최대 {STUDIO_AI_IMAGE_REFERENCE_PROVIDER_SAFE_MAX}개까지 사용할 수
                  있습니다. 일부 참조를 제거한 뒤 생성해 주세요.
                </p>
              ) : null}
              <p className="mt-2 text-[0.66rem] leading-relaxed text-fg-3">
                PNG·JPEG·WebP 프로젝트 에셋만 표시합니다. 참조 메타데이터는 작품별로 저장하며
                이미지 원본은 생성 요청 순간에만 읽습니다.
              </p>
            </div>
          </details>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-fg-2">
              장면 수
              <select
                value={sceneCountHint ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onSceneCountHintChange(v === "" ? undefined : Number(v));
                }}
                disabled={editingLocked}
                className="min-h-11 rounded-md border border-line bg-card px-2 py-1 text-xs text-fg outline-none focus:border-accent disabled:opacity-60 sm:min-h-8"
              >
                <option value="">자동(3~8개)</option>
                {SCENE_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}개
                  </option>
                ))}
              </select>
            </label>

            {!busy ? (
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-8"
              >
                <Sparkles size={13} aria-hidden />
                자동 생성
              </button>
            ) : (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised sm:min-h-8"
              >
                취소
              </button>
            )}

            {busy && (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-3" role="status" aria-live="polite">
                <Loader2 size={13} className="animate-spin" aria-hidden />
                {stageLabel}
                {progress && ` (${progress.done}/${progress.total})`}
              </span>
            )}
          </div>

          {error && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-bad/30 bg-bad/10 px-2.5 py-2 text-xs leading-relaxed text-bad">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}

          {hasPreview && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-fg-2">장면 초안 — {preview!.length}개 컷</p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                    그림을 만들기 전에 프롬프트와 대사를 장면별로 검토하세요. 수정한 장면만 다시 생성할 수 있어요.
                  </p>
                  {textProvenance ? (
                    <div className="mt-1 text-[0.64rem] leading-relaxed text-fg-3">
                      <p>
                        텍스트 생성 이력 · {textProvenance.provider} / {textProvenance.model} · 프롬프트 v
                        {textProvenance.promptVersion} · {textProvenance.transport === "server" ? "서버" : "내 키"}
                        {textProvenance.usage?.totalTokens !== undefined
                          ? ` · ${textProvenance.usage.totalTokens.toLocaleString("ko-KR")} tokens`
                          : ""}
                      </p>
                      {textProvenance.failover ? (
                        <p className="mt-1 rounded-md border border-warn/35 bg-warn/10 px-2 py-1 text-warn" role="status">
                          {studioServerAiProviderLabel(textProvenance.failover.attemptedProvider)} 잔액·패키지 한도 소진으로 {studioServerAiProviderLabel(textProvenance.failover.actualProvider)}에 자동 전환했어요.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {!imageGenerationReady && (
                  <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.65rem] text-fg-3">
                    {!imageConfigured
                      ? "이미지 생성은 내 API 키 연동 필요"
                      : imageReferencesLoading
                        ? "참조 에셋 불러오는 중"
                        : imageReferenceMissingCount > 0
                          ? "누락된 참조 에셋 확인 필요"
                          : "참조 수 제한 확인 필요"}
                  </span>
                )}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {preview!.map((item, idx) => (
                  <article key={idx} className="rounded-xl border border-line bg-card/60 p-2">
                    <div className="mb-2 grid gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                      <label className="block text-[0.65rem] font-semibold text-fg-3">
                        비트 역할
                        <select
                          value={item.beatType}
                          onChange={(event) =>
                            onChangeScene(idx, { beatType: event.target.value as ScenarioBeatType })
                          }
                          disabled={editingLocked}
                          aria-label={`${idx + 1}번 장면 비트 역할`}
                          className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[0.72rem] text-fg outline-none focus:border-accent disabled:opacity-60"
                        >
                          {SCENARIO_BEAT_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {SCENARIO_BEAT_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-[0.65rem] font-semibold text-fg-3">
                        장면 변화 요약
                        <textarea
                          value={item.summary}
                          onChange={(event) => onChangeScene(idx, { summary: event.target.value.slice(0, 240) })}
                          disabled={editingLocked}
                          rows={2}
                          aria-label={`${idx + 1}번 장면 변화 요약`}
                          className="mt-1 w-full resize-y rounded-md border border-line bg-panel px-2 py-1.5 text-[0.72rem] leading-relaxed text-fg outline-none focus:border-accent disabled:opacity-60"
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-lg bg-raised sm:w-32">
                        <span className="absolute left-1 top-1 z-10 grid size-5 place-items-center rounded-full bg-black/65 text-[0.65rem] font-bold text-white">
                          {idx + 1}
                        </span>
                        <StageThumbnail
                          item={item}
                          generating={idx === generatingIndex || idx === regeneratingIndex}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <label className="block text-[0.65rem] font-semibold text-fg-3">
                          그림 프롬프트
                          <textarea
                            value={item.imagePrompt}
                            onChange={(event) =>
                              onChangeScene(idx, { imagePrompt: event.target.value.slice(0, 1_000) })
                            }
                            disabled={editingLocked}
                            rows={3}
                            aria-label={`${idx + 1}번 장면 그림 프롬프트`}
                            className="mt-1 w-full resize-y rounded-md border border-line bg-panel px-2 py-1.5 text-[0.72rem] leading-relaxed text-fg outline-none focus:border-accent disabled:opacity-60"
                          />
                        </label>
                      </div>
                    </div>
                    <label className="mt-2 block text-[0.65rem] font-semibold text-fg-3">
                      대사·지문
                      <textarea
                        value={item.dialogue}
                        onChange={(event) => onChangeScene(idx, { dialogue: event.target.value.slice(0, 2_000) })}
                        disabled={editingLocked}
                        rows={3}
                        placeholder={'민수: 안녕!\n(잠시 정적)'}
                        aria-label={`${idx + 1}번 장면 대사와 지문`}
                        className="mt-1 w-full resize-y rounded-md border border-line bg-panel px-2 py-1.5 text-[0.72rem] leading-relaxed text-fg outline-none focus:border-accent disabled:opacity-60"
                      />
                    </label>
                    <details className="mt-2 rounded-lg border border-line bg-panel/55 px-2.5 py-2">
                      <summary className="cursor-pointer text-[0.68rem] font-semibold text-fg-2">
                        연속성 메타 — 인물·장소·시간·의상·소품
                      </summary>
                      <div className="mt-2">
                        <StudioContinuityMetadataEditor
                          value={item.continuity ?? {}}
                          onChange={(continuity) => onChangeScene(idx, { continuity })}
                          disabled={editingLocked}
                          compact
                        />
                      </div>
                    </details>
                    {item.imageError && (
                      <p className="mt-1.5 flex items-start gap-1 text-[0.65rem] leading-snug text-bad">
                        <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />
                        {item.imageError}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onRegenerateScene(idx)}
                        disabled={!imageGenerationReady || editingLocked || item.imagePrompt.trim().length === 0}
                        title={
                          !imageConfigured
                            ? "AI 연동에서 이미지 API 키를 설정하세요"
                            : imageReferencesBlocked
                              ? "AI 참조 에셋을 모두 확인한 뒤 생성하세요"
                              : undefined
                        }
                        className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[0.65rem] font-semibold text-fg-2 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-7"
                      >
                        {idx === regeneratingIndex ? (
                          <Loader2 size={11} className="animate-spin" aria-hidden />
                        ) : (
                          <RefreshCw size={11} aria-hidden />
                        )}
                        {item.imageDataUrl ? "이 장면 다시 생성" : "이 장면 이미지 생성"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveScene(idx)}
                        disabled={editingLocked || preview!.length <= 1}
                        className="ml-auto inline-grid size-11 place-items-center rounded-md border border-line text-fg-3 hover:border-bad/50 hover:bg-bad/10 hover:text-bad disabled:cursor-not-allowed disabled:opacity-35 sm:size-7"
                        aria-label={`${idx + 1}번 장면 삭제`}
                        title={preview!.length <= 1 ? "장면은 하나 이상 필요해요" : "이 장면 삭제"}
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>

        {hasPreview && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <button
              type="button"
              onClick={onDiscard}
              disabled={editingLocked}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-8"
            >
              <RotateCcw size={13} aria-hidden />
              다시 만들기
            </button>
            {missingImageCount > 0 && (
              <button
                type="button"
                onClick={onGenerateImages}
                disabled={!imageGenerationReady || editingLocked}
                title={
                  !imageConfigured
                    ? "AI 연동에서 이미지 API 키를 설정하세요"
                    : imageReferencesBlocked
                      ? "AI 참조 에셋을 모두 확인한 뒤 생성하세요"
                      : undefined
                }
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft/30 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft/50 disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-8"
              >
                <ImagePlus size={13} aria-hidden />
                빈 장면 이미지 {missingImageCount}개 생성
              </button>
            )}
            <label className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-fg-2">
              적용 위치
              <select
                value={applyTarget}
                onChange={(event) =>
                  onApplyTargetChange(event.target.value === "new-page" ? "new-page" : "current-page")
                }
                disabled={editingLocked}
                className="min-h-11 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent disabled:opacity-60 sm:min-h-8"
              >
                <option value="current-page">현재 페이지 아래</option>
                <option value="new-page">다음 새 페이지</option>
              </select>
            </label>
            <button
              type="button"
              onClick={onApply}
              disabled={editingLocked}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-8"
              )}
            >
              {applyTarget === "new-page" ? "새 페이지로 적용" : "현재 페이지에 적용"}
            </button>
          </div>
        )}

        <p className="shrink-0 border-t border-line px-4 py-2 text-[0.65rem] leading-relaxed text-fg-3">
          이미지 없이도 컷·말풍선만 먼저 적용할 수 있어요. 선택한 위치에 적용한 결과는 일반 레이어가 되어
          위치·크기·이미지·대사를 계속 다듬을 수 있어요.
        </p>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
