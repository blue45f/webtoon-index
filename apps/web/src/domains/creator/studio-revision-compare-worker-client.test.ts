import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { parseStudioProjectFile } from "./studio-project-file";
import {
  runStudioRevisionComparison,
  STUDIO_REVISION_COMPARE_DIRECT_MAX_ELEMENTS,
  STUDIO_REVISION_COMPARE_MAX_DEPTH,
  STUDIO_REVISION_COMPARE_MAX_ELEMENTS,
  STUDIO_REVISION_COMPARE_MAX_INDIVIDUAL_STRING_CODE_UNITS,
  STUDIO_REVISION_COMPARE_MAX_PAGE_ID_LIST,
  STUDIO_REVISION_COMPARE_MAX_PAGE_LABELS,
  type StudioRevisionCompareWorkerLike,
  type StudioRevisionCompareWorkerRequest,
  type StudioRevisionCompareWorkerResponse,
} from "./studio-revision-compare-worker-client";
import {
  buildStudioServerRevisionComparison,
  type StudioServerRevisionComparisonInput,
} from "./studio-server-revision-comparison";

function page(text: string) {
  return {
    id: "page-1",
    elements: [{ id: "text-1", type: "text", text }],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1200,
  };
}

function input(): StudioServerRevisionComparisonInput {
  return {
    targetRevision: 2,
    baseRevision: 4,
    targetSnapshot: { title: "초안", tags: [], doc: { pagesList: [page("처음")] } },
    baseSnapshot: { title: "현재", tags: [], doc: { pagesList: [page("안녕")] } },
    localProject: parseStudioProjectFile({ version: 2, title: "현재", pagesList: [page("안녕!")] }),
  };
}

class ApplyingWorker implements StudioRevisionCompareWorkerLike {
  onmessage: StudioRevisionCompareWorkerLike["onmessage"] = null;
  onerror: StudioRevisionCompareWorkerLike["onerror"] = null;
  terminateCount = 0;

  postMessage(message: StudioRevisionCompareWorkerRequest): void {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "studio-revision-compare/success",
          version: 1,
          comparison: buildStudioServerRevisionComparison(structuredClone(message.input)),
        },
      } as MessageEvent<StudioRevisionCompareWorkerResponse>);
    });
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class HangingWorker implements StudioRevisionCompareWorkerLike {
  onmessage: StudioRevisionCompareWorkerLike["onmessage"] = null;
  onerror: StudioRevisionCompareWorkerLike["onerror"] = null;
  terminateCount = 0;
  private resolvePosted: () => void = () => undefined;
  readonly posted = new Promise<void>((resolve) => {
    this.resolvePosted = resolve;
  });

  postMessage(): void {
    this.resolvePosted();
  }
  terminate(): void {
    this.terminateCount += 1;
  }
}

class ReplyWorker implements StudioRevisionCompareWorkerLike {
  onmessage: StudioRevisionCompareWorkerLike["onmessage"] = null;
  onerror: StudioRevisionCompareWorkerLike["onerror"] = null;
  postMessageCount = 0;
  terminateCount = 0;

  constructor(private readonly response: unknown) {}

  postMessage(): void {
    this.postMessageCount += 1;
    queueMicrotask(() => {
      this.onmessage?.({
        data: this.response as StudioRevisionCompareWorkerResponse,
      } as MessageEvent<StudioRevisionCompareWorkerResponse>);
    });
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class RuntimeFailureWorker implements StudioRevisionCompareWorkerLike {
  onmessage: StudioRevisionCompareWorkerLike["onmessage"] = null;
  onerror: StudioRevisionCompareWorkerLike["onerror"] = null;
  postMessageCount = 0;
  terminateCount = 0;
  readonly preventDefault = vi.fn();

  postMessage(): void {
    this.postMessageCount += 1;
    queueMicrotask(() => {
      this.onerror?.({ preventDefault: this.preventDefault });
    });
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

class PostFailureWorker implements StudioRevisionCompareWorkerLike {
  onmessage: StudioRevisionCompareWorkerLike["onmessage"] = null;
  onerror: StudioRevisionCompareWorkerLike["onerror"] = null;
  postMessageCount = 0;
  terminateCount = 0;

  postMessage(): void {
    this.postMessageCount += 1;
    throw new DOMException("clone failed", "DataCloneError");
  }

  terminate(): void {
    this.terminateCount += 1;
  }
}

function successResponse(): Extract<
  StudioRevisionCompareWorkerResponse,
  { type: "studio-revision-compare/success" }
> {
  return {
    type: "studio-revision-compare/success",
    version: 1,
    comparison: buildStudioServerRevisionComparison(input()),
  };
}

describe("runStudioRevisionComparison", () => {
  it("uses the module worker path and returns only semantic descriptors", async () => {
    const worker = new ApplyingWorker();
    const result = await runStudioRevisionComparison(input(), {
      executionBackend: "worker",
      workerFactory: () => worker,
    });
    expect(result.targetRevision).toBe(2);
    expect(result.localToTarget.hasChanges).toBe(true);
    expect(result.serverToLocal.summary["element-text-changed"]).toBe(1);
    expect(result).not.toHaveProperty("targetSnapshot");
    expect(worker.terminateCount).toBe(1);
  });

  it("projects local resource URLs before they can cross the Worker boundary", async () => {
    const rawDataUrl = "data:image/png;base64,private-local-pixels";
    const projected = input();
    projected.localProject = parseStudioProjectFile({
      version: 2,
      title: "현재",
      pagesList: [{
        id: "page-1",
        elements: [{ id: "image-1", type: "image", src: rawDataUrl }],
        bg: "#fff",
        bgGrad: null,
        canvasH: 1200,
      }],
    });

    let posted = "";
    const worker = new ApplyingWorker();
    const originalPostMessage = worker.postMessage.bind(worker);
    worker.postMessage = (message) => {
      posted = JSON.stringify(message);
      originalPostMessage(message);
    };

    await runStudioRevisionComparison(projected, {
      executionBackend: "worker",
      workerFactory: () => worker,
    });
    expect(posted).not.toContain(rawDataUrl);
    expect(posted).not.toContain("data:image");
    expect(posted).toContain("toonspectrum:resource-sha256:v1:");
  });

  it("runs direct comparison only when direct was selected before the request", async () => {
    const workerFactory = vi.fn(() => new ApplyingWorker());
    const result = await runStudioRevisionComparison(input(), {
      executionBackend: "direct",
      workerFactory,
    });
    expect(result.localToTarget.totalChanges).toBeGreaterThan(0);
    expect(result.serverToLocal.totalChanges).toBe(1);
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it("defaults to Worker and fails closed when that backend is unavailable or cannot be created", async () => {
    await expect(runStudioRevisionComparison(input(), {
      workerFactory: null,
    })).rejects.toMatchObject({
      name: "StudioRevisionCompareWorkerError",
      message: "버전 비교 Worker를 사용할 수 없습니다.",
    });

    const throwingFactory = vi.fn((): StudioRevisionCompareWorkerLike => {
      throw new Error("worker constructor blocked");
    });
    await expect(runStudioRevisionComparison(input(), {
      executionBackend: "worker",
      workerFactory: throwingFactory,
    })).rejects.toMatchObject({
      name: "StudioRevisionCompareWorkerError",
      message: "버전 비교 Worker를 생성하지 못했습니다.",
    });
    expect(throwingFactory).toHaveBeenCalledOnce();
  });

  it("does not rerun direct comparison after Worker post or runtime failure", async () => {
    const postFailure = new PostFailureWorker();
    await expect(runStudioRevisionComparison(input(), {
      executionBackend: "worker",
      workerFactory: () => postFailure,
    })).rejects.toMatchObject({
      name: "StudioRevisionCompareWorkerError",
      message: "버전 비교 Worker 요청을 시작하지 못했습니다.",
    });
    expect(postFailure.postMessageCount).toBe(1);
    expect(postFailure.terminateCount).toBe(1);

    const runtimeFailure = new RuntimeFailureWorker();
    await expect(runStudioRevisionComparison(input(), {
      executionBackend: "worker",
      workerFactory: () => runtimeFailure,
    })).rejects.toMatchObject({
      name: "StudioRevisionCompareWorkerError",
      message: "버전 비교 Worker 실행에 실패했습니다.",
    });
    expect(runtimeFailure.postMessageCount).toBe(1);
    expect(runtimeFailure.preventDefault).toHaveBeenCalledOnce();
    expect(runtimeFailure.terminateCount).toBe(1);
  });

  it("terminates an in-flight worker when comparison is cancelled", async () => {
    const worker = new HangingWorker();
    const controller = new AbortController();
    const pending = runStudioRevisionComparison(input(), {
      executionBackend: "worker",
      workerFactory: () => worker,
      signal: controller.signal,
    });
    await worker.posted;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminateCount).toBe(1);
  });

  it("refuses a huge explicit direct comparison instead of freezing the editor", async () => {
    const elements = Array.from(
      { length: STUDIO_REVISION_COMPARE_DIRECT_MAX_ELEMENTS + 1 },
      (_, index) => ({ id: `element-${index}`, type: "image" })
    );
    const huge = input();
    huge.localProject = parseStudioProjectFile({
      version: 2,
      pagesList: [{ id: "page-1", elements: [], bg: "#fff", bgGrad: null, canvasH: 1000 }],
    });
    huge.targetSnapshot = {
      title: "큰 원고",
      tags: [],
      doc: { pagesList: [{ id: "page-1", elements, bg: "#fff", bgGrad: null, canvasH: 1000 }] },
    };

    await expect(runStudioRevisionComparison(huge, {
      executionBackend: "direct",
    })).rejects.toThrow(/direct 버전 비교는 안전 상한/);
  });

  it("rejects null and malformed Worker envelopes instead of trusting TypeScript types", async () => {
    const malformedSummary = successResponse() as unknown as Record<string, unknown>;
    const comparison = malformedSummary.comparison as Record<string, unknown>;
    const targetDiff = comparison.localToTarget as Record<string, unknown>;
    const summary = targetDiff.summary as Record<string, unknown>;
    summary["document-metadata-changed"] = -1;

    for (const response of [null, {}, malformedSummary]) {
      const worker = new ReplyWorker(response);
      await expect(
        runStudioRevisionComparison(input(), {
          executionBackend: "worker",
          workerFactory: () => worker,
        })
      ).rejects.toThrow(/응답 계약/);
      expect(worker.terminateCount).toBe(1);
    }
  });

  it("accepts only bounded Worker failures and never surfaces an oversized provider message", async () => {
    const bounded = new ReplyWorker({
      type: "studio-revision-compare/failure",
      version: 1,
      error: { name: "StudioRevisionDiffError", message: "중복 요소 ID" },
    });
    await expect(
      runStudioRevisionComparison(input(), {
        executionBackend: "worker",
        workerFactory: () => bounded,
      })
    ).rejects.toMatchObject({ name: "StudioRevisionDiffError", message: "중복 요소 ID" });

    const oversizedPrivateMessage = "private".repeat(400);
    const oversized = new ReplyWorker({
      type: "studio-revision-compare/failure",
      version: 1,
      error: { name: "Error", message: oversizedPrivateMessage },
    });
    const error = await runStudioRevisionComparison(input(), {
      executionBackend: "worker",
      workerFactory: () => oversized,
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("응답 계약");
    expect(String(error)).not.toContain(oversizedPrivateMessage);
  });

  it("rejects inconsistent diff flags, summaries, scopes, and oversized descriptor arrays", async () => {
    const inconsistentFlags = successResponse();
    inconsistentFlags.comparison.localToTarget.truncated =
      !inconsistentFlags.comparison.localToTarget.truncated;

    const wrongScope = successResponse();
    (wrongScope.comparison.localToTarget.changes[0] as { scope: string }).scope = "element";

    const oversizedIds = successResponse();
    const firstChange = oversizedIds.comparison.localToTarget.changes[0] as {
      beforePageIds?: string[];
    };
    firstChange.beforePageIds = Array.from(
      { length: STUDIO_REVISION_COMPARE_MAX_PAGE_ID_LIST + 1 },
      (_, index) => `page-${index}`
    );

    const invalidPublicationImpact = successResponse();
    invalidPublicationImpact.comparison.publicationImpact = {
      statusChange: { before: "draft", after: "draft" },
      changedRelations: [],
    };

    const oversizedPageLabels = successResponse();
    oversizedPageLabels.comparison.pageLabels = Object.fromEntries(
      Array.from(
        { length: STUDIO_REVISION_COMPARE_MAX_PAGE_LABELS + 1 },
        (_, index) => [`page-${index}`, `${index + 1}페이지`]
      )
    );

    for (const response of [
      inconsistentFlags,
      wrongScope,
      oversizedIds,
      invalidPublicationImpact,
      oversizedPageLabels,
    ]) {
      await expect(
        runStudioRevisionComparison(input(), {
          executionBackend: "worker",
          workerFactory: () => new ReplyWorker(response),
        })
      ).rejects.toThrow(/응답 계약/);
    }
  });

  it("applies the shared element ceiling before creating or posting to a Worker", async () => {
    const oversized = input();
    oversized.targetSnapshot = {
      title: "과대 원고",
      tags: [],
      doc: {
        pagesList: [{
          id: "page-1",
          elements: new Array(STUDIO_REVISION_COMPARE_MAX_ELEMENTS + 1),
          bg: "#fff",
          bgGrad: null,
          canvasH: 1200,
        }],
      },
    };
    let factoryCalls = 0;

    await expect(runStudioRevisionComparison(oversized, {
      executionBackend: "worker",
      workerFactory: () => {
        factoryCalls += 1;
        return new HangingWorker();
      },
    })).rejects.toThrow(/페이지·마스터 요소 수/);
    expect(factoryCalls).toBe(0);
  });

  it("fails closed on deep and cyclic graphs before Worker cloning", async () => {
    const deep = input();
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < STUDIO_REVISION_COMPARE_MAX_DEPTH + 1; index += 1) {
      nested = { nested };
    }
    const deepTarget = deep.targetSnapshot as { doc: Record<string, unknown> };
    deepTarget.doc.extension = nested;

    const cyclic = input();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const cyclicTarget = cyclic.targetSnapshot as { doc: Record<string, unknown> };
    cyclicTarget.doc.extension = loop;

    for (const unsafe of [deep, cyclic]) {
      let factoryCalls = 0;
      await expect(runStudioRevisionComparison(unsafe, {
        executionBackend: "worker",
        workerFactory: () => {
          factoryCalls += 1;
          return new HangingWorker();
        },
      })).rejects.toThrow(/안전 한도/);
      expect(factoryCalls).toBe(0);
    }
  });

  it("rejects an oversized data URL before either direct comparison or hashing/cloning", async () => {
    const oversized = input();
    const oversizedTarget = oversized.targetSnapshot as { doc: Record<string, unknown> };
    oversizedTarget.doc.preview =
      `data:image/png;base64,${"A".repeat(
        STUDIO_REVISION_COMPARE_MAX_INDIVIDUAL_STRING_CODE_UNITS + 1
      )}`;

    await expect(
      runStudioRevisionComparison(oversized, { executionBackend: "direct" })
    ).rejects.toThrow(/개별 문자열/);
  });

  it("keeps the product callsite on the explicit Worker backend", () => {
    const panel = readFileSync(new URL("./StudioCheckpointPanel.tsx", import.meta.url), "utf8");
    expect(panel).toContain('{ executionBackend: "worker", signal: controller.signal }');
  });
});
