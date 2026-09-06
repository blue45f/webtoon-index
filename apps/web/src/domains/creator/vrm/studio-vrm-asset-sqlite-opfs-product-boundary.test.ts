import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

function source(fileName: string): string {
  if (fileName === "StudioVrmPoser.tsx") {
    return readStudioVrmPoserImplementationSource();
  }
  const pathInVrm = join(process.cwd(), "apps/web/src/domains/creator/vrm", fileName);
  try {
    return readFileSync(pathInVrm, "utf8");
  } catch {
    return readFileSync(join(process.cwd(), "apps/web/src/domains/creator", fileName), "utf8");
  }
}

describe("VRM asset SQLite/OPFS product boundary", () => {
  it("routes the poser catalog, model load, upload, thumbnail, and delete through vrm-library defaults", () => {
    const poser = source("StudioVrmPoser.tsx");
    // 2026-08-21 의도적 변경: 모델 로딩·업로드·삭제가 StudioVrmPoser.tsx에서
    // use-studio-vrm-model-loading.ts(포저가 소유하는 훅)로 분리됐다. 카탈로그/썸네일은
    // 포저에 남아 있어 그대로 대조하고, 이동한 경로만 새 모듈로 마커를 옮긴다.
    const modelLoading = source("use-studio-vrm-model-loading.ts");
    expect(poser).toContain("queryUploadedVrmLibraryEntriesPage({");
    expect(poser).toContain("hydrateVrmLibraryThumbnailWindow(windowEntries");
    expect(poser).not.toContain("listVrmLibraryEntries()");
    expect(modelLoading).toContain("await getStoredVrmModel(entry.id)");
    expect(modelLoading).toContain("await saveUploadedVrm(file)");
    expect(poser).toContain("saveVrmThumbnail(activeLibraryEntry.id, thumbnail)");
    expect(modelLoading).toContain("await deleteStoredVrmModel(entry.id)");
    expect(poser).not.toContain("legacyIndexedDb");
    expect(poser).not.toContain("globalThis.indexedDB");
    expect(modelLoading).not.toContain("legacyIndexedDb");
    expect(modelLoading).not.toContain("globalThis.indexedDB");
  });

  it("preserves the catalog and cursor when a post-mutation first-page refresh fails", () => {
    const poser = source("StudioVrmPoser.tsx");
    // 2026-08-21 의도적 변경: 모델 로딩·업로드·삭제가 StudioVrmPoser.tsx에서
    // use-studio-vrm-model-loading.ts(포저가 소유하는 훅)로 분리됐다. 카탈로그/썸네일은
    // 포저에 남아 있어 그대로 대조하고, 이동한 경로만 새 모듈로 마커를 옮긴다.
    const modelLoading = source("use-studio-vrm-model-loading.ts");
    const uploadStart = modelLoading.indexOf("async function handleFileChange(");
    const deleteStart = modelLoading.indexOf("async function handleDeleteEntry(", uploadStart);
    const upload = modelLoading.slice(uploadStart, deleteStart);
    const deleteEnd = modelLoading.indexOf("return {", deleteStart);
    const deletion = modelLoading.slice(deleteStart, deleteEnd);
    expect(uploadStart).toBeGreaterThan(-1);
    expect(deleteStart).toBeGreaterThan(uploadStart);
    expect(deleteEnd).toBeGreaterThan(deleteStart);
    expect(upload).not.toContain("queryUploadedVrmLibraryEntriesPage().catch(() => null)");
    expect(upload).toContain("let refreshSucceeded = false");
    expect(upload).toContain(": [...libraryEntries]");
    expect(upload).toContain("if (refreshSucceeded) {");
    expect(upload).toContain("setLibraryNextCursor(firstPage?.nextCursor ?? null)");
    expect(deletion).not.toContain("queryUploadedVrmLibraryEntriesPage().catch(() => null)");
    expect(deletion).toContain("libraryEntries.filter((candidate) => candidate.id !== entry.id)");
    expect(deletion).toContain("if (refreshSucceeded) {");
    expect(deletion).toContain("setLibraryStatus(\"error\")");
    expect(poser).toContain("async function handleRetryVrmLibraryRefresh()");
    expect(poser).toContain("onRetry={handleRetryVrmLibraryRefresh}");
  });

  it("aborts the bounded thumbnail window on conditional unmount and fences late results", () => {
    const poser = source("StudioVrmPoser.tsx");
    const disposeStart = poser.indexOf("const disposeVrmOnUnmount = useEffectEvent(() => {");
    const disposeEnd = poser.indexOf("const clearCurrentVrmOnClose", disposeStart);
    const dispose = poser.slice(disposeStart, disposeEnd);
    const hydrateStart = poser.indexOf("void hydrateVrmLibraryThumbnailWindow(windowEntries");
    const hydrateEnd = poser.indexOf("useEffect(() => {", hydrateStart);
    const hydrate = poser.slice(hydrateStart, hydrateEnd);
    expect(disposeStart).toBeGreaterThan(-1);
    expect(disposeEnd).toBeGreaterThan(disposeStart);
    expect(dispose).toContain("thumbnailRequestRef.current += 1");
    expect(dispose).toContain("thumbnailWindowAbortRef.current?.abort()");
    expect(dispose).toContain("thumbnailWindowAbortRef.current = null");
    expect(dispose).toContain('thumbnailWindowKeyRef.current = ""');
    expect(dispose).toContain("return () => disposeVrmOnUnmount()");
    expect(hydrate.match(
      /controller\.signal\.aborted \|\| thumbnailWindowAbortRef\.current !== controller/gu,
    )).toHaveLength(2);
    expect(hydrate.indexOf("controller.signal.aborted")).toBeLessThan(
      hydrate.indexOf("setLibraryEntries("),
    );
  });

  it("keeps packaged bundle card art resident while evicting offscreen hydrated data", () => {
    const poser = source("StudioVrmPoser.tsx");
    const hydrateStart = poser.indexOf("void hydrateVrmLibraryThumbnailWindow(windowEntries");
    const hydrateEnd = poser.indexOf("useEffect(() => {", hydrateStart);
    const hydrate = poser.slice(hydrateStart, hydrateEnd);

    expect(hydrate).toContain('entry.source === "sample"');
    expect(hydrate).toContain('entry.thumbnail?.startsWith("/vrm/thumbnails/")');
    expect(hydrate).toContain("isBundledStaticThumbnail");
    expect(hydrate).toContain("return { ...entry, thumbnail: null }");
  });

  it("makes shared SQLite/OPFS the no-options authority while keeping IDB explicit-only", () => {
    const library = source("vrm-library.ts");
    expect(library).toContain("options.repository ?? getProductStudioVrmAssetSqliteOpfsRepository()");
    expect(library).toContain("if (usesLegacyIndexedDb(options))");
    expect(library).toContain("readonly legacyIndexedDb?: IDBFactory | null");
    expect(library).not.toContain("typeof indexedDB");
    expect(library).not.toContain("globalThis.indexedDB");
  });

  it("routes texture persistence and project archive bridges through the upgraded library defaults", () => {
    const library = source("studio-vrm-texture-paint-library.ts");
    const persistence = source("studio-vrm-texture-paint-persistence.ts");
    const project = source("studio-vrm-texture-paint-project-library.ts");
    expect(library).toContain("if (!usesLegacyIndexedDb(options))");
    expect(library).toContain("repository(options).saveTexture");
    expect(library).toContain("repository(options).getTexture");
    expect(library).not.toContain("globalThis.indexedDB");
    expect(persistence).toContain("saveArtifact: saveStudioVrmTexturePaintLibraryArtifact");
    expect(persistence).toContain("getArtifact: getStudioVrmTexturePaintLibraryArtifact");
    expect(project).toContain("saveStudioVrmTexturePaintLibraryArtifact");
    expect(project).toContain("getStudioVrmTexturePaintLibraryArtifact");
  });

  it("keeps bytes out of SQLite and commits the canonical manifest last", () => {
    const repository = source("studio-vrm-asset-sqlite-opfs-repository.ts");
    const blobWrite = repository.indexOf("assets().put");
    const markerWrite = repository.indexOf("fs().write(markerPath");
    const modelCommit = repository.indexOf("async function commitModelManifest");
    const ownerCommit = repository.indexOf("assets().setOwnerRefs", modelCommit);
    const sqliteCommit = repository.indexOf("prepared.raw", ownerCommit);
    const exactOwnerCommit = repository.indexOf("assets().setOwnerRefs", sqliteCommit);
    expect(blobWrite).toBeGreaterThan(-1);
    expect(markerWrite).toBeGreaterThan(blobWrite);
    expect(ownerCommit).toBeGreaterThan(markerWrite);
    expect(sqliteCommit).toBeGreaterThan(ownerCommit);
    expect(exactOwnerCommit).toBeGreaterThan(sqliteCommit);
    expect(repository.slice(ownerCommit, sqliteCommit)).toContain("unionLiveHashes");
    expect(repository).toContain("page.descriptor.key");
    expect(repository).not.toContain("base64");
    expect(repository).not.toContain("THREE.");
    expect(repository).not.toContain("WebGLRenderer");
  });

  it("labels memory-only use and blocks portable insert until durable storage succeeds", () => {
    const poser = source("StudioVrmPoser.tsx");
    const panel = source("StudioVrmCharacterLibraryPanel.tsx");
    expect(poser).toContain("현재 탭 메모리에만 유지합니다");
    expect(poser).toContain('insertLibraryEntry?.source === "memory"');
    expect(panel).toContain('entry.source === "memory"');
    expect(panel).toContain("현재 탭 임시");
  });
});
