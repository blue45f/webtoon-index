import { describe, expect, it } from "vitest";

import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";
import { parseStudioProjectFile } from "./studio-project-file";
import { buildStudioServerRevisionComparison } from "./studio-server-revision-comparison";

import {
  REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL,
  projectRevisionComparisonValue,
} from "@/shared/lib/revision-comparison-projection";

function page(text: string) {
  return {
    id: "page-1",
    elements: [{ id: "dialogue-1", type: "text", text }],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1600,
  };
}

function snapshot(title: string, text: string) {
  return { title, description: "", tags: [], doc: { pagesList: [page(text)] } };
}

function aiProvenance(requestId: string, digest: string) {
  return {
    version: 1,
    operations: [{
      id: "operation-1",
      kind: "text",
      task: "dialogue",
      provider: "provider-a",
      model: "model-a",
      transport: "server",
      promptVersion: 1,
      prompt: {
        sha256: digest,
        summary: "텍스트 AI 프롬프트 · 내용 비공개",
        retention: "hash-only",
      },
      status: "succeeded",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
      references: [],
      requestId,
    }],
  };
}

interface PrivateAiSemanticFields {
  kind: "text" | "image";
  task: "dialogue" | "scenario" | "background-image";
  status: "succeeded" | "failed";
  promptVersion: number;
  requestedSize: { width: number; height: number };
}

function privateAiProvenance(fields: PrivateAiSemanticFields) {
  return {
    version: 1,
    operations: [{
      id: "private-operation-id-zeta",
      ...fields,
      provider: "private-provider-zeta",
      model: "private-model-zeta",
      transport: "byok",
      prompt: {
        sha256: "9".repeat(64),
        raw: "private raw prompt zeta",
      },
      createdAt: "2026-07-13T01:02:03.000Z",
      updatedAt: "2026-07-13T01:02:04.000Z",
      usage: { promptTokens: 101, completionTokens: 202, totalTokens: 303 },
      target: { pageId: "private-page-zeta", elementId: "private-element-zeta" },
      references: [{ assetId: "private-reference-zeta", sha256: "8".repeat(64) }],
      requestId: "private-request-zeta",
      ...(fields.status === "failed"
        ? { error: { category: "provider", code: "PRIVATE_PROVIDER_FAILURE" } }
        : {}),
    }],
  };
}

describe("buildStudioServerRevisionComparison", () => {
  it("separates target changes from unsaved local changes without retaining snapshots", () => {
    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 2,
      baseRevision: 4,
      targetSnapshot: snapshot("초안", "처음 만나"),
      baseSnapshot: snapshot("현재", "안녕"),
      localProject: parseStudioProjectFile({
        version: 2,
        title: "현재",
        pagesList: [page("안녕!")],
      }),
    });

    expect(comparison).toMatchObject({ targetRevision: 2, baseRevision: 4 });
    expect(comparison.localToTarget.hasChanges).toBe(true);
    expect(comparison.localToTarget.summary["document-metadata-changed"]).toBe(1);
    expect(comparison.localToTarget.summary["element-text-changed"]).toBe(1);
    expect(comparison.serverToLocal.summary["element-text-changed"]).toBe(1);
    expect(comparison).not.toHaveProperty("targetSnapshot");
    expect(comparison).not.toHaveProperty("baseSnapshot");
    expect(JSON.stringify(comparison)).not.toContain("처음 만나");
    expect(JSON.stringify(comparison)).not.toContain("안녕!");
  });

  it("describes page, element, and geometry changes in the actual local-to-target restore direction", () => {
    const targetPage = {
      ...page("복원할 대사"),
      elements: [
        { id: "dialogue-1", type: "text", text: "복원할 대사", x: 10 },
        { id: "target-only", type: "text", text: "되살아날 요소", x: 30 },
      ],
    };
    const localPage = {
      ...page("현재 대사"),
      elements: [
        { id: "dialogue-1", type: "text", text: "현재 대사", x: 50 },
        { id: "local-only", type: "text", text: "삭제될 요소", x: 70 },
      ],
    };
    const localSecondPage = {
      ...page("삭제될 페이지"),
      id: "page-2",
      elements: [{ id: "dialogue-2", type: "text", text: "삭제될 페이지" }],
    };
    const currentSnapshot = {
      title: "현재",
      description: "",
      tags: [],
      doc: { pagesList: [localPage, localSecondPage] },
    };

    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 2,
      baseRevision: 4,
      targetSnapshot: {
        title: "현재",
        description: "",
        tags: [],
        doc: { pagesList: [targetPage] },
      },
      baseSnapshot: currentSnapshot,
      localProject: parseStudioProjectFile({
        version: 2,
        title: "현재",
        pagesList: [localPage, localSecondPage],
      }),
    });

    expect(comparison.localToTarget.summary["page-removed"]).toBe(1);
    expect(comparison.localToTarget.summary["page-added"]).toBe(0);
    expect(comparison.localToTarget.summary["element-added"]).toBe(1);
    expect(comparison.localToTarget.summary["element-removed"]).toBe(1);
    expect(comparison.localToTarget.changes).toContainEqual(
      expect.objectContaining({
        kind: "element-moved",
        elementId: "dialogue-1",
        before: expect.objectContaining({ x: 50 }),
        after: expect.objectContaining({ x: 10 }),
      })
    );
    expect(comparison.serverToLocal).toMatchObject({ hasChanges: false, totalChanges: 0 });
  });

  it("prefers restore-target page labels, then current local labels, over stale baseline names", () => {
    const targetFirstPage = { ...page("복원할 대사"), name: "복원 대상 이름" };
    const baseFirstPage = { ...page("현재 대사"), name: "서버의 이전 이름" };
    const localFirstPage = { ...page("현재 대사"), name: "로컬의 현재 이름" };
    const baseSecondPage = {
      ...page("현재 둘째 페이지"),
      id: "page-2",
      name: "둘째 서버 이전 이름",
      elements: [{ id: "dialogue-2", type: "text", text: "현재 둘째 페이지" }],
    };
    const localSecondPage = {
      ...baseSecondPage,
      name: "둘째 로컬 현재 이름",
    };

    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 2,
      baseRevision: 4,
      targetSnapshot: {
        title: "현재",
        description: "",
        tags: [],
        doc: { pagesList: [targetFirstPage] },
      },
      baseSnapshot: {
        title: "현재",
        description: "",
        tags: [],
        doc: { pagesList: [baseFirstPage, baseSecondPage] },
      },
      localProject: parseStudioProjectFile({
        version: 2,
        title: "현재",
        pagesList: [localFirstPage, localSecondPage],
      }),
    });

    expect(comparison.pageLabels).toMatchObject({
      "page-1": "복원 대상 이름",
      "page-2": "둘째 로컬 현재 이름",
    });
  });

  it("compares registered doc.fx against the current server baseline", () => {
    const target = snapshot("현재", "안녕");
    target.doc = { ...target.doc, fx: { reveal: "fade-up" } } as typeof target.doc;
    const base = snapshot("현재", "안녕");
    base.doc = { ...base.doc, fx: { reveal: "zoom-in" } } as typeof base.doc;

    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 2,
      baseRevision: 4,
      targetSnapshot: target,
      baseSnapshot: base,
      localProject: parseStudioProjectFile({ version: 2, title: "현재", pagesList: [page("안녕")] }),
    });

    expect(comparison.serverToLocal).toMatchObject({ hasChanges: false, totalChanges: 0 });
    expect(comparison.localToTarget.summary["document-extension-changed"]).toBe(1);
    expect(comparison.localToTarget.changes).toContainEqual(
      expect.objectContaining({ kind: "document-extension-changed", field: "fx" })
    );
  });

  it("ignores private AI transport and prompt identifiers in the creative comparison", () => {
    const target = snapshot("현재", "안녕");
    target.doc = {
      ...target.doc,
      aiProvenance: aiProvenance("provider-request-old", "a".repeat(64)),
    } as typeof target.doc;
    const base = snapshot("현재", "안녕");
    base.doc = {
      ...base.doc,
      aiProvenance: aiProvenance("provider-request-new", "b".repeat(64)),
    } as typeof base.doc;

    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 2,
      baseRevision: 4,
      targetSnapshot: target,
      baseSnapshot: base,
      localProject: parseStudioProjectFile({
        version: 2,
        title: "현재",
        pagesList: [page("안녕")],
        aiProvenance: aiProvenance("local-request", "c".repeat(64)),
      }),
    });

    expect(comparison.localToTarget).toMatchObject({ hasChanges: false, totalChanges: 0 });
    expect(comparison.serverToLocal).toMatchObject({ hasChanges: false, totalChanges: 0 });
    expect(JSON.stringify(comparison)).not.toContain("provider-request");
    expect(JSON.stringify(comparison)).not.toContain("a".repeat(64));
  });

  it("parses the synthetic AI scaffold and compares only whitelisted creative semantics", async () => {
    const localSemanticFields: PrivateAiSemanticFields = {
      kind: "text",
      task: "dialogue",
      status: "succeeded",
      promptVersion: 1,
      requestedSize: { width: 512, height: 768 },
    };
    const localSource = {
      version: 2,
      title: "현재",
      pagesList: [page("안녕")],
      aiProvenance: privateAiProvenance(localSemanticFields),
    };
    const baseSource = {
      ...snapshot("현재", "안녕"),
      doc: {
        pagesList: [page("안녕")],
        aiProvenance: privateAiProvenance(localSemanticFields),
      },
    };
    const projectedLocalValue = await projectRevisionComparisonValue(localSource);
    const projectedBaseValue = await projectRevisionComparisonValue(baseSource);
    const projectedLocalRecord = projectedLocalValue as {
      aiProvenance: { operations: Record<string, unknown>[] };
    };
    const projectedOperation = projectedLocalRecord.aiProvenance.operations[0];

    expect(projectedOperation).toEqual({
      id: "revision-comparison-operation-000001",
      kind: "text",
      task: "dialogue",
      prompt: { sha256: REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL },
      promptVersion: 1,
      status: "succeeded",
      createdAt: "1970-01-01T00:00:00.000Z",
      requestedSize: { width: 512, height: 768 },
    });
    for (const privateField of [
      "provider",
      "model",
      "transport",
      "updatedAt",
      "usage",
      "target",
      "references",
      "requestId",
      "error",
    ]) {
      expect(projectedOperation).not.toHaveProperty(privateField);
    }
    const serializedProjection = JSON.stringify(projectedLocalValue);
    for (const privateValue of [
      "private-operation-id-zeta",
      "private-provider-zeta",
      "private-model-zeta",
      "private raw prompt zeta",
      "2026-07-13T01:02:03.000Z",
      "2026-07-13T01:02:04.000Z",
      "private-page-zeta",
      "private-element-zeta",
      "private-reference-zeta",
      "private-request-zeta",
      "9".repeat(64),
      "8".repeat(64),
    ]) {
      expect(serializedProjection).not.toContain(privateValue);
    }

    const parsedLocal = parseStudioProjectFile(projectedLocalValue);
    expect(parsedLocal.aiProvenance?.operations).toHaveLength(1);
    expect(parsedLocal.aiProvenance?.operations[0]).toMatchObject({
      id: "revision-comparison-operation-000001",
      ...localSemanticFields,
      provider: "unknown",
      model: "unknown",
      transport: "other",
      prompt: { sha256: REVISION_COMPARISON_AI_PROMPT_DIGEST_SENTINEL },
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      references: [],
    });

    const semanticCases: { name: string; target: PrivateAiSemanticFields }[] = [
      {
        name: "kind",
        target: { ...localSemanticFields, kind: "image", task: "background-image" },
      },
      { name: "task", target: { ...localSemanticFields, task: "scenario" } },
      { name: "status", target: { ...localSemanticFields, status: "failed" } },
      { name: "promptVersion", target: { ...localSemanticFields, promptVersion: 2 } },
      {
        name: "requestedSize",
        target: { ...localSemanticFields, requestedSize: { width: 1024, height: 1536 } },
      },
    ];

    for (const semanticCase of semanticCases) {
      const projectedTargetValue = await projectRevisionComparisonValue({
        ...snapshot("현재", "안녕"),
        doc: {
          pagesList: [page("안녕")],
          aiProvenance: privateAiProvenance(semanticCase.target),
        },
      });
      const parsedTarget = creatorWorkSnapshotToStudioProject(projectedTargetValue);
      expect(
        parsedTarget.aiProvenance?.operations[0],
        `${semanticCase.name} projection should survive the Studio parser`
      ).toMatchObject(semanticCase.target);

      const comparison = buildStudioServerRevisionComparison({
        targetRevision: 2,
        baseRevision: 4,
        targetSnapshot: projectedTargetValue,
        baseSnapshot: projectedBaseValue,
        localProject: parsedLocal,
      });

      expect(
        comparison.localToTarget.summary["document-content-changed"],
        `${semanticCase.name} should remain semantically comparable`
      ).toBe(1);
      expect(comparison.localToTarget.changes).toContainEqual({
        kind: "document-content-changed",
        scope: "document",
        field: "aiProvenance",
      });
      expect(comparison.serverToLocal).toMatchObject({ hasChanges: false, totalChanges: 0 });
    }
  });

  it("treats omitted legacy sections and explicit empty editor defaults as the same content", () => {
    const server = snapshot("현재", "안녕");
    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 3,
      baseRevision: 3,
      targetSnapshot: server,
      baseSnapshot: server,
      localProject: parseStudioProjectFile({
        version: 2,
        title: "현재",
        pagesList: [page("안녕")],
        aiProvenance: { version: 1, operations: [] },
        characterBible: { version: 1, characters: [] },
        comments: { version: 1, threads: [] },
        releaseSchedule: { version: 1, items: [] },
        publicationAnalytics: { version: 1, records: [] },
        publishPack: undefined,
      }),
    });

    expect(comparison.localToTarget).toMatchObject({ hasChanges: false, totalChanges: 0 });
    expect(comparison.serverToLocal).toMatchObject({ hasChanges: false, totalChanges: 0 });
  });

  it("compares server-owned publication links against the current server base, not query aliases", () => {
    const target = {
      ...snapshot("현재", "안녕"),
      titleId: "old-title",
      seriesId: null,
      challengeId: null,
      episodeNo: null,
      remixFromId: null,
      format: "cuttoon",
      status: "draft",
    };
    const base = {
      ...target,
      titleId: "current-title",
      status: "published",
    };
    const comparison = buildStudioServerRevisionComparison({
      targetRevision: 2,
      baseRevision: 4,
      targetSnapshot: target,
      baseSnapshot: base,
      localProject: parseStudioProjectFile({
        version: 2,
        title: "현재",
        pagesList: [page("안녕")],
        linkedTitleId: "query-only-link",
      }),
    });

    expect(comparison.serverToLocal).toMatchObject({ hasChanges: false, totalChanges: 0 });
    expect(comparison.localToTarget.summary["publication-metadata-changed"]).toBe(2);
    expect(comparison.localToTarget.changes.map((change) => change.field)).toEqual([
      "status",
      "titleId",
    ]);
    expect(comparison.publicationImpact).toEqual({
      statusChange: { before: "published", after: "draft" },
      changedRelations: ["titleId"],
    });
  });

  it("rejects upload-format targets before the cuttoon editor can restore them", () => {
    expect(() => buildStudioServerRevisionComparison({
      targetRevision: 1,
      baseRevision: 2,
      targetSnapshot: { ...snapshot("업로드", ""), format: "upload" },
      baseSnapshot: { ...snapshot("컷툰", "안녕"), format: "cuttoon" },
      localProject: parseStudioProjectFile({ version: 2, pagesList: [page("안녕")] }),
    })).toThrow("업로드형 과거 버전");
  });
});
