/**
 * Oil/acrylic engine-program composer.
 *
 * The carrier always paints the base body. Three independently switchable physical passes then
 * create the complete 2^3 matrix: bristle motion, paint depletion and impasto relief. The editor
 * exposes both the literal paint order and every valid combination so artists can move from a
 * known recipe to detailed per-pass editing without losing preset byte identity.
 */
import { Gauge, Layers, RotateCcw, Sparkles } from "lucide-react";

import { resolveStudioBrushRenderFamily } from "../studio-brush";

import {
  STUDIO_BRUSH_OIL_PROGRAM_KEYS,
  STUDIO_OIL_PROGRAM_MATRIX_BRUSH_IDS,
  studioBrushEngineProgramSetFromOil,
  studioOilProgramSetForBrush,
  type StudioBrushEngineProgramSet,
  type StudioBrushOilProgramKey,
  type StudioBrushOilProgramSet,
} from "./studio-brush-engine-program-set";
import { studioBrushPresetById } from "./studio-draw-ux";

import { cn } from "@/shared/lib/utils";

/** Paint order is the carrier's actual execution order. */
const OIL_PROGRAM_ROWS: readonly {
  key: StudioBrushOilProgramKey;
  label: string;
  shortLabel: string;
  physical: string;
  cost: "낮음" | "중간";
}[] = [
  {
    key: "bristlePhysics",
    label: "붓털 물리",
    shortLabel: "강모",
    physical: "필압에 눌린 붓털이 벌어지고 다시 뭉치며 결의 경로 자체를 만듭니다.",
    cost: "중간",
  },
  {
    key: "bristleLoadDynamics",
    label: "물감 소모",
    shortLabel: "소모",
    physical: "획을 이어 갈수록 적재된 물감이 줄어 자연스러운 갈필과 재충전 리듬을 만듭니다.",
    cost: "낮음",
  },
  {
    key: "impastoRelief",
    label: "임파스토 릴리프",
    shortLabel: "두께",
    physical: "이미 쌓인 능선 위에 하이라이트와 그림자를 합성해 실제 물감 두께를 드러냅니다.",
    cost: "중간",
  },
];

const OIL_PRESET_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  "brush--bristle-physics": "유화 · 물리 강모 갈필",
  "brush--bristle-depletion": "갈필",
  "brush--impasto-relief": "임파스토 릴리프",
  "oil--filbert-ribbon": "유화 · 필버트 리본",
  "oil--impasto-ribbon": "유화 · 임파스토(소모 없음)",
  "brush--oil-lanes": "유화 · 기본 레인",
};

const OIL_PRESET_CANDIDATE_IDS: readonly string[] = [
  ...STUDIO_OIL_PROGRAM_MATRIX_BRUSH_IDS,
  "brush--oil-lanes",
];

interface OilCombinationRecipe {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly programs: StudioBrushOilProgramSet;
}

/** Every meaningful combination of the three independent oil programs. */
const OIL_COMBINATION_RECIPES: readonly OilCombinationRecipe[] = Object.freeze([
  {
    id: "body-only",
    name: "기본 본체",
    description: "매끈하고 빠른 평면 도포",
    programs: Object.freeze({
      bristlePhysics: false,
      bristleLoadDynamics: false,
      impastoRelief: false,
    }),
  },
  {
    id: "bristle-only",
    name: "부드러운 강모",
    description: "결이 벌어지는 깨끗한 리본",
    programs: Object.freeze({
      bristlePhysics: true,
      bristleLoadDynamics: false,
      impastoRelief: false,
    }),
  },
  {
    id: "depletion-only",
    name: "마른 획",
    description: "진행할수록 끊기는 갈필",
    programs: Object.freeze({
      bristlePhysics: false,
      bristleLoadDynamics: true,
      impastoRelief: false,
    }),
  },
  {
    id: "relief-only",
    name: "두꺼운 능선",
    description: "평면 경로 위의 입체 표면",
    programs: Object.freeze({
      bristlePhysics: false,
      bristleLoadDynamics: false,
      impastoRelief: true,
    }),
  },
  {
    id: "natural-bristle",
    name: "자연 강모",
    description: "벌어짐과 소모가 함께 변화",
    programs: Object.freeze({
      bristlePhysics: true,
      bristleLoadDynamics: true,
      impastoRelief: false,
    }),
  },
  {
    id: "bristle-relief",
    name: "강모 임파스토",
    description: "움직이는 결 위에 두께 표현",
    programs: Object.freeze({
      bristlePhysics: true,
      bristleLoadDynamics: false,
      impastoRelief: true,
    }),
  },
  {
    id: "dry-relief",
    name: "건조 임파스토",
    description: "갈필과 능선의 강한 대비",
    programs: Object.freeze({
      bristlePhysics: false,
      bristleLoadDynamics: true,
      impastoRelief: true,
    }),
  },
  {
    id: "full-physics",
    name: "풀 피직스",
    description: "강모·소모·두께를 모두 사용",
    programs: Object.freeze({
      bristlePhysics: true,
      bristleLoadDynamics: true,
      impastoRelief: true,
    }),
  },
]);

function oilPresetName(id: string): string | null {
  return OIL_PRESET_NAME_OVERRIDES[id] ?? studioBrushPresetById(id)?.name ?? null;
}

function oilProgramsEqual(
  left: StudioBrushOilProgramSet,
  right: StudioBrushOilProgramSet,
): boolean {
  return STUDIO_BRUSH_OIL_PROGRAM_KEYS.every((key) => left[key] === right[key]);
}

function matchingPresetName(programs: StudioBrushOilProgramSet, brushId: string): string | null {
  for (const id of [brushId, ...OIL_PRESET_CANDIDATE_IDS]) {
    const name = oilPresetName(id);
    if (!name) continue;
    if (oilProgramsEqual(studioOilProgramSetForBrush(id), programs)) return name;
  }
  return null;
}

function combinationComplexity(activeCount: number): {
  label: "경량" | "균형" | "고품질";
  description: string;
} {
  if (activeCount <= 0) {
    return { label: "경량", description: "본체 패스만 실행" };
  }
  if (activeCount <= 2) {
    return { label: "균형", description: `${activeCount + 1}개 패스를 순차 실행` };
  }
  return { label: "고품질", description: "4개 패스를 모두 실행" };
}

export interface StudioBrushEngineProgramControlsProps {
  brushId: string;
  /** Stroke/custom-brush override. Absence means the id-derived baseline. */
  programSet: StudioBrushEngineProgramSet | null | undefined;
  onChange: (next: StudioBrushEngineProgramSet | null) => void;
}

export function StudioBrushEngineProgramControls({
  brushId,
  programSet,
  onChange,
}: StudioBrushEngineProgramControlsProps) {
  const family = resolveStudioBrushRenderFamily(brushId);
  if (family !== "oil") {
    return (
      <div
        className="rounded-xl border border-line bg-bg-2/60 p-4 text-xs leading-relaxed text-fg-2"
        role="status"
        aria-live="polite"
      >
        <p className="font-semibold text-fg">이 브러시는 아직 조합할 엔진이 없습니다</p>
        <p className="mt-1 text-pretty text-fg-3">
          이 패널의 물리 패스 매트릭스는 유화·아크릴 캐리어에서 동작합니다. 다른 계열은 위의
          재질·동적 특성 믹서와 해당 매체 프로그램 카드로 조합할 수 있습니다.
        </p>
      </div>
    );
  }

  const baseline = studioOilProgramSetForBrush(brushId);
  const current = programSet?.oil ?? baseline;
  const changed = !oilProgramsEqual(current, baseline);
  const presetName = matchingPresetName(current, brushId);
  const activeCount = STUDIO_BRUSH_OIL_PROGRAM_KEYS.filter((key) => current[key]).length;
  const complexity = combinationComplexity(activeCount);

  function emit(next: StudioBrushOilProgramSet) {
    onChange(
      oilProgramsEqual(next, baseline)
        ? null
        : studioBrushEngineProgramSetFromOil(next),
    );
  }

  function toggle(key: StudioBrushOilProgramKey) {
    emit({ ...current, [key]: !current[key] });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 rounded-xl border border-line bg-bg-2/60 px-3 py-2.5">
        <Layers aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-3" />
        <div className="min-w-0 text-xs leading-relaxed">
          <p className="font-semibold text-fg">
            {presetName ? `${presetName}와 같은 조합` : "커스텀 조합"}
          </p>
          <p className="mt-0.5 text-pretty text-fg-3">
            아래 순서대로 칠해집니다. 켠 패스 {activeCount}개
            {presetName ? "" : " — 이 조합과 같은 프리셋은 없습니다"}
          </p>
        </div>
        {changed ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-fg-2 transition hover:bg-bg-3"
          >
            <RotateCcw aria-hidden className="size-3" />
            프리셋으로
          </button>
        ) : null}
      </div>

      <section className="rounded-xl border border-line bg-card/45 p-3" aria-labelledby="oil-matrix-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="oil-matrix-heading" className="flex items-center gap-1.5 text-xs font-bold text-fg">
              <Sparkles aria-hidden className="size-3.5 text-accent" />
              8가지 물리 조합
            </h3>
            <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">
              세 프로그램의 모든 조합을 한 번에 비교하고 시작점으로 적용합니다.
            </p>
          </div>
          <span className="rounded-lg border border-line bg-raised px-2 py-1 text-[0.65rem] font-semibold text-fg-2">
            2³ 조합
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {OIL_COMBINATION_RECIPES.map((recipe) => {
            const selected = oilProgramsEqual(current, recipe.programs);
            return (
              <button
                key={recipe.id}
                type="button"
                aria-pressed={selected}
                onClick={() => emit(recipe.programs)}
                className={cn(
                  "min-h-20 rounded-xl border px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "border-accent/55 bg-accent-soft/35"
                    : "border-line bg-card hover:border-line-strong hover:bg-raised",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[0.7rem] font-bold text-fg">{recipe.name}</span>
                  <span className="text-[0.6rem] tabular-nums text-fg-3">
                    {STUDIO_BRUSH_OIL_PROGRAM_KEYS.filter((key) => recipe.programs[key]).length}/3
                  </span>
                </span>
                <span className="mt-0.5 block text-[0.61rem] leading-relaxed text-fg-3">
                  {recipe.description}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1" aria-hidden>
                  {OIL_PROGRAM_ROWS.map((row) => (
                    <span
                      key={row.key}
                      className={cn(
                        "rounded px-1 py-px text-[0.56rem] font-semibold",
                        recipe.programs[row.key]
                          ? "bg-accent-soft text-accent"
                          : "bg-bg-2 text-fg-4",
                      )}
                    >
                      {row.shortLabel}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card/45 px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-fg-2">
          <Gauge aria-hidden className="size-3.5 text-accent" />
          실행 복잡도
        </span>
        <span className="text-right">
          <span className="block text-[0.68rem] font-bold text-fg">{complexity.label}</span>
          <span className="block text-[0.6rem] text-fg-3">{complexity.description}</span>
        </span>
      </div>

      <ol className="flex flex-col gap-2">
        <li className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-3">
          <span className="tabular-nums text-fg-4">1</span>
          <span className="font-medium text-fg-2">물감 본체</span>
          <span className="text-fg-4">항상 칠해집니다</span>
        </li>
        {OIL_PROGRAM_ROWS.map((row, index) => {
          const on = current[row.key];
          const differs = current[row.key] !== baseline[row.key];
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => toggle(row.key)}
                aria-pressed={on}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition",
                  on
                    ? "border-accent/45 bg-accent-soft/25"
                    : "border-line bg-bg-2/40 hover:bg-bg-3/60",
                )}
              >
                <span className="mt-0.5 tabular-nums text-[11px] text-fg-4">{index + 2}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn("text-xs font-semibold", on ? "text-fg" : "text-fg-3")}>
                      {row.label}
                    </span>
                    {differs ? (
                      <span className="rounded bg-accent-soft px-1 py-px text-[10px] font-medium text-accent">
                        변경됨
                      </span>
                    ) : null}
                    <span className="rounded bg-bg-2 px-1 py-px text-[10px] font-medium text-fg-4">
                      비용 {row.cost}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-pretty text-[11px] leading-relaxed text-fg-3">
                    {row.physical}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 h-4 w-7 shrink-0 rounded-full border transition",
                    on ? "border-accent bg-accent" : "border-line bg-bg-3",
                  )}
                >
                  <span
                    className={cn(
                      "block size-3 translate-y-px rounded-full bg-bg transition",
                      on ? "translate-x-3.5" : "translate-x-0.5",
                    )}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
