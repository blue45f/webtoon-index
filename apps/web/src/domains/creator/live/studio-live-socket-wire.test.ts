import { describe, expect, it } from "vitest";

import { STUDIO_LIVE_SDP_MAX_LENGTH } from "./studio-live-collaboration-protocol";
import {
  isRecord,
  isRole,
  nullableString,
  parseActiveScreenShare,
  parseFailure,
  parseJoinAck,
  parseLock,
  parseLockRevision,
  parseParticipant,
  parseVoiceMember,
  publicParticipant,
  safeIdentifier,
  safeSdpString,
  safeString,
} from "./studio-live-socket-wire";

const UPDATED_AT = "2026-07-19T04:00:00.000Z";
const EXPIRES_AT = "2026-07-19T04:00:15.000Z";

function participant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: "connection-1",
    clientInstanceId: "client-1",
    name: "작가",
    role: "editor",
    state: "active",
    pageId: null,
    tool: "draw",
    sharingScreen: false,
    updatedAt: UPDATED_AT,
    capabilities: { edit: true },
    joinedAt: UPDATED_AT,
    ...overrides,
  };
}

function lock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resourceId: "page:1",
    leaseId: "lease-1",
    ownerConnectionId: "connection-1",
    ownerName: "작가",
    expiresAt: EXPIRES_AT,
    serverOnly: true,
    ...overrides,
  };
}

function voiceMember(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: "connection-1",
    callId: "voice-main",
    muted: false,
    serverOnly: true,
    ...overrides,
  };
}

function screenShare(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: "connection-1",
    shareId: "share-1",
    label: "작업 화면",
    serverOnly: true,
    ...overrides,
  };
}

describe("studio live socket wire primitives", () => {
  it("accepts records only and bounds strings without control characters", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);

    expect(safeString("작업실", 3)).toBe(true);
    expect(safeString("", 3)).toBe(false);
    expect(safeString("", 3, true)).toBe(true);
    expect(safeString("   ", 3)).toBe(false);
    expect(safeString("abcd", 3)).toBe(false);
    expect(safeString("a\tb", 10)).toBe(false);
    expect(safeString("a\u0085b", 10)).toBe(false);
  });

  it("distinguishes trimmed identifiers and nullable strings", () => {
    expect(safeIdentifier("connection-1", 128)).toBe(true);
    expect(safeIdentifier(" connection-1", 128)).toBe(false);
    expect(safeIdentifier("connection-1 ", 128)).toBe(false);
    expect(safeIdentifier("", 128)).toBe(false);
    expect(nullableString(null, 10)).toBe(true);
    expect(nullableString("draw", 10)).toBe(true);
    expect(nullableString("", 10)).toBe(false);
    expect(nullableString("", 10, true)).toBe(true);
  });

  it("accepts canonical bounded SDP line endings but rejects byte overflow and controls", () => {
    const boundary = `v=0\r\n${"s".repeat(STUDIO_LIVE_SDP_MAX_LENGTH - 7)}`;
    const multibyteBoundary = "가".repeat(STUDIO_LIVE_SDP_MAX_LENGTH / 3);

    expect(safeSdpString(boundary)).toBe(true);
    expect(safeSdpString(`${boundary}x`)).toBe(false);
    expect(safeSdpString(multibyteBoundary)).toBe(true);
    expect(safeSdpString(`${multibyteBoundary}가`)).toBe(false);
    expect(safeSdpString("v=0\nline\r\n")).toBe(true);
    expect(safeSdpString("v=0\tinvalid")).toBe(false);
    expect(safeSdpString("v=0\u0085invalid")).toBe(false);
    expect(safeSdpString("   ")).toBe(false);
  });

  it.each(["owner", "admin", "editor", "commenter", "viewer"])(
    "accepts the exact %s server role",
    (role) => expect(isRole(role)).toBe(true)
  );

  it("rejects unknown or non-string roles", () => {
    expect(isRole("guest")).toBe(false);
    expect(isRole("Owner")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("parses canonical PostgreSQL bigint lock revisions without number precision loss", () => {
    expect(parseLockRevision("0", { allowZero: true })).toBe(BigInt(0));
    expect(parseLockRevision("1")).toBe(BigInt(1));
    expect(parseLockRevision("9007199254740993")).toBe(BigInt("9007199254740993"));
    expect(parseLockRevision("9223372036854775807")).toBe(BigInt("9223372036854775807"));
  });

  it.each([
    ["mutation zero", "0", undefined],
    ["empty", "", { allowZero: true }],
    ["leading zero", "01", { allowZero: true }],
    ["positive sign", "+1", { allowZero: true }],
    ["negative", "-1", { allowZero: true }],
    ["fraction", "1.0", { allowZero: true }],
    ["exponent", "1e3", { allowZero: true }],
    ["whitespace", " 1", { allowZero: true }],
    ["non-ASCII digit", "１", { allowZero: true }],
    ["PostgreSQL bigint overflow", "9223372036854775808", { allowZero: true }],
    ["non-string number", 1, { allowZero: true }],
    ["null", null, { allowZero: true }],
  ])("rejects %s lock revisions", (_case, value, options) => {
    expect(parseLockRevision(value, options)).toBeNull();
  });
});

describe("studio live socket wire entity parsers", () => {
  it("projects participants onto the exact trusted key set", () => {
    const parsed = parseParticipant(participant());

    expect(parsed).toEqual({
      connectionId: "connection-1",
      clientInstanceId: "client-1",
      name: "작가",
      role: "editor",
      state: "active",
      pageId: null,
      tool: "draw",
      sharingScreen: false,
      updatedAt: UPDATED_AT,
    });
    expect(Object.keys(parsed ?? {})).toEqual([
      "connectionId",
      "clientInstanceId",
      "name",
      "role",
      "state",
      "pageId",
      "tool",
      "sharingScreen",
      "updatedAt",
    ]);
  });

  it("rejects malformed participant roles, dates, states, nullable fields, and bounded IDs", () => {
    expect(parseParticipant(participant({ role: "guest" }))).toBeNull();
    expect(parseParticipant(participant({ updatedAt: "not-a-date" }))).toBeNull();
    expect(parseParticipant(participant({ state: "offline" }))).toBeNull();
    expect(parseParticipant(participant({ pageId: 1 }))).toBeNull();
    expect(parseParticipant(participant({ connectionId: "" }))).toBeNull();
    expect(parseParticipant(participant({ clientInstanceId: "x".repeat(81) }))).toBeNull();
  });

  it("projects locks exactly and rejects invalid expiry or identifier fields", () => {
    const parsed = parseLock(lock());

    expect(parsed).toEqual({
      resourceId: "page:1",
      leaseId: "lease-1",
      ownerConnectionId: "connection-1",
      ownerName: "작가",
      expiresAt: EXPIRES_AT,
      revision: null,
    });
    expect(Object.keys(parsed ?? {})).toEqual([
      "resourceId",
      "leaseId",
      "ownerConnectionId",
      "ownerName",
      "expiresAt",
      "revision",
    ]);
    expect(parseLock(lock({ revision: "42" }))).toEqual({
      ...parsed,
      revision: BigInt(42),
    });
    expect(parseLock(lock(), { requireRevision: true })).toBeNull();
    expect(parseLock(lock({ revision: "42" }), { requireRevision: true })?.revision).toBe(
      BigInt(42)
    );
    expect(parseLock(lock({ revision: "0" }))).toBeNull();
    expect(parseLock(lock({ revision: "01" }))).toBeNull();
    expect(parseLock(lock({ expiresAt: "never" }))).toBeNull();
    expect(parseLock(lock({ resourceId: "" }))).toBeNull();
    expect(parseLock(lock({ leaseId: "x".repeat(81) }))).toBeNull();
  });

  it("projects voice members exactly and enforces trimmed connection/call IDs", () => {
    const parsed = parseVoiceMember(voiceMember());

    expect(parsed).toEqual({ connectionId: "connection-1", callId: "voice-main", muted: false });
    expect(Object.keys(parsed ?? {})).toEqual(["connectionId", "callId", "muted"]);
    expect(parseVoiceMember(voiceMember({ connectionId: " connection-1" }))).toBeNull();
    expect(parseVoiceMember(voiceMember({ callId: "voice-main " }))).toBeNull();
    expect(parseVoiceMember(voiceMember({ muted: "false" }))).toBeNull();
  });

  it("projects active screen shares exactly and enforces bounded canonical metadata", () => {
    const parsed = parseActiveScreenShare(screenShare());

    expect(parsed).toEqual({
      connectionId: "connection-1",
      shareId: "share-1",
      label: "작업 화면",
    });
    expect(Object.keys(parsed ?? {})).toEqual(["connectionId", "shareId", "label"]);
    expect(parseActiveScreenShare(screenShare({ shareId: " share-1" }))).toBeNull();
    expect(parseActiveScreenShare(screenShare({ label: "x".repeat(81) }))).toBeNull();
    expect(parseActiveScreenShare(screenShare({ connectionId: "" }))).toBeNull();
  });

  it("projects failures exactly and rejects non-failure or malformed failure records", () => {
    const parsed = parseFailure({
      ok: false,
      code: "forbidden",
      message: "권한이 없습니다.",
      stack: "must-not-cross-wire-boundary",
    });

    expect(parsed).toEqual({ ok: false, code: "forbidden", message: "권한이 없습니다." });
    expect(Object.keys(parsed ?? {})).toEqual(["ok", "code", "message"]);
    expect(parseFailure({ ok: true, code: "forbidden", message: "권한이 없습니다." })).toBeNull();
    expect(parseFailure({ ok: false, code: "", message: "권한이 없습니다." })).toBeNull();
    expect(parseFailure({ ok: false, code: "forbidden", message: "" })).toBeNull();
  });

  it("projects a public participant without leaking server presence fields", () => {
    const parsed = parseParticipant(participant({ name: "   " }));
    expect(parsed).not.toBeNull();
    expect(publicParticipant(parsed!)).toEqual({
      sessionId: "connection-1",
      displayName: "팀원",
      role: "editor",
    });
    expect(Object.keys(publicParticipant(parsed!))).toEqual(["sessionId", "displayName", "role"]);
  });
});

describe("studio live socket join acknowledgement", () => {
  it("parses every nested collection atomically and strips untrusted keys", () => {
    const parsed = parseJoinAck({
      ok: true,
      data: {
        self: participant({ connectionId: "self" }),
        participants: [participant({ connectionId: "self" }), participant({ connectionId: "remote" })],
        locks: [lock({ ownerConnectionId: "remote", ownerName: "원격 편집자" })],
        voiceMembers: [voiceMember()],
        screenShares: [screenShare()],
        serverOnly: "ignored",
      },
      transportOnly: "ignored",
    });

    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("ok");
    expect(Object.keys(parsed ?? {})).toEqual([
      "lockProtocolVersion",
      "lockRevisionVersion",
      "lockSnapshotRevision",
      "crdtWireAdvertisement",
      "self",
      "participants",
      "locks",
      "voiceMembers",
      "screenShares",
    ]);
    if (!parsed || "ok" in parsed) throw new Error("expected a join snapshot");
    expect(parsed.lockProtocolVersion).toBe(1);
    expect(parsed.lockRevisionVersion).toBe(0);
    expect(parsed.lockSnapshotRevision).toBeNull();
    expect(parsed.crdtWireAdvertisement).toBeNull();
    expect(parsed.participants).toHaveLength(2);
    expect(parsed.locks).toHaveLength(1);
    expect(parsed.voiceMembers).toHaveLength(1);
    expect(parsed.screenShares).toHaveLength(1);
  });

  it("keeps legacy missing additive collections compatible but rejects malformed present values", () => {
    const legacy = parseJoinAck({
      ok: true,
      data: { self: participant(), participants: [participant()], locks: [] },
    });
    expect(legacy && !("ok" in legacy) ? legacy.voiceMembers : null).toEqual([]);
    expect(legacy && !("ok" in legacy) ? legacy.screenShares : null).toEqual([]);

    expect(parseJoinAck({
      ok: true,
      data: { self: participant(), participants: [participant()], locks: [], voiceMembers: {} },
    })).toBeNull();
    expect(parseJoinAck({
      ok: true,
      data: { self: participant(), participants: [participant()], locks: [], screenShares: {} },
    })).toBeNull();
  });

  it("parses the exact binary CRDT advertisement and rejects incomplete or stale epochs", () => {
    const epoch = "00000000-0000-4000-8000-000000000101";
    const binary = parseJoinAck({
      ok: true,
      data: {
        self: participant(),
        participants: [participant()],
        locks: [],
        crdtWireFormats: ["binary-v1", "base64-v4"],
        crdtWireSelectionEpoch: epoch,
      },
    });
    expect(binary && !("ok" in binary) ? binary.crdtWireAdvertisement : null).toEqual({
      formats: ["binary-v1", "base64-v4"],
      selectionEpoch: epoch,
    });

    for (const malformed of [
      { crdtWireFormats: ["binary-v1", "base64-v4"] },
      { crdtWireSelectionEpoch: epoch },
      {
        crdtWireFormats: ["base64-v4", "binary-v1"],
        crdtWireSelectionEpoch: epoch,
      },
      {
        crdtWireFormats: ["binary-v1", "base64-v4"],
        crdtWireSelectionEpoch: "stale-epoch",
      },
    ]) {
      expect(parseJoinAck({
        ok: true,
        data: {
          self: participant(),
          participants: [participant()],
          locks: [],
          ...malformed,
        },
      })).toBeNull();
    }
  });

  it("negotiates lock protocol v2 while rejecting malformed capability values", () => {
    const v2 = parseJoinAck({
      ok: true,
      data: {
        lockProtocolVersion: 2,
        self: participant(),
        participants: [participant()],
        locks: [],
      },
    });
    expect(v2 && !("ok" in v2) ? v2.lockProtocolVersion : null).toBe(2);
    for (const malformed of [null, 0, 1.5, "2", 101]) {
      expect(
        parseJoinAck({
          ok: true,
          data: {
            lockProtocolVersion: malformed,
            self: participant(),
            participants: [participant()],
            locks: [],
          },
        })
      ).toBeNull();
    }
  });

  it("negotiates the exact lock revision v1 snapshot and preserves every bigint revision", () => {
    const parsed = parseJoinAck({
      ok: true,
      data: {
        lockProtocolVersion: 2,
        lockRevisionVersion: 1,
        lockSnapshotRevision: "9007199254740993",
        self: participant(),
        participants: [participant()],
        locks: [
          lock({ resourceId: "page:1", revision: "9007199254740992" }),
          lock({ resourceId: "page:2", leaseId: "lease-2", revision: "9007199254740993" }),
        ],
      },
    });

    expect(parsed && !("ok" in parsed) ? parsed : null).toMatchObject({
      lockProtocolVersion: 2,
      lockRevisionVersion: 1,
      lockSnapshotRevision: BigInt("9007199254740993"),
      locks: [
        { resourceId: "page:1", revision: BigInt("9007199254740992") },
        { resourceId: "page:2", revision: BigInt("9007199254740993") },
      ],
    });
  });

  it("accepts revision zero only for an empty revision-aware snapshot", () => {
    const empty = parseJoinAck({
      ok: true,
      data: {
        lockRevisionVersion: 1,
        lockSnapshotRevision: "0",
        self: participant(),
        participants: [participant()],
        locks: [],
      },
    });
    expect(empty && !("ok" in empty) ? empty.lockSnapshotRevision : null).toBe(BigInt(0));

    expect(parseJoinAck({
      ok: true,
      data: {
        lockRevisionVersion: 1,
        lockSnapshotRevision: "0",
        self: participant(),
        participants: [participant()],
        locks: [lock({ revision: "1" })],
      },
    })).toBeNull();
  });

  it.each([
    ["version without snapshot", { lockRevisionVersion: 1 }],
    ["snapshot without version", { lockSnapshotRevision: "1" }],
    ["legacy sentinel on wire", { lockRevisionVersion: 0, lockSnapshotRevision: "1" }],
    ["unknown version", { lockRevisionVersion: 2, lockSnapshotRevision: "1" }],
    ["string version", { lockRevisionVersion: "1", lockSnapshotRevision: "1" }],
    ["numeric snapshot", { lockRevisionVersion: 1, lockSnapshotRevision: 1 }],
    ["non-canonical snapshot", { lockRevisionVersion: 1, lockSnapshotRevision: "01" }],
    ["overflow snapshot", { lockRevisionVersion: 1, lockSnapshotRevision: "9223372036854775808" }],
  ])("rejects an incomplete or unsupported lock revision capability: %s", (_case, fields) => {
    expect(parseJoinAck({
      ok: true,
      data: {
        ...fields,
        self: participant(),
        participants: [participant()],
        locks: [],
      },
    })).toBeNull();
  });

  it.each([
    ["missing lock revision", lock()],
    ["zero lock revision", lock({ revision: "0" })],
    ["malformed lock revision", lock({ revision: "01" })],
    ["lock newer than snapshot", lock({ revision: "8" })],
    ["one malformed lock in an otherwise valid snapshot", [lock({ revision: "7" }), lock({ resourceId: "page:2" })]],
  ])("rejects a revision v1 snapshot with %s", (_case, locks) => {
    expect(parseJoinAck({
      ok: true,
      data: {
        lockRevisionVersion: 1,
        lockSnapshotRevision: "7",
        self: participant(),
        participants: [participant()],
        locks: Array.isArray(locks) ? locks : [locks],
      },
    })).toBeNull();
  });

  it("rejects a snapshot with conflicting page and element locks owned by different connections", () => {
    const secondParticipant = participant({
      connectionId: "connection-2",
      clientInstanceId: "client-2",
      name: "어시스턴트",
    });
    const baseData = {
      lockRevisionVersion: 1,
      lockSnapshotRevision: "7",
      self: participant(),
      participants: [participant(), secondParticipant],
    };
    const page = lock({ resourceId: "page:hierarchy", revision: "6" });
    const element = lock({
      resourceId: "element:hierarchy:panel-1",
      leaseId: "lease-2",
      revision: "7",
    });

    expect(parseJoinAck({
      ok: true,
      data: {
        ...baseData,
        locks: [
          page,
          { ...element, ownerConnectionId: "connection-2", ownerName: "어시스턴트" },
        ],
      },
    })).toBeNull();
    expect(parseJoinAck({
      ok: true,
      data: { ...baseData, locks: [page, element] },
    })).not.toBeNull();
  });

  it("rejects locks owned by an absent participant and duplicate exact resources", () => {
    const baseData = {
      lockRevisionVersion: 1,
      lockSnapshotRevision: "8",
      self: participant(),
      participants: [participant()],
    };

    expect(parseJoinAck({
      ok: true,
      data: {
        ...baseData,
        locks: [lock({ ownerConnectionId: "connection-missing", revision: "7" })],
      },
    })).toBeNull();
    expect(parseJoinAck({
      ok: true,
      data: {
        ...baseData,
        locks: [
          lock({ revision: "7" }),
          lock({ leaseId: "lease-duplicate", revision: "8" }),
        ],
      },
    })).toBeNull();
  });

  it("keeps a legacy snapshot compatible while preserving an optional valid lock revision", () => {
    const withoutRevision = parseJoinAck({
      ok: true,
      data: { self: participant(), participants: [participant()], locks: [lock()] },
    });
    const withRevision = parseJoinAck({
      ok: true,
      data: {
        self: participant(),
        participants: [participant()],
        locks: [lock({ revision: "7" })],
      },
    });

    expect(withoutRevision && !("ok" in withoutRevision) ? withoutRevision : null).toMatchObject({
      lockRevisionVersion: 0,
      lockSnapshotRevision: null,
      locks: [{ revision: null }],
    });
    expect(withRevision && !("ok" in withRevision) ? withRevision : null).toMatchObject({
      lockRevisionVersion: 0,
      lockSnapshotRevision: null,
      locks: [{ revision: BigInt(7) }],
    });
  });

  it.each([
    ["self", { ...participant(), role: "guest" }],
    ["participants", [participant(), participant({ updatedAt: "invalid" })]],
    ["locks", [lock(), lock({ expiresAt: "invalid" })]],
    ["voiceMembers", [voiceMember(), voiceMember({ callId: " bad" })]],
    ["screenShares", [screenShare(), screenShare({ label: " bad" })]],
  ])("rejects the whole acknowledgement when nested %s is malformed", (field, malformed) => {
    expect(parseJoinAck({
      ok: true,
      data: {
        self: participant(),
        participants: [participant()],
        locks: [],
        voiceMembers: [],
        [field]: malformed,
      },
    })).toBeNull();
  });

  it("returns a validated failure acknowledgement with the original error meaning", () => {
    expect(parseJoinAck({
      ok: false,
      code: "forbidden",
      message: "이 작품에 참여할 권한이 없습니다.",
      data: { ignored: true },
    })).toEqual({
      ok: false,
      code: "forbidden",
      message: "이 작품에 참여할 권한이 없습니다.",
    });
  });
});
