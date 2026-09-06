import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_UPLOAD_MAX_JSON_BYTES,
  StudioUploadPublishSafetyError,
  StudioUploadPublishScopeInvalidatedError,
  StudioUploadSharedAccessChangedError,
  advanceStudioUploadSharedMetaAfterSave,
  assertStudioUploadJsonPayloadSize,
  assertStudioUploadSharedMetaUnchanged,
  canEditStudioUploadSharedDocument,
  canPublishStudioUploadSharedDocument,
  captureStudioUploadPublishScope,
  isStudioUploadHydrationScopeCurrent,
  isStudioUploadPublishScopeCurrent,
  isStudioUploadWorkspaceLocked,
  resolveStudioUploadActionLocks,
  resolveStudioUploadSharedCrdtSaveFence,
  resolveStudioUploadUpdateRevision,
  runStudioUploadPublishStages,
  shouldResetStudioUploadDraft,
  studioUploadJsonByteLength,
  validateStudioUploadHydratedSharedDocument,
  validateStudioUploadSavedWork,
} from "./studio-upload-publish-safety";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("studio upload hydration safety", () => {
  const scope = { authUserId: "owner-a", workId: "work-1" } as const;

  it("공동 upload 문서는 역할·capability를 교차 확인하고 열람 역할도 안전하게 연다", () => {
    const editable = {
      workId: "work-1",
      role: "editor" as const,
      status: "active" as const,
      capabilities: { view: true as const, edit: true },
      access: "edit" as const,
      revision: 7,
      crdtServerSequence: "27",
      document: { format: "upload" },
    };
    expect(validateStudioUploadHydratedSharedDocument(editable, scope)).toBe(7);
    expect(canEditStudioUploadSharedDocument(editable)).toBe(true);
    expect(canPublishStudioUploadSharedDocument(editable)).toBe(false);
    expect(canPublishStudioUploadSharedDocument({ ...editable, role: "owner" })).toBe(true);

    const viewer = {
      ...editable,
      role: "viewer" as const,
      capabilities: { view: true as const, edit: false },
      access: "view" as const,
    };
    expect(validateStudioUploadHydratedSharedDocument(viewer, scope)).toBe(7);
    expect(canEditStudioUploadSharedDocument(viewer)).toBe(false);
    expect(
      resolveStudioUploadActionLocks({
        workId: "work-1",
        workspaceLocked: false,
        meta: viewer,
      })
    ).toMatchObject({ mutationLocked: true, publishLocked: true });
    expect(
      resolveStudioUploadActionLocks({
        workId: "work-1",
        workspaceLocked: false,
        meta: editable,
      })
    ).toMatchObject({ mutationLocked: false, publishLocked: true });
    expect(
      resolveStudioUploadActionLocks({
        workId: "work-1",
        workspaceLocked: true,
        meta: { ...editable, role: "owner" },
      })
    ).toMatchObject({ mutationLocked: true, publishLocked: true });

    expect(() =>
      validateStudioUploadHydratedSharedDocument(
        { ...editable, document: { format: "cuttoon" } },
        scope
      )
    ).toThrow(/컷툰/);
    expect(() =>
      validateStudioUploadHydratedSharedDocument(
        { ...editable, capabilities: { view: true, edit: false } },
        scope
      )
    ).toThrow(/역할과 편집 권한/);
    expect(() =>
      validateStudioUploadHydratedSharedDocument(
        { ...editable, crdtServerSequence: "01" },
        scope
      )
    ).toThrow(/CRDT/);
  });

  it("focus/save 직전 meta의 role·권한·revision 변경을 fail-closed 처리한다", () => {
    const meta = {
      workId: "work-1",
      role: "admin" as const,
      status: "active" as const,
      capabilities: { view: true as const, edit: true },
      access: "edit" as const,
      revision: 7,
      crdtServerSequence: "27",
    };
    expect(() => assertStudioUploadSharedMetaUnchanged(meta, { ...meta })).not.toThrow();
    for (const fresh of [
      { ...meta, role: "editor" as const },
      { ...meta, access: "view" as const, capabilities: { view: true as const, edit: false } },
      { ...meta, revision: 8 },
    ]) {
      expect(() => assertStudioUploadSharedMetaUnchanged(meta, fresh)).toThrow(
        StudioUploadSharedAccessChangedError
      );
    }
  });

  it("공동 저장 성공 revision과 updatedAt을 다음 meta 기준으로 원자 갱신한다", () => {
    const meta = {
      workId: "work-1",
      role: "editor" as const,
      status: "active" as const,
      capabilities: { view: true as const, edit: true },
      access: "edit" as const,
      revision: 7,
      crdtServerSequence: "27",
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    expect(
      advanceStudioUploadSharedMetaAfterSave(meta, {
        workId: "work-1",
        revision: 8,
        updatedAt: "2026-07-12T09:01:00+09:00",
      })
    ).toEqual({ ...meta, revision: 8, updatedAt: "2026-07-12T00:01:00.000Z" });
    expect(() =>
      advanceStudioUploadSharedMetaAfterSave(meta, {
        workId: "work-1",
        revision: 9,
        updatedAt: "2026-07-12T00:01:00.000Z",
      })
    ).toThrow(StudioUploadPublishSafetyError);
  });

  it("공동 upload 저장은 save 직전 fresh meta의 PostgreSQL bigint CRDT fence만 사용한다", () => {
    expect(resolveStudioUploadSharedCrdtSaveFence({ crdtServerSequence: "0" })).toBe("0");
    expect(
      resolveStudioUploadSharedCrdtSaveFence({
        crdtServerSequence: "9223372036854775807",
      })
    ).toBe("9223372036854775807");
    for (const crdtServerSequence of ["", "-1", "+1", "01", "9223372036854775808"]) {
      expect(() =>
        resolveStudioUploadSharedCrdtSaveFence({ crdtServerSequence })
      ).toThrow(StudioUploadPublishSafetyError);
    }
  });

  it("기존 작품은 ready와 유효 revision 없이는 저장할 수 없고 실패 상태도 잠근다", () => {
    expect(resolveStudioUploadUpdateRevision(scope, scope, "ready", 4)).toBe(4);
    expect(
      resolveStudioUploadUpdateRevision(
        { authUserId: "owner-a", workId: null },
        null,
        "ready",
        undefined
      )
    ).toBeUndefined();
    expect(() => resolveStudioUploadUpdateRevision(scope, scope, "loading", 4)).toThrow(
      StudioUploadPublishSafetyError
    );
    expect(() => resolveStudioUploadUpdateRevision(scope, scope, "error", 4)).toThrow(
      StudioUploadPublishSafetyError
    );
    expect(() => resolveStudioUploadUpdateRevision(scope, scope, "ready", undefined)).toThrow(
      StudioUploadPublishSafetyError
    );
    expect(() =>
      resolveStudioUploadUpdateRevision(
        { authUserId: "owner-b", workId: "work-1" },
        scope,
        "ready",
        4
      )
    ).toThrow(StudioUploadPublishSafetyError);
    expect(
      isStudioUploadHydrationScopeCurrent(scope, {
        authUserId: "owner-a",
        workId: "work-1",
      })
    ).toBe(true);
    expect(
      isStudioUploadHydrationScopeCurrent(scope, {
        authUserId: "owner-b",
        workId: "work-1",
      })
    ).toBe(false);
    expect(
      isStudioUploadWorkspaceLocked({
        workId: "work-1",
        currentScope: { authUserId: "owner-b", workId: "work-1" },
        hydratedScope: scope,
        hydrationStatus: "ready",
        saving: false,
        loadingFiles: false,
      })
    ).toBe(true);
    expect(
      isStudioUploadWorkspaceLocked({
        workId: "work-1",
        currentScope: scope,
        hydratedScope: scope,
        hydrationStatus: "error",
        saving: false,
        loadingFiles: false,
      })
    ).toBe(true);
    expect(
      isStudioUploadWorkspaceLocked({
        workId: "work-1",
        currentScope: scope,
        hydratedScope: scope,
        hydrationStatus: "ready",
        saving: false,
        loadingFiles: false,
      })
    ).toBe(false);
    expect(
      isStudioUploadWorkspaceLocked({
        workId: null,
        currentScope: { authUserId: "owner-a", workId: null },
        hydratedScope: null,
        hydrationStatus: "ready",
        saving: true,
        loadingFiles: false,
      })
    ).toBe(true);
    expect(
      isStudioUploadWorkspaceLocked({
        workId: null,
        currentScope: { authUserId: "owner-a", workId: null },
        hydratedScope: null,
        hydrationStatus: "ready",
        saving: false,
        loadingFiles: true,
      })
    ).toBe(true);
    expect(() => resolveStudioUploadUpdateRevision(scope, null, "ready", 4)).toThrow(
      StudioUploadPublishSafetyError
    );
  });

  it("guest save scope는 await 전에 동기 거부한다", () => {
    expect(() => captureStudioUploadPublishScope(null, null)).toThrow(
      StudioUploadPublishSafetyError
    );
    expect(captureStudioUploadPublishScope("owner-a", null)).toEqual({
      authUserId: "owner-a",
      workId: null,
    });
  });

  it("계정 또는 작품 범위 변경 시 create draft도 layout commit 전에 초기화 대상으로 판정한다", () => {
    expect(
      shouldResetStudioUploadDraft(
        { authUserId: null, workId: null },
        { authUserId: "first-account", workId: null }
      )
    ).toBe(false);
    expect(
      shouldResetStudioUploadDraft(
        { authUserId: "owner-a", workId: null },
        { authUserId: null, workId: null }
      )
    ).toBe(true);
    expect(
      shouldResetStudioUploadDraft(
        { authUserId: "owner-a", workId: null },
        { authUserId: "owner-b", workId: null }
      )
    ).toBe(true);
    expect(
      shouldResetStudioUploadDraft(
        { authUserId: "owner-a", workId: "work-1" },
        { authUserId: "owner-a", workId: "work-2" }
      )
    ).toBe(true);
    expect(
      shouldResetStudioUploadDraft(
        { authUserId: "owner-a", workId: null },
        { authUserId: "owner-a", workId: null }
      )
    ).toBe(false);
  });

  it("실제 JSON UTF-8 byte를 계산하고 15MB 초과 payload를 API 전에 차단한다", () => {
    expect(studioUploadJsonByteLength({ text: "가" })).toBe(
      new TextEncoder().encode(JSON.stringify({ text: "가" })).byteLength
    );
    expect(assertStudioUploadJsonPayloadSize({ ok: true })).toBeGreaterThan(0);
    expect(() =>
      assertStudioUploadJsonPayloadSize({ page: "a".repeat(STUDIO_UPLOAD_MAX_JSON_BYTES) })
    ).toThrow(/15MB.*나눠/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => assertStudioUploadJsonPayloadSize(circular)).toThrow(/직렬화/);
  });

  it("저장 응답도 시작 계정·작품과 증가한 revision을 교차 확인한다", () => {
    expect(
      validateStudioUploadSavedWork(
        { id: "work-1", author: { id: "owner-a" }, revision: 8 },
        scope,
        7
      )
    ).toBe(8);
    expect(() =>
      validateStudioUploadSavedWork(
        { id: "work-2", author: { id: "owner-a" }, revision: 8 },
        scope,
        7
      )
    ).toThrow(StudioUploadPublishSafetyError);
    expect(() =>
      validateStudioUploadSavedWork(
        { id: "work-1", author: { id: "owner-b" }, revision: 8 },
        scope,
        7
      )
    ).toThrow(StudioUploadPublishSafetyError);
    expect(() =>
      validateStudioUploadSavedWork(
        { id: "work-1", author: { id: "owner-a" }, revision: 7 },
        scope,
        7
      )
    ).toThrow(StudioUploadPublishSafetyError);
  });
});

describe("studio upload publish scope", () => {
  it("A→logout/B, 작품 변경, unmount를 모두 stale로 판정한다", () => {
    const captured = { authUserId: "owner-a", workId: "work-1" };
    expect(
      isStudioUploadPublishScopeCurrent(
        captured,
        { authUserId: "owner-a", workId: "work-1" },
        true
      )
    ).toBe(true);
    expect(
      isStudioUploadPublishScopeCurrent(captured, { authUserId: null, workId: "work-1" }, true)
    ).toBe(false);
    expect(
      isStudioUploadPublishScopeCurrent(
        captured,
        { authUserId: "owner-b", workId: "work-1" },
        true
      )
    ).toBe(false);
    expect(
      isStudioUploadPublishScopeCurrent(
        captured,
        { authUserId: "owner-a", workId: "work-2" },
        true
      )
    ).toBe(false);
    expect(
      isStudioUploadPublishScopeCurrent(
        captured,
        { authUserId: "owner-a", workId: "work-1" },
        false
      )
    ).toBe(false);
  });

  it("downscale 후 auth가 바뀌면 import·API를 실행하지 않는다", async () => {
    const downscale = deferred<string>();
    let current = { authUserId: "owner-a", workId: "work-1" } as {
      authUserId: string | null;
      workId: string | null;
    };
    const loadClient = vi.fn(async () => ({ name: "client" }));
    const mutate = vi.fn(async () => ({ id: "saved" }));
    const operation = runStudioUploadPublishStages({
      scope: { authUserId: "owner-a", workId: "work-1" },
      currentScope: () => current,
      mounted: () => true,
      signal: new AbortController().signal,
      downscale: () => downscale.promise,
      loadClient,
      mutate,
    });

    current = { authUserId: "owner-b", workId: "work-1" };
    downscale.resolve("cover");
    await expect(operation).rejects.toBeInstanceOf(StudioUploadPublishScopeInvalidatedError);
    expect(loadClient).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("동일 AbortSignal을 API에 전파하고 API 후 unmount continuation을 차단한다", async () => {
    let mounted = true;
    const controller = new AbortController();
    const mutate = vi.fn(async (_client: object, _cover: string, signal: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      mounted = false;
      return { id: "saved" };
    });

    await expect(
      runStudioUploadPublishStages({
        scope: { authUserId: "owner-a", workId: null },
        currentScope: () => ({ authUserId: "owner-a", workId: null }),
        mounted: () => mounted,
        signal: controller.signal,
        downscale: async () => "cover",
        loadClient: async () => ({}),
        mutate,
      })
    ).rejects.toBeInstanceOf(StudioUploadPublishScopeInvalidatedError);
    expect(mutate).toHaveBeenCalledWith({}, "cover", controller.signal);
  });

  it("abort된 요청은 다음 stage를 시작하지 않는다", async () => {
    const controller = new AbortController();
    controller.abort();
    const downscale = vi.fn(async () => "cover");
    await expect(
      runStudioUploadPublishStages({
        scope: { authUserId: "owner-a", workId: null },
        currentScope: () => ({ authUserId: "owner-a", workId: null }),
        mounted: () => true,
        signal: controller.signal,
        downscale,
        loadClient: async () => ({}),
        mutate: async () => ({ id: "saved" }),
      })
    ).rejects.toBeInstanceOf(StudioUploadPublishScopeInvalidatedError);
    expect(downscale).not.toHaveBeenCalled();
  });
});
