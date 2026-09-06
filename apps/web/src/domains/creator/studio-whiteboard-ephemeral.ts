/**
 * Witeboard / Whiteboard.fi-class ephemeral shared board sessions.
 *
 * Lightweight room model for "open and draw immediately" collaboration without
 * a full project. Pure state helpers — transport remains Studio live layer.
 */

import { uid } from "./studio-id";

export const STUDIO_WHITEBOARD_EPHEMERAL_TTL_MS = 24 * 60 * 60 * 1000;

export type StudioWhiteboardEphemeralRole = "host" | "participant" | "viewer";

export interface StudioWhiteboardEphemeralSession {
  readonly id: string;
  readonly roomCode: string;
  readonly title: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly volatile: true;
  readonly allowAnonymous: boolean;
  readonly role: StudioWhiteboardEphemeralRole;
  /** Soft infinite-canvas feel: pan freely beyond page bounds. */
  readonly infinitePan: boolean;
  readonly stickyNotesEnabled: boolean;
  readonly pixelArtToolsEnabled: boolean;
}

export interface CreateStudioWhiteboardEphemeralInput {
  readonly title?: string;
  readonly role?: StudioWhiteboardEphemeralRole;
  readonly allowAnonymous?: boolean;
  readonly ttlMs?: number;
  readonly now?: number;
}

function roomCodeFromId(id: string): string {
  // Short share code — 6 chars base36-ish from id hash
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

export function createStudioWhiteboardEphemeralSession(
  input: CreateStudioWhiteboardEphemeralInput = {},
): StudioWhiteboardEphemeralSession {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const ttl = Math.max(
    60 * 1000,
    Math.min(7 * 24 * 60 * 60 * 1000, input.ttlMs ?? STUDIO_WHITEBOARD_EPHEMERAL_TTL_MS),
  );
  const id = uid();
  return Object.freeze({
    id,
    roomCode: roomCodeFromId(id),
    title: (input.title?.trim() || "빠른 화이트보드").slice(0, 80),
    createdAt: now,
    expiresAt: now + ttl,
    volatile: true as const,
    allowAnonymous: input.allowAnonymous ?? true,
    role: input.role ?? "host",
    infinitePan: true,
    stickyNotesEnabled: true,
    pixelArtToolsEnabled: true,
  });
}

export function studioWhiteboardEphemeralIsExpired(
  session: StudioWhiteboardEphemeralSession,
  now = Date.now(),
): boolean {
  return now >= session.expiresAt;
}

export function studioWhiteboardEphemeralSharePath(
  session: StudioWhiteboardEphemeralSession,
): string {
  return `/studio?board=${encodeURIComponent(session.roomCode)}&ephemeral=1`;
}

export function studioWhiteboardEphemeralHudLabel(
  session: StudioWhiteboardEphemeralSession,
  now = Date.now(),
): string {
  if (studioWhiteboardEphemeralIsExpired(session, now)) {
    return "휘발 보드 · 만료됨";
  }
  const remainMin = Math.max(0, Math.ceil((session.expiresAt - now) / 60_000));
  return `휘발 보드 ${session.roomCode} · ${remainMin}분 남음`;
}
