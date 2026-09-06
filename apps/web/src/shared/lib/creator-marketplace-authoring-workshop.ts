/**
 * Rich authoring envelope used by the Creator Marketplace workshop.
 *
 * The envelope lives inside the marketplace package manifest so older API clients can continue
 * to transport the package while newer Studio builds retain the exact editable recipe.
 */

export const CREATOR_MARKETPLACE_AUTHORING_SCHEMA_VERSION = 2 as const;
export const CREATOR_MARKETPLACE_AUTHORING_STORAGE_KEY =
  "toonspectrum:creator-marketplace-authoring:v2";
export const CREATOR_MARKETPLACE_AUTHORING_HANDOFF_KEY =
  "toonspectrum:creator-marketplace-handoff:v2";
export const CREATOR_MARKETPLACE_AUTHORING_EVENT =
  "toonspectrum:creator-marketplace-authoring-change";

export const CREATOR_MARKETPLACE_AUTHORING_KINDS = [
  "brush",
  "tone",
  "palette",
  "pose",
  "3d",
  "background",
  "bubble",
  "template",
  "material",
] as const;
export type CreatorMarketplaceAuthoringKind =
  (typeof CREATOR_MARKETPLACE_AUTHORING_KINDS)[number];

export const CREATOR_MARKETPLACE_REQUIRED_QUALITY_SCENARIOS: Readonly<
  Record<CreatorMarketplaceAuthoringKind, readonly string[]>
> = {
  brush: ["brush-fast-slow", "brush-pressure", "brush-crossing"],
  tone: ["tone-seam", "tone-dpi"],
  palette: ["palette-space", "palette-contrast"],
  pose: ["pose-rig", "pose-mirror"],
  "3d": ["3d-scale", "3d-material", "3d-lod"],
  background: ["background-scroll", "background-perspective"],
  bubble: ["bubble-fit", "bubble-vertical"],
  template: ["template-pages", "template-fonts"],
  material: ["material-install", "material-dependencies"],
};

export const CREATOR_MARKETPLACE_BRUSH_ENGINES = [
  "solid-path",
  "vector-outline",
  "dab-stamp",
  "image-tip",
  "procedural-sdf-tip",
  "dry-media",
  "particle-scatter",
  "wet-media",
  "watercolor-diffusion",
  "oil-impasto",
  "living-ink",
  "dual-brush",
  "smudge",
  "eraser",
  "texture-relief",
  "glow",
  "post-process",
] as const;
export type CreatorMarketplaceBrushEngineKind =
  (typeof CREATOR_MARKETPLACE_BRUSH_ENGINES)[number];

export const CREATOR_MARKETPLACE_BRUSH_CHANNELS = [
  "pressure",
  "velocity",
  "direction",
  "tilt-x",
  "tilt-y",
  "tilt-magnitude",
  "twist",
  "distance",
  "time",
  "random",
] as const;
export type CreatorMarketplaceBrushInputChannel =
  (typeof CREATOR_MARKETPLACE_BRUSH_CHANNELS)[number];

export const CREATOR_MARKETPLACE_BRUSH_TARGETS = [
  "size",
  "opacity",
  "flow",
  "spacing",
  "angle",
  "scatter",
  "roundness",
  "hardness",
  "color-hue",
  "color-saturation",
  "color-lightness",
  "wetness",
  "mix",
  "relief",
  "particle-count",
] as const;
export type CreatorMarketplaceBrushTarget =
  (typeof CREATOR_MARKETPLACE_BRUSH_TARGETS)[number];

export const CREATOR_MARKETPLACE_BRUSH_BLEND_OPERATORS = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "add",
  "subtract",
  "darken",
  "lighten",
  "max-alpha",
  "min-alpha",
  "mask",
  "interleave",
] as const;
export type CreatorMarketplaceBrushBlendOperator =
  (typeof CREATOR_MARKETPLACE_BRUSH_BLEND_OPERATORS)[number];

export interface CreatorMarketplaceBrushChannelMapping {
  id: string;
  channel: CreatorMarketplaceBrushInputChannel;
  target: CreatorMarketplaceBrushTarget;
  enabled: boolean;
  min: number;
  max: number;
  invert: boolean;
  curve: readonly number[];
}

export interface CreatorMarketplaceBrushTipLayer {
  id: string;
  name: string;
  source: "shape" | "image" | "procedural" | "studio-snapshot";
  blend: CreatorMarketplaceBrushBlendOperator;
  opacity: number;
  scale: number;
  rotationDeg: number;
  spacing: number;
  scatter: number;
  textureAssetId?: string;
  sourcePayload?: unknown;
}

export interface CreatorMarketplaceBrushEngineNode {
  id: string;
  name: string;
  engine: CreatorMarketplaceBrushEngineKind;
  enabled: boolean;
  blend: CreatorMarketplaceBrushBlendOperator;
  backend: "portable" | "canvas2d" | "webgl2" | "webgpu" | "wasm";
  parameters: Readonly<Record<string, number | string | boolean>>;
  mappings: readonly CreatorMarketplaceBrushChannelMapping[];
  tipLayers: readonly CreatorMarketplaceBrushTipLayer[];
  /** Exact native Studio program. Never replace this with the normalized representation. */
  sourceProgram?: unknown;
}

export interface CreatorMarketplaceAuthoringCompatibility {
  canvas2d: boolean;
  webgl2: boolean;
  webgpu: boolean;
  wasm: boolean;
  touch: boolean;
  stylus: boolean;
  mouse: boolean;
  minAppVersion: string;
  testedBrowsers: readonly string[];
  notes: string;
}

export interface CreatorMarketplaceAuthoringMediaItem {
  id: string;
  kind: "cover" | "image" | "stroke-sheet" | "video" | "turntable" | "before-after";
  name: string;
  url?: string;
  alt: string;
  scenario?: string;
}

export interface CreatorMarketplaceAuthoringBundleItem {
  id: string;
  kind: CreatorMarketplaceAuthoringKind | "font" | "texture" | "reference" | "other";
  name: string;
  required: boolean;
  marketplaceResourceId?: string;
  versionRange?: string;
  role: string;
}

export interface CreatorMarketplaceAuthoringRelease {
  mode: "new" | "update";
  version: string;
  previousResourceId?: string;
  changelog: string;
  migrationNotes: string;
  breaking: boolean;
}

export interface CreatorMarketplaceAuthoringRights {
  license: string;
  commercialUse: boolean;
  redistribution: boolean;
  aiTrainingAllowed: boolean;
  containsThirdPartyContent: boolean;
  thirdPartyAttribution: string;
  originalWorkAttested: boolean;
  previewRightsAttested: boolean;
}

export interface CreatorMarketplaceAuthoringDraft {
  schemaVersion: typeof CREATOR_MARKETPLACE_AUTHORING_SCHEMA_VERSION;
  id: string;
  resumeToken: string;
  createdAt: string;
  updatedAt: string;
  kind: CreatorMarketplaceAuthoringKind;
  title: string;
  summary: string;
  description: string;
  tags: readonly string[];
  source: {
    mode: "blank" | "brush-studio" | "studio-project" | "file" | "marketplace-update";
    name: string;
    fileName?: string;
    sourceResourceId?: string;
    studioSnapshot?: unknown;
  };
  brush: {
    engineNodes: readonly CreatorMarketplaceBrushEngineNode[];
    /** Native Brush Studio programs retained byte-for-byte in the authoring manifest. */
    originalEnginePrograms: readonly unknown[];
    originalSnapshot?: unknown;
    deterministicSeed: number;
    presetFamily: string;
    intendedUse: readonly string[];
  };
  technical: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  compatibility: CreatorMarketplaceAuthoringCompatibility;
  media: readonly CreatorMarketplaceAuthoringMediaItem[];
  bundle: readonly CreatorMarketplaceAuthoringBundleItem[];
  release: CreatorMarketplaceAuthoringRelease;
  rights: CreatorMarketplaceAuthoringRights;
  reviewNotes: string;
  completedSteps: readonly string[];
}

export interface CreatorMarketplaceAuthoringDiagnostic {
  id: string;
  severity: "error" | "warning" | "info";
  step: "source" | "recipe" | "preview" | "bundle" | "compatibility" | "rights" | "release";
  message: string;
  action: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const entropy = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${entropy.slice(0, 20)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createCreatorMarketplaceBrushEngineNode(
  engine: CreatorMarketplaceBrushEngineKind,
): CreatorMarketplaceBrushEngineNode {
  return {
    id: makeId("engine"),
    name: engine.replaceAll("-", " "),
    engine,
    enabled: true,
    blend: engine === "dual-brush" ? "multiply" : "normal",
    backend: engine === "glow" || engine === "particle-scatter" ? "webgl2" : "portable",
    parameters: {
      size: 24,
      opacity: 1,
      flow: 1,
      spacing: engine === "solid-path" ? 0.04 : 0.16,
      scatter: engine === "particle-scatter" ? 0.42 : 0,
      jitter: 0,
    },
    mappings: [
      {
        id: makeId("mapping"),
        channel: "pressure",
        target: "size",
        enabled: true,
        min: 0.12,
        max: 1,
        invert: false,
        curve: [0, 0.12, 0.35, 0.58, 0.78, 1],
      },
      {
        id: makeId("mapping"),
        channel: "pressure",
        target: "opacity",
        enabled: true,
        min: 0.18,
        max: 1,
        invert: false,
        curve: [0, 0.2, 0.42, 0.66, 0.84, 1],
      },
    ],
    tipLayers: [
      {
        id: makeId("tip"),
        name: "Primary tip",
        source: "shape",
        blend: "normal",
        opacity: 1,
        scale: 1,
        rotationDeg: 0,
        spacing: 0.16,
        scatter: 0,
      },
    ],
  };
}

export function createCreatorMarketplaceAuthoringDraft(
  kind: CreatorMarketplaceAuthoringKind = "brush",
): CreatorMarketplaceAuthoringDraft {
  const timestamp = nowIso();
  return {
    schemaVersion: CREATOR_MARKETPLACE_AUTHORING_SCHEMA_VERSION,
    id: makeId("draft"),
    resumeToken: makeId("resume"),
    createdAt: timestamp,
    updatedAt: timestamp,
    kind,
    title: "",
    summary: "",
    description: "",
    tags: [],
    source: { mode: "blank", name: "새 에셋" },
    brush: {
      engineNodes: [createCreatorMarketplaceBrushEngineNode("dab-stamp")],
      originalEnginePrograms: [],
      deterministicSeed: 1207,
      presetFamily: "custom",
      intendedUse: ["inking"],
    },
    technical: {},
    compatibility: {
      canvas2d: true,
      webgl2: true,
      webgpu: false,
      wasm: false,
      touch: true,
      stylus: true,
      mouse: true,
      minAppVersion: "1.0.0",
      testedBrowsers: ["Chrome", "Edge"],
      notes: "",
    },
    media: [],
    bundle: [],
    release: {
      mode: "new",
      version: "1.0.0",
      changelog: "첫 공개 버전",
      migrationNotes: "",
      breaking: false,
    },
    rights: {
      license: "free",
      commercialUse: true,
      redistribution: false,
      aiTrainingAllowed: false,
      containsThirdPartyContent: false,
      thirdPartyAttribution: "",
      originalWorkAttested: false,
      previewRightsAttested: false,
    },
    reviewNotes: "",
    completedSteps: [],
  };
}

const SNAPSHOT_KEYS = [
  "enginePrograms", "engineProgram", "brushEngine", "brushTip", "tip", "tips",
  "tipLayers", "extraTips", "dualBrush", "grain", "paper", "texture", "dynamics",
  "pressure", "pressureCurve", "velocity", "tilt", "twist", "rotation",
  "colorDynamics", "wetMix", "watercolor", "oil", "impasto", "particle",
  "postProcess", "spacing", "scatter", "jitter", "seed", "runtime", "backend",
] as const;

export function extractCreatorMarketplaceBrushStudioSnapshot(
  input: unknown,
): Record<string, unknown> {
  if (!isRecord(input)) return {};
  const candidates: Record<string, unknown>[] = [input];
  for (const key of ["brush", "snapshot", "preset", "payload", "data"] as const) {
    const nested = input[key];
    if (isRecord(nested)) candidates.push(nested);
  }
  const result: Record<string, unknown> = {};
  for (const candidate of candidates) {
    for (const key of SNAPSHOT_KEYS) {
      if (key in candidate && !(key in result)) result[key] = candidate[key];
    }
  }
  for (const key of ["id", "name", "title", "version", "description", "tags"] as const) {
    for (const candidate of candidates) {
      if (key in candidate && !(key in result)) result[key] = candidate[key];
    }
  }
  return result;
}

function inferEngineKind(program: unknown): CreatorMarketplaceBrushEngineKind {
  if (!isRecord(program)) return "dab-stamp";
  const source = [program.kind, program.type, program.engine, program.id, program.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (source.includes("water")) return "watercolor-diffusion";
  if (source.includes("oil") || source.includes("impasto")) return "oil-impasto";
  if (source.includes("particle") || source.includes("scatter")) return "particle-scatter";
  if (source.includes("dry") || source.includes("pencil") || source.includes("chalk")) return "dry-media";
  if (source.includes("living")) return "living-ink";
  if (source.includes("smudge")) return "smudge";
  if (source.includes("glow") || source.includes("neon")) return "glow";
  if (source.includes("dual")) return "dual-brush";
  if (source.includes("vector") || source.includes("outline")) return "vector-outline";
  if (source.includes("solid") || source.includes("path")) return "solid-path";
  if (source.includes("procedural") || source.includes("sdf")) return "procedural-sdf-tip";
  if (source.includes("image") || source.includes("stamp")) return "image-tip";
  return "dab-stamp";
}

export function createCreatorMarketplaceDraftFromBrushStudio(
  snapshotInput: unknown,
): CreatorMarketplaceAuthoringDraft {
  const snapshot = extractCreatorMarketplaceBrushStudioSnapshot(snapshotInput);
  const programs = Array.isArray(snapshot.enginePrograms) ? snapshot.enginePrograms : [];
  const draft = createCreatorMarketplaceAuthoringDraft("brush");
  const engineNodes = programs.length > 0
    ? programs.map((program, index) => ({
        ...createCreatorMarketplaceBrushEngineNode(inferEngineKind(program)),
        id: `studio_program_${index}`,
        name: isRecord(program) ? text(program.name, `Studio engine ${index + 1}`) : `Studio engine ${index + 1}`,
        sourceProgram: program,
      }))
    : draft.brush.engineNodes;
  return {
    ...draft,
    title: text(snapshot.name, text(snapshot.title)),
    description: text(snapshot.description),
    tags: Array.isArray(snapshot.tags)
      ? snapshot.tags.filter((value): value is string => typeof value === "string")
      : [],
    source: {
      mode: "brush-studio",
      name: text(snapshot.name, "Brush Studio brush"),
      studioSnapshot: snapshotInput,
    },
    brush: {
      ...draft.brush,
      engineNodes,
      originalEnginePrograms: programs,
      originalSnapshot: snapshotInput,
      deterministicSeed: finite(snapshot.seed, draft.brush.deterministicSeed),
    },
  };
}

function normalizeMapping(value: Record<string, unknown>): CreatorMarketplaceBrushChannelMapping {
  return {
    id: text(value.id, makeId("mapping")),
    channel: CREATOR_MARKETPLACE_BRUSH_CHANNELS.includes(value.channel as CreatorMarketplaceBrushInputChannel)
      ? value.channel as CreatorMarketplaceBrushInputChannel : "pressure",
    target: CREATOR_MARKETPLACE_BRUSH_TARGETS.includes(value.target as CreatorMarketplaceBrushTarget)
      ? value.target as CreatorMarketplaceBrushTarget : "size",
    enabled: bool(value.enabled, true),
    min: clamp(finite(value.min, 0), -8, 8),
    max: clamp(finite(value.max, 1), -8, 8),
    invert: bool(value.invert, false),
    curve: Array.isArray(value.curve)
      ? value.curve.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).slice(0, 32)
      : [0, 0.2, 0.45, 0.7, 0.86, 1],
  };
}

function normalizeTip(value: Record<string, unknown>): CreatorMarketplaceBrushTipLayer {
  return {
    id: text(value.id, makeId("tip")),
    name: text(value.name, "Tip layer"),
    source: ["shape", "image", "procedural", "studio-snapshot"].includes(text(value.source))
      ? value.source as CreatorMarketplaceBrushTipLayer["source"] : "shape",
    blend: CREATOR_MARKETPLACE_BRUSH_BLEND_OPERATORS.includes(value.blend as CreatorMarketplaceBrushBlendOperator)
      ? value.blend as CreatorMarketplaceBrushBlendOperator : "normal",
    opacity: clamp(finite(value.opacity, 1), 0, 1),
    scale: clamp(finite(value.scale, 1), 0.01, 32),
    rotationDeg: finite(value.rotationDeg, 0),
    spacing: clamp(finite(value.spacing, 0.16), 0.001, 8),
    scatter: clamp(finite(value.scatter, 0), 0, 8),
    textureAssetId: text(value.textureAssetId) || undefined,
    sourcePayload: value.sourcePayload,
  };
}

function normalizeEngineNode(
  node: Record<string, unknown>,
  index: number,
): CreatorMarketplaceBrushEngineNode {
  const engine = CREATOR_MARKETPLACE_BRUSH_ENGINES.includes(node.engine as CreatorMarketplaceBrushEngineKind)
    ? node.engine as CreatorMarketplaceBrushEngineKind
    : inferEngineKind(node.sourceProgram ?? node);
  const fallback = createCreatorMarketplaceBrushEngineNode(engine);
  return {
    ...fallback,
    id: text(node.id, `engine_${index}`),
    name: text(node.name, fallback.name),
    engine,
    enabled: bool(node.enabled, true),
    blend: CREATOR_MARKETPLACE_BRUSH_BLEND_OPERATORS.includes(node.blend as CreatorMarketplaceBrushBlendOperator)
      ? node.blend as CreatorMarketplaceBrushBlendOperator : fallback.blend,
    backend: ["portable", "canvas2d", "webgl2", "webgpu", "wasm"].includes(text(node.backend))
      ? node.backend as CreatorMarketplaceBrushEngineNode["backend"] : fallback.backend,
    parameters: isRecord(node.parameters)
      ? node.parameters as CreatorMarketplaceBrushEngineNode["parameters"] : fallback.parameters,
    mappings: Array.isArray(node.mappings)
      ? node.mappings.filter(isRecord).map(normalizeMapping) : fallback.mappings,
    tipLayers: Array.isArray(node.tipLayers)
      ? node.tipLayers.filter(isRecord).map(normalizeTip) : fallback.tipLayers,
    sourceProgram: node.sourceProgram,
  };
}

export function normalizeCreatorMarketplaceAuthoringDraft(
  input: unknown,
): CreatorMarketplaceAuthoringDraft {
  if (!isRecord(input)) return createCreatorMarketplaceAuthoringDraft();
  const kind = CREATOR_MARKETPLACE_AUTHORING_KINDS.includes(input.kind as CreatorMarketplaceAuthoringKind)
    ? input.kind as CreatorMarketplaceAuthoringKind : "brush";
  const fallback = createCreatorMarketplaceAuthoringDraft(kind);
  const source = isRecord(input.source) ? input.source : {};
  const brush = isRecord(input.brush) ? input.brush : {};
  const compatibility = isRecord(input.compatibility) ? input.compatibility : {};
  const release = isRecord(input.release) ? input.release : {};
  const rights = isRecord(input.rights) ? input.rights : {};
  return {
    ...fallback,
    id: text(input.id, fallback.id),
    resumeToken: text(input.resumeToken, fallback.resumeToken),
    createdAt: text(input.createdAt, fallback.createdAt),
    updatedAt: nowIso(),
    kind,
    title: text(input.title),
    summary: text(input.summary),
    description: text(input.description),
    tags: Array.isArray(input.tags)
      ? input.tags.filter((item): item is string => typeof item === "string").slice(0, 24) : [],
    source: {
      mode: ["blank", "brush-studio", "studio-project", "file", "marketplace-update"].includes(text(source.mode))
        ? source.mode as CreatorMarketplaceAuthoringDraft["source"]["mode"] : fallback.source.mode,
      name: text(source.name, fallback.source.name),
      fileName: text(source.fileName) || undefined,
      sourceResourceId: text(source.sourceResourceId) || undefined,
      studioSnapshot: source.studioSnapshot,
    },
    brush: {
      engineNodes: Array.isArray(brush.engineNodes)
        ? brush.engineNodes.filter(isRecord).map(normalizeEngineNode) : fallback.brush.engineNodes,
      originalEnginePrograms: Array.isArray(brush.originalEnginePrograms)
        ? brush.originalEnginePrograms : [],
      originalSnapshot: brush.originalSnapshot,
      deterministicSeed: Math.round(finite(brush.deterministicSeed, fallback.brush.deterministicSeed)),
      presetFamily: text(brush.presetFamily, fallback.brush.presetFamily),
      intendedUse: Array.isArray(brush.intendedUse)
        ? brush.intendedUse.filter((item): item is string => typeof item === "string")
        : fallback.brush.intendedUse,
    },
    technical: isRecord(input.technical)
      ? input.technical as CreatorMarketplaceAuthoringDraft["technical"] : {},
    compatibility: {
      canvas2d: bool(compatibility.canvas2d, fallback.compatibility.canvas2d),
      webgl2: bool(compatibility.webgl2, fallback.compatibility.webgl2),
      webgpu: bool(compatibility.webgpu, fallback.compatibility.webgpu),
      wasm: bool(compatibility.wasm, fallback.compatibility.wasm),
      touch: bool(compatibility.touch, fallback.compatibility.touch),
      stylus: bool(compatibility.stylus, fallback.compatibility.stylus),
      mouse: bool(compatibility.mouse, fallback.compatibility.mouse),
      minAppVersion: text(compatibility.minAppVersion, fallback.compatibility.minAppVersion),
      testedBrowsers: Array.isArray(compatibility.testedBrowsers)
        ? compatibility.testedBrowsers.filter((item): item is string => typeof item === "string")
        : fallback.compatibility.testedBrowsers,
      notes: text(compatibility.notes),
    },
    media: Array.isArray(input.media)
      ? input.media.filter(isRecord).map((item) => ({
          id: text(item.id, makeId("media")),
          kind: ["cover", "image", "stroke-sheet", "video", "turntable", "before-after"].includes(text(item.kind))
            ? item.kind as CreatorMarketplaceAuthoringMediaItem["kind"] : "image",
          name: text(item.name, "Preview"),
          url: text(item.url) || undefined,
          alt: text(item.alt),
          scenario: text(item.scenario) || undefined,
        })) : [],
    bundle: Array.isArray(input.bundle)
      ? input.bundle.filter(isRecord).map((item) => ({
          id: text(item.id, makeId("bundle")),
          kind: text(item.kind, "other") as CreatorMarketplaceAuthoringBundleItem["kind"],
          name: text(item.name, "Dependency"),
          required: bool(item.required, true),
          marketplaceResourceId: text(item.marketplaceResourceId) || undefined,
          versionRange: text(item.versionRange) || undefined,
          role: text(item.role),
        })) : [],
    release: {
      mode: release.mode === "update" ? "update" : "new",
      version: text(release.version, fallback.release.version),
      previousResourceId: text(release.previousResourceId) || undefined,
      changelog: text(release.changelog, fallback.release.changelog),
      migrationNotes: text(release.migrationNotes),
      breaking: bool(release.breaking, false),
    },
    rights: {
      license: text(rights.license, fallback.rights.license),
      commercialUse: bool(rights.commercialUse, fallback.rights.commercialUse),
      redistribution: bool(rights.redistribution, fallback.rights.redistribution),
      aiTrainingAllowed: bool(rights.aiTrainingAllowed, fallback.rights.aiTrainingAllowed),
      containsThirdPartyContent: bool(rights.containsThirdPartyContent, false),
      thirdPartyAttribution: text(rights.thirdPartyAttribution),
      originalWorkAttested: bool(rights.originalWorkAttested, false),
      previewRightsAttested: bool(rights.previewRightsAttested, false),
    },
    reviewNotes: text(input.reviewNotes),
    completedSteps: Array.isArray(input.completedSteps)
      ? input.completedSteps.filter((item): item is string => typeof item === "string") : [],
  };
}

export function validateCreatorMarketplaceAuthoringDraft(
  draftInput: CreatorMarketplaceAuthoringDraft,
): readonly CreatorMarketplaceAuthoringDiagnostic[] {
  const draft = normalizeCreatorMarketplaceAuthoringDraft(draftInput);
  const diagnostics: CreatorMarketplaceAuthoringDiagnostic[] = [];
  const add = (
    id: string,
    severity: CreatorMarketplaceAuthoringDiagnostic["severity"],
    step: CreatorMarketplaceAuthoringDiagnostic["step"],
    message: string,
    action: string,
  ): void => {
    diagnostics.push({ id, severity, step, message, action });
  };

  if (draft.title.trim().length < 2) add("title", "error", "source", "에셋 이름이 너무 짧습니다.", "이름을 2자 이상 입력하세요.");
  if (draft.summary.trim().length < 12) add("summary", "warning", "source", "검색 카드 요약이 짧습니다.", "용도와 결과를 한 문장으로 설명하세요.");
  if (draft.description.trim().length < 30) add("description", "warning", "source", "상세 사용 설명이 부족합니다.", "권장 설정과 사용 예를 추가하세요.");
  if (draft.tags.length < 2) add("tags", "warning", "source", "검색 태그가 부족합니다.", "스타일·용도 태그를 2개 이상 추가하세요.");

  if (draft.kind === "brush") {
    const enabled = draft.brush.engineNodes.filter((node) => node.enabled);
    if (enabled.length === 0) add("brush-engine", "error", "recipe", "활성 브러시 엔진이 없습니다.", "엔진 패스를 하나 이상 활성화하세요.");
    if (enabled.some((node) => node.backend === "webgpu") && !draft.compatibility.webgpu) add("webgpu-contract", "error", "compatibility", "WebGPU 엔진이 있지만 WebGPU 호환성이 꺼져 있습니다.", "백엔드를 바꾸거나 WebGPU 요구사항을 명시하세요.");
    if (enabled.some((node) => node.backend === "webgl2") && !draft.compatibility.webgl2) add("webgl-contract", "error", "compatibility", "WebGL2 엔진이 있지만 WebGL2 호환성이 꺼져 있습니다.", "호환성 표를 수정하세요.");
    if (enabled.some((node) => node.backend === "wasm") && !draft.compatibility.wasm) add("wasm-contract", "error", "compatibility", "WASM 엔진이 있지만 WASM 호환성이 꺼져 있습니다.", "WASM 요구사항을 명시하세요.");
    if (enabled.some((node) => node.engine === "dual-brush") && enabled.length < 2) add("dual-brush-input", "error", "recipe", "듀얼 브러시에 결합할 두 번째 엔진이 없습니다.", "기본·보조 엔진을 함께 구성하세요.");
    if (draft.brush.originalEnginePrograms.length > 0 && enabled.every((node) => node.sourceProgram === undefined)) add("engine-program-loss", "error", "recipe", "Brush Studio enginePrograms가 게시 레시피에서 분리됐습니다.", "Studio 원본 엔진 프로그램을 다시 가져오세요.");
  }

  const qualityScenarios = Array.isArray(draft.technical.qualityScenarios)
    ? draft.technical.qualityScenarios.filter((value): value is string => typeof value === "string")
    : [];
  const missingQualityScenarios = CREATOR_MARKETPLACE_REQUIRED_QUALITY_SCENARIOS[draft.kind]
    .filter((scenario) => !qualityScenarios.includes(scenario));
  if (missingQualityScenarios.length > 0) {
    add(
      "quality-plan",
      "error",
      "preview",
      `필수 품질 시나리오 ${missingQualityScenarios.length}개가 계획되지 않았습니다.`,
      "미리보기 단계에서 필수 시나리오를 선택하고 실제 결과를 첨부하세요.",
    );
  }
  if (draft.media.length === 0) add("preview", "warning", "preview", "실사용 미리보기가 없습니다.", "커버 또는 스트로크 테스트 시트를 추가하세요.");
  if (draft.media.some((media) => media.alt.trim().length < 3)) {
    add("preview-alt", "error", "preview", "대체 텍스트가 없는 미리보기가 있습니다.", "각 미디어가 무엇을 검증하는지 설명하세요.");
  }
  if (draft.bundle.some((item) => !item.name.trim() || !item.role.trim())) {
    add("bundle-metadata", "error", "bundle", "이름 또는 역할이 비어 있는 번들 항목이 있습니다.", "설치 항목의 이름과 역할을 입력하세요.");
  }
  if (draft.release.mode === "update" && !draft.release.previousResourceId) add("update-parent", "error", "release", "업데이트 대상 리소스가 없습니다.", "기존 마켓 리소스를 선택하세요.");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(draft.release.version)) add("semver", "error", "release", "버전이 SemVer 형식이 아닙니다.", "예: 1.2.0 또는 2.0.0-beta.1");
  if (!draft.rights.originalWorkAttested) add("rights-original", "error", "rights", "원본 제작 권리 확인이 필요합니다.", "권리 확인 항목에 동의하세요.");
  if (!draft.rights.previewRightsAttested) add("rights-preview", "error", "rights", "미리보기 미디어 권리 확인이 필요합니다.", "미디어 권리 항목에 동의하세요.");
  if (draft.rights.containsThirdPartyContent && !draft.rights.thirdPartyAttribution.trim()) add("third-party-attribution", "error", "rights", "제3자 콘텐츠 출처가 비어 있습니다.", "출처와 허가 범위를 기록하세요.");
  if (!draft.compatibility.mouse && !draft.compatibility.touch && !draft.compatibility.stylus) add("input-device", "error", "compatibility", "지원 입력 장치가 없습니다.", "마우스·터치·펜 중 하나를 선택하세요.");
  return diagnostics;
}

export function creatorMarketplaceBrushCombinationCount(
  draftInput: CreatorMarketplaceAuthoringDraft,
): number {
  const draft = normalizeCreatorMarketplaceAuthoringDraft(draftInput);
  if (draft.kind !== "brush") return 1;
  let count = 1;
  for (const node of draft.brush.engineNodes.filter((item) => item.enabled)) {
    const mappings = Math.max(1, node.mappings.filter((mapping) => mapping.enabled).length);
    const tips = Math.max(1, node.tipLayers.length);
    count = Math.min(Number.MAX_SAFE_INTEGER, count * mappings * tips * 2);
  }
  return Math.max(1, count);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function buildCreatorMarketplaceAuthoringManifest(
  draftInput: CreatorMarketplaceAuthoringDraft,
): Readonly<Record<string, unknown>> {
  const draft = normalizeCreatorMarketplaceAuthoringDraft(draftInput);
  return canonicalize({
    format: "toonspectrum.creator-marketplace-authoring",
    schemaVersion: CREATOR_MARKETPLACE_AUTHORING_SCHEMA_VERSION,
    generatedAt: draft.updatedAt,
    resource: {
      kind: draft.kind,
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      tags: draft.tags,
    },
    source: draft.source,
    brush: draft.kind === "brush" ? {
      deterministicSeed: draft.brush.deterministicSeed,
      presetFamily: draft.brush.presetFamily,
      intendedUse: draft.brush.intendedUse,
      engineNodes: draft.brush.engineNodes,
      enginePrograms: draft.brush.originalEnginePrograms,
      studioSnapshot: draft.brush.originalSnapshot ?? draft.source.studioSnapshot,
    } : undefined,
    technical: draft.technical,
    compatibility: draft.compatibility,
    media: draft.media,
    bundle: draft.bundle,
    release: draft.release,
    rights: draft.rights,
    reviewNotes: draft.reviewNotes,
  }) as Readonly<Record<string, unknown>>;
}

export function serializeCreatorMarketplaceAuthoringDraft(
  draft: CreatorMarketplaceAuthoringDraft,
): string {
  return JSON.stringify(canonicalize(normalizeCreatorMarketplaceAuthoringDraft(draft)), null, 2);
}

export function saveCreatorMarketplaceAuthoringDraft(
  draft: CreatorMarketplaceAuthoringDraft,
): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeCreatorMarketplaceAuthoringDraft(draft);
  window.localStorage.setItem(CREATOR_MARKETPLACE_AUTHORING_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(CREATOR_MARKETPLACE_AUTHORING_EVENT, { detail: normalized }));
}

export function loadCreatorMarketplaceAuthoringDraft(): CreatorMarketplaceAuthoringDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CREATOR_MARKETPLACE_AUTHORING_STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizeCreatorMarketplaceAuthoringDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function stageCreatorMarketplaceAuthoringHandoff(
  draft: CreatorMarketplaceAuthoringDraft,
): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    CREATOR_MARKETPLACE_AUTHORING_HANDOFF_KEY,
    serializeCreatorMarketplaceAuthoringDraft(draft),
  );
  saveCreatorMarketplaceAuthoringDraft(draft);
}

export function consumeCreatorMarketplaceAuthoringHandoff(): CreatorMarketplaceAuthoringDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(CREATOR_MARKETPLACE_AUTHORING_HANDOFF_KEY);
  if (!raw) return null;
  try {
    const draft = normalizeCreatorMarketplaceAuthoringDraft(JSON.parse(raw));
    window.sessionStorage.removeItem(CREATOR_MARKETPLACE_AUTHORING_HANDOFF_KEY);
    return draft;
  } catch {
    return null;
  }
}
