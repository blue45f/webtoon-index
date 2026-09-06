import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseStudioAutosave,
  serializeStudioAutosave,
} from "../studio-autosave";
import { createEmptyStudioCharacterBible } from "../studio-character-bible";
import { createEmptyStudioCommentsDocument } from "../studio-comments";
import {
  parseStudioProjectFile,
  serializeStudioProjectFile,
} from "../studio-project-file";
import {
  buildStudioProjectFileSnapshot,
  type BuildStudioProjectFileSnapshotInput,
} from "../studio-project-snapshot";
import { createEmptyStudioPublicationAnalyticsDocument } from "../studio-publication-analytics";
import { normalizeStudioPublishCompliance } from "../studio-publish-compliance";
import { DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS } from "../studio-publish-package";
import { createDefaultStudioReferenceBoardDocument } from "../studio-reference-board";
import { createEmptyStudioReleaseSchedule } from "../studio-release-schedule";
import { buildStudioSavePayload } from "../studio-save-payload";
import { createEmptyStudioWriterRoomDocument } from "../studio-writer-room";

import {
  createEmptyStudioAiImageReferenceDocument,
  hydrateStudioAiImageReferenceDocument,
  serializeStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
} from "./studio-ai-image-reference-roles";
import { createEmptyStudioAiProvenanceDocument } from "./studio-ai-provenance";

import type { PageState } from "../studio-page-state";

const SAVED_AT = "2026-08-10T09:00:00.000Z";
const LEGACY_REFERENCE_STORAGE_PREFIX =
  "toonspectrum-studio-ai-image-references:v1";

// 984251d8c 가 참조 문서 state 를 useStudioDocumentAccessRuntime 으로 빼냈다. 추출본을 앞에 둬야
// 거기서 시작한 슬라이스가 호스트 쪽 끝 토큰까지 나아간다.
const studioPageSource = [
  new URL(
    "../studio-cuttoon-editor/runtime/useStudioDocumentAccessRuntime.ts",
    import.meta.url,
  ),
  new URL("../StudioCuttoonEditorHost.tsx", import.meta.url),
]
  .map((url) => readFileSync(url, "utf8"))
  .join("\n");
const legacyStorageSource = readFileSync(
  new URL("./studio-ai-image-reference-storage.ts", import.meta.url),
  "utf8",
);

function page(): PageState {
  return {
    id: "page-1",
    elements: [],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1_080,
  };
}

function metadataOnlyReferenceDocument(): StudioAiImageReferenceDocument {
  return hydrateStudioAiImageReferenceDocument({
    version: 1,
    references: [
      {
        id: "character-reference-1",
        role: "character",
        asset: {
          assetId: "asset-character-1",
          sha256: `sha256:${"a".repeat(64)}`,
          dataUrl: "data:image/png;base64,asset-secret",
          bytes: new Uint8Array([137, 80, 78, 71]),
          providerPayload: { uploadId: "provider-upload-secret" },
        },
        label: "주인공 정면",
        guidance: "얼굴 비율과 눈매만 유지",
        dataUrl: "data:image/webp;base64,reference-secret",
        binary: new Uint8Array([1, 2, 3, 4]),
        provider: "private-provider",
        providerPayload: {
          requestId: "private-request-id",
          inlineData: "provider-inline-secret",
        },
      },
      {
        id: "method-reference-1",
        role: "method",
        asset: { assetId: "asset-method-1" },
        label: "로우 앵글",
        guidance: "카메라 높이와 원근만 참고",
      },
    ],
  });
}

function snapshotInput(
  aiImageReferences = metadataOnlyReferenceDocument(),
): BuildStudioProjectFileSnapshotInput {
  return {
    savedAt: SAVED_AT,
    title: "AI 참조 권위 테스트",
    description: "메타데이터 왕복",
    tagsText: "reference, metadata",
    linkedTitleId: null,
    linkedSeriesId: null,
    linkedChallengeId: null,
    pagesList: [page()],
    master: { elements: [] },
    characterBible: createEmptyStudioCharacterBible(),
    writerRoom: createEmptyStudioWriterRoomDocument(),
    aiProvenance: createEmptyStudioAiProvenanceDocument(),
    aiImageReferences,
    comments: createEmptyStudioCommentsDocument(),
    releaseSchedule: createEmptyStudioReleaseSchedule(),
    publicationAnalytics: createEmptyStudioPublicationAnalyticsDocument(),
    referenceBoard: createDefaultStudioReferenceBoardDocument(),
    currentPageId: "page-1",
    webtoonTheme: "classic",
    panelGutter: 24,
    publishPack: {
      profile: "generic",
      aiUsage: "none",
      disclosure: "",
      compliance: normalizeStudioPublishCompliance(undefined),
      packageSettings: {
        ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
        requestedThumbnailSlots: [
          ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS.requestedThumbnailSlots,
        ],
      },
      packageCredits: "",
    },
  };
}

function expectMetadataOnly(value: unknown): void {
  expect(value).toEqual({
    version: 1,
    references: [
      {
        id: "character-reference-1",
        role: "character",
        asset: {
          assetId: "asset-character-1",
          sha256: `sha256:${"a".repeat(64)}`,
        },
        label: "주인공 정면",
        guidance: "얼굴 비율과 눈매만 유지",
      },
      {
        id: "method-reference-1",
        role: "method",
        asset: { assetId: "asset-method-1" },
        label: "로우 앵글",
        guidance: "카메라 높이와 원근만 참고",
      },
    ],
  });
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    "data:",
    "base64",
    "asset-secret",
    "reference-secret",
    "provider",
    "private-request-id",
    "provider-inline-secret",
    "bytes",
    "binary",
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}

function sourceBetween(start: string, end: string): string {
  const startIndex = studioPageSource.indexOf(start);
  const endIndex = studioPageSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return studioPageSource.slice(startIndex, endIndex);
}

describe("AI image reference project authority", () => {
  it("preserves only role, asset identity, label, and guidance through project parse/serialize", () => {
    const references = metadataOnlyReferenceDocument();
    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [page()],
      aiImageReferences: references,
    });
    const reparsed = parseStudioProjectFile(
      JSON.parse(serializeStudioProjectFile(parsed)) as unknown,
    );

    expectMetadataOnly(parsed.aiImageReferences);
    expectMetadataOnly(reparsed.aiImageReferences);
    expect(serializeStudioAiImageReferenceDocument(reparsed.aiImageReferences)).toBe(
      serializeStudioAiImageReferenceDocument(references),
    );
  });

  it("keeps identical reference semantics from project snapshot to autosave restore and save payload", () => {
    const snapshot = buildStudioProjectFileSnapshot(snapshotInput());
    const autosaveJson = serializeStudioAutosave(snapshot);
    const restored = parseStudioAutosave(autosaveJson);

    expect(restored).not.toBeNull();
    if (!restored) throw new Error("AI image reference autosave did not parse");
    expectMetadataOnly(snapshot.aiImageReferences);
    expectMetadataOnly(restored.aiImageReferences);

    const payload = buildStudioSavePayload({
      title: snapshot.title,
      description: snapshot.description,
      tagsText: snapshot.tagsText,
      linkedTitleId: snapshot.linkedTitleId,
      cover: "data:image/webp;base64,rendered-cover-is-not-document-metadata",
      pageImages: ["data:image/png;base64,rendered-page-is-not-document-metadata"],
      document: {
        ...snapshot,
        width: 800,
        aiImageReferences: restored.aiImageReferences
          ?? createEmptyStudioAiImageReferenceDocument(),
      },
      status: "draft",
      linkedSeriesId: snapshot.linkedSeriesId,
      linkedChallengeId: snapshot.linkedChallengeId,
    });
    const savedDocument = payload.doc as Record<string, unknown>;

    expectMetadataOnly(savedDocument.aiImageReferences);
    const canonical = serializeStudioAiImageReferenceDocument(
      snapshot.aiImageReferences,
    );
    expect(serializeStudioAiImageReferenceDocument(restored.aiImageReferences)).toBe(
      canonical,
    );
    expect(serializeStudioAiImageReferenceDocument(savedDocument.aiImageReferences)).toBe(
      canonical,
    );
  });

  it.each([
    ["malformed", { version: 1, references: "not-an-array" }],
    ["future version", {
      version: 99,
      references: [{
        id: "future-ref",
        role: "style",
        asset: { assetId: "future-asset" },
      }],
    }],
    ["invalid JSON", "{not-json"],
  ])("fails closed for a %s nested reference document", (_label, candidate) => {
    const empty = createEmptyStudioAiImageReferenceDocument();
    const project = parseStudioProjectFile({
      version: 2,
      pagesList: [page()],
      aiImageReferences: candidate,
    });
    const autosave = parseStudioAutosave(JSON.stringify({
      version: 2,
      savedAt: SAVED_AT,
      pagesList: [page()],
      aiImageReferences: candidate,
    }));

    expect(project.aiImageReferences).toEqual(empty);
    expect(autosave?.aiImageReferences).toEqual(empty);
  });

  it("wires StudioPage snapshots and restore to project state without the legacy storage adapter", () => {
    const referenceState = sourceBetween(
      "const [scenarioImageReferenceDocument",
      "const draftRuntime = useStudioDraftCollaborationRuntime({",
    );
    const snapshotBoundary = sourceBetween(
      "return buildStudioProjectFileSnapshot({",
      "// 오토세이브 임시저장 리스너",
    );
    const restoreBoundary = sourceBetween(
      "function applyStudioProjectSnapshotWithPreparedDocuments(",
      "async function applyStudioProjectSnapshot(",
    );

    expect(referenceState).toContain("createEmptyStudioAiImageReferenceDocument");
    expect(referenceState).not.toMatch(/\b(?:localStorage|studioWorkspaceStorage)\b/u);
    expect(snapshotBoundary).toContain(
      "aiImageReferences: scenarioImageReferenceDocument",
    );
    expect(restoreBoundary).toMatch(
      /setScenarioImageReferenceDocument\(\s*hydrateStudioAiImageReferenceDocument\(projectData\.aiImageReferences\)/u,
    );
    expect(studioPageSource).not.toMatch(
      /\b(?:load|save|clear)StudioAiImageReferenceDocument\b/u,
    );
    expect(studioPageSource).not.toContain("studio-ai-image-reference-storage");
  });

  it("keeps the legacy browser key as an unreferenced compatibility module with zero automatic import", () => {
    expect(legacyStorageSource).toMatch(
      /toonspectrum-studio-ai-image-references:v\$\{STUDIO_AI_IMAGE_REFERENCE_STORAGE_VERSION\}/u,
    );
    expect(studioPageSource).not.toContain(LEGACY_REFERENCE_STORAGE_PREFIX);
    expect(studioPageSource.match(/studio-ai-image-reference-storage/gu) ?? []).toHaveLength(0);
    expect(
      studioPageSource.match(/loadStudioAiImageReferenceDocument/gu) ?? [],
    ).toHaveLength(0);
  });
});
