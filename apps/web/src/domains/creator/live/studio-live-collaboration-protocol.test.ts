import { describe, expect, it } from "vitest";

import {
  STUDIO_LIVE_CHAT_TEXT_MAX_LENGTH,
  STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES,
  STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_METADATA_MAX_BYTES,
  STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH,
  STUDIO_LIVE_LOCK_MAX_LEASE_MS,
  STUDIO_LIVE_MESSAGE_MAX_AGE_MS,
  STUDIO_LIVE_MESSAGE_MAX_BYTES,
  STUDIO_LIVE_RESOURCE_MAX_LENGTH,
  STUDIO_LIVE_SDP_MAX_LENGTH,
  STUDIO_LIVE_SDP_MID_MAX_LENGTH,
  STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH,
  StudioLiveProtocolError,
  createStudioLiveEnvelope,
  parseStudioLiveEnvelope,
  studioLiveJsonEscapedContentByteLength,
  studioLiveEnvelopeByteLength,
  studioLiveUtf8ByteLength,
  studioLocalLiveChannelName,
  type StudioLiveMessageKind,
  type StudioLiveParticipant,
  type StudioLivePayloadMap,
} from "./studio-live-collaboration-protocol";
import {
  STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES,
  type StudioLiveGesturePreviewPayload,
} from "./studio-live-gesture-preview";

const NOW = 2_000_000;
const WORK_ID = "work/local-1";
const LOCAL_SESSION = "session-local";
const participant: StudioLiveParticipant = {
  sessionId: "session-peer",
  displayName: "서윤",
  role: "editor",
};

function message<K extends StudioLiveMessageKind>(
  kind: K,
  payload: StudioLivePayloadMap[K],
  targetSessionId: string | null = null,
  sentAt = NOW
) {
  return createStudioLiveEnvelope({
    workId: WORK_ID,
    sender: participant,
    sentAt,
    sequence: 1,
    kind,
    targetSessionId,
    payload,
  });
}

function parse(value: unknown, now = NOW) {
  return parseStudioLiveEnvelope(value, {
    expectedWorkId: WORK_ID,
    selfSessionId: LOCAL_SESSION,
    now,
  });
}

function nearMaximumGesturePreviewPayload(): StudioLiveGesturePreviewPayload {
  const sampleCount = 280;
  const channel = (value: number) => Array.from({ length: sampleCount }, () => value);
  return {
    version: 1,
    gestureId: "gesture-near-envelope-limit-x",
    pageId: "page-1",
    seq: 1,
    phase: "begin",
    operation: "draw",
    base: { documentGeneration: 1 },
    renderer: {
      kind: "freehand",
      mode: "pen",
      stroke: "#000000",
      strokeWidth: 1,
    },
    samples: {
      startIndex: 0,
      points: Array.from(
        { length: sampleCount },
        () => [9_999_999.123456789, -9_999_999.123456789],
      ).flat(),
      pressures: channel(0.123456789012345),
      tiltXs: channel(-89.1234567890123),
      tiltYs: channel(89.1234567890123),
      twists: channel(358.123456789012),
      speeds: channel(999_999.123456789),
      tangentialPressures: channel(-0.123456789012345),
      altitudeAngles: channel(1.123456789012345),
      azimuthAngles: channel(6.123456789012345),
      contactWidths: channel(8_191.123456789012),
      contactHeights: channel(8_191.123456789012),
      sampleTimeOffsets: Array.from(
        { length: sampleCount },
        (_, index) => index + 0.123456789012345,
      ),
    },
  };
}

describe("studio live collaboration protocol", () => {
  it("accepts a strict same-work presence envelope without persistent account identifiers", () => {
    const value = message("presence:hello", { visibility: "active", pageId: "page-1" });

    expect(parse(value)).toEqual(value);
    expect(
      parse(message("presence:heartbeat", { visibility: "active", pageId: "page-1", tool: "pen" }))
    ).not.toBeNull();
    expect(() =>
      message("presence:heartbeat", {
        visibility: "active",
        pageId: "page-1",
        tool: "pen\nforged",
      })
    ).toThrow(StudioLiveProtocolError);
    expect(Object.keys(value.sender).sort()).toEqual(["displayName", "role", "sessionId"]);
    expect(value.sender).not.toHaveProperty("userId");
  });

  it("strictly parses bounded gesture previews with envelope-only framing headroom", () => {
    const payload = nearMaximumGesturePreviewPayload();
    const payloadBytes = studioLiveUtf8ByteLength(JSON.stringify(payload));
    expect(payloadBytes).toBeLessThanOrEqual(STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES);

    const value = message("preview:gesture", payload);
    const envelopeBytes = studioLiveEnvelopeByteLength(value);
    expect(envelopeBytes).toBeGreaterThan(STUDIO_LIVE_MESSAGE_MAX_BYTES);
    expect(envelopeBytes).toBeLessThanOrEqual(STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES);
    expect(STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_MAX_BYTES).toBe(
      STUDIO_LIVE_GESTURE_PREVIEW_MAX_BYTES
        + STUDIO_LIVE_GESTURE_PREVIEW_ENVELOPE_METADATA_MAX_BYTES,
    );
    expect(parse(value)).toEqual(value);

    expect(parse({ ...value, targetSessionId: LOCAL_SESSION })).toBeNull();
    expect(parse({
      ...value,
      payload: { ...payload, extension: { rendererUrl: "blob:preview" } },
    })).toBeNull();
    expect(parse({
      ...value,
      payload: { ...payload, extension: "x".repeat(5 * 1024) },
    })).toBeNull();
  });

  it("rejects cross-work, self, stale and future messages", () => {
    const value = message("presence:heartbeat", { visibility: "idle", pageId: null });

    expect(parse({ ...value, workId: "work-other" })).toBeNull();
    expect(parse({ ...value, sender: { ...value.sender, sessionId: LOCAL_SESSION } })).toBeNull();
    expect(parse({ ...value, sentAt: NOW - STUDIO_LIVE_MESSAGE_MAX_AGE_MS - 1 })).toBeNull();
    expect(parse({ ...value, sentAt: NOW + 5_001 })).toBeNull();
  });

  it("requires exact plain-object envelope, participant and payload fields", () => {
    const value = message("cursor:update", {
      x: 0.25,
      y: 0.75,
      pageId: "page-1",
      tool: "brush",
    });

    expect(parse({ ...value, authToken: "secret" })).toBeNull();
    expect(parse({ ...value, sender: { ...value.sender, userId: "db-user" } })).toBeNull();
    expect(parse({ ...value, payload: { ...value.payload, pressure: 0.5 } })).toBeNull();
    expect(parse(Object.assign(Object.create({ polluted: true }), value))).toBeNull();
  });

  it("bounds normalized cursor coordinates, labels and ids", () => {
    const value = message("cursor:update", { x: 0, y: 1, pageId: null, tool: null });
    expect(parse(value)).not.toBeNull();
    expect(parse({ ...value, payload: { ...value.payload, x: -0.01 } })).toBeNull();
    expect(parse({ ...value, payload: { ...value.payload, y: 1.01 } })).toBeNull();
    expect(parse({ ...value, payload: { ...value.payload, tool: "x".repeat(64) } })).not.toBeNull();
    expect(parse({ ...value, payload: { ...value.payload, tool: "x".repeat(65) } })).toBeNull();
  });

  it("accepts only targeted request/SDP/ICE messages addressed to this session", () => {
    const request = message("screen:request", { shareId: "share-1" }, LOCAL_SESSION);
    const access = message(
      "screen:access",
      { shareId: "share-1", decision: "approved" },
      LOCAL_SESSION
    );
    const offer = message(
      "webrtc:description",
      { shareId: "share-1", type: "offer", sdp: "v=0" },
      LOCAL_SESSION
    );
    const ice = message(
      "webrtc:ice",
      {
        shareId: "share-1",
        candidate: "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
      LOCAL_SESSION
    );

    expect(parse(request)).not.toBeNull();
    expect(parse(access)).not.toBeNull();
    expect(parse(offer)).not.toBeNull();
    expect(parse(ice)).not.toBeNull();
    expect(parse({ ...request, targetSessionId: "session-other" })).toBeNull();
    expect(parse({ ...request, targetSessionId: null })).toBeNull();
    expect(parse({ ...access, targetSessionId: null })).toBeNull();
    expect(parse({ ...offer, targetSessionId: null })).toBeNull();
    expect(parse({ ...ice, targetSessionId: null })).toBeNull();
  });

  it("rejects a target on broadcast-only messages", () => {
    const announce = message("screen:announce", { shareId: "share-1", label: "작업 화면" });
    const stop = message("screen:stop", { shareId: "share-1" });

    expect(parse(announce)).not.toBeNull();
    expect(parse(stop)).not.toBeNull();
    expect(parse({ ...announce, targetSessionId: LOCAL_SESSION })).toBeNull();
    expect(parse({ ...stop, targetSessionId: LOCAL_SESSION })).toBeNull();
  });

  it("validates lease bounds and claim-scoped releases", () => {
    const claim = message("lock:claim", {
      resource: "page:page-1",
      claimId: "claim-1",
      leaseUntil: NOW + STUDIO_LIVE_LOCK_MAX_LEASE_MS,
    });
    const release = message("lock:release", {
      resource: "page:page-1",
      claimId: "claim-1",
    });

    expect(parse(claim)).not.toBeNull();
    expect(parse(release)).not.toBeNull();
    expect(
      parse({
        ...claim,
        payload: { ...claim.payload, leaseUntil: NOW + STUDIO_LIVE_LOCK_MAX_LEASE_MS + 1 },
      })
    ).toBeNull();
    expect(parse({ ...claim, payload: { ...claim.payload, leaseUntil: NOW } })).toBeNull();
    expect(parse({ ...release, payload: { resource: release.payload.resource } })).toBeNull();
  });

  it("matches the server's exact resource identifier boundary", () => {
    const claim = message("lock:claim", {
      resource: "r".repeat(STUDIO_LIVE_RESOURCE_MAX_LENGTH),
      claimId: "claim-1",
      leaseUntil: NOW + 5_000,
    });
    expect(parse(claim)).not.toBeNull();
    expect(
      parse({
        ...claim,
        payload: {
          ...claim.payload,
          resource: "r".repeat(STUDIO_LIVE_RESOURCE_MAX_LENGTH + 1),
        },
      })
    ).toBeNull();
  });

  it("rejects invalid SDP types and oversized signaling before state mutation", () => {
    const offer = message(
      "webrtc:description",
      { shareId: "share-1", type: "offer", sdp: "v=0" },
      LOCAL_SESSION
    );
    expect(parse({ ...offer, payload: { ...offer.payload, type: "rollback" } })).toBeNull();
    expect(parse({ ...offer, payload: { ...offer.payload, sdp: "x".repeat(49 * 1024) } })).toBeNull();

    const tooLarge = { ...offer, padding: "x".repeat(STUDIO_LIVE_MESSAGE_MAX_BYTES) };
    expect(studioLiveEnvelopeByteLength(tooLarge)).toBeGreaterThan(STUDIO_LIVE_MESSAGE_MAX_BYTES);
    expect(parse(tooLarge)).toBeNull();
  });

  it("accepts SDP CR/LF at 48 KiB but rejects overflow and every other control", () => {
    const boundarySdp = `v=0\r\n${"s".repeat(STUDIO_LIVE_SDP_MAX_LENGTH - 7)}`;
    const offer = message(
      "webrtc:description",
      { shareId: "share-1", type: "offer", sdp: boundarySdp },
      LOCAL_SESSION
    );
    expect(studioLiveJsonEscapedContentByteLength(offer.payload.sdp)).toBe(
      STUDIO_LIVE_SDP_MAX_LENGTH
    );
    expect(parse(offer)).not.toBeNull();
    expect(
      parse({ ...offer, payload: { ...offer.payload, sdp: `${boundarySdp}x` } })
    ).toBeNull();
    for (const control of ["\t", "\u0000", "\u0085"]) {
      expect(
        parse({ ...offer, payload: { ...offer.payload, sdp: `v=0${control}tail` } })
      ).toBeNull();
    }
  });

  it("enforces SDP raw UTF-8 and JSON-escaped byte boundaries without banning Unicode", () => {
    const multibyteBoundary = "가".repeat(STUDIO_LIVE_SDP_MAX_LENGTH / 3);
    const escapedUnit = "\r\n\\\"";
    const escapedBoundary = `vv${escapedUnit.repeat(6_143)}\r\n\\`;
    expect(studioLiveUtf8ByteLength(multibyteBoundary)).toBe(STUDIO_LIVE_SDP_MAX_LENGTH);
    expect(studioLiveJsonEscapedContentByteLength(multibyteBoundary)).toBe(
      STUDIO_LIVE_SDP_MAX_LENGTH
    );
    expect(studioLiveUtf8ByteLength(escapedBoundary)).toBeLessThan(
      STUDIO_LIVE_SDP_MAX_LENGTH
    );
    expect(studioLiveJsonEscapedContentByteLength(escapedBoundary)).toBe(
      STUDIO_LIVE_SDP_MAX_LENGTH
    );

    const offer = message(
      "webrtc:description",
      { shareId: "share-1", type: "offer", sdp: multibyteBoundary },
      LOCAL_SESSION
    );
    expect(parse(offer)).not.toBeNull();
    expect(
      parse({ ...offer, payload: { ...offer.payload, sdp: `${multibyteBoundary}가` } })
    ).toBeNull();
    expect(parse({ ...offer, payload: { ...offer.payload, sdp: escapedBoundary } })).not.toBeNull();
    expect(
      parse({ ...offer, payload: { ...offer.payload, sdp: `${escapedBoundary}"` } })
    ).toBeNull();
  });

  it("enforces ICE, sdpMid and usernameFragment boundaries including empty optional strings", () => {
    const ice = message(
      "webrtc:ice",
      {
        shareId: "share-1",
        candidate: "c".repeat(STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH),
        sdpMid: "m".repeat(STUDIO_LIVE_SDP_MID_MAX_LENGTH),
        sdpMLineIndex: 0,
        usernameFragment: "u".repeat(STUDIO_LIVE_USERNAME_FRAGMENT_MAX_LENGTH),
      },
      LOCAL_SESSION
    );
    expect(parse(ice)).not.toBeNull();
    expect(
      parse({
        ...ice,
        payload: {
          ...ice.payload,
          candidate: `${ice.payload.candidate}c`,
        },
      })
    ).toBeNull();
    expect(
      parse({
        ...ice,
        payload: { ...ice.payload, sdpMid: `${ice.payload.sdpMid}m` },
      })
    ).toBeNull();
    expect(
      parse({
        ...ice,
        payload: {
          ...ice.payload,
          usernameFragment: `${ice.payload.usernameFragment}u`,
        },
      })
    ).toBeNull();
    expect(
      parse({
        ...ice,
        payload: { ...ice.payload, sdpMid: "", usernameFragment: "" },
      })
    ).not.toBeNull();
    expect(
      parse({
        ...ice,
        payload: { ...ice.payload, candidate: "candidate:\ncontrol" },
      })
    ).toBeNull();
    expect(
      parse({
        ...ice,
        payload: { ...ice.payload, sdpMid: "mid\tcontrol" },
      })
    ).toBeNull();
    expect(
      parse({
        ...ice,
        payload: { ...ice.payload, usernameFragment: "user\u0085control" },
      })
    ).toBeNull();
  });

  it("enforces ICE raw UTF-8 and dense JSON escape byte boundaries", () => {
    const multibyteBoundary = "🙂".repeat(STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH / 4);
    const escapedBoundary = `cc${"\\\"".repeat(2_047)}\\`;
    expect(studioLiveUtf8ByteLength(multibyteBoundary)).toBe(
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH
    );
    expect(studioLiveJsonEscapedContentByteLength(multibyteBoundary)).toBe(
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH
    );
    expect(studioLiveUtf8ByteLength(escapedBoundary)).toBeLessThan(
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH
    );
    expect(studioLiveJsonEscapedContentByteLength(escapedBoundary)).toBe(
      STUDIO_LIVE_ICE_CANDIDATE_MAX_LENGTH
    );

    const ice = message(
      "webrtc:ice",
      {
        shareId: "share-1",
        candidate: multibyteBoundary,
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
      LOCAL_SESSION
    );
    expect(parse(ice)).not.toBeNull();
    expect(
      parse({ ...ice, payload: { ...ice.payload, candidate: `${multibyteBoundary}🙂` } })
    ).toBeNull();
    expect(
      parse({ ...ice, payload: { ...ice.payload, candidate: escapedBoundary } })
    ).not.toBeNull();
    expect(
      parse({ ...ice, payload: { ...ice.payload, candidate: `${escapedBoundary}"` } })
    ).toBeNull();
  });

  it("rejects control characters in ids and labels while allowing SDP line endings", () => {
    const presence = message("presence:hello", { visibility: "active", pageId: "page-1" });
    const offer = message(
      "webrtc:description",
      { shareId: "share-1", type: "offer", sdp: "v=0\r\no=peer\r\n" },
      LOCAL_SESSION
    );

    expect(parse(offer)).not.toBeNull();
    expect(
      parse({
        ...presence,
        sender: { ...presence.sender, displayName: "악성\n이름" },
      })
    ).toBeNull();
    expect(parse({ ...presence, payload: { ...presence.payload, pageId: "page\u0000other" } })).toBeNull();
    expect(
      parse({ ...offer, payload: { ...offer.payload, sdp: "v=0\r\no=peer\u0000tail" } })
    ).toBeNull();
  });

  it("isolates strict broadcast voice membership from targeted audio WebRTC signaling", () => {
    const join = message("voice:join", { callId: "voice-main", muted: false });
    const state = message("voice:state", { callId: "voice-main", muted: true });
    const leave = message("voice:leave", { callId: "voice-main" });
    const offer = message(
      "voice:description",
      { callId: "voice-main", type: "offer", sdp: "v=0\r\n" },
      LOCAL_SESSION
    );
    const ice = message(
      "voice:ice",
      {
        callId: "voice-main",
        candidate: "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
      LOCAL_SESSION
    );

    expect(parse(join)).toEqual(join);
    expect(parse(state)).toEqual(state);
    expect(parse(leave)).toEqual(leave);
    expect(parse(offer)).toEqual(offer);
    expect(parse(ice)).toEqual(ice);
    expect(parse({ ...join, targetSessionId: LOCAL_SESSION })).toBeNull();
    expect(parse({ ...offer, targetSessionId: null })).toBeNull();
    expect(parse({ ...ice, targetSessionId: "session-other" })).toBeNull();
    expect(parse({ ...join, payload: { ...join.payload, muted: "false" } })).toBeNull();
    expect(parse({ ...join, payload: { ...join.payload, callId: " voice-main " } })).toBeNull();
    expect(parse({ ...offer, payload: { ...offer.payload, shareId: "screen-1" } })).toBeNull();
  });

  it("rejects non-canonical identifiers instead of silently rewriting room boundaries", () => {
    expect(parse({ ...message("voice:leave", { callId: "voice-main" }), workId: ` ${WORK_ID}` }))
      .toBeNull();
    expect(
      parse({
        ...message("voice:leave", { callId: "voice-main" }),
        sender: { ...participant, sessionId: `${participant.sessionId} ` },
      })
    ).toBeNull();
    expect(() => studioLocalLiveChannelName(` ${WORK_ID}`)).toThrow(
      "유효한 작품 ID가 필요합니다."
    );
  });

  it("accepts a bounded broadcast chat line and rejects unsafe or targeted chat", () => {
    const value = message("chat:message", {
      messageId: "chat-1",
      text: "이 컷 대사만 조금 줄여 볼까요?",
    });
    expect(parse(value)).toEqual(value);
    expect(
      parse(
        message("chat:message", {
          messageId: "chat-max",
          text: "가".repeat(STUDIO_LIVE_CHAT_TEXT_MAX_LENGTH),
        })
      )
    ).not.toBeNull();

    expect(() =>
      message("chat:message", {
        messageId: "chat-too-long",
        text: "가".repeat(STUDIO_LIVE_CHAT_TEXT_MAX_LENGTH + 1),
      })
    ).toThrow(StudioLiveProtocolError);
    expect(() =>
      message("chat:message", { messageId: "chat-blank", text: "   " })
    ).toThrow(StudioLiveProtocolError);
    expect(() =>
      message("chat:message", { messageId: "chat-control", text: `안녕${"\u0000"}하세요` })
    ).toThrow(StudioLiveProtocolError);
    expect(() =>
      message("chat:message", { messageId: "chat-targeted", text: "귓속말" }, "session-local")
    ).toThrow(StudioLiveProtocolError);
    expect(
      parse({
        ...value,
        payload: { messageId: "chat-extra", text: "안녕하세요", extra: true },
      })
    ).toBeNull();
  });

  it("rejects non-serializable and cyclic transport values", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(studioLiveEnvelopeByteLength(cyclic)).toBeNull();
    expect(parse(cyclic)).toBeNull();
    expect(parse(undefined)).toBeNull();
  });

  it("builds a deterministic, non-raw local room name while envelope work id prevents hash mixing", () => {
    const first = studioLocalLiveChannelName("private/work/123");
    expect(first).toBe(studioLocalLiveChannelName("private/work/123"));
    expect(first).not.toContain("private/work/123");
    expect(first).not.toBe(studioLocalLiveChannelName("private/work/124"));
    expect(() => studioLocalLiveChannelName(" ")).toThrow("유효한 작품 ID");
  });
});
