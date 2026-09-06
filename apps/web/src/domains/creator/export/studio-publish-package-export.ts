import {
  projectStudioAiProvenanceForPublish,
  type StudioAiProvenanceDocument,
} from "../ai/studio-ai-provenance";
import { CANVAS_W } from "../studio-assets";
import { normalizePageReviewState } from "../studio-page-review";
import { sha256Blob } from "../studio-page-shell-runtime";
import {
  validateStudioPublishCompliance,
  type StudioPublishComplianceChecklist,
  type StudioPublishComplianceResult,
} from "../studio-publish-compliance";
import {
  planStudioPublishPackage,
  sanitizeStudioPublishFileStem,
  type StudioPublishPackageManifest,
  type StudioPublishPackagePlan,
  type StudioPublishPackageSettings,
} from "../studio-publish-package";
import {
  validateStudioPublishPreflight,
  type StudioPublishAiProvenance,
  type StudioPublishAiUsage,
  type StudioPublishPreflightInput,
  type StudioPublishPreflightResult,
  type StudioPublishProfile,
} from "../studio-publish-preflight";

import type { PageState } from "../studio-page-state";
import type { WatermarkSettings } from "../studio-watermark";

/**
 * Publish package export + preflight assembly, extracted from StudioPage.tsx (2026-08, B-04).
 * Every entry point is parameterized on a snapshot object the page captures at call time —
 * nothing here reads React state, and the original guard ordering (shared-document
 * availability, busy flag, capture completeness, destination re-validation) is preserved
 * verbatim so behavior stays byte-identical with the inline implementation.
 */

/** 리뷰 스레드에서 편집 검수 카운트만 필요하다 — 구조 타입으로 결합을 줄인다. */
export interface StudioPublishEditorialThread {
  readonly resolved: boolean;
}

export interface StudioPublishPreflightSnapshot {
  readonly title: string;
  readonly tagsText: string;
  readonly publishAiUsage: StudioPublishAiUsage;
  readonly publishAiDisclosure: string;
  readonly commentThreads: readonly StudioPublishEditorialThread[];
}

export function collectStudioPublishPreflightProvenance(
  sourcePages: readonly PageState[]
): StudioPublishAiProvenance[] {
  return sourcePages.flatMap((page) =>
    page.elements.flatMap((element) => {
      const provenance: StudioPublishAiProvenance[] = [];
      if ("aiProvenance" in element && element.aiProvenance) {
        provenance.push({ ...element.aiProvenance, assetId: `render:${page.id}` });
      }
      if (element.type === "frame" && element.storyBeat?.textAiProvenance) {
        provenance.push({
          action: "other",
          assetId: `frame:${page.id}:${element.id}`,
          ...element.storyBeat.textAiProvenance,
        });
      }
      return provenance;
    })
  );
}

export function buildStudioPublishPreflightInput(
  snapshot: StudioPublishPreflightSnapshot,
  provenance: readonly StudioPublishAiProvenance[],
  sourcePages: readonly PageState[]
): StudioPublishPreflightInput {
  const { title, tagsText, publishAiUsage, publishAiDisclosure, commentThreads } = snapshot;
  return {
    title,
    tags: tagsText
      .split(/[,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    pages: sourcePages.map((page) => {
      const review = normalizePageReviewState(page.review);
      return {
        id: page.id,
        reviewStatus: review.status,
        reviewLocked: review.locked,
        images: [
          {
            id: `render:${page.id}`,
            fileName: `${page.id}.png`,
            mimeType: "image/png",
            width: CANVAS_W,
            height: page.canvasH,
            aiGenerated: page.elements.some(
              (element) => "aiProvenance" in element && element.aiProvenance?.action === "generated"
            ),
          },
        ],
      };
    }),
    aiContent: {
      usage: publishAiUsage,
      disclosure: publishAiDisclosure,
      provenance,
    },
    editorial: {
      openCommentThreads: commentThreads
        .filter((thread) => !thread.resolved).length,
    },
  };
}

export interface StudioPublishPackageExportSnapshot extends StudioPublishPreflightSnapshot {
  readonly pages: readonly PageState[];
  readonly currentPageId: string;
  /** 페이지가 계산해 넘긴다 — 원본: writerRoom.stages["episode-outline"].title || title. */
  readonly episodeTitle: string;
  readonly effectivePublishPackageSettings: StudioPublishPackageSettings;
  readonly publishPackagePlan: StudioPublishPackagePlan | null;
  readonly publishPackageExportBusy: boolean;
  readonly publishCompliance: StudioPublishComplianceChecklist;
  readonly aiProvenance: StudioAiProvenanceDocument;
  readonly ensureSharedDocumentAvailableForExport: () => boolean;
  readonly ensureWatermarkLoaded: () => Promise<WatermarkSettings>;
  readonly handleCapturePagesForPreset: (preset: "all") => Promise<HTMLCanvasElement[]>;
  readonly currentPublishPackageCreditsText: () => string;
  readonly setPublishPackageExportStatus: (
    status: { tone: "info" | "good" | "bad"; text: string } | null
  ) => void;
  readonly setPublishPackageExportProgress: (
    progress: { done: number; total: number } | null
  ) => void;
  readonly setPublishPackageExportBusy: (busy: boolean) => void;
  readonly setPublishPackageOpen: (open: boolean) => void;
  readonly setPublishPreflightOpen: (open: boolean) => void;
  readonly setError: (message: string) => void;
}

export async function executeStudioPublishPackageExport(
  snapshot: StudioPublishPackageExportSnapshot
): Promise<void> {
  const {
    ensureSharedDocumentAvailableForExport,
    publishPackagePlan,
    publishPackageExportBusy,
    effectivePublishPackageSettings,
    publishCompliance,
    pages,
    title,
    episodeTitle,
    currentPageId,
    aiProvenance,
    ensureWatermarkLoaded,
    handleCapturePagesForPreset,
    currentPublishPackageCreditsText,
    setPublishPackageExportStatus,
    setPublishPackageExportProgress,
    setPublishPackageExportBusy,
    setPublishPackageOpen,
    setPublishPreflightOpen,
    setError,
  } = snapshot;
  if (!ensureSharedDocumentAvailableForExport()) return;
  if (!publishPackagePlan?.canExport || publishPackageExportBusy) return;
  const structuralResult = validateStudioPublishPreflight(
    buildStudioPublishPreflightInput(
      snapshot,
      collectStudioPublishPreflightProvenance(pages),
      pages
    ),
    effectivePublishPackageSettings.destination
  );
  const complianceResult = validateStudioPublishCompliance(
    publishCompliance,
    effectivePublishPackageSettings.destination,
    { aiUsage: effectivePublishPackageSettings.aiUsage }
  );
  if (!structuralResult.canPublish || !complianceResult.readyForDestinationReview) {
    const blockedCount = structuralResult.errors.length + complianceResult.errors.length;
    setPublishPackageExportStatus({
      tone: "bad",
      text: `게시 전 필수 점검 ${blockedCount}개를 해결해야 정식 패키지를 만들 수 있어요.`,
    });
    setError(`게시 전 필수 점검 ${blockedCount}개를 확인해 주세요.`);
    setPublishPackageOpen(false);
    setPublishPreflightOpen(true);
    return;
  }
  const watermarkForExport = await ensureWatermarkLoaded();
  setPublishPackageExportBusy(true);
  setPublishPackageExportProgress(null);
  setPublishPackageExportStatus({ tone: "info", text: "페이지 픽셀을 캡처하는 중…" });
  let captured: HTMLCanvasElement[] = [];
  try {
    captured = await handleCapturePagesForPreset("all");
    if (captured.length !== pages.length) {
      throw new Error("일부 페이지를 캡처하지 못해 패키지 생성을 중단했어요.");
    }
    const [
      { renderStudioPublishPackageImages },
      {
        finalizeStudioPublishPackageManifest,
        serializeStudioPublishPackageManifest,
      },
    ] = await Promise.all([
      import("../studio-publish-package-renderer"),
      import("../studio-publish-package-manifest-runtime"),
    ]);
    const sources = captured.map((canvas, index) => ({ id: pages[index].id, canvas }));
    const rendered = await renderStudioPublishPackageImages({
      settings: effectivePublishPackageSettings,
      seriesTitle: title,
      sources,
      thumbnailSourceId: currentPageId,
      watermark: watermarkForExport,
      onProgress: (done, total) => {
        setPublishPackageExportProgress({ done, total });
        setPublishPackageExportStatus({
          tone: "info",
          text: `규격 이미지와 썸네일 렌더링 중… ${done}/${total}`,
        });
      },
    });
    const creditsText = currentPublishPackageCreditsText();
    const actualPlan = planStudioPublishPackage({
      settings: effectivePublishPackageSettings,
      seriesTitle: title,
      episodeTitle,
      canvases: sources.map((source) => ({
        id: source.id,
        width: source.canvas.width,
        height: source.canvas.height,
      })),
      episodeImages: rendered.episodeImages.map(({ metadata }) => metadata),
      thumbnails: rendered.thumbnails.map(({ metadata }) => metadata),
      creditsText,
      generatedAt: new Date(),
    });
    if (!actualPlan.canExport) {
      throw new Error(
        actualPlan.errors[0]?.message || "렌더한 파일이 목적지 규격을 통과하지 못했어요."
      );
    }

    const archiveEntries: Array<{ path: string; data: Blob }> = [
      ...rendered.episodeImages.map((file) => ({ path: file.fileName, data: file.blob })),
      ...rendered.thumbnails.map((file) => ({ path: file.fileName, data: file.blob })),
    ];
    if (effectivePublishPackageSettings.includeReviewPdf) {
      setPublishPackageExportStatus({ tone: "info", text: "검수용 PDF를 만드는 중…" });
      const { renderStudioReviewPdf } = await import("../studio-review-pdf");
      // 페이지 검토 메타데이터는 내부 review.pdf의 픽셀 주석에만 전달한다. public manifest와
      // 게시용 이미지 렌더 경로에는 넘기지 않아 담당자·검토 메모가 외부 산출물에 섞이지 않는다.
      const reviewPdf = await renderStudioReviewPdf({
        pages: captured,
        pageMetadata: pages,
        profile: effectivePublishPackageSettings.reviewPdfProfile,
        title: "review",
        watermark: watermarkForExport,
        onProgress: (done, total) => {
          setPublishPackageExportProgress({ done, total });
        },
      });
      archiveEntries.push({ path: "review.pdf", data: reviewPdf.blob });
    }
    if (effectivePublishPackageSettings.includeCredits && creditsText) {
      archiveEntries.push({
        path: "credits.txt",
        data: new Blob([creditsText], { type: "text/plain;charset=utf-8" }),
      });
    }
    if (effectivePublishPackageSettings.aiUsage !== "none") {
      archiveEntries.push({
        path: "ai-disclosure.json",
        data: new Blob([JSON.stringify({
          schema: "toonspectrum.ai-disclosure",
          version: 1,
          usage: effectivePublishPackageSettings.aiUsage,
          disclosure: effectivePublishPackageSettings.aiDisclosure,
          provenance: projectStudioAiProvenanceForPublish(aiProvenance),
        }, null, 2)], { type: "application/json" }),
      });
    }
    archiveEntries.push({
      path: "validation-report.json",
      data: new Blob([JSON.stringify({
        schema: "toonspectrum.publish-package-validation",
        version: 1,
        generatedAt: actualPlan.manifest.generatedAt,
        destination: actualPlan.settings.destination,
        canExport: actualPlan.canExport,
        errors: actualPlan.errors,
        warnings: actualPlan.warnings,
        preflight: {
          structural: {
            canPublish: structuralResult.canPublish,
            errors: structuralResult.errors,
            warnings: structuralResult.warnings,
          },
          compliance: {
            readyForDestinationReview: complianceResult.readyForDestinationReview,
            errors: complianceResult.errors,
            warnings: complianceResult.warnings,
          },
        },
      }, null, 2)], { type: "application/json" }),
    });

    const renderedHashes = new Map<string, string>([
      ...rendered.episodeImages.map((file) => [file.fileName, file.metadata.sha256 ?? ""] as const),
      ...rendered.thumbnails.map((file) => [file.fileName, file.metadata.sha256 ?? ""] as const),
    ]);
    const actualArtifacts = [];
    for (let index = 0; index < archiveEntries.length; index += 1) {
      const entry = archiveEntries[index];
      if (!entry) continue;
      setPublishPackageExportProgress({ done: index, total: archiveEntries.length });
      setPublishPackageExportStatus({
        tone: "info",
        text: `파일 무결성과 manifest 일치 여부 확인 중… ${index + 1}/${archiveEntries.length}`,
      });
      actualArtifacts.push({
        fileName: entry.path,
        mimeType: entry.data.type,
        byteSize: entry.data.size,
        sha256: renderedHashes.get(entry.path) || await sha256Blob(entry.data),
      });
    }
    const finalManifest: StudioPublishPackageManifest = finalizeStudioPublishPackageManifest(
      actualPlan.manifest,
      actualArtifacts
    );
    const manifestBlob = new Blob([serializeStudioPublishPackageManifest(finalManifest)], {
      type: "application/json",
    });
    const finalEntries = [...archiveEntries, { path: "manifest.json", data: manifestBlob }];
    const { buildStudioPackageArchiveBlob } = await import("../studio-package-archive");
    const archiveBlob = await buildStudioPackageArchiveBlob(finalEntries, {
      crc32ExecutionMode: "worker",
      modifiedAt: finalManifest.generatedAt,
      onProgress: ({ completedFiles, totalFiles }) => {
        setPublishPackageExportProgress({ done: completedFiles, total: totalFiles });
        setPublishPackageExportStatus({
          tone: "info",
          text: `모바일 호환 단일 ZIP 패키지 조립 중… ${completedFiles}/${totalFiles}`,
        });
      },
    });
    const { downloadBlob } = await import("./studio-export");
    const archiveName = `${sanitizeStudioPublishFileStem(title, {
      fallback: "toonspectrum",
      maxCodeUnits: 90,
    })}-${effectivePublishPackageSettings.destination}-publish.toonpkg.zip`;
    downloadBlob(archiveBlob, archiveName);
    setPublishPackageExportStatus({
      tone: "good",
      text: `검증된 ${finalEntries.length}개 파일을 ZIP 하나로 저장 요청했어요. 브라우저 다운로드 완료 여부를 확인한 뒤 플랫폼 업로드는 직접 진행해 주세요.`,
    });
  } catch (cause) {
    setPublishPackageExportStatus({
      tone: "bad",
      text: cause instanceof Error ? cause.message : "게시 패키지를 만들지 못했어요.",
    });
  } finally {
    for (const canvas of captured) {
      canvas.width = 0;
      canvas.height = 0;
    }
    setPublishPackageExportBusy(false);
  }
}

export interface StudioPublishPreflightReportSnapshot {
  readonly title: string;
  readonly publishProfile: StudioPublishProfile;
  readonly pages: readonly PageState[];
  readonly publishAiUsage: StudioPublishAiUsage;
  readonly publishAiDisclosure: string;
  readonly publishPreflightProvenance: readonly StudioPublishAiProvenance[];
  readonly commentThreads: readonly StudioPublishEditorialThread[];
  readonly plannedReleaseItems: number;
  readonly importedAnalyticsRecords: number;
  readonly publishPreflightResult: StudioPublishPreflightResult | null;
  readonly publishComplianceResult: StudioPublishComplianceResult;
  readonly ensureSharedDocumentAvailableForExport: () => boolean;
}

// 목적지별 Publish Pack 사전검사 결과를 사람이 검토·보관할 수 있는 JSON 보고서로 내보낸다.
export async function downloadStudioPublishPreflightReport(
  snapshot: StudioPublishPreflightReportSnapshot
): Promise<void> {
  const {
    title,
    publishProfile,
    pages,
    publishAiUsage,
    publishAiDisclosure,
    publishPreflightProvenance,
    commentThreads,
    plannedReleaseItems,
    importedAnalyticsRecords,
    publishPreflightResult,
    publishComplianceResult,
    ensureSharedDocumentAvailableForExport,
  } = snapshot;
  if (!ensureSharedDocumentAvailableForExport()) return;
  if (!publishPreflightResult) return;
  const report = {
    format: "toonspectrum-publish-preflight",
    version: 2,
    createdAt: new Date().toISOString(),
    destination: publishProfile,
    work: {
      title: title.trim(),
      pageCount: pages.length,
      pageOrder: pages.map((page) => page.id),
      pageReviews: pages.map((page) => ({
        pageId: page.id,
        ...normalizePageReviewState(page.review),
      })),
    },
    aiContent: {
      usage: publishAiUsage,
      disclosure: publishAiDisclosure.trim(),
      provenance: publishPreflightProvenance,
    },
    editorial: {
      commentThreads: commentThreads.length,
      openCommentThreads: commentThreads
        .filter((thread) => !thread.resolved).length,
      resolvedCommentThreads: commentThreads
        .filter((thread) => thread.resolved).length,
      plannedReleaseItems,
      importedAnalyticsRecords,
    },
    structuralResult: publishPreflightResult,
    complianceResult: publishComplianceResult,
  };
  const { downloadBlob } = await import("./studio-export");
  downloadBlob(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    `${(title.trim() || "toonspectrum").replace(/[\\/:*?"<>|]+/g, "-")}-publish-preflight.json`
  );
}

export interface StudioPublishPackageManifestDownloadSnapshot {
  readonly title: string;
  readonly publishPackagePlan: StudioPublishPackagePlan | null;
  readonly ensureSharedDocumentAvailableForExport: () => boolean;
}

export async function downloadStudioPublishPackageManifest(
  snapshot: StudioPublishPackageManifestDownloadSnapshot
): Promise<void> {
  const { title, publishPackagePlan, ensureSharedDocumentAvailableForExport } = snapshot;
  if (!ensureSharedDocumentAvailableForExport()) return;
  if (!publishPackagePlan) return;
  const [
    { downloadBlob },
    { serializeStudioPublishPackageManifest },
  ] = await Promise.all([
    import("./studio-export"),
    import("../studio-publish-package-manifest-runtime"),
  ]);
  downloadBlob(
    new Blob([serializeStudioPublishPackageManifest(publishPackagePlan.manifest)], {
      type: "application/json",
    }),
    `${(title.trim() || "toonspectrum").replace(/[\\/:*?"<>|]+/g, "-")}-publish-package-manifest.json`
  );
}
