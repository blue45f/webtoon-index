import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioLinked3dPassAssetFenceError } from
  "../../../../web/src/shared/lib/studio-linked-3d-pass-asset-fence";
import { CreatorDraftCollaborationStatusLockedError } from "../../server/creator-provisional-work-status";
import {
  CreatorWorkRevisionConflictError,
  CreatorWorkRevisionNotFoundError,
} from "../../server/creator-work-revisions";

import {
  CreatorCollaborationCrdtSequenceConflictError,
  CreatorCollaborationConflictError,
  CreatorCollaborationForbiddenError,
  CreatorCollaborationInvalidTargetError,
  CreatorCollaborationNotFoundError,
  CreatorCollaborationRepository,
  CreatorCollaborationRevisionConflictError,
} from "./creator-collaboration.repository";
import {
  CreatorDraftCollaborationGraphConflictError,
  CreatorDraftCollaborationRateLimitError,
  CreatorDraftCollaborationRepository,
  CreatorDraftCollaborationRoomExpiredError,
  CreatorDraftCollaborationWorkRevisionConflictError,
} from "./creator-draft-collaboration.repository";
import { CreatorService } from "./creator.service";

import type { StudioWorkAssetService } from "./studio-work-asset.service";

const INVITATION_ID = "5f6f6d5c-58f1-4e2c-a228-4b670f470e2b";
const DRAFT_ID = "draft_11111111-1111-4111-8111-111111111111";
const ROOM_ID = "draft-room_22222222-2222-4222-8222-222222222222";
const PROVISION_MUTATION_ID = "33333333-3333-4333-8333-333333333333";
const PROMOTION_MUTATION_ID = "44444444-4444-4444-8444-444444444444";

const {
  createWork,
  getWork,
  getWorkRevisionComparison,
  getWorkRevision,
  listWorkRevisions,
  restoreWorkRevision,
  updateWork,
  bumpViews,
  bumpAssetDownloads,
  deleteWork,
  generateImageAsset,
  getSharedAssetContent,
  listSharedAssets,
} = vi.hoisted(() => ({
  createWork: vi.fn(),
  getWork: vi.fn(),
  getWorkRevisionComparison: vi.fn(),
  getWorkRevision: vi.fn(),
  listWorkRevisions: vi.fn(),
  restoreWorkRevision: vi.fn(),
  updateWork: vi.fn(),
  bumpViews: vi.fn(),
  bumpAssetDownloads: vi.fn(),
  deleteWork: vi.fn(),
  generateImageAsset: vi.fn(),
  getSharedAssetContent: vi.fn(),
  listSharedAssets: vi.fn(),
}));

vi.mock("../../server/creator", () => ({
  addComment: vi.fn(),
  bumpAssetDownloads,
  bumpViews,
  createSeries: vi.fn(),
  createWork,
  deleteSeries: vi.fn(),
  deleteSharedAsset: vi.fn(),
  deleteWork,
  generateImageAsset,
  getSharedAssetContent,
  getChallenge: vi.fn(),
  getCreatorPublicProfile: vi.fn(),
  getSeries: vi.fn(),
  getWork,
  getWorkRevisionComparison,
  getWorkRevision,
  listChallenges: vi.fn(),
  listComments: vi.fn(),
  listSeries: vi.fn(),
  listSharedAssets,
  listWorkRevisions,
  listWorks: vi.fn(),
  parseCreatorSort: vi.fn(() => "recent"),
  parseSeriesSort: vi.fn(() => "recent"),
  publishAsset: vi.fn(),
  restoreWorkRevision,
  toggleFollow: vi.fn(),
  toggleLike: vi.fn(),
  updateSeries: vi.fn(),
  updateWork,
}));

const collaborationRepository = {
  listSharedWorks: vi.fn(),
  getSharedDocument: vi.fn(),
  getSharedDocumentMeta: vi.fn(),
  saveSharedDocument: vi.fn(),
  getTeam: vi.fn(),
  getAuthorization: vi.fn(),
  listInvitations: vi.fn(),
  getActivity: vi.fn(),
  invite: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
  removeMemberWithRevocation: vi.fn(),
  respondToInvitation: vi.fn(),
};

const draftCollaborationRepository = {
  provision: vi.fn(),
  promote: vi.fn(),
};

const studioWorkAssetService = {
  deleteGeneratedObjectsForWork: vi.fn(),
};

function createService(): CreatorService {
  return new CreatorService(
    collaborationRepository as unknown as CreatorCollaborationRepository,
    draftCollaborationRepository as unknown as CreatorDraftCollaborationRepository,
    studioWorkAssetService as unknown as StudioWorkAssetService,
  );
}

describe("CreatorService safety gates", () => {
  beforeEach(() => {
    createWork.mockReset();
    getWork.mockReset();
    getWorkRevisionComparison.mockReset();
    getWorkRevision.mockReset();
    listWorkRevisions.mockReset();
    restoreWorkRevision.mockReset();
    updateWork.mockReset();
    bumpViews.mockReset();
    bumpAssetDownloads.mockReset();
    generateImageAsset.mockReset();
    getSharedAssetContent.mockReset();
    listSharedAssets.mockReset();
    collaborationRepository.getTeam.mockReset();
    collaborationRepository.getAuthorization.mockReset();
    collaborationRepository.listSharedWorks.mockReset();
    collaborationRepository.getSharedDocument.mockReset();
    collaborationRepository.getSharedDocumentMeta.mockReset();
    collaborationRepository.saveSharedDocument.mockReset();
    collaborationRepository.listInvitations.mockReset();
    collaborationRepository.getActivity.mockReset();
    collaborationRepository.invite.mockReset();
    collaborationRepository.updateMemberRole.mockReset();
    collaborationRepository.removeMember.mockReset();
    collaborationRepository.removeMemberWithRevocation.mockReset();
    collaborationRepository.respondToInvitation.mockReset();
    draftCollaborationRepository.provision.mockReset();
    draftCollaborationRepository.promote.mockReset();
    studioWorkAssetService.deleteGeneratedObjectsForWork
      .mockReset()
      .mockResolvedValue(0);
    deleteWork.mockReset();
    delete process.env.CREATOR_IMAGE_AI_ENABLED;
  });

  afterEach(() => {
    delete process.env.CREATOR_IMAGE_AI_ENABLED;
  });

  it("소유자의 작품 조회는 공개 조회수를 올리지 않는다", async () => {
    getWork.mockResolvedValue({ id: "work-owner", isOwner: true });
    await expect(createService().getWork("work-owner", "owner")).resolves.toMatchObject({ id: "work-owner" });
    expect(bumpViews).not.toHaveBeenCalled();
  });

  it("작품 삭제 전에 생성 오브젝트 참조를 모두 정리한다", async () => {
    deleteWork.mockResolvedValueOnce({ deleted: true });

    await expect(
      createService().deleteWork("owner", "work-delete", false)
    ).resolves.toEqual({ deleted: true });

    expect(studioWorkAssetService.deleteGeneratedObjectsForWork)
      .toHaveBeenCalledWith("owner", "work-delete", false);
    expect(deleteWork).toHaveBeenCalledWith("owner", "work-delete", false);
    expect(
      studioWorkAssetService.deleteGeneratedObjectsForWork.mock.invocationCallOrder[0]
    ).toBeLessThan(deleteWork.mock.invocationCallOrder[0]!);
  });

  it("작품 생성물 정리의 일시적 저장소 장애 상태를 보존한다", async () => {
    const unavailable = new ServiceUnavailableException(
      "비공개 오브젝트 저장소 요청을 완료할 수 없습니다.",
    );
    studioWorkAssetService.deleteGeneratedObjectsForWork.mockRejectedValueOnce(
      unavailable,
    );

    await expect(
      createService().deleteWork("owner", "work-delete", false),
    ).rejects.toBe(unavailable);
    expect(deleteWork).not.toHaveBeenCalled();
  });

  it("에셋 인기 집계는 인증 사용자·에셋 조합당 하루 한 번만 반영한다", async () => {
    const service = createService();
    const userId = `asset-use-user-${Date.now()}`;

    await expect(service.useSharedAsset(userId, "asset-1")).resolves.toEqual({ ok: true });
    await expect(service.useSharedAsset(userId, "asset-1")).resolves.toEqual({ ok: true });
    await expect(service.useSharedAsset(userId, "asset-2")).resolves.toEqual({ ok: true });

    expect(bumpAssetDownloads).toHaveBeenNthCalledWith(1, "asset-1");
    expect(bumpAssetDownloads).toHaveBeenNthCalledWith(2, "asset-2");
    expect(bumpAssetDownloads).toHaveBeenCalledTimes(2);
  });

  it("에셋 원본은 viewer 범위를 전달하고 비공개 여부를 구분하지 않는 404로 감춘다", async () => {
    const content = { id: "asset-1", dataUrl: "data:image/png;base64,AA==", width: 1, height: 1 };
    getSharedAssetContent.mockResolvedValueOnce(content);

    await expect(createService().getSharedAssetContent("asset-1", "viewer-1"))
      .resolves.toBe(content);
    expect(getSharedAssetContent).toHaveBeenCalledWith("asset-1", "viewer-1", false);

    getSharedAssetContent.mockResolvedValueOnce(content);
    await expect(createService().getSharedAssetContent("asset-1", "admin-1", true))
      .resolves.toBe(content);
    expect(getSharedAssetContent).toHaveBeenLastCalledWith("asset-1", "admin-1", true);

    getSharedAssetContent.mockRejectedValueOnce(new Error("hidden"));
    await expect(createService().getSharedAssetContent("asset-2", "viewer-1"))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("레거시 full-data 목록은 요청 kind와 무관하게 VRM poser 에셋만 조회한다", async () => {
    listSharedAssets.mockResolvedValue([]);
    await createService().listSharedAssets({
      limit: 30,
      offset: 0,
      kind: "image",
      sort: "newest",
    }, "viewer-1");

    expect(listSharedAssets).toHaveBeenCalledWith(expect.objectContaining({
      viewerId: "viewer-1",
      kind: "vrm_pose",
    }));
  });

  it("비소유자의 공개 작품 조회만 조회수를 올린다", async () => {
    getWork.mockResolvedValue({ id: "work-reader", isOwner: false });
    await createService().getWork("work-reader", "reader");
    expect(bumpViews).toHaveBeenCalledWith("work-reader");
  });

  it("서버 이미지 생성은 명시적 kill switch가 켜지기 전까지 호출하지 않는다", async () => {
    await expect(createService().generateAsset("image-user-disabled", { prompt: "도시" })).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
    expect(generateImageAsset).not.toHaveBeenCalled();
  });

  it("활성화된 서버 이미지 생성은 사용자 ID가 있는 제한 경로에서만 실행한다", async () => {
    process.env.CREATOR_IMAGE_AI_ENABLED = "true";
    generateImageAsset.mockResolvedValue({ dataUrl: "data:image/webp;base64,AA==" });
    await expect(
      createService().generateAsset("image-user-enabled-once", { prompt: "도시" })
    ).resolves.toMatchObject({ dataUrl: "data:image/webp;base64,AA==" });
    expect(generateImageAsset).toHaveBeenCalledOnce();
  });

  it("stale baseRevision은 비밀정보 없이 현재 revision만 담은 409로 변환한다", async () => {
    updateWork.mockRejectedValue(new CreatorWorkRevisionConflictError(8));
    const error = await createService()
      .updateWork("owner", "work-1", { title: "수정", baseRevision: 7 })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as ConflictException).getResponse()).toEqual({
      code: "creator_work_revision_conflict",
      message: "다른 저장이 먼저 반영되었습니다. 작품을 다시 불러온 뒤 변경 내용을 확인해 주세요.",
      currentRevision: 8,
    });
    expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain("snapshot");
  });

  it("direct/shared provisional status guard를 동일한 안정된 409로 변환한다", async () => {
    const service = createService();
    updateWork.mockRejectedValueOnce(new CreatorDraftCollaborationStatusLockedError());
    collaborationRepository.saveSharedDocument.mockRejectedValueOnce(
      new CreatorDraftCollaborationStatusLockedError()
    );

    const directError = await service
      .updateWork("owner", "work-provisional", { status: "published" })
      .catch((cause: unknown) => cause);
    const sharedError = await service
      .saveSharedWorkDocument("owner", "work-provisional", {
        baseRevision: 1,
        crdtServerSequence: "0",
        status: "published",
      })
      .catch((cause: unknown) => cause);

    for (const error of [directError, sharedError]) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
      expect((error as ConflictException).getResponse()).toEqual({
        code: "creator_draft_collaboration_status_locked",
        message: "임시 작업실의 게시 상태는 저장 승격 단계에서만 변경할 수 있습니다.",
      });
    }
  });

  it("owner-only revision 조회는 작품 없음과 타인 작품을 구분하지 않는 404로 변환한다", async () => {
    getWorkRevision.mockRejectedValue(new CreatorWorkRevisionNotFoundError());
    await expect(createService().getWorkRevision("reader", "private-work", 1)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("owner-only revision 비교 projection을 검증하고 렌더 에셋 없이 반환한다", async () => {
    getWorkRevisionComparison.mockResolvedValue({
      revision: 4,
      restoredFromRevision: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      snapshot: {
        titleId: null,
        title: "1화",
        description: "설명",
        tags: ["판타지"],
        format: "cuttoon",
        doc: { pagesList: [] },
        status: "draft",
        seriesId: null,
        episodeNo: null,
        challengeId: null,
        remixFromId: null,
      },
    });

    const response = await createService().getWorkRevisionComparison("owner", "work-1", 4);

    expect(getWorkRevisionComparison).toHaveBeenCalledWith("owner", "work-1", 4);
    expect(response.snapshot).not.toHaveProperty("cover");
    expect(response.snapshot).not.toHaveProperty("pages");
  });

  it("revision 비교 projection도 작품 없음과 타인 작품을 같은 404로 닫는다", async () => {
    getWorkRevisionComparison.mockRejectedValue(new CreatorWorkRevisionNotFoundError());
    await expect(
      createService().getWorkRevisionComparison("reader", "private-work", 1)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("복원 충돌도 현재 revision만 담은 409로 변환한다", async () => {
    restoreWorkRevision.mockRejectedValue(new CreatorWorkRevisionConflictError(11));
    const error = await createService()
      .restoreWorkRevision("owner", "work-1", 2, 10)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "creator_work_revision_conflict",
      currentRevision: 11,
    });
  });

  it("direct create/update/restore의 linked-pass fence 오류를 bounded 409로 변환한다", async () => {
    const cases = [
      {
        code: "asset-missing" as const,
        mock: createWork,
        run: () => createService().createWork("owner", { title: "linked" }),
      },
      {
        code: "asset-mismatch" as const,
        mock: updateWork,
        run: () => createService().updateWork("owner", "work-1", { title: "linked" }),
      },
      {
        code: "receipt-mismatch" as const,
        mock: restoreWorkRevision,
        run: () => createService().restoreWorkRevision("owner", "work-1", 1, 2),
      },
    ];
    for (const testCase of cases) {
      testCase.mock.mockRejectedValueOnce(new StudioLinked3dPassAssetFenceError(
        testCase.code,
        `private locator ${"a".repeat(64)}`,
      ));
      const error = await testCase.run().catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
      expect((error as ConflictException).getResponse()).toEqual({
        code: "creator_linked_3d_pass_asset_fence_failed",
        message: "연결된 3D 패스와 작품의 immutable PNG 자산이 일치하지 않습니다.",
        assetFenceCode: testCase.code,
      });
      expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain(
        "a".repeat(64)
      );
    }
  });

  it("임시 협업 작업실 provision과 promotion을 인증 소유자 범위로만 위임한다", async () => {
    const activeRoom = {
      version: 1 as const,
      roomId: ROOM_ID,
      draftDocumentId: DRAFT_ID,
      provisionalWorkId: "work-provisional",
      ownerScopeKey: "owner",
      status: "active" as const,
      graphRevision: 0,
      initialSnapshotByteLength: 2_048,
      provisionIntent: "cloud-save" as const,
      provisionedAt: "2026-07-26T00:00:00.000Z",
      expiresAt: "2026-08-02T00:00:00.000Z",
      promotedAt: null,
    };
    const promotedRoom = {
      ...activeRoom,
      status: "promoted" as const,
      graphRevision: 1,
      promotedAt: "2026-07-26T00:01:00.000Z",
    };
    draftCollaborationRepository.provision.mockResolvedValue(activeRoom);
    draftCollaborationRepository.promote.mockResolvedValue(promotedRoom);
    const service = createService();

    await expect(
      service.provisionDraftCollaborationRoom("owner", {
        draftDocumentId: DRAFT_ID,
        ownerScopeKey: "owner",
        intent: "cloud-save",
        clientMutationId: PROVISION_MUTATION_ID,
        initialSnapshotByteLength: 2_048,
      })
    ).resolves.toEqual(activeRoom);
    await expect(
      service.promoteDraftCollaborationRoom("owner", ROOM_ID, {
        draftDocumentId: DRAFT_ID,
        ownerScopeKey: "owner",
        targetWorkId: "work-provisional",
        expectedGraphRevision: 0,
        expectedWorkRevision: 2,
        finalStatus: "published",
        clientMutationId: PROMOTION_MUTATION_ID,
      })
    ).resolves.toEqual(promotedRoom);

    expect(draftCollaborationRepository.provision).toHaveBeenCalledWith({
      ownerUserId: "owner",
      ownerScopeKey: "owner",
      draftDocumentId: DRAFT_ID,
      intent: "cloud-save",
      clientMutationId: PROVISION_MUTATION_ID,
      initialSnapshotByteLength: 2_048,
    });
    expect(draftCollaborationRepository.promote).toHaveBeenCalledWith({
      ownerUserId: "owner",
      ownerScopeKey: "owner",
      roomId: ROOM_ID,
      draftDocumentId: DRAFT_ID,
      targetWorkId: "work-provisional",
      expectedGraphRevision: 0,
      expectedWorkRevision: 2,
      finalStatus: "published",
      clientMutationId: PROMOTION_MUTATION_ID,
    });
  });

  it("임시 협업 ownerScopeKey 스푸핑은 저장소 호출 전에 닫는다", async () => {
    const service = createService();
    await expect(
      service.provisionDraftCollaborationRoom("owner", {
        draftDocumentId: DRAFT_ID,
        ownerScopeKey: "other-owner",
        intent: "invite-member",
        clientMutationId: PROVISION_MUTATION_ID,
        initialSnapshotByteLength: 0,
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.promoteDraftCollaborationRoom("owner", ROOM_ID, {
        draftDocumentId: DRAFT_ID,
        ownerScopeKey: "other-owner",
        targetWorkId: "work-provisional",
        expectedGraphRevision: 0,
        expectedWorkRevision: 2,
        finalStatus: "draft",
        clientMutationId: PROMOTION_MUTATION_ID,
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(draftCollaborationRepository.provision).not.toHaveBeenCalled();
    expect(draftCollaborationRepository.promote).not.toHaveBeenCalled();
  });

  it("임시 협업 분산 제한과 graph CAS·TTL 오류를 최소 상태만 포함한 HTTP 오류로 변환한다", async () => {
    draftCollaborationRepository.provision.mockRejectedValue(
      new CreatorDraftCollaborationRateLimitError(1_501)
    );
    draftCollaborationRepository.promote
      .mockRejectedValueOnce(new CreatorDraftCollaborationGraphConflictError(7))
      .mockRejectedValueOnce(new CreatorDraftCollaborationRoomExpiredError());
    const service = createService();
    const provisionBody = {
      draftDocumentId: DRAFT_ID,
      ownerScopeKey: "owner",
      intent: "share-link" as const,
      clientMutationId: PROVISION_MUTATION_ID,
      initialSnapshotByteLength: 128,
    };
    const promotionBody = {
      draftDocumentId: DRAFT_ID,
      ownerScopeKey: "owner",
      targetWorkId: "work-provisional",
      expectedGraphRevision: 0,
      expectedWorkRevision: 2,
      finalStatus: "draft" as const,
      clientMutationId: PROMOTION_MUTATION_ID,
    };

    const rateLimited = await service
      .provisionDraftCollaborationRoom("owner", provisionBody)
      .catch((cause: unknown) => cause);
    const graphConflict = await service
      .promoteDraftCollaborationRoom("owner", ROOM_ID, promotionBody)
      .catch((cause: unknown) => cause);
    const expired = await service
      .promoteDraftCollaborationRoom("owner", ROOM_ID, promotionBody)
      .catch((cause: unknown) => cause);

    expect(rateLimited).toBeInstanceOf(HttpException);
    expect((rateLimited as HttpException).getStatus()).toBe(429);
    expect((rateLimited as HttpException).getResponse()).toEqual({
      code: "creator_draft_collaboration_rate_limited",
      message: "임시 협업 작업실을 너무 자주 만들고 있습니다. 잠시 후 다시 시도해 주세요.",
      retryAfterSeconds: 2,
    });
    expect(graphConflict).toBeInstanceOf(ConflictException);
    expect((graphConflict as ConflictException).getResponse()).toEqual({
      code: "creator_draft_collaboration_graph_conflict",
      message: "협업 상태가 먼저 변경되었습니다. 최신 작업실 상태를 다시 확인해 주세요.",
      currentGraphRevision: 7,
    });
    expect(expired).toBeInstanceOf(HttpException);
    expect((expired as HttpException).getStatus()).toBe(410);
    expect(JSON.stringify((expired as HttpException).getResponse())).not.toContain(
      "work-provisional"
    );
  });

  it("임시 cloud-save promotion의 work revision·asset fence를 bounded 409로 변환한다", async () => {
    draftCollaborationRepository.promote
      .mockRejectedValueOnce(new CreatorDraftCollaborationWorkRevisionConflictError(12))
      .mockRejectedValueOnce(new StudioLinked3dPassAssetFenceError(
        "asset-missing",
        `private linked pass ${"a".repeat(64)}`,
      ));
    const service = createService();
    const promotionBody = {
      draftDocumentId: DRAFT_ID,
      ownerScopeKey: "owner",
      targetWorkId: "work-provisional",
      expectedGraphRevision: 0,
      expectedWorkRevision: 2,
      finalStatus: "draft" as const,
      clientMutationId: PROMOTION_MUTATION_ID,
    };

    const workRevisionConflict = await service
      .promoteDraftCollaborationRoom("owner", ROOM_ID, promotionBody)
      .catch((cause: unknown) => cause);
    const assetFenceConflict = await service
      .promoteDraftCollaborationRoom("owner", ROOM_ID, promotionBody)
      .catch((cause: unknown) => cause);

    expect(workRevisionConflict).toBeInstanceOf(ConflictException);
    expect((workRevisionConflict as ConflictException).getResponse()).toEqual({
      code: "creator_draft_collaboration_work_revision_conflict",
      message: "저장할 작품이 먼저 변경되었습니다. 최신 revision으로 다시 시도해 주세요.",
      currentWorkRevision: 12,
    });
    expect(assetFenceConflict).toBeInstanceOf(ConflictException);
    expect((assetFenceConflict as ConflictException).getResponse()).toEqual({
      code: "creator_draft_collaboration_asset_fence_failed",
      message: "연결된 3D 패스와 업로드된 원본 자산이 일치하지 않습니다.",
      assetFenceCode: "asset-missing",
    });
    expect(JSON.stringify((assetFenceConflict as ConflictException).getResponse()))
      .not.toContain("a".repeat(64));
  });

  it("팀 조회와 변경 요청을 repository에 사용자·작품 범위 그대로 위임한다", async () => {
    const snapshot = {
      workId: "work-team",
      viewer: {
        userId: "owner",
        role: "owner",
        status: "active",
        capabilities: {
          view: true,
          comment: true,
          edit: true,
          manageMembers: true,
          respondInvite: false,
        },
      },
      members: [],
    };
    collaborationRepository.getTeam.mockResolvedValue(snapshot);
    collaborationRepository.getAuthorization.mockResolvedValue({
      workId: snapshot.workId,
      viewer: snapshot.viewer,
      authorizationEpoch: "2026-08-02T00:00:00.000Z",
    });
    collaborationRepository.listInvitations.mockResolvedValue([]);
    collaborationRepository.getActivity.mockResolvedValue([]);
    collaborationRepository.invite.mockResolvedValue(snapshot);
    collaborationRepository.updateMemberRole.mockResolvedValue(snapshot);
    collaborationRepository.removeMember.mockResolvedValue(snapshot);
    collaborationRepository.removeMemberWithRevocation.mockResolvedValue({
      snapshot,
      authorizationEpochMs: Date.parse("2026-08-02T00:00:00.000Z"),
    });
    const invitationResponse = {
      workId: "work-team",
      role: "editor",
      status: "active",
    };
    collaborationRepository.respondToInvitation.mockResolvedValue(invitationResponse);
    const service = createService();

    await expect(service.getWorkTeam("owner", "work-team")).resolves.toBe(snapshot);
    await expect(service.getWorkAuthorization("owner", "work-team")).resolves.toEqual({
      workId: snapshot.workId,
      viewer: snapshot.viewer,
      authorizationEpoch: "2026-08-02T00:00:00.000Z",
    });
    await service.listWorkTeamInvitations("artist", 12);
    await service.getWorkTeamActivity("owner", "work-team", 9);
    await service.inviteWorkTeamMember("owner", "work-team", "artist", "editor");
    await service.updateWorkTeamMemberRole("owner", "work-team", "artist", "commenter");
    await service.removeWorkTeamMember("owner", "work-team", "artist");
    await expect(
      service.respondToWorkTeamInvitation("artist", "work-team", "accept", INVITATION_ID)
    ).resolves.toBe(invitationResponse);

    expect(collaborationRepository.getTeam).toHaveBeenCalledWith("owner", "work-team");
    expect(collaborationRepository.getAuthorization).toHaveBeenCalledWith("owner", "work-team");
    expect(collaborationRepository.listInvitations).toHaveBeenCalledWith("artist", 12);
    expect(collaborationRepository.getActivity).toHaveBeenCalledWith("owner", "work-team", 9);
    expect(collaborationRepository.invite).toHaveBeenCalledWith("owner", "work-team", "artist", "editor");
    expect(collaborationRepository.updateMemberRole).toHaveBeenCalledWith(
      "owner",
      "work-team",
      "artist",
      "commenter"
    );
    expect(
      collaborationRepository.removeMemberWithRevocation,
    ).toHaveBeenCalledWith("owner", "work-team", "artist");
    expect(collaborationRepository.respondToInvitation).toHaveBeenCalledWith(
      "artist",
      "work-team",
      "accept",
      INVITATION_ID
    );
  });

  it("repository의 작품/멤버/초대 없음 오류를 404로 변환한다", async () => {
    collaborationRepository.getTeam.mockRejectedValue(
      new CreatorCollaborationNotFoundError("work_not_found")
    );
    collaborationRepository.updateMemberRole.mockRejectedValue(
      new CreatorCollaborationNotFoundError("member_not_found")
    );
    collaborationRepository.respondToInvitation.mockRejectedValue(
      new CreatorCollaborationNotFoundError("invitation_not_found")
    );
    const service = createService();

    await expect(service.getWorkTeam("owner", "missing")).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateWorkTeamMemberRole("owner", "work", "missing", "viewer")
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.respondToWorkTeamInvitation("artist", "work", "accept", INVITATION_ID)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("공유 목록·원본 문서 응답을 strict 계약으로 검증하고 저장 patch만 위임한다", async () => {
    const sharedWork = {
      workId: "work-1",
      title: "공동 작업",
      format: "cuttoon",
      role: "editor",
      status: "active",
      capabilities: { view: true, comment: true, edit: true, manageMembers: false },
      owner: { name: "작가" },
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const sharedDocument = {
      workId: "work-1",
      role: "editor",
      status: "active",
      capabilities: { view: true, edit: true },
      revision: 7,
      crdtServerSequence: "27",
      updatedAt: "2026-07-12T00:00:00.000Z",
      document: {
        titleId: null,
        title: "공동 작업",
        description: "",
        cover: "",
        tags: [],
        format: "cuttoon",
        pages: [],
        doc: { pagesList: [] },
        status: "draft",
        seriesId: null,
        episodeNo: null,
        challengeId: null,
        remixFromId: null,
      },
    };
    const saveResponse = {
      workId: "work-1",
      revision: 8,
      updatedAt: "2026-07-12T00:01:00.000Z",
    };
    const { document: _document, ...sharedDocumentMeta } = sharedDocument;
    const sharedWorksPage = { items: [sharedWork], nextCursor: "next_cursor" };
    collaborationRepository.listSharedWorks.mockResolvedValue(sharedWorksPage);
    collaborationRepository.getSharedDocument.mockResolvedValue(sharedDocument);
    collaborationRepository.getSharedDocumentMeta.mockResolvedValue(sharedDocumentMeta);
    collaborationRepository.saveSharedDocument.mockResolvedValue(saveResponse);
    const service = createService();

    await expect(service.listSharedWorks("editor", 50, "current_cursor")).resolves.toEqual(
      sharedWorksPage
    );
    await expect(service.getSharedWorkDocument("editor", "work-1")).resolves.toEqual(
      sharedDocument
    );
    await expect(service.getSharedWorkDocumentMeta("editor", "work-1")).resolves.toEqual(
      sharedDocumentMeta
    );
    await expect(
      service.saveSharedWorkDocument("editor", "work-1", {
        baseRevision: 7,
        crdtServerSequence: "27",
        title: "수정",
        doc: { pagesList: [{ id: "page-2" }] },
      })
    ).resolves.toEqual(saveResponse);
    expect(collaborationRepository.listSharedWorks).toHaveBeenCalledWith(
      "editor",
      50,
      "current_cursor"
    );
    expect(collaborationRepository.getSharedDocument).toHaveBeenCalledWith("editor", "work-1");
    expect(collaborationRepository.getSharedDocumentMeta).toHaveBeenCalledWith(
      "editor",
      "work-1"
    );
    expect(collaborationRepository.saveSharedDocument).toHaveBeenCalledWith(
      "editor",
      "work-1",
      7,
      BigInt(27),
      { title: "수정", doc: { pagesList: [{ id: "page-2" }] } }
    );
  });

  it("공유 저장 revision 충돌은 현재 번호만 포함한 409로 변환한다", async () => {
    collaborationRepository.saveSharedDocument.mockRejectedValue(
      new CreatorCollaborationRevisionConflictError(11)
    );
    const error = await createService()
      .saveSharedWorkDocument("editor", "work-1", {
        baseRevision: 10,
        crdtServerSequence: "27",
        doc: {},
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: "creator_work_revision_conflict",
      message: "다른 팀원이 먼저 저장했습니다. 최신 문서를 불러온 뒤 변경 내용을 다시 확인해 주세요.",
      currentRevision: 11,
    });
    expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain("document");
  });

  it("공유 저장 CRDT fence 충돌을 decimal 순번만 포함한 전용 409로 변환한다", async () => {
    collaborationRepository.saveSharedDocument.mockRejectedValue(
      new CreatorCollaborationCrdtSequenceConflictError(BigInt(27), BigInt(28))
    );
    const error = await createService()
      .saveSharedWorkDocument("editor", "work-1", {
        baseRevision: 10,
        crdtServerSequence: "27",
        doc: {},
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: "creator_crdt_sequence_conflict",
      message:
        "동기화 확인 후 다른 팀 편집이 먼저 저장됐습니다. 최신 원고를 맞춘 뒤 다시 저장해 주세요.",
      currentCrdtServerSequence: "28",
    });
    expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain("requested");
  });

  it("공유 저장 linked-pass asset fence도 원문 경로 없이 안정된 409로 변환한다", async () => {
    collaborationRepository.saveSharedDocument.mockRejectedValue(
      new StudioLinked3dPassAssetFenceError(
        "invalid-reserved-locator",
        "/doc/pagesList/0/elements/0/maskSrc",
      )
    );
    const error = await createService()
      .saveSharedWorkDocument("editor", "work-1", {
        baseRevision: 10,
        crdtServerSequence: "27",
        doc: {},
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: "creator_linked_3d_pass_asset_fence_failed",
      message: "연결된 3D 패스와 작품의 immutable PNG 자산이 일치하지 않습니다.",
      assetFenceCode: "invalid-reserved-locator",
    });
    expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain("maskSrc");
  });

  it("raw shared format 전환은 repository mutation 전에 strict 거부한다", async () => {
    await expect(
      createService().saveSharedWorkDocument(
        "owner",
        "work-1",
        {
          baseRevision: 7,
          crdtServerSequence: "27",
          title: "형식 전환 시도",
          format: "upload",
        } as never
      )
    ).rejects.toThrow();
    expect(collaborationRepository.saveSharedDocument).not.toHaveBeenCalled();
  });

  it("공유 문서 읽기·쓰기 권한 오류를 구분된 403으로 변환한다", async () => {
    collaborationRepository.getSharedDocument.mockRejectedValue(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );
    collaborationRepository.getSharedDocumentMeta.mockRejectedValue(
      new CreatorCollaborationForbiddenError("document_access_denied")
    );
    collaborationRepository.saveSharedDocument
      .mockRejectedValueOnce(new CreatorCollaborationForbiddenError("document_edit_denied"))
      .mockRejectedValueOnce(
        new CreatorCollaborationForbiddenError("document_owner_fields_denied")
      );
    const service = createService();

    const readError = await service
      .getSharedWorkDocument("pending", "work-1")
      .catch((cause: unknown) => cause);
    const metaError = await service
      .getSharedWorkDocumentMeta("pending", "work-1")
      .catch((cause: unknown) => cause);
    const writeError = await service
      .saveSharedWorkDocument("viewer", "work-1", {
        baseRevision: 1,
        crdtServerSequence: "27",
        doc: {},
      })
      .catch((cause: unknown) => cause);
    const ownerFieldError = await service
      .saveSharedWorkDocument("editor", "work-1", {
        baseRevision: 1,
        crdtServerSequence: "27",
        status: "published",
      })
      .catch((cause: unknown) => cause);
    expect(readError).toBeInstanceOf(ForbiddenException);
    expect((readError as ForbiddenException).message).toContain("볼 권한");
    expect(metaError).toBeInstanceOf(ForbiddenException);
    expect((metaError as ForbiddenException).message).toContain("볼 권한");
    expect(writeError).toBeInstanceOf(ForbiddenException);
    expect((writeError as ForbiddenException).message).toContain("저장할 권한");
    expect(ownerFieldError).toBeInstanceOf(ForbiddenException);
    expect((ownerFieldError as ForbiddenException).message).toContain("작품 소유자만");
  });

  it("repository의 권한·충돌·대상 검증 오류를 각각 403·409·400으로 변환한다", async () => {
    collaborationRepository.getTeam.mockRejectedValue(
      new CreatorCollaborationForbiddenError("team_access_denied")
    );
    collaborationRepository.getAuthorization.mockRejectedValue(
      new CreatorCollaborationForbiddenError("team_access_denied")
    );
    collaborationRepository.invite
      .mockRejectedValueOnce(new CreatorCollaborationConflictError("invitation_already_pending"))
      .mockRejectedValueOnce(new CreatorCollaborationInvalidTargetError("target_user_unavailable"));
    collaborationRepository.listSharedWorks.mockRejectedValue(
      new CreatorCollaborationInvalidTargetError("invalid_cursor")
    );
    const service = createService();

    await expect(service.getWorkTeam("viewer", "work")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getWorkAuthorization("viewer", "work")).rejects.toBeInstanceOf(
      ForbiddenException
    );
    await expect(
      service.inviteWorkTeamMember("owner", "work", "artist", "viewer")
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.inviteWorkTeamMember("owner", "work", "inactive", "viewer")
    ).rejects.toBeInstanceOf(BadRequestException);
    const cursorError = await service
      .listSharedWorks("editor", 50, "forged")
      .catch((cause: unknown) => cause);
    expect(cursorError).toBeInstanceOf(BadRequestException);
    expect((cursorError as BadRequestException).message).toContain("페이지 커서");
  });

  it("동일 actor·work의 초대 시도를 시간당 30회로 제한하고 429를 그대로 유지한다", async () => {
    const snapshot = { workId: "rate-limit-work" };
    collaborationRepository.invite.mockResolvedValue(snapshot);
    const service = createService();
    const requests = Array.from({ length: 30 }, (_, index) =>
      service.inviteWorkTeamMember(
        "rate-limit-actor-service-test",
        "rate-limit-work-service-test",
        `artist-${index}`,
        "viewer"
      )
    );

    await expect(Promise.all(requests)).resolves.toHaveLength(30);
    const limited = await service
      .inviteWorkTeamMember(
        "rate-limit-actor-service-test",
        "rate-limit-work-service-test",
        "artist-overflow",
        "viewer"
      )
      .catch((cause: unknown) => cause);

    expect(limited).toBeInstanceOf(HttpException);
    expect((limited as HttpException).getStatus()).toBe(429);
    expect((limited as HttpException).getResponse()).toEqual({
      code: "creator_team_invite_rate_limited",
      message: "팀 초대 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    });
    expect(collaborationRepository.invite).toHaveBeenCalledTimes(30);
  });

  it("변경된 초대·재초대 쿨다운 conflict는 클라이언트가 분기할 코드와 일반화된 문구를 준다", async () => {
    collaborationRepository.respondToInvitation.mockRejectedValue(
      new CreatorCollaborationConflictError("invitation_changed")
    );
    collaborationRepository.invite.mockRejectedValue(
      new CreatorCollaborationConflictError("reinvite_cooldown")
    );
    const service = createService();

    const changed = await service
      .respondToWorkTeamInvitation("artist", "work", "accept", INVITATION_ID)
      .catch((cause: unknown) => cause);
    const cooldown = await service
      .inviteWorkTeamMember("owner", "work", "artist", "viewer")
      .catch((cause: unknown) => cause);

    expect((changed as ConflictException).getResponse()).toEqual({
      code: "invitation_changed",
      message: "초대 내용이 변경되었습니다. 최신 팀 정보를 불러온 뒤 다시 선택해 주세요.",
    });
    expect((cooldown as ConflictException).getResponse()).toEqual({
      code: "reinvite_cooldown",
      message: "최근 처리된 초대입니다. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("알 수 없는 저장소 오류는 내부 정보를 노출하지 않는 503으로 변환한다", async () => {
    const logError = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    collaborationRepository.getTeam.mockRejectedValue(new Error("postgres password=secret"));
    const error = await createService().getWorkTeam("owner", "work").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain("secret");
    expect(logError).toHaveBeenCalledOnce();
    expect(JSON.stringify(logError.mock.calls)).toContain("get_team");
    expect(JSON.stringify(logError.mock.calls)).toContain("work");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret");
    logError.mockRestore();
  });
});
