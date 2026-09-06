/**
 * Studio UI density modes — three-tier layout presets (Super Simple / Simple / Full),
 * a common commercial drawing-app IA (no branding cloned).
 *
 * Our keys stay simple | full | focus for storage stability:
 * - focus  ≈ Super Simple (minimal chrome, draw tools stay)
 * - simple ≈ Simple (core tools, hide advanced AI/3D)
 * - full   ≈ Full (everything)
 *
 * Pure prefs model; StudioPage applies visibility matrix to toolbar clusters and panels.
 */

export const STUDIO_UI_DENSITY_MODES = ["simple", "full", "focus"] as const;
export type StudioUiDensityMode = (typeof STUDIO_UI_DENSITY_MODES)[number];

export const STUDIO_UI_DENSITY_STORAGE_KEY = "toonspectrum-studio-ui-density:v1";
export const DEFAULT_STUDIO_UI_DENSITY_MODE: StudioUiDensityMode = "full";

export type StudioUiChromeRegion =
  | "toolbar-assets"
  | "toolbar-cut"
  | "toolbar-draw"
  | "toolbar-reference"
  | "toolbar-scene"
  | "toolbar-style"
  | "toolbar-ai"
  | "toolbar-insert"
  | "left-panel"
  | "right-panel"
  | "page-strip"
  | "status-rail"
  | "tool-rail"
  | "quick-actions";

export interface StudioUiDensityState {
  mode: StudioUiDensityMode;
}

export interface StudioUiDensityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isStudioUiDensityMode(value: unknown): value is StudioUiDensityMode {
  return value === "simple" || value === "full" || value === "focus";
}

export function normalizeStudioUiDensityMode(value: unknown): StudioUiDensityMode {
  return isStudioUiDensityMode(value) ? value : DEFAULT_STUDIO_UI_DENSITY_MODE;
}

export function normalizeStudioUiDensityState(value?: unknown): StudioUiDensityState {
  if (!value || typeof value !== "object") {
    return { mode: DEFAULT_STUDIO_UI_DENSITY_MODE };
  }
  const record = value as Record<string, unknown>;
  return { mode: normalizeStudioUiDensityMode(record.mode ?? record.density) };
}

export function loadStudioUiDensityState(
  storage: StudioUiDensityStorage | null | undefined
): StudioUiDensityState {
  if (!storage) return normalizeStudioUiDensityState();
  try {
    const raw = storage.getItem(STUDIO_UI_DENSITY_STORAGE_KEY);
    if (!raw) return normalizeStudioUiDensityState();
    return normalizeStudioUiDensityState(JSON.parse(raw));
  } catch {
    return normalizeStudioUiDensityState();
  }
}

export function saveStudioUiDensityState(
  storage: StudioUiDensityStorage | null | undefined,
  state: StudioUiDensityState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      STUDIO_UI_DENSITY_STORAGE_KEY,
      JSON.stringify(normalizeStudioUiDensityState(state))
    );
    return true;
  } catch {
    return false;
  }
}

/** Visibility matrix — false means hide the chrome region. */
export function studioUiDensityAllows(
  mode: StudioUiDensityMode,
  region: StudioUiChromeRegion
): boolean {
  const normalized = normalizeStudioUiDensityMode(mode);
  if (normalized === "full") return true;

  // Super Simple (focus): draw + 삽입 코어(템플릿·에셋·텍스트·말풍선) + 레일. 패널·AI·3D 참조는 접는다.
  if (normalized === "focus") {
    return (
      region === "toolbar-draw"
      || region === "toolbar-insert"
      || region === "toolbar-assets"
      || region === "toolbar-cut"
      || region === "tool-rail"
      || region === "quick-actions"
      || region === "status-rail"
    );
  }

  // Simple: core webtoon tools; hide AI/3D-heavy chrome (advanced brush props stay folded).
  if (region === "toolbar-ai" || region === "toolbar-reference") return false;
  return true;
}

/** Short UI chip label (Super Simple / Simple / Full). */
export function studioUiDensityLabel(
  mode: StudioUiDensityMode,
  t?: (key: string) => string
): string {
  if (t) {
    if (mode === "simple") return t("studio.settings.uiDensityMode.simple");
    if (mode === "focus") return t("studio.settings.uiDensityMode.focus");
    return t("studio.settings.uiDensityMode.full");
  }
  if (mode === "simple") return "심플";
  if (mode === "focus") return "슈퍼심플";
  return "전체";
}

export function studioUiDensityDescription(
  mode: StudioUiDensityMode,
  t?: (key: string) => string
): string {
  if (t) {
    if (mode === "simple") return t("studio.settings.uiDensityDescription.simple");
    if (mode === "focus") return t("studio.settings.uiDensityDescription.focus");
    return t("studio.settings.uiDensityDescription.full");
  }
  if (mode === "simple") {
    return "심플 모드 — 핵심 도구와 기본 설정만 보여 입문·집중 작업에 맞춥니다.";
  }
  if (mode === "focus") {
    return "슈퍼심플 모드 — 그리기·삽입(템플릿·에셋·말풍선)과 캔버스 위주, AI·3D·속성 패널은 접습니다.";
  }
  return "전체 모드 — 모든 메뉴·패널·AI·3D 도구를 표시합니다.";
}

/** Map existing mobile immersive flag into density for unified consumers. */
export function studioUiDensityFromImmersive(mobileImmersive: boolean): StudioUiDensityMode {
  return mobileImmersive ? "focus" : "full";
}
