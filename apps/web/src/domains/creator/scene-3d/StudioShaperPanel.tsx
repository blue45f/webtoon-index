import {
  Check,
  Download,
  ImagePlus,
  Layers,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_SHAPER_SELECTION,
  recommendShaperPreset,
  SHAPER_AI_ARCHETYPES,
  SHAPER_CATEGORIES,
  SHAPER_PRESETS,
  type ShaperAiArchetype,
  type ShaperPresetCategory,
  type ShaperPresetSelection,
} from "./studio-shaper-model";

import { cn } from "@/shared/lib/utils";

export interface StudioShaperPanelProps {
  readonly selection?: Partial<ShaperPresetSelection>;
  readonly supportedCategories?: readonly ShaperPresetCategory[];
  readonly onSelectionChange?: (selection: ShaperPresetSelection) => void;
  readonly onExportPsd?: () => void;
  readonly onInsertCanvas?: () => void;
  readonly onTriggerPoseScanner?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

type ShaperSectionTab = "recipes" | "assist" | "output";

const SECTION_TABS: readonly { id: ShaperSectionTab; label: string }[] = [
  { id: "recipes", label: "캐릭터 레시피" },
  { id: "assist", label: "추천·포즈" },
  { id: "output", label: "출력" },
];

const DEFAULT_SUPPORTED_CATEGORIES: readonly ShaperPresetCategory[] = Object.freeze([
  "face",
  "eye",
  "nose",
  "body",
  "bodypose",
  "handpose",
]);

const VRM_ONLY_REASON: Readonly<Partial<Record<ShaperPresetCategory, string>>> = Object.freeze({
  pupil: "홍채와 동공은 텍스처·morph가 있는 VRM 캐릭터에서 편집합니다.",
  lip: "입술 형태는 호환 morph가 있는 VRM 캐릭터에서만 안전하게 편집합니다.",
  ear: "귀 모양은 해당 메시·morph가 있는 VRM 캐릭터에서 편집합니다.",
  hair: "고품질 헤어는 VRM 캐릭터 조형의 시각 헤어 레시피에서 편집합니다.",
  top: "상의는 VRM 의상 슬롯과 스키닝 검증이 끝난 에셋만 적용합니다.",
  bottom: "하의는 VRM 의상 슬롯과 스키닝 검증이 끝난 에셋만 적용합니다.",
  shoes: "신발은 VRM 의상 슬롯에서 발 리그 호환성을 확인한 뒤 적용합니다.",
  accessories: "액세서리는 VRM 소품 부착점과 라이선스가 확인된 에셋만 적용합니다.",
});

function visualToken(category: ShaperPresetCategory, presetId: string): string {
  if (category === "face") {
    if (presetId.includes("round") || presetId.includes("chibi")) return "rounded-[45%]";
    if (presetId.includes("sharp")) return "[clip-path:polygon(18%_5%,82%_5%,96%_48%,50%_100%,4%_48%)]";
    if (presetId.includes("square")) return "rounded-lg";
    return "rounded-[48%_48%_44%_44%]";
  }
  if (category === "body") {
    if (presetId.includes("chibi")) return "h-10 w-8";
    if (presetId.includes("tall")) return "h-16 w-5";
    if (presetId.includes("muscular")) return "h-14 w-10";
    return "h-14 w-7";
  }
  return "";
}

function PresetPreview({
  category,
  presetId,
}: {
  readonly category: ShaperPresetCategory;
  readonly presetId: string;
}) {
  if (category === "face") {
    return (
      <span className={cn(
        "relative block h-14 w-11 border-2 border-current bg-[linear-gradient(145deg,oklch(0.92_0.03_65),oklch(0.78_0.06_55))]",
        visualToken(category, presetId),
      )}>
        <span className="absolute left-2 top-5 size-1.5 rounded-full bg-current" />
        <span className="absolute right-2 top-5 size-1.5 rounded-full bg-current" />
        <span className="absolute bottom-3 left-1/2 h-px w-3 -translate-x-1/2 bg-current" />
      </span>
    );
  }
  if (category === "eye") {
    const scale = presetId.includes("romance") ? "scale-110" : presetId.includes("action") ? "scale-y-75" : "";
    return (
      <span className={cn("flex items-center gap-2", scale)}>
        <span className="h-3 w-7 rounded-[50%] border-2 border-current"><span className="mx-auto mt-0.5 block size-1.5 rounded-full bg-current" /></span>
        <span className="h-3 w-7 rounded-[50%] border-2 border-current"><span className="mx-auto mt-0.5 block size-1.5 rounded-full bg-current" /></span>
      </span>
    );
  }
  if (category === "nose") {
    return (
      <span className={cn(
        "block border-b-2 border-r-2 border-current",
        presetId.includes("dot") ? "size-3 rounded-full border-2" : "h-9 w-4 skew-y-12",
      )} />
    );
  }
  if (category === "body") {
    return (
      <span className={cn("relative block rounded-t-full border-2 border-current bg-accent-soft", visualToken(category, presetId))}>
        <span className="absolute -left-2 top-3 h-8 w-1.5 rotate-6 rounded-full bg-current" />
        <span className="absolute -right-2 top-3 h-8 w-1.5 -rotate-6 rounded-full bg-current" />
        <span className="absolute -bottom-7 left-1 h-8 w-1.5 rounded-full bg-current" />
        <span className="absolute -bottom-7 right-1 h-8 w-1.5 rounded-full bg-current" />
      </span>
    );
  }
  if (category === "bodypose" || category === "handpose") {
    return (
      <span className="relative block h-16 w-16">
        <span className="absolute left-1/2 top-0 size-4 -translate-x-1/2 rounded-full border-2 border-current" />
        <span className={cn(
          "absolute left-1/2 top-4 h-8 w-0.5 -translate-x-1/2 bg-current",
          presetId.includes("run") || presetId.includes("sword") ? "rotate-12" : "",
        )} />
        <span className="absolute left-2 top-7 h-0.5 w-12 rotate-[-12deg] bg-current" />
        <span className="absolute bottom-0 left-4 h-0.5 w-8 rotate-[55deg] bg-current" />
        <span className="absolute bottom-0 right-4 h-0.5 w-8 rotate-[-55deg] bg-current" />
      </span>
    );
  }
  return <span className="grid size-14 place-items-center rounded-2xl border border-dashed border-line text-[0.58rem] text-fg-3">VRM</span>;
}

export function StudioShaperPanel({
  selection = DEFAULT_SHAPER_SELECTION,
  supportedCategories = DEFAULT_SUPPORTED_CATEGORIES,
  onSelectionChange,
  onExportPsd,
  onInsertCanvas,
  onTriggerPoseScanner,
  disabled = false,
  className,
}: StudioShaperPanelProps) {
  const supported = useMemo(() => new Set(supportedCategories), [supportedCategories]);
  const firstSupported = SHAPER_CATEGORIES.find((category) => supported.has(category.id))?.id ?? "face";
  const [activeTab, setActiveTab] = useState<ShaperSectionTab>("recipes");
  const [activeCategory, setActiveCategory] = useState<ShaperPresetCategory>(firstSupported);
  const [currentSelection, setCurrentSelection] = useState<ShaperPresetSelection>({
    ...DEFAULT_SHAPER_SELECTION,
    ...selection,
  });

  useEffect(() => {
    setCurrentSelection({ ...DEFAULT_SHAPER_SELECTION, ...selection });
  }, [selection]);

  useEffect(() => {
    if (!supported.has(activeCategory)) setActiveCategory(firstSupported);
  }, [activeCategory, firstSupported, supported]);

  const supportedCount = SHAPER_CATEGORIES.filter((category) => supported.has(category.id)).length;
  const unsupportedCategories = SHAPER_CATEGORIES.filter((category) => !supported.has(category.id));
  const activePresets = SHAPER_PRESETS.filter((preset) => preset.category === activeCategory);

  const commitSelection = (next: ShaperPresetSelection) => {
    setCurrentSelection(next);
    onSelectionChange?.(next);
  };

  const selectPreset = (category: ShaperPresetCategory, presetId: string) => {
    if (disabled || !supported.has(category)) return;
    commitSelection({ ...currentSelection, [category]: presetId });
  };

  const applyArchetype = (archetypeId: ShaperAiArchetype) => {
    if (disabled) return;
    const recommended = recommendShaperPreset(archetypeId);
    const next = { ...currentSelection };
    for (const category of supportedCategories) next[category] = recommended[category];
    commitSelection(next);
  };

  return (
    <section
      className={cn(
        "space-y-3 rounded-2xl border border-accent/25 bg-[linear-gradient(145deg,var(--color-card),color-mix(in_oklch,var(--color-accent)_6%,var(--color-panel)))] p-3 text-xs shadow-sm",
        className,
      )}
      aria-label="웹툰 캐릭터 셰이퍼"
    >
      <header className="space-y-2 border-b border-line/70 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-fg">
              <Wand2 size={15} className="text-accent" aria-hidden />
              웹툰 캐릭터 셰이퍼
            </h3>
            <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">
              현재 데생 인형이 실제로 지원하는 얼굴·체형·포즈만 즉시 적용합니다.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[0.58rem] font-extrabold text-accent">
            TOONSTUDIO
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-panel/60 p-2">
          <span className="rounded-lg bg-card px-2 py-1.5 text-[0.6rem] text-fg-3">
            즉시 적용 <b className="text-fg">{supportedCount}개 범주</b>
          </span>
          <span className="rounded-lg bg-card px-2 py-1.5 text-[0.6rem] text-fg-3">
            VRM 전용 <b className="text-fg">{unsupportedCategories.length}개 범주</b>
          </span>
        </div>
      </header>

      <div role="tablist" aria-label="캐릭터 셰이퍼 작업" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel/65 p-1">
        {SECTION_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cn(
              "min-h-11 rounded-lg border px-2 text-[0.62rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              activeTab === tab.id
                ? "border-accent/50 bg-accent-soft text-accent"
                : "border-transparent text-fg-3 hover:bg-raised hover:text-fg",
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "recipes" ? (
        <div role="tabpanel" aria-label="캐릭터 레시피" className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="tablist" aria-label="셰이퍼 범주">
            {SHAPER_CATEGORIES.map((category) => {
              const available = supported.has(category.id);
              const selected = activeCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-disabled={!available}
                  disabled={!available}
                  title={available ? category.description : VRM_ONLY_REASON[category.id] ?? "현재 데생 인형에서 지원하지 않습니다."}
                  className={cn(
                    "min-h-10 shrink-0 rounded-full border px-3 text-[0.6rem] font-bold transition-colors",
                    selected
                      ? "border-accent/60 bg-accent-soft text-accent"
                      : available
                        ? "border-line bg-card text-fg-2 hover:bg-raised"
                        : "cursor-not-allowed border-line/60 bg-panel/40 text-fg-3 opacity-45",
                  )}
                  onClick={() => {
                    if (available) setActiveCategory(category.id);
                  }}
                >
                  {category.label}
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-line/70 bg-panel/55 px-3 py-2">
            <p className="text-[0.66rem] font-bold text-fg-2">
              {SHAPER_CATEGORIES.find((category) => category.id === activeCategory)?.label}
            </p>
            <p className="mt-0.5 text-[0.58rem] leading-relaxed text-fg-3">
              {SHAPER_CATEGORIES.find((category) => category.id === activeCategory)?.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {activePresets.map((preset) => {
              const selected = currentSelection[activeCategory] === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  className={cn(
                    "min-h-[8.5rem] overflow-hidden rounded-xl border text-left transition-[border-color,background-color,transform] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40",
                    selected
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-2 hover:-translate-y-0.5 hover:bg-raised",
                  )}
                  onClick={() => selectPreset(activeCategory, preset.id)}
                >
                  <span className="grid h-[5.5rem] place-items-center border-b border-line/60 bg-panel/65">
                    <PresetPreview category={activeCategory} presetId={preset.id} />
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-2 text-[0.63rem] font-bold">
                    <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                    {selected ? <Check size={12} className="shrink-0 text-accent" aria-hidden /> : null}
                  </span>
                </button>
              );
            })}
          </div>

          <details className="rounded-xl border border-line bg-card/55 p-3">
            <summary className="min-h-9 cursor-pointer text-[0.63rem] font-bold text-fg-2">
              VRM 캐릭터에서 더 세밀하게 편집
            </summary>
            <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
              {unsupportedCategories.map((category) => (
                <p key={category.id} className="text-[0.58rem] leading-relaxed text-fg-3">
                  <b className="text-fg-2">{category.label}</b> · {VRM_ONLY_REASON[category.id] ?? "VRM 캐릭터 빌더에서 제공합니다."}
                </p>
              ))}
            </div>
          </details>
        </div>
      ) : null}

      {activeTab === "assist" ? (
        <div role="tabpanel" aria-label="추천과 포즈" className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-accent/25 bg-accent-soft/30 p-3">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <p className="text-[0.61rem] leading-relaxed text-fg-2">
              장르 레시피는 현재 인형이 실제로 지원하는 {supportedCount}개 범주만 바꿉니다. 의상·헤어를 적용한 것처럼 보이게 꾸미지 않습니다.
            </p>
          </div>
          <div className="space-y-2">
            {SHAPER_AI_ARCHETYPES.map((archetype) => (
              <button
                key={archetype.id}
                type="button"
                disabled={disabled}
                className="w-full rounded-xl border border-line bg-card p-3 text-left transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                onClick={() => applyArchetype(archetype.id)}
                aria-label={`${archetype.label} 지원 범주 적용`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[0.68rem] font-extrabold text-fg">{archetype.label}</span>
                  <span className="rounded-full border border-accent/25 bg-accent-soft px-2 py-0.5 text-[0.56rem] font-bold text-accent">
                    {supportedCount}개 적용
                  </span>
                </span>
                <span className="mt-1 block text-[0.59rem] leading-relaxed text-fg-3">{archetype.description}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={disabled || !onTriggerPoseScanner}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft px-3 text-[0.65rem] font-extrabold text-accent hover:bg-accent/15 disabled:opacity-40"
            onClick={onTriggerPoseScanner}
          >
            <ScanSearch size={14} aria-hidden />
            사진 위 랜드마크로 포즈 검수
          </button>
        </div>
      ) : null}

      {activeTab === "output" ? (
        <div role="tabpanel" aria-label="셰이퍼 출력" className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl border border-line bg-panel/55 p-3">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-good" aria-hidden />
            <p className="text-[0.61rem] leading-relaxed text-fg-2">
              캡처와 PSD는 현재 3D 장면에서 생성합니다. 콜백이 연결되지 않은 환경에서는 가짜 픽셀이나 빈 PSD를 만들지 않습니다.
            </p>
          </div>
          <button
            type="button"
            disabled={disabled || !onInsertCanvas}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-accent/50 bg-accent px-3 text-[0.66rem] font-extrabold text-on-accent hover:bg-accent/90 disabled:opacity-40"
            onClick={onInsertCanvas}
          >
            <ImagePlus size={14} aria-hidden />
            현재 장면을 캔버스에 추가
          </button>
          <button
            type="button"
            disabled={disabled || !onExportPsd}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.66rem] font-extrabold text-fg-2 hover:bg-raised disabled:opacity-40"
            onClick={onExportPsd}
          >
            <Layers size={14} aria-hidden />
            레이어드 PSD 내보내기
          </button>
          <div className="rounded-xl border border-dashed border-line bg-card/45 p-3 text-[0.59rem] leading-relaxed text-fg-3">
            <p className="flex items-center gap-1.5 font-bold text-fg-2">
              <Download size={12} aria-hidden />
              직접 표면 드로잉
            </p>
            <p className="mt-1">
              UV가 있는 VRM 캐릭터의 표면 탭에서 B 브러시, F ColorDrop, I 스포이드를 사용합니다. 데생 인형에는 존재하지 않는 UV 기능을 가짜 토글로 노출하지 않습니다.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
