import { readFileSync } from "node:fs";
import { inspect } from "node:util";


import { describe, expect, it } from "vitest";

import {
  appendStudioAiOperation,
  createEmptyStudioAiProvenanceDocument,
} from "./ai/studio-ai-provenance";
import { readStudioPageCompositionSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import {
  createCanonicalStudioDocumentEnvelope,
  serializeCanonicalStudioDocumentEnvelope,
} from "./studio-document-envelope";
import {
  buildStudioProjectDocumentSaveArtifact,
  createStudioProjectDocumentEnvelope,
  parseStudioProjectDocument,
  serializeStudioProjectDocument,
  StudioProjectDocumentError,
  STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
  STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
  STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE,
} from "./studio-project-document";

const studioPageSource = readStudioPageCompositionSource();
const projectArchiveSource = readFileSync(
  new URL("./studio-project-archive-orchestration-runtime.ts", import.meta.url),
  "utf8",
);

const metadata = {
  documentId: "work:project-1",
  revision: 7,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T01:00:00.000Z",
} as const;

function page(id = "page-1") {
  return {
    id,
    elements: [],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 2_000,
  };
}

function retainedAiProvenance(rawPrompt: string) {
  return appendStudioAiOperation(
    createEmptyStudioAiProvenanceDocument(),
    {
      id: "operation-1",
      kind: "image",
      task: "background-image",
      provider: "image-provider",
      model: "image-v1",
      transport: "byok",
      promptVersion: 2,
      prompt: rawPrompt,
      createdAt: "2026-07-10T00:00:00.000Z",
    },
    { retainRawPrompt: true }
  );
}

describe("studio project canonical document boundary", () => {
  it("keeps current raw project JSON import-compatible", async () => {
    const loaded = await parseStudioProjectDocument({
      version: 2,
      title: "현재 프로젝트",
      pagesList: [page()],
    });

    expect(loaded.source).toBe("legacy-project");
    expect(loaded.project).toMatchObject({
      version: 2,
      title: "현재 프로젝트",
    });
    expect(loaded.envelope).toBeNull();
  });

  it("keeps legacy v1 project JSON import-compatible", async () => {
    const loaded = await parseStudioProjectDocument({
      version: "1.0",
      title: "과거 프로젝트",
      pages: [page()],
    });

    expect(loaded.source).toBe("legacy-project");
    expect(loaded.project).toMatchObject({
      version: 2,
      title: "과거 프로젝트",
      currentPageId: "page-1",
    });
  });

  it("keeps a legitimate raw project format field on the legacy path", async () => {
    const loaded = await parseStudioProjectDocument({
      version: 2,
      format: "cuttoon",
      title: "컷툰 프로젝트",
      pagesList: [page()],
    });

    expect(loaded.source).toBe("legacy-project");
    expect(loaded.project).toMatchObject({
      version: 2,
      format: "cuttoon",
      title: "컷툰 프로젝트",
    });
  });

  it("serializes a deterministic current canonical envelope", async () => {
    const value = {
      version: 2,
      title: "정식 프로젝트",
      pagesList: [page()],
    };
    const first = serializeStudioProjectDocument(value, metadata, {
      "vendor.example": { retained: true },
    });
    const second = serializeStudioProjectDocument(value, metadata, {
      "vendor.example": { retained: true },
    });
    const loaded = await parseStudioProjectDocument(first);

    expect(first).toBe(second);
    expect(loaded.source).toBe("canonical-envelope");
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");
    expect(loaded.project.title).toBe("정식 프로젝트");
    expect(loaded.envelope.format).toEqual({
      id: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
      version: STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
    });
    expect(loaded.envelope.extensions).toEqual({
      "vendor.example": { retained: true },
    });
    expect(loaded.receipt.migrated).toBe(false);
    expect(loaded.receipt.steps).toEqual([]);
  });

  it("migrates a v1 envelope and preserves document identity and extensions", async () => {
    const legacyEnvelope = createCanonicalStudioDocumentEnvelope({
      format: {
        id: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
        version: 1,
      },
      document: {
        id: metadata.documentId,
        revision: metadata.revision,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      },
      payload: {
        type: STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE,
        data: {
          version: "1.0",
          title: "봉인된 과거 프로젝트",
          pages: [page()],
        },
      },
      extensions: {
        "vendor.example": {
          opaque: ["keep", 1],
        },
      },
    });

    const loaded = await parseStudioProjectDocument(
      serializeCanonicalStudioDocumentEnvelope(legacyEnvelope)
    );

    expect(loaded.source).toBe("canonical-envelope");
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");
    expect(loaded.project).toMatchObject({
      version: 2,
      title: "봉인된 과거 프로젝트",
    });
    expect(loaded.envelope.document).toEqual({
      id: metadata.documentId,
      revision: metadata.revision,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    });
    expect(loaded.envelope.extensions).toEqual(legacyEnvelope.extensions);
    expect(loaded.receipt).toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      migrated: true,
      steps: [
        {
          migratorId: "studio-project.v1-to-v2",
          fromVersion: 1,
          toVersion: 2,
        },
      ],
    });
  });

  it("preserves an unknown future envelope behind a recoverable typed error", async () => {
    const future = createCanonicalStudioDocumentEnvelope({
      format: {
        id: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
        version: 99,
      },
      document: {
        id: metadata.documentId,
        revision: metadata.revision,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      },
      payload: {
        type: STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE,
        data: {
          version: 2,
          pagesList: [page()],
        },
      },
      extensions: {
        future: {
          doNotDrop: true,
        },
      },
    });

    await expect(parseStudioProjectDocument(future)).rejects.toMatchObject({
      name: "StudioProjectDocumentError",
      diagnostic: {
        code: "UNKNOWN_FUTURE_VERSION",
        recoverable: true,
        recovery: "upgrade-client",
      },
      preservedEnvelope: future,
    });
  });

  it("does not reinterpret a damaged envelope as a permissive raw project", async () => {
    await expect(
      parseStudioProjectDocument({
        format: {
          id: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
          version: 2,
        },
        version: 2,
        pagesList: [page()],
      })
    ).rejects.toMatchObject({
      name: "StudioProjectDocumentError",
      diagnostic: {
        code: "INVALID_ENVELOPE",
      },
    });
  });

  it("detaches and freezes the exported project payload", () => {
    const input = {
      version: 2,
      title: "분리",
      pagesList: [page()],
    };
    const envelope = createStudioProjectDocumentEnvelope(input, metadata);

    input.title = "외부 변경";
    expect(envelope.payload.data).toMatchObject({ title: "분리" });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.payload.data)).toBe(true);
  });

  it("builds deterministic save bytes and a checksum from the established export boundary", async () => {
    const value = {
      version: 2,
      title: "checksum 프로젝트",
      pagesList: [page()],
    };
    const extensions = {
      "vendor.example": { retained: true },
    };
    const first = await buildStudioProjectDocumentSaveArtifact(
      value,
      metadata,
      extensions
    );
    const second = await buildStudioProjectDocumentSaveArtifact(
      value,
      metadata,
      extensions
    );

    expect(first.canonicalJson).toBe(
      serializeStudioProjectDocument(value, metadata, extensions)
    );
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.checksum).toBe(second.checksum);
    expect(first.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.project).toMatchObject({
      version: 2,
      title: "checksum 프로젝트",
    });
    expect(first.envelope.extensions).toEqual(extensions);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("redacts retained AI raw prompts before canonical save bytes are produced", async () => {
    const rawPrompt = "작가의 비공개 반전 프롬프트";
    const artifact = await buildStudioProjectDocumentSaveArtifact(
      {
        version: 2,
        title: "AI 이력 프로젝트",
        pagesList: [page()],
        aiProvenance: retainedAiProvenance(rawPrompt),
      },
      metadata
    );

    expect(artifact.canonicalJson).not.toContain(rawPrompt);
    expect(JSON.stringify(artifact.project)).not.toContain(rawPrompt);
    expect(artifact.project.aiProvenance?.operations[0].prompt).toMatchObject({
      retention: "hash-only",
    });
    expect(artifact.project.aiProvenance?.operations[0].prompt).not.toHaveProperty(
      "raw"
    );
  });

  it("fails closed, preserves a future raw source, and keeps recovery bytes off error surfaces", async () => {
    const rawPrompt = "비공개 미래 AI 프롬프트 · 절대 오류 로그에 남기지 않기";
    const privateContact = "future-creator-private@example.invalid";
    const future = {
      version: 3,
      format: "cuttoon",
      title: "미래 프로젝트",
      pagesList: [page()],
      futureEditingState: { mode: "next-generation" },
      aiProvenance: {
        version: 3,
        operations: [
          {
            prompt: { retention: "raw-opt-in", raw: rawPrompt },
            collaboratorContact: privateContact,
          },
        ],
      },
    };
    const futureSource = JSON.stringify(future, null, 2);

    let caught: unknown;
    try {
      await parseStudioProjectDocument(futureSource);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(StudioProjectDocumentError);
    const documentError = caught as StudioProjectDocumentError;
    expect(documentError).toMatchObject({
      diagnostic: {
        code: "UNKNOWN_FUTURE_VERSION",
        recoverable: true,
        recovery: "upgrade-client",
        actualVersion: 3,
        currentVersion: 2,
      },
    });
    expect(documentError.preservedSource).toBe(futureSource);

    expect(Object.keys(documentError)).not.toContain("preservedSource");
    expect(Object.getOwnPropertyNames(documentError)).not.toContain(
      "preservedSource"
    );
    expect(Reflect.ownKeys(documentError)).not.toContain("preservedSource");
    expect(
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(documentError) as object,
        "preservedSource"
      )?.enumerable
    ).toBe(false);

    const consoleProjection = documentError.toJSON();
    const exposedSurfaces = JSON.stringify({
      enumerable: { ...documentError },
      json: JSON.parse(JSON.stringify(documentError)) as unknown,
      string: String(documentError),
      message: documentError.message,
      stack: documentError.stack ?? "",
      consoleInspection: inspect(documentError),
      consoleProjection,
    });
    expect(consoleProjection).toMatchObject({
      name: "StudioProjectDocumentError",
      diagnostic: { code: "UNKNOWN_FUTURE_VERSION" },
    });
    expect(exposedSurfaces).not.toContain(rawPrompt);
    expect(exposedSurfaces).not.toContain(privateContact);
    expect(exposedSurfaces).not.toContain(futureSource);
  });

  it.each(["3.0", "3.1"])(
    "fails closed and preserves future string-version raw projects (%s)",
    async (version) => {
      const futureSource = JSON.stringify({
        version,
        format: "cuttoon",
        title: "미래 문자열 프로젝트",
        pagesList: [page()],
      });

      await expect(parseStudioProjectDocument(futureSource)).rejects.toMatchObject({
        diagnostic: {
          code: "UNKNOWN_FUTURE_VERSION",
          actualVersion: 3,
          currentVersion: 2,
          recoverable: true,
        },
        preservedSource: futureSource,
      });
    }
  );

  it("keeps project export and import on the established dynamic module contract", async () => {
    expect(projectArchiveSource).not.toMatch(
      /import\s+[^;]*from\s+["']\.\/studio-project-document["']/u
    );
    expect(projectArchiveSource).toContain("{ createStudioProjectDocumentEnvelope },");
    expect(projectArchiveSource).toContain('import("./studio-project-document")');
    expect(projectArchiveSource).toContain("{ serializeCanonicalStudioDocumentEnvelope },");
    expect(projectArchiveSource).toContain('import("./studio-document-envelope")');
    expect(projectArchiveSource).not.toMatch(
      /import\s+\{\s*(?:captureStudioProjectDocumentSession|planStudioProjectDocumentSessionExport)/u
    );
    expect(projectArchiveSource).toContain(
      'import("./studio-project-document-session")'
    );
    expect(projectArchiveSource).toContain(
      "planStudioProjectDocumentSessionExport({"
    );
    expect(projectArchiveSource).toContain("sessionExport.metadata");
    expect(projectArchiveSource).toContain("sessionExport.extensions");
    expect(projectArchiveSource).toContain("sessionExport.directEnvelope");
    expect(projectArchiveSource).toContain("sessionExport.project");
    expect(projectArchiveSource).toContain(
      "readCurrentProject: currentStudioProjectSnapshot"
    );
    expect(projectArchiveSource).toContain("{ parseStudioProjectDocument },");
    expect(projectArchiveSource).toContain(
      "const loaded = await parseStudioProjectDocument(text);"
    );
    expect(projectArchiveSource).toContain(
      "applyStudioProjectSnapshot(loaded.project)"
    );
    expect(projectArchiveSource).toContain(
      'loaded.source === "canonical-envelope"'
    );
    expect(projectArchiveSource).toContain(
      "captureStudioProjectDocumentSession("
    );

    const canonicalExport = projectArchiveSource.slice(
      projectArchiveSource.indexOf("async function handleExportProject()"),
      projectArchiveSource.indexOf("async function handleExportProjectArchive()")
    );
    const serializedAt = canonicalExport.indexOf(
      "serializeCanonicalStudioDocumentEnvelope(exportEnvelope)"
    );
    const downloadPreparedAt = canonicalExport.indexOf("URL.createObjectURL(blob)");
    const downloadRequestedAt = canonicalExport.indexOf("link.click()");
    const sessionInstalledAt = canonicalExport.indexOf(
      "projectDocumentSessionRef.current = captureStudioProjectDocumentSession("
    );
    expect(serializedAt).toBeGreaterThanOrEqual(0);
    expect(downloadPreparedAt).toBeGreaterThan(serializedAt);
    expect(downloadRequestedAt).toBeGreaterThan(downloadPreparedAt);
    expect(sessionInstalledAt).toBeGreaterThan(downloadRequestedAt);
    expect(canonicalExport).not.toContain("sessionExport.nextSession");

    const replacement = studioPageSource.slice(
      studioPageSource.indexOf(
        "function applyStudioProjectSnapshotWithPreparedDocuments("
      ),
      studioPageSource.indexOf(
        "async function applyStudioProjectSnapshot("
      )
    );
    expect(replacement).toContain(
      "studioProjectDocumentSessionRef.current = null;"
    );
    const scopeClear = studioPageSource.slice(
      studioPageSource.indexOf(
        "studioProjectDocumentSessionScopeRef.current"
      ),
      studioPageSource.indexOf(
        "const mutationScopeKey = JSON.stringify"
      )
    );
    expect(scopeClear).toContain(
      "studioProjectDocumentSessionRef.current = null;"
    );
    const canonicalImport = projectArchiveSource.slice(
      projectArchiveSource.indexOf("function handleImportProject("),
      projectArchiveSource.indexOf(
        "async function handleImportProjectArchive("
      )
    );
    expect(canonicalImport).toContain(
      'loaded.source === "canonical-envelope"'
    );
    expect(canonicalImport).toContain(
      "hasStudioLinked3dPassProjectArchiveReferences(loaded.project)"
    );
    expect(canonicalImport).toContain("self-contained .toonproject.zip archive");
    expect(canonicalImport).toContain(": null;");
    expect(canonicalImport).not.toContain("console.error(err)");
    const archiveImport = projectArchiveSource.slice(
      projectArchiveSource.indexOf(
        "async function handleImportProjectArchive("
      ),
      projectArchiveSource.indexOf("return {")
    );
    expect(archiveImport).toContain(
      "applyStudioProjectSnapshotWithPreparedDocuments("
    );
    const serverHydration = studioPageSource.slice(
      studioPageSource.indexOf("// 기존 작품 로드 또는 리믹스 대상 로드."),
      studioPageSource.indexOf("// 시리즈·챌린지 딥링크로 들어온 경우")
    );
    expect(serverHydration).toContain(
      "studioProjectDocumentSessionRef.current = null;"
    );

    const runtime = await import("./studio-project-document");
    const serialized = runtime.serializeStudioProjectDocument(
      { version: 2, title: "동적 계약", pagesList: [page()] },
      metadata
    );
    const loaded = await runtime.parseStudioProjectDocument(serialized);
    expect(loaded.source).toBe("canonical-envelope");
    expect(loaded.project.title).toBe("동적 계약");
  });
});
