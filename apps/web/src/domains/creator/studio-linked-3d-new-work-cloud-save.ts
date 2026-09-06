import {
  createStudioDraftCollaborationPromotionRequest,
  createStudioDraftCollaborationProvisionRequest,
} from "./studio-draft-collaboration";

import type {
  CreatorDraftCollaborationRequestOptions,
  CreatorDraftCollaborationRoomResponse,
} from "./creator-draft-collaboration-client";
import type {
  StudioDraftCollaborationFinalStatus,
  StudioDraftCollaborationIdentity,
  StudioDraftCollaborationTemporaryRoom,
} from "./studio-draft-collaboration";
import type { StudioLinked3dPassCloudUploadReceipt } from "./studio-linked-3d-pass-cloud-sync";
import type {
  CreateWorkInput,
  UpdateWorkInput,
} from "@/src/infrastructure/creator-client";

export type StudioLinked3dNewWorkCloudSaveResult =
  | {
      readonly outcome: "promoted";
      readonly room: CreatorDraftCollaborationRoomResponse;
      readonly revision: number;
      readonly workId: string;
    }
  | {
      /** The server already promoted this room; the caller must preserve its current local draft. */
      readonly outcome: "recovered-existing";
      readonly room: CreatorDraftCollaborationRoomResponse;
      readonly revision: number | null;
      readonly workId: string;
    };

export interface StudioLinked3dNewWorkCloudSaveDependencies {
  readonly ensureCloudArtifacts: (
    workId: string,
    signal?: AbortSignal,
  ) => Promise<readonly StudioLinked3dPassCloudUploadReceipt[]>;
  readonly compensateCloudArtifacts: (
    workId: string,
    receipts: readonly StudioLinked3dPassCloudUploadReceipt[],
  ) => Promise<void>;
  readonly inspectWorkRevision: (workId: string, signal?: AbortSignal) => Promise<number>;
  readonly promote: (
    request: ReturnType<typeof createStudioDraftCollaborationPromotionRequest>,
    options?: CreatorDraftCollaborationRequestOptions,
  ) => Promise<CreatorDraftCollaborationRoomResponse>;
  readonly provision: (
    request: ReturnType<typeof createStudioDraftCollaborationProvisionRequest>,
    options?: CreatorDraftCollaborationRequestOptions,
  ) => Promise<CreatorDraftCollaborationRoomResponse>;
  readonly retireIdentity: (identity: StudioDraftCollaborationIdentity) => Promise<boolean>;
  readonly updateWork: (
    workId: string,
    payload: StudioLinked3dProvisionalWorkUpdatePayload,
    signal?: AbortSignal,
  ) => Promise<number>;
}

export type StudioLinked3dProvisionalWorkUpdatePayload = Pick<
  UpdateWorkInput,
  | "title"
  | "description"
  | "tags"
  | "format"
  | "titleId"
  | "cover"
  | "pages"
  | "doc"
  | "seriesId"
  | "challengeId"
> & {
  readonly baseRevision: number;
  readonly status: "draft";
};

function assertRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error(`${label} 작품 revision이 올바르지 않습니다.`);
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

function assertRoomScope(
  room: StudioDraftCollaborationTemporaryRoom,
  identity: StudioDraftCollaborationIdentity,
): void {
  if (
    room.draftDocumentId !== identity.draftDocumentId
    || room.ownerScopeKey !== identity.ownerScopeKey
  ) {
    throw new Error("임시 cloud-save 작업실이 현재 초안과 일치하지 않습니다.");
  }
}

function provisionalUpdatePayload(
  payload: CreateWorkInput,
  baseRevision: number,
): StudioLinked3dProvisionalWorkUpdatePayload {
  return {
    title: payload.title,
    description: payload.description,
    tags: payload.tags,
    format: payload.format,
    titleId: payload.titleId,
    cover: payload.cover,
    pages: payload.pages,
    doc: payload.doc,
    seriesId: payload.seriesId,
    challengeId: payload.challengeId,
    status: "draft",
    baseRevision,
  };
}

/**
 * Stages a never-saved linked-pass document in its already-canonical hidden creator_work, uploads
 * every content-addressed raster before the JSON update, then atomically promotes that same row.
 * A promoted room is never reusable as a staging target because doing so could overwrite the work
 * from the preceding new-document save.
 */
export async function saveStudioLinked3dNewWorkThroughCloudRoom(input: {
  readonly actorAuthScopeKey: string;
  readonly assertFresh?: () => void;
  readonly createPayload: CreateWorkInput;
  readonly dependencies: StudioLinked3dNewWorkCloudSaveDependencies;
  readonly existingRoom?: CreatorDraftCollaborationRoomResponse | null;
  readonly finalStatus: StudioDraftCollaborationFinalStatus;
  readonly identity: StudioDraftCollaborationIdentity;
  readonly initialSnapshotByteLength: number;
  readonly signal?: AbortSignal;
}): Promise<StudioLinked3dNewWorkCloudSaveResult> {
  const assertFresh = () => {
    throwIfAborted(input.signal);
    input.assertFresh?.();
  };
  assertFresh();
  if (input.createPayload.remixFromId !== undefined && input.createPayload.remixFromId !== null) {
    throw new Error(
      "연결형 3D 리믹스 신규 저장은 원본 provenance를 원자 승격할 수 없어 지원하지 않습니다.",
    );
  }
  const room = input.existingRoom ?? await input.dependencies.provision(
    createStudioDraftCollaborationProvisionRequest({
      identity: input.identity,
      actorAuthScopeKey: input.actorAuthScopeKey,
      intent: "cloud-save",
      initialSnapshotByteLength: input.initialSnapshotByteLength,
    }),
    { signal: input.signal },
  );
  assertRoomScope(room, input.identity);
  if (room.status === "promoted") {
    let recoveredRevision: number | null = null;
    try {
      recoveredRevision = assertRevision(
        await input.dependencies.inspectWorkRevision(room.provisionalWorkId, input.signal),
        "복구된",
      );
    } catch {
      // The promoted room receipt still proves which work exists. Revision inspection is a
      // best-effort recovery hint and never authorizes upload or mutation of that work.
    }
    await input.dependencies.retireIdentity(input.identity);
    assertFresh();
    return {
      outcome: "recovered-existing",
      room,
      revision: recoveredRevision,
      workId: room.provisionalWorkId,
    };
  }
  assertFresh();

  const workId = room.provisionalWorkId;
  const baseRevision = assertRevision(
    await input.dependencies.inspectWorkRevision(workId, input.signal),
    "임시",
  );
  assertFresh();
  const uploadReceipts = await input.dependencies.ensureCloudArtifacts(workId, input.signal);
  let revision: number;
  try {
    assertFresh();
    revision = assertRevision(
      await input.dependencies.updateWork(
        workId,
        provisionalUpdatePayload(input.createPayload, baseRevision),
        input.signal,
      ),
      "저장된",
    );
    if (revision !== baseRevision + 1) {
      throw new Error("임시 cloud-save 작품 revision이 정확히 한 세대 전진하지 않았습니다.");
    }
  } catch (cause) {
    try {
      await input.dependencies.compensateCloudArtifacts(workId, uploadReceipts);
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        "임시 cloud-save 저장과 미참조 3D pass 정리를 모두 완료하지 못했습니다.",
        { cause: cleanupCause },
      );
    }
    throw cause;
  }
  assertFresh();
  const promoted = await input.dependencies.promote(
    createStudioDraftCollaborationPromotionRequest({
      identity: input.identity,
      room,
      actorAuthScopeKey: input.actorAuthScopeKey,
      targetWorkId: workId,
      expectedWorkRevision: revision,
      finalStatus: input.finalStatus,
    }),
    { signal: input.signal },
  );
  assertRoomScope(promoted, input.identity);
  if (promoted.status !== "promoted" || promoted.provisionalWorkId !== workId) {
    throw new Error("임시 cloud-save 작업실의 원자 승격 영수증이 일치하지 않습니다.");
  }
  // Promotion consumed this local draft even if the route/document became stale while awaiting
  // the response. Retire first so another new document cannot resolve the promoted room again.
  // `false` means this exact UUID is already absent (for example, a stale completion observed a
  // newer replacement). That is also safe: the replacement remains untouched and cannot resolve
  // this promoted room.
  await input.dependencies.retireIdentity(input.identity);
  assertFresh();
  return { outcome: "promoted", room: promoted, revision, workId };
}
