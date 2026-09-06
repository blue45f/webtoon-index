/**
 * Brush engine mixer UI: stack diagnosis, portable trait imports, curated multi-source recipes,
 * watercolor programs and durable custom-brush saving.
 */
import {
  CheckCircle2,
  Download,
  Gauge,
  LoaderCircle,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";

import { resolveStudioBrushRenderFamily } from "../studio-brush";
import { STUDIO_FOCUS_RING, StudioSectionHeader } from "../studio-panel-ui";

import {
  STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS,
  STUDIO_BRUSH_MEDIA_LABELS,
} from "./studio-brush-catalog-core";
import { studioBrushDynamicsSettingsForBrushId } from "./studio-brush-dynamics";
import {
  analyzeStudioBrushMixQuality,
  applyStudioBrushMixRecipe,
  describeStudioBrushEngineStack,
  isStudioBrushMixTraitSectionId,
  mergeStudioBrushMixTraitSection,
  STUDIO_BRUSH_MIX_RECIPES,
  STUDIO_BRUSH_MIX_TRAIT_SECTIONS,
  stabilizeStudioBrushMixQuality,
  suggestStudioBrushMixName,
  type StudioBrushMixRecipeId,
  type StudioBrushMixTraitGroup,
} from "./studio-brush-engine-mix";
import {
  studioBrushWatercolorProgramSetFrom,
  type StudioBrushEngineProgramSet,
} from "./studio-brush-engine-program-set";
import {
  createBrush,
  type StudioBrushSnapshot,
} from "./studio-brush-library";
import {
  notifyStudioBrushLibraryChanged,
  openProductBrushLibraryRepository,
} from "./studio-brush-library-sqlite-repository";
import { materializeStudioBrushCatalogSelection } from "./studio-brush-selection";

import type { NormalizedStudioBrushDynamicsSettings } from "./studio-brush-dynamics";

import { cn } from "@/shared/lib/utils";

function MixerCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card/45 p-3">
      <h3 className="text-sm font-bold text-fg">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">{description}</p>
      ) : null}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

const COMPLEXITY_LABELS = {
  light: "경량",
  balanced: "균형",
  intensive: "고부하",
} as const;

export function StudioBrushEngineStackPanel({
  brushId,
  settings,
  enginePrograms,
}: {
  brushId: string;
  settings: NormalizedStudioBrushDynamicsSettings;
  enginePrograms?: StudioBrushEngineProgramSet | null;
}) {
  const entries = useMemo(
    () => describeStudioBrushEngineStack(brushId, settings, enginePrograms),
    [brushId, settings, enginePrograms],
  );
  const quality = useMemo(
    () => analyzeStudioBrushMixQuality(brushId, settings, enginePrograms),
    [brushId, settings, enginePrograms],
  );

  return (
    <MixerCard
      title="현재 엔진 구성"
      description="실제로 실행되는 캐리어·팁·재질·입력 매핑·물성 프로그램과 예상 비용입니다."
    >
      <ul className="flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={cn(
              "flex min-h-7 items-center gap-1 rounded-lg border px-2 py-1 text-[0.66rem] font-semibold",
              entry.active
                ? "border-accent/35 bg-accent-soft text-fg"
                : "border-line bg-raised text-fg-3",
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", entry.active ? "bg-accent" : "bg-fg-3")}
            />
            {entry.label}
          </li>
        ))}
      </ul>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-bg-2/55 px-2.5 py-2">
          <span className="flex items-center gap-1 text-[0.62rem] font-semibold text-fg-3">
            <Gauge size={12} aria-hidden /> 품질 안정도
          </span>
          <strong className="mt-1 block text-sm tabular-nums text-fg">{quality.qualityScore}/100</strong>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
            <span
              className="block h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${quality.qualityScore}%` }}
            />
          </span>
        </div>
        <div className="rounded-xl border border-line bg-bg-2/55 px-2.5 py-2">
          <span className="text-[0.62rem] font-semibold text-fg-3">조합 복잡도</span>
          <strong className="mt-1 block text-sm text-fg">
            {COMPLEXITY_LABELS[quality.complexityLevel]} · {quality.complexityScore}
          </strong>
          <span className="mt-0.5 block text-[0.62rem] text-fg-3">
            모듈 {quality.activeModuleCount}개 · 매핑 {quality.mappedInputCount}개
          </span>
        </div>
        <div className="rounded-xl border border-line bg-bg-2/55 px-2.5 py-2">
          <span className="text-[0.62rem] font-semibold text-fg-3">실시간 작업량</span>
          <strong className="mt-1 block text-sm tabular-nums text-fg">
            {quality.estimatedMarksPerDab} mark/dab
          </strong>
          <span className="mt-0.5 block text-[0.62rem] text-fg-3">
            실제 팁 샘플과 레이어를 반영한 추정치
          </span>
        </div>
      </div>

      {quality.issues.length > 0 ? (
        <ul className="mt-2 space-y-1.5" aria-label="브러시 품질 진단">
          {quality.issues.slice(0, 3).map((issue) => (
            <li
              key={issue.id}
              className={cn(
                "flex gap-2 rounded-lg border px-2.5 py-2 text-[0.65rem] leading-relaxed",
                issue.severity === "warning"
                  ? "border-warn/35 bg-warn/5 text-fg-2"
                  : "border-line bg-bg-2/45 text-fg-3",
              )}
            >
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>
                <strong className="block text-fg-2">{issue.title}</strong>
                {issue.description}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-[0.66rem] font-medium text-good">
          <CheckCircle2 size={13} aria-hidden /> 현재 조합에서 즉시 수정할 품질 위험이 없습니다.
        </p>
      )}
    </MixerCard>
  );
}

interface TraitImportProps {
  settings: NormalizedStudioBrushDynamicsSettings;
  onSettingsChange: (settings: NormalizedStudioBrushDynamicsSettings) => void;
}

type SourceItem = Pick<
  (typeof STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS)[number],
  "id" | "name" | "mediaGroup"
>;

const TRAIT_GROUP_LABELS: Readonly<Record<StudioBrushMixTraitGroup, string>> = {
  shape: "촉 구성",
  material: "재질",
  dynamics: "동적 반응",
  bundle: "묶음 적용",
};

export function StudioBrushTraitImportControls({ settings, onSettingsChange }: TraitImportProps) {
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<{ tone: "done" | "error"; message: string } | null>(null);
  const [previousSettings, setPreviousSettings] = useState<NormalizedStudioBrushDynamicsSettings | null>(null);
  const [applyingRecipeId, setApplyingRecipeId] = useState<StudioBrushMixRecipeId | null>(null);
  const [proItems, setProItems] = useState<readonly SourceItem[]>([]);

  useEffect(() => {
    let active = true;
    void import("./studio-brush-catalog")
      .then((catalog) => {
        if (!active) return;
        setProItems(
          catalog.STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS
            .filter((item) => item.source === "pro")
            .map((item) => ({ id: item.id, name: item.name, mediaGroup: item.mediaGroup })),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const allItems = useMemo(() => {
    const seen = new Set<string>();
    const result: SourceItem[] = [];
    const place = (item: SourceItem) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      result.push(item);
    };
    for (const item of STUDIO_LISTED_CORE_BRUSH_CATALOG_ITEMS) {
      if (item.operation === "paint") place(item);
    }
    for (const item of proItems) place(item);
    return result;
  }, [proItems]);

  const groupedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const groups = new Map<SourceItem["mediaGroup"], SourceItem[]>();
    for (const item of allItems) {
      const mediaLabel = STUDIO_BRUSH_MEDIA_LABELS[item.mediaGroup] ?? item.mediaGroup;
      const haystack = `${item.name} ${item.id} ${mediaLabel}`.toLocaleLowerCase("ko-KR");
      if (normalizedQuery && !haystack.includes(normalizedQuery)) continue;
      const bucket = groups.get(item.mediaGroup) ?? [];
      bucket.push(item);
      groups.set(item.mediaGroup, bucket);
    }
    return Array.from(groups.entries());
  }, [allItems, query]);

  const quality = useMemo(
    () => analyzeStudioBrushMixQuality("custom-mix", settings, null),
    [settings],
  );

  const sectionsByGroup = useMemo(() => {
    const groups = new Map<StudioBrushMixTraitGroup, typeof STUDIO_BRUSH_MIX_TRAIT_SECTIONS[number][]>();
    for (const section of STUDIO_BRUSH_MIX_TRAIT_SECTIONS) {
      const bucket = groups.get(section.group) ?? [];
      bucket.push(section);
      groups.set(section.group, bucket);
    }
    return groups;
  }, []);

  async function materializeSourceDynamics(sourceBrushId: string) {
    let sourceDynamics = studioBrushDynamicsSettingsForBrushId(sourceBrushId);
    if (sourceDynamics) return sourceDynamics;
    try {
      const selection = await materializeStudioBrushCatalogSelection(sourceBrushId);
      sourceDynamics = selection?.brushDynamics ?? null;
    } catch {
      sourceDynamics = null;
    }
    return sourceDynamics;
  }

  async function handleSectionImport(sectionId: string) {
    if (!isStudioBrushMixTraitSectionId(sectionId) || !sourceId) return;
    const sourceName = allItems.find((item) => item.id === sourceId)?.name ?? sourceId;
    let sourceDynamics = studioBrushDynamicsSettingsForBrushId(sourceId);
    if (!sourceDynamics) sourceDynamics = await materializeSourceDynamics(sourceId);
    if (!sourceDynamics) {
      setStatus({ tone: "error", message: `"${sourceName}" 브러시에서 특성을 가져오지 못했어요.` });
      return;
    }
    const sectionLabel = STUDIO_BRUSH_MIX_TRAIT_SECTIONS.find(
      (section) => section.id === sectionId,
    )?.label ?? sectionId;
    setPreviousSettings(settings);
    onSettingsChange(mergeStudioBrushMixTraitSection(sectionId, settings, sourceDynamics));
    setStatus({ tone: "done", message: `${sectionLabel} — "${sourceName}"에서 가져왔어요.` });
  }

  async function handleRecipeApply(recipeId: StudioBrushMixRecipeId) {
    const recipe = STUDIO_BRUSH_MIX_RECIPES.find((candidate) => candidate.id === recipeId);
    if (!recipe || applyingRecipeId) return;
    setApplyingRecipeId(recipeId);
    setStatus(null);
    try {
      const sourceIds = [...new Set(recipe.steps.map((step) => step.sourceBrushId))];
      const sources: Record<string, NormalizedStudioBrushDynamicsSettings | null> = {};
      for (const id of sourceIds) {
        sources[id] = await materializeSourceDynamics(id);
      }
      const result = applyStudioBrushMixRecipe(recipeId, settings, sources);
      if (result.appliedStepCount === 0) {
        setStatus({ tone: "error", message: `"${recipe.name}"에 필요한 브러시 재질을 불러오지 못했어요.` });
        return;
      }
      setPreviousSettings(settings);
      onSettingsChange(result.settings);
      setStatus({
        tone: result.missingSourceBrushIds.length > 0 ? "error" : "done",
        message: result.missingSourceBrushIds.length > 0
          ? `${recipe.name}: ${result.appliedStepCount}단계를 적용했고 ${result.missingSourceBrushIds.length}개 소스는 건너뛰었어요.`
          : `${recipe.name}: ${result.appliedStepCount}개 엔진 특성을 조합했어요.`,
      });
    } finally {
      setApplyingRecipeId(null);
    }
  }

  return (
    <MixerCard
      title="다른 브러시에서 엔진 특성 가져오기"
      description="캐리어와 재생 계약은 유지하고, 촉·재질·안료·반응을 섹션별 또는 다중 소스 레시피로 조합합니다."
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <label className="relative block">
          <span className="sr-only">브러시 소스 검색</span>
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
            aria-label="브러시 소스 검색"
            placeholder="이름·매체·ID 검색"
            className={cn(
              "h-11 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-xs text-fg placeholder:text-fg-3",
              STUDIO_FOCUS_RING,
            )}
          />
        </label>
        <label className="block">
          <span className="sr-only">소스 브러시</span>
          <select
            value={sourceId}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setSourceId(event.currentTarget.value);
              setStatus(null);
            }}
            aria-label="소스 브러시"
            className={cn(
              "h-11 w-full rounded-xl border border-line bg-card px-2.5 text-xs font-medium text-fg",
              STUDIO_FOCUS_RING,
            )}
          >
            <option value="">소스 브러시 선택…</option>
            {groupedItems.map(([mediaGroup, items]) => (
              <optgroup key={mediaGroup} label={STUDIO_BRUSH_MEDIA_LABELS[mediaGroup] ?? mediaGroup}>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 space-y-3">
        {(["shape", "material", "dynamics", "bundle"] as const).map((group) => (
          <div key={group}>
            <p className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-wide text-fg-3">
              {TRAIT_GROUP_LABELS[group]}
            </p>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {(sectionsByGroup.get(group) ?? []).map((section) => (
                <button
                  key={section.id}
                  type="button"
                  disabled={!sourceId}
                  title={section.description}
                  onClick={() => void handleSectionImport(section.id)}
                  className={cn(
                    "flex min-h-12 flex-col items-start justify-center rounded-xl border border-line bg-card px-2.5 py-1.5 text-left transition-colors hover:border-accent/45 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50",
                    STUDIO_FOCUS_RING,
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[0.7rem] font-bold text-fg">
                    <Download size={12} className="text-accent" aria-hidden />
                    {section.label}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[0.6rem] leading-relaxed text-fg-3">
                    {section.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-bold text-fg">
              <Sparkles size={13} className="text-accent" aria-hidden /> 다중 엔진 빠른 레시피
            </p>
            <p className="mt-0.5 text-[0.62rem] text-fg-3">
              서로 다른 매체의 검증된 특성을 순서대로 합성합니다.
            </p>
          </div>
          {previousSettings ? (
            <button
              type="button"
              onClick={() => {
                onSettingsChange(previousSettings);
                setPreviousSettings(null);
                setStatus({ tone: "done", message: "직전 엔진 조합으로 되돌렸어요." });
              }}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line px-2 text-[0.65rem] font-semibold text-fg-2 hover:bg-raised",
                STUDIO_FOCUS_RING,
              )}
            >
              <RotateCcw size={12} aria-hidden /> 직전 조합
            </button>
          ) : null}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {STUDIO_BRUSH_MIX_RECIPES.map((recipe) => {
            const applying = applyingRecipeId === recipe.id;
            return (
              <button
                key={recipe.id}
                type="button"
                disabled={applyingRecipeId !== null}
                onClick={() => void handleRecipeApply(recipe.id)}
                className={cn(
                  "rounded-xl border border-line bg-bg-2/45 p-2.5 text-left transition-colors hover:border-accent/45 hover:bg-raised disabled:cursor-wait disabled:opacity-60",
                  STUDIO_FOCUS_RING,
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong className="text-[0.7rem] text-fg">{recipe.name}</strong>
                  {applying ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : null}
                </span>
                <span className="mt-1 block text-[0.61rem] leading-relaxed text-fg-3">
                  {recipe.description}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {recipe.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-raised px-1.5 py-0.5 text-[0.56rem] font-semibold text-fg-3">
                      {tag}
                    </span>
                  ))}
                  <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[0.56rem] font-semibold text-accent">
                    {recipe.steps.length}단계
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {quality.issues.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            setPreviousSettings(settings);
            onSettingsChange(stabilizeStudioBrushMixQuality(settings));
            setStatus({
              tone: "done",
              message: `연속 획 품질 위험 ${quality.issues.length}건을 보수적으로 안정화했어요.`,
            });
          }}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent-soft/25 px-3 py-2.5 text-[0.68rem] font-bold text-accent transition-colors hover:bg-accent-soft/45",
            STUDIO_FOCUS_RING,
          )}
        >
          <Gauge size={13} aria-hidden /> 품질 자동 안정화
        </button>
      ) : null}

      {status ? (
        <p
          role="status"
          className={cn(
            "mt-3 flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[0.66rem] font-medium leading-relaxed",
            status.tone === "done"
              ? "border-good/30 bg-good/5 text-good"
              : "border-warn/35 bg-warn/5 text-warn",
          )}
        >
          {status.tone === "done"
            ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden />
            : <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />}
          {status.message}
        </p>
      ) : null}
    </MixerCard>
  );
}

interface SaveAsCustomProps {
  snapshot: StudioBrushSnapshot;
  baseBrushName: string;
}

export function StudioBrushSaveAsCustomControls({ snapshot, baseBrushName }: SaveAsCustomProps) {
  const [name, setName] = useState(() => suggestStudioBrushMixName(baseBrushName));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "done" | "error"; message: string } | null>(null);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const created = createBrush(name, snapshot);
      const product = await openProductBrushLibraryRepository();
      await product.repository.put(created);
      notifyStudioBrushLibraryChanged();
      setStatus({
        tone: "done",
        message: product.authority === "sqlite"
          ? `"${created.name}" 브러시를 내 브러시에 저장했어요.`
          : `"${created.name}" 브러시를 현재 세션에 보관했어요. 브라우저를 닫으면 사라지므로 필요하면 파일로 내보내 주세요.`,
      });
    } catch (caught) {
      setStatus({
        tone: "error",
        message: caught instanceof Error && caught.message
          ? `저장하지 못했어요: ${caught.message}`
          : "저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <MixerCard
      title="커스텀 브러시로 저장"
      description="캐리어·펜촉·질감·반응·엔진 프로그램과 레시피 결과를 하나의 재현 가능한 브러시로 저장합니다."
    >
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <input
          type="text"
          value={name}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value)}
          maxLength={40}
          aria-label="새 브러시 이름"
          placeholder="새 브러시 이름"
          className={cn(
            "h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-2.5 text-xs font-medium text-fg placeholder:text-fg-3",
            STUDIO_FOCUS_RING,
          )}
        />
        <button
          type="submit"
          disabled={saving}
          className={cn(
            "flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-accent bg-accent px-3.5 text-xs font-bold text-on-accent transition-colors hover:bg-accent-2 disabled:cursor-wait disabled:opacity-60",
            STUDIO_FOCUS_RING,
          )}
        >
          {saving
            ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
            : <Save size={14} aria-hidden />}
          {saving ? "저장 중" : "내 브러시에 저장"}
        </button>
      </form>
      {status ? (
        <p
          role="status"
          data-studio-brush-save-custom-status={status.tone}
          className={cn(
            "mt-2 text-[0.66rem] font-medium leading-relaxed",
            status.tone === "done" ? "text-good" : "text-warn",
          )}
        >
          {status.message}
        </p>
      ) : null}
    </MixerCard>
  );
}

export function StudioBrushComposerIntro() {
  return (
    <StudioSectionHeader
      title="엔진 믹서"
      description="캐리어 위에 촉·종이·안료·입력 반응·물성 프로그램을 조합하고, 품질과 실시간 비용을 확인한 뒤 커스텀 브러시로 저장합니다."
    />
  );
}

const STUDIO_WET_EDGE_BLOOM_PROGRAM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "edge-bloom": "에지 블룸 — 건조 링",
  "granulating-wash": "과립 워시 — 안료 침전",
  "fiber-feather": "파이버 페더 — 신묵 번짐",
  "chroma-halo": "크로마 헤일로 — 크로마토그래피",
});

const STUDIO_LIVING_INK_BAKE_PROGRAM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "sumi-flow-bake": "수묵 플로우 베이크",
  "fluid-feather-lite": "유체 페더 (가벼운 수채)",
});

const STUDIO_WATERCOLOR_PROGRAM_RECIPES = Object.freeze([
  { id: "lane", label: "레인 기본", bloom: "", bake: "" },
  { id: "edge", label: "건조 링", bloom: "edge-bloom", bake: "" },
  { id: "granular", label: "과립 침전", bloom: "granulating-wash", bake: "" },
  { id: "fiber", label: "생지 번짐", bloom: "fiber-feather", bake: "" },
  { id: "chroma", label: "크로마 후광", bloom: "chroma-halo", bake: "" },
  { id: "sumi", label: "수묵 정착", bloom: "", bake: "sumi-flow-bake" },
  { id: "fluid", label: "유체 페더", bloom: "", bake: "fluid-feather-lite" },
] as const);

export function StudioBrushWatercolorProgramControls({
  brushId,
  programSet,
  onChange,
}: {
  brushId: string;
  programSet: StudioBrushEngineProgramSet | null;
  onChange?: ((next: StudioBrushEngineProgramSet | null) => void) | undefined;
}) {
  if (resolveStudioBrushRenderFamily(brushId) !== "watercolor") return null;
  const current = programSet?.watercolor ?? null;
  const bloomId = current?.wetEdgeBloomProgramId ?? "";
  const bakeId = current?.livingInkBakeProgramId ?? "";
  const conflicting = Boolean(bloomId && bakeId);

  function emit(nextBloom: string, nextBake: string) {
    if (!onChange) return;
    if (!nextBloom && !nextBake) {
      onChange(null);
      return;
    }
    onChange(studioBrushWatercolorProgramSetFrom({
      ...(nextBloom ? { wetEdgeBloomProgramId: nextBloom } : {}),
      ...(nextBake ? { livingInkBakeProgramId: nextBake } : {}),
    }));
  }

  const renderSelect = (
    label: string,
    value: string,
    options: Readonly<Record<string, string>>,
    onPick: (next: string) => void,
    hint: string,
  ) => (
    <label className="block rounded-xl border border-line bg-card/55 px-3 py-2.5">
      <span className="text-xs font-semibold text-fg-2">{label}</span>
      <select
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onPick(event.currentTarget.value)}
        className={cn(
          "mt-1.5 h-10 w-full rounded-lg border border-line bg-card px-2 text-xs font-medium text-fg",
          STUDIO_FOCUS_RING,
        )}
      >
        <option value="">레인 기본값</option>
        {Object.entries(options).map(([id, text]) => (
          <option key={id} value={id}>{text}</option>
        ))}
      </select>
      <span className="mt-1 block text-[0.62rem] leading-relaxed text-fg-3">{hint}</span>
    </label>
  );

  return (
    <MixerCard
      title="수채 엔진 프로그램"
      description="블룸/과립/크로마토그래피와 마른 뒤 정착 베이크를 선택합니다. 두 물성 권위는 동시에 실행하지 않아 결과를 예측 가능하게 유지합니다."
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {STUDIO_WATERCOLOR_PROGRAM_RECIPES.map((recipe) => {
          const selected = bloomId === recipe.bloom && bakeId === recipe.bake;
          return (
            <button
              key={recipe.id}
              type="button"
              aria-pressed={selected}
              onClick={() => emit(recipe.bloom, recipe.bake)}
              className={cn(
                "min-h-9 rounded-lg border px-2 py-1 text-[0.62rem] font-semibold transition-colors",
                selected
                  ? "border-accent bg-accent-soft text-fg"
                  : "border-line bg-bg-2/45 text-fg-3 hover:bg-raised",
                STUDIO_FOCUS_RING,
              )}
            >
              {recipe.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {renderSelect(
          "웻엣지 블룸",
          bloomId,
          STUDIO_WET_EDGE_BLOOM_PROGRAM_LABELS,
          (next) => emit(next, next ? "" : bakeId),
          "블룸을 고르면 정착 베이크를 끄고 젖은 가장자리 물성 하나만 실행합니다.",
        )}
        {renderSelect(
          "정착 베이크 (드라이 후)",
          bakeId,
          STUDIO_LIVING_INK_BAKE_PROGRAM_LABELS,
          (next) => emit(next ? "" : bloomId, next),
          "베이크를 고르면 블룸을 끄고 마른 뒤의 모세관/번짐 프로그램만 실행합니다.",
        )}
      </div>
      {conflicting ? (
        <button
          type="button"
          onClick={() => emit(bloomId, "")}
          className={cn(
            "mt-2 flex w-full items-center gap-1.5 rounded-lg border border-warn/35 bg-warn/5 px-2.5 py-2 text-left text-[0.65rem] font-medium text-warn",
            STUDIO_FOCUS_RING,
          )}
        >
          <TriangleAlert size={13} aria-hidden /> 동시 저장된 두 프로그램을 블룸 하나로 정리
        </button>
      ) : null}
    </MixerCard>
  );
}
