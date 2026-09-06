type StudioSvgExportModule = typeof import("./studio-svg-export");
type StudioSvgExportWorkerClientModule = typeof import("./studio-svg-export-worker-client");
type StudioPsdExportModule = typeof import("./studio-psd-export");
type StudioPsdImportModule = typeof import("../studio-psd-import");

let svgExportModulePromise: Promise<StudioSvgExportModule> | null = null;
let svgExportWorkerClientModulePromise: Promise<StudioSvgExportWorkerClientModule> | null = null;
let psdExportModulePromise: Promise<StudioPsdExportModule> | null = null;
let psdImportModulePromise: Promise<StudioPsdImportModule> | null = null;

/**
 * Document interchange engines are deliberately absent from the initial Studio graph. Each
 * literal import remains statically analyzable by Vite while the cached promise makes hover,
 * focus, pointer-down, and click converge on one request. A failed chunk can be retried after a
 * deployment instead of poisoning the tab for the rest of its lifetime.
 */
export function loadStudioSvgExportModule(): Promise<StudioSvgExportModule> {
  svgExportModulePromise ??= import("./studio-svg-export").catch((error: unknown) => {
    svgExportModulePromise = null;
    throw error;
  });
  return svgExportModulePromise;
}

/** 실제 직렬화(exportPageToSvg)는 이 Worker 클라이언트를 통해서만 부른다. 제품 기본 Worker가
 * unavailable이면 fail-closed하며, direct 실행은 호출자가 작업 전에 명시한 경우에만 허용한다.
 * MIME/파일명 등 가벼운 메타데이터는 여전히 loadStudioSvgExportModule을 쓴다. */
export function loadStudioSvgExportWorkerClientModule(): Promise<StudioSvgExportWorkerClientModule> {
  svgExportWorkerClientModulePromise ??= import("./studio-svg-export-worker-client").catch((error: unknown) => {
    svgExportWorkerClientModulePromise = null;
    throw error;
  });
  return svgExportWorkerClientModulePromise;
}

export function loadStudioPsdExportModule(): Promise<StudioPsdExportModule> {
  psdExportModulePromise ??= import("./studio-psd-export").catch((error: unknown) => {
    psdExportModulePromise = null;
    throw error;
  });
  return psdExportModulePromise;
}

export function loadStudioPsdImportModule(): Promise<StudioPsdImportModule> {
  psdImportModulePromise ??= import("../studio-psd-import").catch((error: unknown) => {
    psdImportModulePromise = null;
    throw error;
  });
  return psdImportModulePromise;
}

export function preloadStudioSvgExportModule(): void {
  void loadStudioSvgExportModule();
  void loadStudioSvgExportWorkerClientModule();
}

export function preloadStudioPsdExportModule(): void {
  void loadStudioPsdExportModule();
}

export function preloadStudioPsdImportModule(): void {
  void loadStudioPsdImportModule();
}
