/**
 * Which engine programs a brush runs, as data that travels with the brush.
 *
 * Every program combination in the product is a literal `case brushId`: `studioOilRibbonProgramsForBrush`
 * switches on the id, the engine-lane tables are keyed by the id, the alias profiles are keyed by
 * the id. That is fine for a shipped preset and fatal for a user brush, because a saved brush
 * persists only `brushId` plus scalars plus `brushDynamics` — the programs are RE-DERIVED from the
 * id at paint time. An artist who wants the filbert's splay with impasto ridges on top has no way
 * to express it and no way to save it: there is no id for that brush, so there is no case for it.
 *
 * This module is the seam that fixes that. A program set is a small, versioned, validated record
 * that says which programs to run, independent of any id. When an element or a saved brush carries
 * one, it WINS over the id-derived baseline; when it does not, the baseline is used unchanged and
 * every shipped preset keeps a byte-identical plan.
 *
 * It deliberately starts with the oil carrier. That is the one engine whose planner already takes a
 * multi-program options object and already runs two programs at once for `oil--impasto-ribbon`, so
 * the composition it expresses is real at paint time today rather than aspirational. Other engine
 * families join by adding a key here and reading it in their resolver — the shape is designed for
 * that, which is why the oil programs sit under an `oil` key rather than at the top level.
 */

import type { StudioOilRibbonCarrierOptions } from "./studio-oil-ribbon-carrier";

export const STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION = 1 as const;

/**
 * The oil/acrylic carrier's three programs.
 *
 * All three are independent and all eight combinations are meaningful, which is exactly why an id
 * switch is the wrong shape for them:
 * - `bristlePhysics`      the WetBrush-2D tuft sim drives lane offsets, splay and clump-split
 * - `bristleLoadDynamics` the film depletes as the stroke travels (갈필)
 * - `impastoRelief`       standing ridges get a GGX highlight/shadow overlay
 */
export interface StudioBrushOilProgramSet {
  readonly bristlePhysics: boolean;
  readonly bristleLoadDynamics: boolean;
  readonly impastoRelief: boolean;
}

/**
 * 수채 웻 텍스처 프로그램 — 레인 정적 테이블이 id 로 고정하던 wet-edge-bloom / living-ink settled
 * bake 핀을 커스텀 조합이 덮어쓸 수 있게 하는 키. 값은 출하된 프로그램 레지스트리의 id 이고,
 * 소비 시점(`applyStudioBrushAliasWatercolorMaterial`)의 리졸버가 모르는 id 는 null 로 실패
 * 닫힘한다 — 여기서는 형식만 검증하고 존재 여부는 소비자가 단일 권위로 판정한다.
 */
export interface StudioBrushWatercolorProgramSet {
  readonly wetEdgeBloomProgramId?: string;
  readonly livingInkBakeProgramId?: string;
}

export interface StudioBrushEngineProgramSet {
  readonly version: typeof STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION;
  readonly oil?: StudioBrushOilProgramSet;
  readonly watercolor?: StudioBrushWatercolorProgramSet;
}

export const STUDIO_BRUSH_OIL_PROGRAM_KEYS = Object.freeze([
  "bristlePhysics",
  "bristleLoadDynamics",
  "impastoRelief",
] as const);

export type StudioBrushOilProgramKey = (typeof STUDIO_BRUSH_OIL_PROGRAM_KEYS)[number];

/**
 * Every brush id the oil program matrix names — the case labels of `studioOilProgramSetForBrush`
 * below and of `studioOilRibbonProgramsForBrush` in the carrier, restated as data. Consumers that
 * walk the matrix (the byte-identity contract test, the engine editor's "same as preset" lookup)
 * read this instead of keeping a private copy: the last private copies missed the rows added on
 * 2026-08-20 for two weeks. The contract test proves every entry here is a real matrix row, so a
 * typo fails a test instead of silently matching nothing.
 *
 * Only ids that ship are listed. The four `fluid-paint*` ids (registered in no catalog, so no
 * picker could offer them) and the two `oil--fluid-paint-*` alias rows that nothing produced were
 * dropped on 2026-09-02.
 */
export const STUDIO_OIL_PROGRAM_MATRIX_BRUSH_IDS = Object.freeze([
  // single- and two-mechanism showcase lanes
  "brush--bristle-physics",
  "brush--bristle-depletion",
  "brush--impasto-relief",
  "oil--filbert-ribbon",
  "oil--impasto-ribbon",
  // the general-purpose oils — all three programs (2026-08-20)
  "oil",
  "acrylic",
] as const);

const EMPTY_OIL_PROGRAMS: StudioBrushOilProgramSet = Object.freeze({
  bristlePhysics: false,
  bristleLoadDynamics: false,
  impastoRelief: false,
});

/**
 * The id-derived baseline, expressed as a program set.
 *
 * The switch below is deliberately the SAME matrix `studioOilRibbonProgramsForBrush` has always
 * applied, restated as data. Keeping one authority for it is the point: the editor needs to show an
 * artist what a preset already does before they change it, and a second copy of the matrix would
 * drift the moment either side was retuned.
 */
export function studioOilProgramSetForBrush(brush: string): StudioBrushOilProgramSet {
  switch (brush) {
    case "brush--bristle-physics":
      return Object.freeze({
        bristlePhysics: true,
        bristleLoadDynamics: true,
        impastoRelief: false,
      });
    case "brush--bristle-depletion":
      return Object.freeze({
        bristlePhysics: false,
        bristleLoadDynamics: true,
        impastoRelief: false,
      });
    case "brush--impasto-relief":
      return Object.freeze({
        bristlePhysics: false,
        bristleLoadDynamics: false,
        impastoRelief: true,
      });
    case "oil--filbert-ribbon":
      return Object.freeze({
        bristlePhysics: true,
        bristleLoadDynamics: false,
        impastoRelief: false,
      });
    case "oil--impasto-ribbon":
      return Object.freeze({
        bristlePhysics: true,
        bristleLoadDynamics: false,
        impastoRelief: true,
      });
    case "oil":
    case "acrylic":
      return Object.freeze({
        bristlePhysics: true,
        bristleLoadDynamics: true,
        impastoRelief: true,
      });
    default:
      return EMPTY_OIL_PROGRAMS;
  }
}

/**
 * Program set → the carrier's option object.
 *
 * Returns `undefined` rather than an object full of disabled flags when nothing is on, because the
 * carrier's byte-identity contract is written against an ABSENT options object: a plan built with
 * `{ bristlePhysics: { enabled: false } }` must be structurally identical to one built with nothing
 * at all, and the cheapest way to guarantee that is to never construct the former.
 */
export function studioOilRibbonProgramsFromSet(
  programs: StudioBrushOilProgramSet,
  seed: number,
): StudioOilRibbonCarrierOptions | undefined {
  const options: {
    bristlePhysics?: { enabled: true; seed: number };
    bristleLoadDynamics?: { enabled: true; seed: number };
    impastoRelief?: { enabled: true };
  } = {};
  if (programs.bristlePhysics) options.bristlePhysics = { enabled: true, seed };
  if (programs.bristleLoadDynamics) options.bristleLoadDynamics = { enabled: true, seed };
  if (programs.impastoRelief) options.impastoRelief = { enabled: true };
  return Object.keys(options).length === 0 ? undefined : options;
}

function readBoolean(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

/** 프로그램 id 는 출하 레지스트리 키와 같은 소문자 케백 형식으로만 저장된다. */
function readProgramId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[a-z0-9][a-z0-9-]{0,63}$/u.test(trimmed) ? trimmed : undefined;
}

/**
 * Validate an untrusted program set — persisted documents, imported brush files, collaboration
 * payloads. Anything that is not a recognised, well-formed set resolves to `null`, which every
 * caller reads as "use the id-derived baseline". Failing closed matters here: a malformed set that
 * silently enabled a program would change a saved stroke's appearance on reopen.
 */
export function normalizeStudioBrushEngineProgramSet(
  raw: unknown,
): StudioBrushEngineProgramSet | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (source.version !== STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION) return null;
  const oilSource = source.oil;
  let watercolor: StudioBrushWatercolorProgramSet | undefined;
  const watercolorSource = source.watercolor;
  if (typeof watercolorSource === "object" && watercolorSource !== null) {
    const record = watercolorSource as Record<string, unknown>;
    const wetEdgeBloomProgramId = readProgramId(record.wetEdgeBloomProgramId);
    const livingInkBakeProgramId = readProgramId(record.livingInkBakeProgramId);
    if (wetEdgeBloomProgramId || livingInkBakeProgramId) {
      watercolor = Object.freeze({
        ...(wetEdgeBloomProgramId ? { wetEdgeBloomProgramId } : {}),
        ...(livingInkBakeProgramId ? { livingInkBakeProgramId } : {}),
      });
    }
  }
  if (typeof oilSource !== "object" || oilSource === null) {
    return Object.freeze({
      version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
      ...(watercolor ? { watercolor } : {}),
    });
  }
  const oilRecord = oilSource as Record<string, unknown>;
  return Object.freeze({
    version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
    oil: Object.freeze({
      bristlePhysics: readBoolean(oilRecord, "bristlePhysics"),
      bristleLoadDynamics: readBoolean(oilRecord, "bristleLoadDynamics"),
      impastoRelief: readBoolean(oilRecord, "impastoRelief"),
    }),
    ...(watercolor ? { watercolor } : {}),
  });
}

/** True when the set would paint exactly what this brush's id already paints. */
export function studioBrushEngineProgramSetMatchesBrush(
  brush: string,
  set: StudioBrushEngineProgramSet | null | undefined,
): boolean {
  // 수채 오버라이드는 레인 베이스라인과의 비교가 브러시 id → 레인 행 해석을 필요로 한다. 여기서
  // 레인 카탈로그를 당겨 오는 대신, 수채 키가 실린 세트는 보수적으로 "커스텀 조합"으로 읽는다.
  // 이 판정은 편집기 안내 문구 전용이고 실제 페인트 경로와 무관하다.
  if (set?.watercolor) return false;
  if (!set?.oil) return true;
  const baseline = studioOilProgramSetForBrush(brush);
  return STUDIO_BRUSH_OIL_PROGRAM_KEYS.every((key) => set.oil![key] === baseline[key]);
}

export function studioBrushEngineProgramSetFromOil(
  oil: StudioBrushOilProgramSet,
): StudioBrushEngineProgramSet {
  return Object.freeze({
    version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
    oil: Object.freeze({ ...oil }),
  });
}

export function studioBrushWatercolorProgramSetFrom(
  watercolor: StudioBrushWatercolorProgramSet,
): StudioBrushEngineProgramSet {
  return Object.freeze({
    version: STUDIO_BRUSH_ENGINE_PROGRAM_SET_VERSION,
    watercolor: Object.freeze({ ...watercolor }),
  });
}
