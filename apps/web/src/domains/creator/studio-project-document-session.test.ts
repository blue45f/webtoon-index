import { describe, expect, it, vi } from "vitest";

import {
  appendStudioAiOperation,
  createEmptyStudioAiProvenanceDocument,
} from "./ai/studio-ai-provenance";
import {
  createCanonicalStudioDocumentEnvelope,
  serializeCanonicalStudioDocumentEnvelope,
} from "./studio-document-envelope";
import {
  createStudioProjectDocumentEnvelope,
  parseStudioProjectDocument,
  serializeStudioProjectDocument,
  STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
  STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
  STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE,
} from "./studio-project-document";
import {
  captureStudioProjectDocumentSession,
  planStudioProjectDocumentSessionExport,
} from "./studio-project-document-session";

const metadata = Object.freeze({
  documentId: "work:canonical-session",
  revision: 7,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T01:00:00.000Z",
});

const project = Object.freeze({
  version: 2,
  title: "세션 왕복",
  savedAt: "2026-07-26T01:30:00.000Z",
  "future.payload/v9": {
    retainedAcrossKnownEdits: true,
  },
  pagesList: [
    {
      id: "page-1",
      elements: [],
      bg: "#ffffff",
      bgGrad: null,
      canvasH: 2_000,
    },
  ],
});

function retainedAiProvenance(rawPrompt: string) {
  return appendStudioAiOperation(
    createEmptyStudioAiProvenanceDocument(),
    {
      id: "operation-private-prompt",
      kind: "text",
      task: "scenario",
      provider: "private-provider",
      model: "private-model",
      transport: "byok",
      promptVersion: 1,
      prompt: rawPrompt,
      createdAt: "2026-07-26T01:15:00.000Z",
    },
    { retainRawPrompt: true },
  );
}

describe("Studio project document session provenance", () => {
  it("roundtrips canonical audit metadata and opaque future extensions deterministically", async () => {
    const extensions = {
      "future.vendor/v9": {
        opaque: ["keep", { nested: true }],
        policyUnknownToThisBuild: 47,
      },
    };
    const source = serializeStudioProjectDocument(project, metadata, extensions);
    extensions["future.vendor/v9"].opaque[0] = "mutated-after-serialization";
    const loaded = await parseStudioProjectDocument(source);
    expect(loaded.source).toBe("canonical-envelope");
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");

    const session = captureStudioProjectDocumentSession(
      loaded.envelope,
      "scope:one",
      42,
    );
    const readCurrentProject = vi.fn(() => ({
      ...loaded.project,
      savedAt: "2099-01-01T00:00:00.000Z",
    }));
    const plan = planStudioProjectDocumentSessionExport({
      session,
      scopeKey: "scope:one",
      currentGeneration: 42,
      exportedAt: "2026-07-26T03:00:00.000Z",
      fallbackMetadata: {
        documentId: "draft:wrong",
        revision: 0,
        createdAt: "2026-07-26T03:00:00.000Z",
        updatedAt: "2026-07-26T03:00:00.000Z",
      },
      readCurrentProject,
    });
    if (!plan.directEnvelope) throw new Error("Expected a direct canonical envelope");
    const roundtrip = serializeCanonicalStudioDocumentEnvelope(plan.directEnvelope);

    expect(plan.provenance).toBe("unchanged");
    expect(readCurrentProject).not.toHaveBeenCalled();
    expect(plan.metadata).toEqual(metadata);
    expect(plan.extensions).toEqual({
      "future.vendor/v9": {
        opaque: ["keep", { nested: true }],
        policyUnknownToThisBuild: 47,
      },
    });
    expect(roundtrip).toBe(source);
    expect(Object.isFrozen(session)).toBe(true);
    expect(session.envelope).toBe(loaded.envelope);
    expect(Object.isFrozen(session.envelope)).toBe(true);
    expect(Object.isFrozen(session.envelope.payload.data)).toBe(true);
    expect(Object.isFrozen(session.document)).toBe(true);
    expect(Object.isFrozen(session.extensions)).toBe(true);
    expect(Object.isFrozen(session.extensions["future.vendor/v9"])).toBe(true);
  });

  it("redacts an imported raw AI prompt before a no-edit direct export", async () => {
    const rawPrompt = "공개되면 안 되는 작가의 결말 프롬프트";
    const extensions = {
      "future.vendor/v10": {
        opaque: ["preserve", { nested: true }],
      },
    };
    const unsafeEnvelope = createCanonicalStudioDocumentEnvelope({
      format: {
        id: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
        version: STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
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
          ...project,
          aiProvenance: retainedAiProvenance(rawPrompt),
        },
      },
      extensions,
    });
    const unsafeSource = serializeCanonicalStudioDocumentEnvelope(unsafeEnvelope);
    expect(unsafeSource).toContain(rawPrompt);

    const loaded = await parseStudioProjectDocument(unsafeSource);
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");
    expect(JSON.stringify(loaded.project)).not.toContain(rawPrompt);

    const session = captureStudioProjectDocumentSession(
      loaded.envelope,
      "scope:private-import",
      11,
    );
    const readCurrentProject = vi.fn(() => loaded.project);
    const plan = planStudioProjectDocumentSessionExport({
      session,
      scopeKey: "scope:private-import",
      currentGeneration: 11,
      exportedAt: "2026-07-26T05:00:00.000Z",
      fallbackMetadata: metadata,
      readCurrentProject,
    });
    if (!plan.directEnvelope) throw new Error("Expected a direct canonical envelope");
    const exported = serializeCanonicalStudioDocumentEnvelope(plan.directEnvelope);

    expect(plan.provenance).toBe("unchanged");
    expect(readCurrentProject).not.toHaveBeenCalled();
    expect(loaded.envelope).not.toBe(unsafeEnvelope);
    expect(plan.directEnvelope).toBe(loaded.envelope);
    expect(exported).not.toContain(rawPrompt);
    expect(plan.directEnvelope.document).toEqual(loaded.envelope.document);
    expect(plan.directEnvelope.extensions).toEqual(extensions);
    expect(plan.directEnvelope.payload.data).toMatchObject({
      "future.payload/v9": {
        retainedAcrossKnownEdits: true,
      },
      aiProvenance: {
        version: 1,
        operations: [
          {
            prompt: {
              retention: "hash-only",
            },
          },
        ],
      },
    });
    expect(
      (plan.directEnvelope.payload.data as Record<string, unknown>).aiProvenance,
    ).not.toHaveProperty("operations.0.prompt.raw");
  });

  it("redacts raw prompts hidden in a secondary legacy operation list", async () => {
    const shadowPrompt = "operations 배열 뒤에 숨겨 둔 원문 프롬프트";
    const unsafeEnvelope = createCanonicalStudioDocumentEnvelope({
      format: {
        id: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
        version: STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
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
          ...project,
          aiProvenance: {
            version: 1,
            operations: [],
            entries: [{ rawPrompt: shadowPrompt }],
          },
        },
      },
      extensions: {
        "future.vendor/shadow": { retained: true },
      },
    });
    const loaded = await parseStudioProjectDocument(
      serializeCanonicalStudioDocumentEnvelope(unsafeEnvelope),
    );
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");

    const session = captureStudioProjectDocumentSession(
      loaded.envelope,
      "scope:shadow-list",
      12,
    );
    const plan = planStudioProjectDocumentSessionExport({
      session,
      scopeKey: "scope:shadow-list",
      currentGeneration: 12,
      exportedAt: metadata.updatedAt,
      fallbackMetadata: metadata,
      readCurrentProject: vi.fn(() => loaded.project),
    });
    if (!plan.directEnvelope) throw new Error("Expected a direct canonical envelope");
    const exported = serializeCanonicalStudioDocumentEnvelope(plan.directEnvelope);

    expect(exported).not.toContain(shadowPrompt);
    expect(plan.directEnvelope.extensions).toEqual({
      "future.vendor/shadow": { retained: true },
    });
    expect(plan.directEnvelope.payload.data).toMatchObject({
      "future.payload/v9": {
        retainedAcrossKnownEdits: true,
      },
      aiProvenance: {
        version: 1,
        operations: [],
      },
    });
  });

  it("advances revision and updatedAt once per edited generation frontier", async () => {
    const loaded = await parseStudioProjectDocument(
      serializeStudioProjectDocument(project, metadata, {
        "vendor.opaque": { retained: true },
      }),
    );
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");
    const session = captureStudioProjectDocumentSession(
      loaded.envelope,
      "scope:edited",
      100,
    );
    const advanced = planStudioProjectDocumentSessionExport({
      session,
      scopeKey: "scope:edited",
      currentGeneration: 103,
      exportedAt: "2026-07-26T04:00:00.000Z",
      fallbackMetadata: metadata,
      readCurrentProject: () => ({
        version: 2,
        title: "현재 편집 제목",
        savedAt: "2026-07-26T03:59:59.000Z",
        pagesList: project.pagesList,
      }),
    });

    expect(advanced.provenance).toBe("advanced");
    expect(advanced.metadata).toEqual({
      documentId: metadata.documentId,
      revision: metadata.revision + 3,
      createdAt: metadata.createdAt,
      updatedAt: "2026-07-26T04:00:00.000Z",
    });
    expect(advanced.extensions).toEqual({
      "vendor.opaque": { retained: true },
    });
    expect(advanced.directEnvelope).toBeNull();
    expect(advanced.project).toMatchObject({
      title: "현재 편집 제목",
      savedAt: "2026-07-26T03:59:59.000Z",
      "future.payload/v9": {
        retainedAcrossKnownEdits: true,
      },
    });

    const advancedEnvelope = createStudioProjectDocumentEnvelope(
      advanced.project,
      advanced.metadata,
      advanced.extensions,
    );
    expect(advancedEnvelope.document).toMatchObject({
      id: metadata.documentId,
      revision: metadata.revision + 3,
      createdAt: metadata.createdAt,
      updatedAt: "2026-07-26T04:00:00.000Z",
    });
    expect(advancedEnvelope.payload.data).toMatchObject({
      title: "현재 편집 제목",
      savedAt: "2026-07-26T03:59:59.000Z",
      "future.payload/v9": {
        retainedAcrossKnownEdits: true,
      },
    });
    expect(advancedEnvelope.extensions).toEqual({
      "vendor.opaque": { retained: true },
    });
    const advancedSession = captureStudioProjectDocumentSession(
      advancedEnvelope,
      "scope:edited",
      103,
    );
    const readRepeatedProject = vi.fn(() => project);
    const repeated = planStudioProjectDocumentSessionExport({
      session: advancedSession,
      scopeKey: "scope:edited",
      currentGeneration: 103,
      exportedAt: "2026-07-26T05:00:00.000Z",
      fallbackMetadata: metadata,
      readCurrentProject: readRepeatedProject,
    });
    expect(repeated.provenance).toBe("unchanged");
    expect(repeated.metadata).toEqual(advanced.metadata);
    expect(repeated.extensions).toBe(advancedEnvelope.extensions);
    expect(repeated.extensions).toEqual(advanced.extensions);
    expect(repeated.directEnvelope).toBe(advancedEnvelope);
    expect(readRepeatedProject).not.toHaveBeenCalled();
  });

  it("fails closed to fresh metadata when document scope or generation authority changes", async () => {
    const loaded = await parseStudioProjectDocument(
      serializeStudioProjectDocument(project, metadata),
    );
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");
    const session = captureStudioProjectDocumentSession(
      loaded.envelope,
      "scope:original",
      9,
    );
    const fallbackMetadata = {
      documentId: "work:new-scope",
      revision: 2,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    };

    for (const plan of [
      planStudioProjectDocumentSessionExport({
        session,
        scopeKey: "scope:replacement",
        currentGeneration: 9,
        exportedAt: fallbackMetadata.updatedAt,
        fallbackMetadata,
        readCurrentProject: () => project,
      }),
      planStudioProjectDocumentSessionExport({
        session,
        scopeKey: "scope:original",
        currentGeneration: 8,
        exportedAt: fallbackMetadata.updatedAt,
        fallbackMetadata,
        readCurrentProject: () => project,
      }),
      planStudioProjectDocumentSessionExport({
        session: null,
        scopeKey: "scope:original",
        currentGeneration: 9,
        exportedAt: fallbackMetadata.updatedAt,
        fallbackMetadata,
        readCurrentProject: () => project,
      }),
    ]) {
      expect(plan).toMatchObject({
        provenance: "created",
        metadata: fallbackMetadata,
        extensions: {},
        directEnvelope: null,
      });
    }
  });

  it("captures the first canonical export so a second no-edit export reuses its exact identity", () => {
    const fallbackMetadata = {
      documentId: "draft:first-export",
      revision: 0,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    };
    const first = planStudioProjectDocumentSessionExport({
      session: null,
      scopeKey: "scope:fresh",
      currentGeneration: 5,
      exportedAt: fallbackMetadata.updatedAt,
      fallbackMetadata,
      readCurrentProject: () => project,
    });
    const firstEnvelope = createStudioProjectDocumentEnvelope(
      first.project,
      first.metadata,
      first.extensions,
    );
    const firstJson = serializeCanonicalStudioDocumentEnvelope(firstEnvelope);
    const firstSession = captureStudioProjectDocumentSession(
      firstEnvelope,
      "scope:fresh",
      5,
    );
    const readSecondProject = vi.fn(() => ({
      ...project,
      savedAt: "2099-01-01T00:00:00.000Z",
    }));

    const second = planStudioProjectDocumentSessionExport({
      session: firstSession,
      scopeKey: "scope:fresh",
      currentGeneration: 5,
      exportedAt: "2026-07-28T00:00:00.000Z",
      fallbackMetadata: {
        ...fallbackMetadata,
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z",
      },
      readCurrentProject: readSecondProject,
    });

    expect(first.provenance).toBe("created");
    expect(second.provenance).toBe("unchanged");
    expect(second.directEnvelope).toBe(firstEnvelope);
    expect(readSecondProject).not.toHaveBeenCalled();
    if (!second.directEnvelope) throw new Error("Expected captured direct envelope");
    expect(serializeCanonicalStudioDocumentEnvelope(second.directEnvelope)).toBe(firstJson);
  });

  it("rejects revision exhaustion instead of advancing a baseline with a reused revision", async () => {
    const loadSession = async (revision: number) => {
      const loaded = await parseStudioProjectDocument(
        serializeStudioProjectDocument(project, { ...metadata, revision }),
      );
      if (loaded.source !== "canonical-envelope") throw new Error("unreachable");
      return captureStudioProjectDocumentSession(
        loaded.envelope,
        `scope:revision:${revision}`,
        10,
      );
    };
    const exhausted = await loadSession(Number.MAX_SAFE_INTEGER);
    const oneRemaining = await loadSession(Number.MAX_SAFE_INTEGER - 1);

    expect(() => planStudioProjectDocumentSessionExport({
      session: exhausted,
      scopeKey: exhausted.scopeKey,
      currentGeneration: 11,
      exportedAt: "2026-07-26T04:00:00.000Z",
      fallbackMetadata: metadata,
      readCurrentProject: () => project,
    })).toThrow(/revision range is exhausted/u);
    expect(() => planStudioProjectDocumentSessionExport({
      session: oneRemaining,
      scopeKey: oneRemaining.scopeKey,
      currentGeneration: 12,
      exportedAt: "2026-07-26T04:00:00.000Z",
      fallbackMetadata: metadata,
      readCurrentProject: () => project,
    })).toThrow(/revision range is exhausted/u);

    const boundary = planStudioProjectDocumentSessionExport({
      session: oneRemaining,
      scopeKey: oneRemaining.scopeKey,
      currentGeneration: 11,
      exportedAt: "2026-07-26T04:00:00.000Z",
      fallbackMetadata: metadata,
      readCurrentProject: () => project,
    });
    expect(boundary.metadata.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(exhausted.document.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(exhausted.baselineGeneration).toBe(10);
  });

  it("rejects an edited export when its canonical timestamp cannot advance", async () => {
    const endOfCanonicalTime = "9999-12-31T23:59:59.999Z";
    const loaded = await parseStudioProjectDocument(
      serializeStudioProjectDocument(project, {
        ...metadata,
        updatedAt: endOfCanonicalTime,
      }),
    );
    if (loaded.source !== "canonical-envelope") throw new Error("unreachable");
    const session = captureStudioProjectDocumentSession(
      loaded.envelope,
      "scope:timestamp",
      3,
    );

    expect(() => planStudioProjectDocumentSessionExport({
      session,
      scopeKey: "scope:timestamp",
      currentGeneration: 4,
      exportedAt: endOfCanonicalTime,
      fallbackMetadata: metadata,
      readCurrentProject: () => project,
    })).toThrow(/timestamp range is exhausted/u);
    expect(session.baselineGeneration).toBe(3);
    expect(session.document.updatedAt).toBe(endOfCanonicalTime);
  });

  it("rejects unsafe edit-generation counters before reading current project state", () => {
    const readCurrentProject = vi.fn(() => project);
    expect(() => planStudioProjectDocumentSessionExport({
      session: null,
      scopeKey: "scope:unsafe-generation",
      currentGeneration: Number.MAX_SAFE_INTEGER + 1,
      exportedAt: metadata.updatedAt,
      fallbackMetadata: metadata,
      readCurrentProject,
    })).toThrow(/generation must be a non-negative safe integer/u);
    expect(readCurrentProject).not.toHaveBeenCalled();
  });
});
