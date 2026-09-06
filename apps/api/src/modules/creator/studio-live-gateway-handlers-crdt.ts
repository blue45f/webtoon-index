import {
  encodeStudioCrdtBinaryEnvelope,
  fragmentStudioCrdtBinarySyncEnvelope,
} from "../../../../web/src/shared/lib/studio-crdt-binary-envelope";

import { StudioCrdtService } from "./studio-crdt.service";
import {
  mapStudioLiveCrdtFailure,
  replyStudioLiveAck as reply,
  studioLiveFailure as failure,
} from "./studio-live-ack";
import {
  canonicalBase64DecodedLength,
  studioLiveCrdtBinaryRoom,
  studioLiveRoom,
} from "./studio-live-gateway-constants";
import {
  STUDIO_CRDT_BINARY_WIRE_FORMAT,
  STUDIO_CRDT_BINARY_WIRE_VERSION,
  STUDIO_CRDT_PROTOCOL_VERSION,
  STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT,
  STUDIO_LIVE_CRDT_BINARY_SYNC_EVENT,
  STUDIO_LIVE_CRDT_BINARY_UPDATE_EVENT,
  STUDIO_LIVE_CRDT_WIRE_SELECT_EVENT,
  STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT,
  StudioLiveCrdtBinarySelectSchema,
  StudioLiveCrdtBinarySyncSchema,
  StudioLiveCrdtBinaryUpdateSchema,
  StudioLiveCrdtSyncSchema,
  StudioLiveCrdtUpdateSchema,
  StudioLiveCursorSchema,
  StudioLiveGesturePreviewSchema,
  StudioLivePresenceSchema,
} from "./studio-live.protocol";

import type { StudioLiveCrdtBinarySyncWireResult } from "./studio-live-gateway-constants";
import type { StudioLiveGatewayHost } from "./studio-live-gateway-host";
import type {
  StudioLiveAck,
  StudioLiveAckCallback,
  StudioLiveCrdtBinaryRemoteUpdate,
  StudioLiveCrdtBinarySelection,
  StudioLiveCrdtBinarySelectInput,
  StudioLiveCrdtBinarySyncInput,
  StudioLiveCrdtBinaryUpdateAck,
  StudioLiveCrdtBinaryUpdateInput,
  StudioLiveCrdtRemoteUpdate,
  StudioLiveCrdtSyncInput,
  StudioLiveCrdtSyncResult,
  StudioLiveCrdtUpdateAck,
  StudioLiveCrdtUpdateInput,
  StudioLiveCursorInput,
  StudioLiveGesturePreviewInput,
  StudioLiveParticipant,
  StudioLivePresenceInput,
  StudioLiveSocket,
} from "./studio-live.protocol";

export async function updatePresence(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLivePresenceInput,
  ack?: StudioLiveAckCallback<{ participant: StudioLiveParticipant }>
) {
  const parsed = StudioLivePresenceSchema.safeParse(body);
  if (!parsed.success) return reply(ack, failure("invalid_payload", "작업 상태 정보가 올바르지 않습니다."));
  if (!this.consumeRateLimit(client, "presence", 30, 10_000)) {
    return reply(ack, failure("rate_limited", "작업 상태 갱신이 너무 빠릅니다."));
  }
  const authorized = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    false,
    (participant) => {
      participant.state = parsed.data.state;
      if (Object.hasOwn(parsed.data, "pageId")) participant.pageId = parsed.data.pageId ?? null;
      if (Object.hasOwn(parsed.data, "tool")) participant.tool = parsed.data.tool ?? null;
      participant.updatedAt = new Date().toISOString();
      const safe = this.publishParticipantToSocketData(client, participant);
      this.server.to(studioLiveRoom(participant.workId)).emit("studio:presence:update", safe);
      return safe;
    }
  );
  if (!authorized) return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  return reply(ack, { ok: true, data: { participant: authorized.value } });
}

export async function updateCursor(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLiveCursorInput,
  ack?: StudioLiveAckCallback<{ accepted: true }>
) {
  const parsed = StudioLiveCursorSchema.safeParse(body);
  if (!parsed.success) return reply(ack, failure("invalid_payload", "커서 위치가 올바르지 않습니다."));
  if (!this.consumeRateLimit(client, "cursor", 90, 3_000)) {
    return reply(ack, failure("rate_limited", "커서 위치 전송이 너무 빠릅니다."));
  }
  const authorized = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    false,
    (participant) => {
      client.to(studioLiveRoom(participant.workId)).emit("studio:cursor", {
        connectionId: participant.connectionId,
        pageId: parsed.data.pageId,
        x: parsed.data.x,
        y: parsed.data.y,
        tool: parsed.data.tool ?? null,
        drawing: parsed.data.drawing,
        strokeColor: parsed.data.strokeColor,
        strokeWidth: parsed.data.strokeWidth,
        strokeOpacity: parsed.data.strokeOpacity,
        points: parsed.data.points,
        sentAt: new Date().toISOString(),
      });
    }
  );
  if (!authorized) return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  return reply(ack, { ok: true, data: { accepted: true } });
}

export async function relayGesturePreview(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLiveGesturePreviewInput,
  ack?: StudioLiveAckCallback<{ accepted: true }>
) {
  const parsed = StudioLiveGesturePreviewSchema.safeParse(body);
  if (!parsed.success) {
    return reply(ack, failure("invalid_payload", "제스처 미리보기 정보가 올바르지 않습니다."));
  }
  if (!this.consumeRateLimit(client, "gesture-preview", 90, 3_000)) {
    return reply(ack, failure("rate_limited", "제스처 미리보기 전송이 너무 빠릅니다."));
  }
  const authorized = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    false,
    (participant) => {
      if (!participant.capabilities.edit) return false;
      client
        .to(studioLiveRoom(participant.workId))
        .emit(STUDIO_LIVE_GESTURE_PREVIEW_SOCKET_EVENT, {
          connectionId: participant.connectionId,
          preview: parsed.data.preview,
        });
      return true;
    }
  );
  if (!authorized) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }
  if (!authorized.value) {
    return reply(ack, failure("forbidden", "이 작품을 편집할 권한이 없습니다."));
  }
  return reply(ack, { ok: true, data: { accepted: true } });
}

export async function selectCrdtBinaryWire(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLiveCrdtBinarySelectInput,
  ack?: StudioLiveAckCallback<StudioLiveCrdtBinarySelection>
) {
  const parsed = StudioLiveCrdtBinarySelectSchema.safeParse(body);
  if (!parsed.success) {
    return reply(ack, failure("invalid_payload", "CRDT 전송 형식 선택 정보가 올바르지 않습니다."));
  }
  const participant = this.currentJoinedCrdtParticipant(client, parsed.data.workId);
  const selection = this.currentCrdtBinarySelection(
    client,
    parsed.data.workId,
    parsed.data.selectionEpoch,
    false
  );
  if (!participant || !selection) {
    return reply(ack, failure("not_joined", "최신 작업실 참가 정보로 다시 연결해 주세요."));
  }
  const authorizedBefore = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    true,
    (current) => current
  );
  if (!authorizedBefore || authorizedBefore.value !== participant) {
    await this.finishCrdtBinarySelectionCleanup(selection);
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }
  if (!selection.selected) {
    try {
      selection.pendingJoin ??= Promise.resolve(
        client.join(studioLiveCrdtBinaryRoom(parsed.data.workId))
      );
      await selection.pendingJoin;
    } catch {
      await this.finishCrdtBinarySelectionCleanup(selection);
      return reply(
        ack,
        failure("temporarily_unavailable", "바이너리 공동 편집 채널에 연결하지 못했습니다.")
      );
    }
    const currentSelection = this.currentCrdtBinarySelection(
      client,
      parsed.data.workId,
      parsed.data.selectionEpoch,
      false
    );
    const authorizedAfter = await this.runWithAuthorizedParticipant(
      client,
      parsed.data.workId,
      false,
      true,
      (current) => current
    );
    if (
      currentSelection !== selection ||
      !authorizedAfter ||
      authorizedAfter.value !== authorizedBefore.value
    ) {
      await this.finishCrdtBinarySelectionCleanup(selection);
      return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
    }
    selection.pendingJoin = null;
    selection.selected = true;
  }
  return reply(ack, {
    ok: true,
    data: {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
      workId: parsed.data.workId,
      format: STUDIO_CRDT_BINARY_WIRE_FORMAT,
      selectionEpoch: selection.selectionEpoch,
      selected: true,
    },
  });
}

export async function syncCrdtDocumentBinary(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLiveCrdtBinarySyncInput,
  ack?: StudioLiveAckCallback<StudioLiveCrdtBinarySyncWireResult>
) {
  const parsed = StudioLiveCrdtBinarySyncSchema.safeParse(body);
  if (!parsed.success) {
    return reply(ack, failure("invalid_payload", "바이너리 CRDT 동기화 요청이 올바르지 않습니다."));
  }
  const quotaParticipant = this.currentJoinedCrdtParticipant(
    client,
    parsed.data.workId
  );
  const binarySelection = this.currentCrdtBinarySelection(
    client,
    parsed.data.workId,
    undefined,
    true
  );
  if (!quotaParticipant || !binarySelection) {
    return reply(ack, failure("not_joined", "바이너리 공동 편집 채널을 다시 선택해 주세요."));
  }
  if (
    !this.crdtQuotaLimiter.consumeSync({
      userId: quotaParticipant.userId,
      workId: parsed.data.workId,
    })
  ) {
    return reply(ack, failure("rate_limited", "CRDT 전체 동기화 요청이 너무 많습니다."));
  }
  const authorizedBefore = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    true,
    (participant) => participant
  );
  if (
    !authorizedBefore ||
    authorizedBefore.value !== quotaParticipant ||
    this.currentCrdtBinarySelection(
      client,
      parsed.data.workId,
      undefined,
      true
    ) !== binarySelection
  ) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }

  let sync: Awaited<ReturnType<StudioCrdtService["syncBytes"]>>;
  try {
    sync = await this.studioCrdtService.syncBytes(
      parsed.data.workId,
      parsed.data.stateVector
    );
  } catch (error) {
    const mappedFailure = mapStudioLiveCrdtFailure(error, parsed.data.workId, "sync");
    if (mappedFailure.diagnostic) {
      this.logger.error(mappedFailure.diagnostic, "studio CRDT operation failed");
    }
    return reply(ack, mappedFailure.response);
  }
  const authorizedAfter = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    true,
    (participant) => participant
  );
  if (
    !authorizedAfter ||
    authorizedAfter.value !== authorizedBefore.value ||
    this.currentCrdtBinarySelection(
      client,
      parsed.data.workId,
      undefined,
      true
    ) !== binarySelection
  ) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }

  try {
    const diffEnvelope = encodeStudioCrdtBinaryEnvelope("sync-diff", sync.update);
    const fragments = fragmentStudioCrdtBinarySyncEnvelope(diffEnvelope);
    return reply(ack, {
      ok: true,
      data: {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
        workId: parsed.data.workId,
        requestId: parsed.data.requestId,
        transferId: crypto.randomUUID(),
        fragments,
        fragmentCount: fragments.length,
        wireBytes: diffEnvelope.byteLength,
        totalBytes: sync.totalBytes,
        serverStateVector: encodeStudioCrdtBinaryEnvelope(
          "state-vector",
          sync.serverStateVector
        ),
        serverSequence: sync.serverSequence,
      },
    });
  } catch (error) {
    this.logger.error(
      {
        workId: parsed.data.workId,
        error: error instanceof Error ? error.message : "unknown",
      },
      "studio CRDT binary sync encoding failed"
    );
    return reply(ack, failure("internal_error", "CRDT 동기화 응답을 구성하지 못했습니다."));
  }
}

export async function applyCrdtUpdateBinary(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLiveCrdtBinaryUpdateInput,
  ack?: StudioLiveAckCallback<StudioLiveCrdtBinaryUpdateAck>
) {
  const parsed = StudioLiveCrdtBinaryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return reply(ack, failure("invalid_payload", "바이너리 CRDT 편집 업데이트가 올바르지 않습니다."));
  }
  const quotaParticipant = this.currentJoinedCrdtParticipant(
    client,
    parsed.data.workId
  );
  const binarySelection = this.currentCrdtBinarySelection(
    client,
    parsed.data.workId,
    undefined,
    true
  );
  if (!quotaParticipant || !binarySelection) {
    return reply(ack, failure("not_joined", "바이너리 공동 편집 채널을 다시 선택해 주세요."));
  }
  if (
    !this.crdtQuotaLimiter.consumeUpdate(
      { userId: quotaParticipant.userId, workId: parsed.data.workId },
      parsed.data.update.byteLength
    )
  ) {
    return reply(ack, failure("rate_limited", "CRDT 편집 업데이트 전송이 너무 빠릅니다."));
  }
  const authorizedBefore = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    true,
    (participant) => participant
  );
  if (
    !authorizedBefore ||
    authorizedBefore.value !== quotaParticipant ||
    this.currentCrdtBinarySelection(
      client,
      parsed.data.workId,
      undefined,
      true
    ) !== binarySelection
  ) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }
  if (!authorizedBefore.value.capabilities.edit) {
    return reply(ack, failure("forbidden", "이 작품을 편집할 권한이 없습니다."));
  }

  let applied: Awaited<ReturnType<StudioCrdtService["applyUpdateBytes"]>>;
  try {
    applied = await this.studioCrdtService.applyUpdateBytes({
      workId: parsed.data.workId,
      updateId: parsed.data.updateId,
      actorUserId: authorizedBefore.value.userId,
      data: parsed.data.update,
    });
  } catch (error) {
    const mappedFailure = mapStudioLiveCrdtFailure(error, parsed.data.workId, "update");
    if (mappedFailure.diagnostic) {
      this.logger.error(mappedFailure.diagnostic, "studio CRDT operation failed");
    }
    return reply(ack, mappedFailure.response);
  }

  const data: StudioLiveCrdtBinaryUpdateAck = {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
    workId: parsed.data.workId,
    updateId: applied.updateId,
    serverSequence: applied.serverSequence,
    duplicate: applied.duplicate,
  };
  const response: StudioLiveAck<StudioLiveCrdtBinaryUpdateAck> = { ok: true, data };
  reply(ack, response);
  if (!applied.duplicate) {
    const legacyRemote: StudioLiveCrdtRemoteUpdate = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: parsed.data.workId,
      updateId: applied.updateId,
      serverSequence: applied.serverSequence,
      update: Buffer.from(applied.update).toString("base64"),
    };
    try {
      client
        .to(studioLiveRoom(parsed.data.workId))
        .emit("studio:crdt:update", legacyRemote);
    } catch (error) {
      this.logCrdtBroadcastFailure(parsed.data.workId, applied.updateId, error, "legacy");
    }
    try {
      const binaryRemote: StudioLiveCrdtBinaryRemoteUpdate = {
        protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
        wireVersion: STUDIO_CRDT_BINARY_WIRE_VERSION,
        workId: parsed.data.workId,
        updateId: applied.updateId,
        serverSequence: applied.serverSequence,
        update: encodeStudioCrdtBinaryEnvelope("update", applied.update),
      };
      client
        .to(studioLiveCrdtBinaryRoom(parsed.data.workId))
        .emit(STUDIO_LIVE_CRDT_BINARY_REMOTE_EVENT, binaryRemote);
    } catch (error) {
      this.logCrdtBroadcastFailure(parsed.data.workId, applied.updateId, error, "binary");
    }
  }
  return response;
}

export async function syncCrdtDocument(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLiveCrdtSyncInput,
  ack?: StudioLiveAckCallback<StudioLiveCrdtSyncResult>
) {
  const parsed = StudioLiveCrdtSyncSchema.safeParse(body);
  if (!parsed.success) {
    return reply(ack, failure("invalid_payload", "CRDT 동기화 요청이 올바르지 않습니다."));
  }
  const quotaParticipant = this.currentJoinedCrdtParticipant(
    client,
    parsed.data.workId
  );
  if (!quotaParticipant) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }
  if (
    !this.crdtQuotaLimiter.consumeSync({
      userId: quotaParticipant.userId,
      workId: parsed.data.workId,
    })
  ) {
    return reply(ack, failure("rate_limited", "CRDT 전체 동기화 요청이 너무 많습니다."));
  }
  const authorizedBefore = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    true,
    (participant) => participant
  );
  if (!authorizedBefore || authorizedBefore.value !== quotaParticipant) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }

  let sync: Awaited<ReturnType<StudioCrdtService["sync"]>>;
  try {
    sync = await this.studioCrdtService.sync(
      parsed.data.workId,
      parsed.data.stateVector
    );
  } catch (error) {
    const mappedFailure = mapStudioLiveCrdtFailure(error, parsed.data.workId, "sync");
    if (mappedFailure.diagnostic) {
      this.logger.error(mappedFailure.diagnostic, "studio CRDT operation failed");
    }
    return reply(ack, mappedFailure.response);
  }
  const authorizedAfter = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    true,
    (participant) => participant
  );
  if (!authorizedAfter || authorizedAfter.value !== authorizedBefore.value) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }
  return reply(ack, {
    ok: true,
    data: {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: parsed.data.workId,
      requestId: parsed.data.requestId,
      transferId: crypto.randomUUID(),
      chunks: sync.chunks,
      chunkCount: sync.chunkCount,
      totalBytes: sync.totalBytes,
      serverStateVector: sync.serverStateVector,
      serverSequence: sync.serverSequence,
    },
  });
}

export async function applyCrdtUpdate(
  this: StudioLiveGatewayHost, 
  client: StudioLiveSocket,
  body: StudioLiveCrdtUpdateInput,
  ack?: StudioLiveAckCallback<StudioLiveCrdtUpdateAck>
) {
  const parsed = StudioLiveCrdtUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return reply(ack, failure("invalid_payload", "CRDT 편집 업데이트가 올바르지 않습니다."));
  }
  const decodedBytes = canonicalBase64DecodedLength(parsed.data.update);
  const quotaParticipant = this.currentJoinedCrdtParticipant(
    client,
    parsed.data.workId
  );
  if (!quotaParticipant) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }
  if (
    !this.crdtQuotaLimiter.consumeUpdate(
      { userId: quotaParticipant.userId, workId: parsed.data.workId },
      decodedBytes
    )
  ) {
    return reply(ack, failure("rate_limited", "CRDT 편집 업데이트 전송이 너무 빠릅니다."));
  }
  const authorizedBefore = await this.runWithAuthorizedParticipant(
    client,
    parsed.data.workId,
    false,
    true,
    (participant) => participant
  );
  if (!authorizedBefore || authorizedBefore.value !== quotaParticipant) {
    return reply(ack, failure("not_joined", "실시간 작업실에 다시 참여해 주세요."));
  }
  if (!authorizedBefore.value.capabilities.edit) {
    return reply(ack, failure("forbidden", "이 작품을 편집할 권한이 없습니다."));
  }

  let applied: Awaited<ReturnType<StudioCrdtService["applyUpdate"]>>;
  try {
    applied = await this.studioCrdtService.applyUpdate({
      workId: parsed.data.workId,
      updateId: parsed.data.updateId,
      actorUserId: authorizedBefore.value.userId,
      data: parsed.data.update,
    });
  } catch (error) {
    const mappedFailure = mapStudioLiveCrdtFailure(error, parsed.data.workId, "update");
    if (mappedFailure.diagnostic) {
      this.logger.error(mappedFailure.diagnostic, "studio CRDT operation failed");
    }
    return reply(ack, mappedFailure.response);
  }

  const data: StudioLiveCrdtUpdateAck = {
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    workId: parsed.data.workId,
    updateId: applied.updateId,
    serverSequence: applied.serverSequence,
    serverStateVector: applied.serverStateVector,
    duplicate: applied.duplicate,
  };
  const response: StudioLiveAck<StudioLiveCrdtUpdateAck> = { ok: true, data };
  // The forced ACL check immediately before applyUpdate is the authorization linearization
  // point. Once persistence starts, its durable outcome must always be ACKed and fanned out: a
  // second ACL check here could turn a committed operation into an apparent failure, causing
  // retries while peers never observe the already-persisted update.
  // The sender learns that durable persistence succeeded before any peer can observe the op.
  reply(ack, response);
  if (!applied.duplicate) {
    const remote: StudioLiveCrdtRemoteUpdate = {
      protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
      workId: parsed.data.workId,
      updateId: applied.updateId,
      serverSequence: applied.serverSequence,
      update: applied.update,
    };
    try {
      client.to(studioLiveRoom(parsed.data.workId)).emit("studio:crdt:update", remote);
    } catch (error) {
      this.logger.error(
        {
          workId: parsed.data.workId,
          updateId: applied.updateId,
          error: error instanceof Error ? error.message : "unknown",
        },
        "studio CRDT persisted but peer broadcast failed"
      );
    }
  }
  return response;
}
