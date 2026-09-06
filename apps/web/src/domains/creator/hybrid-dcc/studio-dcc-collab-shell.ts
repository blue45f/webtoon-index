/**
 * DOC-008 lite — multi-user collab shell for Hybrid DCC (presence + op log + locks).
 * Not a full Yjs CRDT; pure session ops for offline tests and workspace UI.
 */

export const STUDIO_DCC_COLLAB_SHELL_REVISION = 4 as const;

export type StudioDccCollabPresence = {
  readonly peerId: string;
  readonly displayName: string;
  readonly color: string;
  readonly selection: readonly string[];
  readonly lastSeenAt: number;
};

export type StudioDccCollabOp =
  | {
      readonly kind: "select";
      readonly peerId: string;
      readonly assetIds: readonly string[];
      readonly at: number;
    }
  | {
      readonly kind: "geometry-hint";
      readonly peerId: string;
      readonly assetId: string;
      readonly geometryHash: string;
      readonly at: number;
    }
  | {
      readonly kind: "chat";
      readonly peerId: string;
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly kind: "lock";
      readonly peerId: string;
      readonly assetId: string;
      readonly at: number;
    }
  | {
      readonly kind: "unlock";
      readonly peerId: string;
      readonly assetId: string;
      readonly at: number;
    };

export interface StudioDccCollabRoom {
  readonly revision: typeof STUDIO_DCC_COLLAB_SHELL_REVISION;
  readonly roomId: string;
  readonly peers: readonly StudioDccCollabPresence[];
  readonly ops: readonly StudioDccCollabOp[];
  /** assetId → peerId currently holding exclusive edit lock */
  readonly locks: Readonly<Record<string, string>>;
  readonly epoch: number;
}

export interface StudioDccCollabConflict {
  readonly assetId: string;
  readonly peerIds: readonly string[];
  readonly reason: "concurrent-geometry-hints" | "lock-contention";
}

export function createStudioDccCollabRoom(roomId: string): StudioDccCollabRoom {
  return {
    revision: STUDIO_DCC_COLLAB_SHELL_REVISION,
    roomId,
    peers: [],
    ops: [],
    locks: {},
    epoch: 0,
  };
}

export function collabJoin(
  room: StudioDccCollabRoom,
  peer: Omit<StudioDccCollabPresence, "lastSeenAt" | "selection"> & {
    readonly selection?: readonly string[];
  },
  now = Date.now(),
): StudioDccCollabRoom {
  const presence: StudioDccCollabPresence = {
    peerId: peer.peerId,
    displayName: peer.displayName,
    color: peer.color,
    selection: peer.selection ?? [],
    lastSeenAt: now,
  };
  const peers = [
    ...room.peers.filter((p) => p.peerId !== peer.peerId),
    presence,
  ];
  return { ...room, peers, epoch: room.epoch + 1 };
}

export function collabLeave(
  room: StudioDccCollabRoom,
  peerId: string,
): StudioDccCollabRoom {
  const locks: Record<string, string> = {};
  for (const [assetId, holder] of Object.entries(room.locks)) {
    if (holder !== peerId) locks[assetId] = holder;
  }
  return {
    ...room,
    peers: room.peers.filter((p) => p.peerId !== peerId),
    locks,
    epoch: room.epoch + 1,
  };
}

export function collabAppendOp(
  room: StudioDccCollabRoom,
  op: StudioDccCollabOp,
): StudioDccCollabRoom {
  const locks = { ...room.locks };
  if (op.kind === "lock") {
    const holder = locks[op.assetId];
    if (!(holder && holder !== op.peerId)) {
      locks[op.assetId] = op.peerId;
    }
  } else if (op.kind === "unlock") {
    if (locks[op.assetId] === op.peerId) {
      delete locks[op.assetId];
    }
  }

  const peers = room.peers.map((p) =>
    p.peerId === op.peerId
      ? {
          ...p,
          lastSeenAt: op.at,
          selection: op.kind === "select" ? op.assetIds : p.selection,
        }
      : p,
  );
  return {
    ...room,
    peers,
    locks,
    ops: [...room.ops, op].slice(-512),
    epoch: room.epoch + 1,
  };
}

export function collabActivePeerIds(
  room: StudioDccCollabRoom,
  now = Date.now(),
  ttlMs = 60_000,
): readonly string[] {
  return room.peers
    .filter((p) => now - p.lastSeenAt <= ttlMs)
    .map((p) => p.peerId);
}

/** True when asset is unlocked or the peer holds the exclusive lock. */
export function collabCanEdit(
  room: StudioDccCollabRoom,
  peerId: string,
  assetId: string,
): boolean {
  const holder = room.locks[assetId];
  return holder === undefined || holder === peerId;
}

/**
 * Drop locks held by peers whose lastSeenAt is older than ttlMs (stale presence).
 * Pure session hygiene — not a CRDT tombstone.
 */
export function collabExpireStaleLocks(
  room: StudioDccCollabRoom,
  now = Date.now(),
  ttlMs = 60_000,
): StudioDccCollabRoom {
  const active = new Set(collabActivePeerIds(room, now, ttlMs));
  const locks: Record<string, string> = {};
  let changed = false;
  for (const [assetId, holder] of Object.entries(room.locks)) {
    if (active.has(holder)) {
      locks[assetId] = holder;
    } else {
      changed = true;
    }
  }
  if (!changed) return room;
  return { ...room, locks, epoch: room.epoch + 1 };
}

/** Deterministic room fingerprint for tests / workspace diagnostics (not crypto-secure). */
export function collabRoomDigest(room: StudioDccCollabRoom): string {
  const peers = [...room.peers]
    .map((p) => `${p.peerId}:${p.lastSeenAt}:${p.selection.join(",")}`)
    .sort()
    .join("|");
  const locks = Object.entries(room.locks)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("|");
  const opTail = room.ops
    .slice(-8)
    .map((op) => `${op.kind}:${op.peerId}:${op.at}`)
    .join("|");
  return `e${room.epoch};p${room.peers.length};o${room.ops.length};L[${locks}];P[${peers}];T[${opTail}]`;
}

/** Latest geometry-hint hash per asset (last write wins by op timestamp). */
export function collabLatestGeometryHints(
  room: StudioDccCollabRoom,
): Readonly<Record<string, { readonly hash: string; readonly peerId: string; readonly at: number }>> {
  const out: Record<string, { hash: string; peerId: string; at: number }> = {};
  for (const op of room.ops) {
    if (op.kind !== "geometry-hint") continue;
    const prev = out[op.assetId];
    if (!prev || op.at >= prev.at) {
      out[op.assetId] = { hash: op.geometryHash, peerId: op.peerId, at: op.at };
    }
  }
  return out;
}

/** Latest time the current holder acquired the lock (null if unlocked mid-history). */
function collabLockAcquiredAt(
  room: StudioDccCollabRoom,
  assetId: string,
  holder: string,
): number | null {
  let acquired: number | null = null;
  for (const op of room.ops) {
    if (op.kind === "lock" && op.assetId === assetId && op.peerId === holder) {
      acquired = op.at;
    } else if (op.kind === "unlock" && op.assetId === assetId && op.peerId === holder) {
      acquired = null;
    }
  }
  return acquired;
}

function collabOpDedupeKey(op: StudioDccCollabOp): string {
  switch (op.kind) {
    case "select":
      return `select|${op.peerId}|${op.at}|${op.assetIds.join(",")}`;
    case "geometry-hint":
      return `geometry-hint|${op.peerId}|${op.at}|${op.assetId}|${op.geometryHash}`;
    case "chat":
      return `chat|${op.peerId}|${op.at}|${op.text}`;
    case "lock":
      return `lock|${op.peerId}|${op.at}|${op.assetId}`;
    case "unlock":
      return `unlock|${op.peerId}|${op.at}|${op.assetId}`;
    default: {
      const _exhaustive: never = op;
      return String(_exhaustive);
    }
  }
}

/**
 * Detect concurrent geometry-hints from distinct peers on same asset within windowMs,
 * and lock contention (select/lock by non-holder only after the current lock was acquired).
 */
export function collabConflictReport(
  room: StudioDccCollabRoom,
  windowMs = 5_000,
): readonly StudioDccCollabConflict[] {
  const conflicts: StudioDccCollabConflict[] = [];
  const byAsset = new Map<string, StudioDccCollabOp[]>();
  for (const op of room.ops) {
    if (op.kind !== "geometry-hint") continue;
    const list = byAsset.get(op.assetId) ?? [];
    list.push(op);
    byAsset.set(op.assetId, list);
  }
  for (const [assetId, ops] of byAsset) {
    const peers = new Set<string>();
    for (let i = 0; i < ops.length; i += 1) {
      for (let j = i + 1; j < ops.length; j += 1) {
        const a = ops[i]!;
        const b = ops[j]!;
        if (a.kind !== "geometry-hint" || b.kind !== "geometry-hint") continue;
        if (a.peerId === b.peerId) continue;
        if (Math.abs(a.at - b.at) <= windowMs) {
          peers.add(a.peerId);
          peers.add(b.peerId);
        }
      }
    }
    if (peers.size >= 2) {
      conflicts.push({
        assetId,
        peerIds: [...peers],
        reason: "concurrent-geometry-hints",
      });
    }
  }
  for (const [assetId, holder] of Object.entries(room.locks)) {
    const acquiredAt = collabLockAcquiredAt(room, assetId, holder);
    if (acquiredAt === null) continue;
    const contenders = new Set<string>();
    for (const op of room.ops) {
      if (op.at < acquiredAt) continue;
      if (op.kind === "select" && op.assetIds.includes(assetId) && op.peerId !== holder) {
        contenders.add(op.peerId);
      }
      if (op.kind === "lock" && op.assetId === assetId && op.peerId !== holder) {
        contenders.add(op.peerId);
      }
    }
    if (contenders.size > 0) {
      conflicts.push({
        assetId,
        peerIds: [holder, ...contenders],
        reason: "lock-contention",
      });
    }
  }
  return conflicts;
}

/**
 * Merge two rooms' op logs by timestamp (roomId from primary).
 * Dedupes shared history by (at, peerId, kind, payload) and rebuilds locks from empty via replay.
 */
export function collabMergeOpLogs(
  primary: StudioDccCollabRoom,
  secondary: StudioDccCollabRoom,
): StudioDccCollabRoom {
  const peerMap = new Map<string, StudioDccCollabPresence>();
  for (const p of [...primary.peers, ...secondary.peers]) {
    const prev = peerMap.get(p.peerId);
    if (!prev || p.lastSeenAt >= prev.lastSeenAt) peerMap.set(p.peerId, p);
  }
  const seen = new Set<string>();
  const ops: StudioDccCollabOp[] = [];
  for (const op of [...primary.ops, ...secondary.ops]
    .sort((a, b) => a.at - b.at || a.peerId.localeCompare(b.peerId))) {
    const key = collabOpDedupeKey(op);
    if (seen.has(key)) continue;
    seen.add(key);
    ops.push(op);
  }
  const capped = ops.slice(-512);
  let room: StudioDccCollabRoom = {
    revision: STUDIO_DCC_COLLAB_SHELL_REVISION,
    roomId: primary.roomId,
    peers: [...peerMap.values()],
    ops: [],
    locks: {},
    epoch: 0,
  };
  for (const op of capped) {
    room = collabAppendOp(room, op);
  }
  return room;
}
