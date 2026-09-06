/** Editorial layout planning only. Never stores XR poses, room scans, asset references, or model bytes. */
export type SpatialStoryboardLayout = "focus" | "arc" | "wall";
export type SpatialReadingDirection = "ltr" | "rtl";
export interface SpatialStoryboardSettings {
  readonly layout: SpatialStoryboardLayout;
  readonly direction: SpatialReadingDirection;
  readonly distanceMeters: number;
  readonly panelWidthMeters: number;
  readonly aspectRatio: number;
  readonly gapMeters: number;
  readonly eyeHeightMeters: number;
  readonly maxArcDegrees: number;
}
export interface SpatialShotReference {
  readonly id: string;
  readonly name: string;
}
export interface SpatialStoryboardPanel {
  readonly shotId: string;
  readonly label: string;
  readonly order: number;
  readonly page: number;
  readonly position: readonly [number, number, number];
  /** Rotation around +Y. A panel's unrotated front normal is +Z. */
  readonly yawDegrees: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
}
export interface SpatialStoryboardPlan {
  readonly settings: SpatialStoryboardSettings;
  readonly panels: readonly SpatialStoryboardPanel[];
  readonly pageCount: number;
  readonly omittedCount: number;
  readonly warnings: readonly string[];
}
export const SPATIAL_STORYBOARD_MAX_SHOTS = 96;
export const SPATIAL_STORYBOARD_MAX_FILE_BYTES = 262_144;
export const SPATIAL_STORYBOARD_DEFAULTS: SpatialStoryboardSettings = Object.freeze({
  layout: "arc", direction: "ltr", distanceMeters: 2, panelWidthMeters: 0.72,
  aspectRatio: 16 / 9, gapMeters: 0.12, eyeHeightMeters: 1.4, maxArcDegrees: 100,
});
function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value)) : fallback;
}
export function normalizeSpatialStoryboardSettings(
  value: Partial<SpatialStoryboardSettings> = {},
): SpatialStoryboardSettings {
  const d = SPATIAL_STORYBOARD_DEFAULTS;
  return {
    layout: value.layout === "focus" || value.layout === "wall" ? value.layout : "arc",
    direction: value.direction === "rtl" ? "rtl" : "ltr",
    distanceMeters: finite(value.distanceMeters, d.distanceMeters, 0.75, 6),
    panelWidthMeters: finite(value.panelWidthMeters, d.panelWidthMeters, 0.2, 2),
    aspectRatio: finite(value.aspectRatio, d.aspectRatio, 0.5, 2.4),
    gapMeters: finite(value.gapMeters, d.gapMeters, 0.02, 0.5),
    eyeHeightMeters: finite(value.eyeHeightMeters, d.eyeHeightMeters, 0.8, 2),
    maxArcDegrees: finite(value.maxArcDegrees, d.maxArcDegrees, 40, 140),
  };
}
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;
function rounded(value: number): number {
  const result = Math.round(value * 1e6) / 1e6;
  return Object.is(result, -0) ? 0 : result;
}

/** Canonical order is preserved; RTL mirrors placement, never the source shot array. */
export function buildSpatialStoryboardPlan(
  shots: readonly SpatialShotReference[],
  requested: Partial<SpatialStoryboardSettings> = {},
): SpatialStoryboardPlan {
  const settings = normalizeSpatialStoryboardSettings(requested);
  const { layout, distanceMeters: distance, panelWidthMeters: width, gapMeters: gap } = settings;
  const height = width / settings.aspectRatio;
  const angularWidth = 2 * Math.atan(width / (2 * distance));
  const stepAngle = 2 * Math.atan((width + gap) / (2 * distance));
  const arcLimit = radians(settings.maxArcDegrees);
  const columns = layout === "focus" ? 1 : layout === "arc"
    ? Math.max(1, Math.floor((arcLimit - angularWidth) / stepAngle) + 1)
    : Math.max(1, Math.min(3, Math.floor((2 * distance * Math.tan(arcLimit / 2) + gap) / (width + gap))));
  // Single-row pages avoid hiding rows behind identical top-down markers and large vertical shifts.
  const unique: SpatialShotReference[] = [];
  const seen = new Set<string>();
  for (const shot of shots) {
    if (unique.length >= SPATIAL_STORYBOARD_MAX_SHOTS) break;
    if (!shot || typeof shot.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u.test(shot.id)
      || ["__proto__", "constructor", "prototype"].includes(shot.id) || seen.has(shot.id)) continue;
    seen.add(shot.id);
    unique.push({ id: shot.id, name: typeof shot.name === "string" ? shot.name.slice(0, 160) : "" });
  }
  const panels: SpatialStoryboardPanel[] = unique.map((shot, index) => {
    const page = Math.floor(index / columns);
    const count = Math.min(columns, unique.length - page * columns);
    const direction = settings.direction === "rtl" ? -1 : 1;
    const offset = (index % columns - (count - 1) / 2) * direction;
    const angle = layout === "arc" ? offset * stepAngle : 0;
    const x = layout === "arc" ? Math.sin(angle) * distance : offset * (width + gap);
    const z = layout === "arc" ? -Math.cos(angle) * distance : -distance;
    return {
      shotId: shot.id, label: shot.name || `컷 ${index + 1}`, order: index + 1, page,
      position: [rounded(x), settings.eyeHeightMeters, rounded(z)],
      yawDegrees: rounded(-degrees(angle)), widthMeters: width, heightMeters: rounded(height),
    };
  });
  const warnings: string[] = [];
  // Editorial thresholds, not hardware certification or medical safety limits.
  if (distance < 1) warnings.push("관람 거리가 1m 미만입니다. 실제 기기에서 초점과 글자 가독성을 확인하세요.");
  if (degrees(angularWidth) > 55) warnings.push("한 컷이 넓은 시야를 차지합니다. 컷 폭을 줄이거나 관람 거리를 늘려 비교하세요.");
  if (angularWidth > arcLimit) warnings.push("한 컷의 각도 폭이 설정한 배치 범위를 넘습니다. 범위 또는 컷 폭을 조정하세요.");
  if (panels.some((panel) => panel.position[1] - panel.heightMeters / 2 < 0)) {
    warnings.push("컷의 아래쪽이 계획상의 바닥보다 낮습니다. 세로 비율 또는 중심 높이를 조정하세요.");
  }
  const omittedCount = shots.length - panels.length;
  if (omittedCount > 0) warnings.push(`${omittedCount}개 참조를 제외했습니다. 중복·잘못된 ID 또는 ${SPATIAL_STORYBOARD_MAX_SHOTS}컷 한도를 확인하세요.`);
  return { settings, panels, pageCount: Math.ceil(panels.length / columns), omittedCount, warnings };
}

/** Whitelisted export; intentionally excludes camera transforms and any runtime/device data. */
export function serializeSpatialStoryboardPlan(plan: SpatialStoryboardPlan): string {
  return JSON.stringify({
    kind: "toonstudio.spatial-storyboard-plan", version: 1,
    status: "planning-only", units: "meters", coordinateSystem: "right-handed-y-up-negative-z-forward",
    immersiveRuntimeIncluded: false, transition: "manual-cut", settings: normalizeSpatialStoryboardSettings(plan.settings),
    pageCount: plan.pageCount, omittedCount: plan.omittedCount, warnings: plan.warnings,
    panels: plan.panels.map((panel) => ({
      shotId: panel.shotId, label: panel.label, order: panel.order, page: panel.page,
      position: [...panel.position], yawDegrees: panel.yawDegrees,
      widthMeters: panel.widthMeters, heightMeters: panel.heightMeters,
    })),
  }, null, 2);
}

/** Import settings only. External shot IDs/placements can never issue editor commands. */
export function parseSpatialStoryboardSettings(text: string): SpatialStoryboardSettings {
  if (new TextEncoder().encode(text).byteLength > SPATIAL_STORYBOARD_MAX_FILE_BYTES) {
    throw new Error("계획 파일은 256KB 이하만 가져올 수 있습니다.");
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("계획 파일 형식이 올바르지 않습니다.");
  const record = value as Record<string, unknown>;
  if (record.kind !== "toonstudio.spatial-storyboard-plan" || record.version !== 1
    || !record.settings || typeof record.settings !== "object" || Array.isArray(record.settings)) {
    throw new Error("지원하는 툰스튜디오 공간 콘티 계획 v1 파일이 아닙니다.");
  }
  const s = record.settings as Record<string, unknown>;
  if (!["focus", "arc", "wall"].includes(String(s.layout)) || !["ltr", "rtl"].includes(String(s.direction))) {
    throw new Error("배치 또는 읽기 방향 값이 올바르지 않습니다.");
  }
  for (const key of ["distanceMeters", "panelWidthMeters", "aspectRatio", "gapMeters", "eyeHeightMeters", "maxArcDegrees"]) {
    if (typeof s[key] !== "number" || !Number.isFinite(s[key])) throw new Error("계획 파일의 치수는 유한한 숫자여야 합니다.");
  }
  return normalizeSpatialStoryboardSettings(s as unknown as SpatialStoryboardSettings);
}
