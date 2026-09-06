/** Device-local music uses the shared SQLite/OPFS authority, never a second browser database. */
import type { StudioLocalDatabase } from "../studio-local-database";
import type { LocalMusicTrack } from "./studio-music-client";
import type { MusicTrackMetadata } from "@toonspectrum/core/studio-music";

import { isMp3, MUSIC_MAX_BYTES, MUSIC_TERMS_URL, parseMusicBrief } from "@toonspectrum/core/studio-music";

export const MUSIC_LIBRARY_NAMESPACE = "studio-music-library-v1";
const MAX_TRACKS = 20;
const MAX_BASE64_LENGTH = Math.ceil(MUSIC_MAX_BYTES / 3) * 4;
const MAX_ROW_LENGTH = MAX_BASE64_LENGTH + 30_000;
type Database = Pick<StudioLocalDatabase, "kvGet" | "kvSet">;
export type MusicLibraryLock = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
interface MusicRow { version: 1; ownerId: string; metadata: MusicTrackMetadata; audioBase64: string }

function ownerKey(ownerId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(ownerId)) throw new Error("보관함 계정을 확인해 주세요.");
  return `owner:${ownerId}`;
}
function metadata(value: unknown): MusicTrackMetadata {
  if (!value || typeof value !== "object") throw new Error("음원 제작 정보가 올바르지 않습니다.");
  const m = value as MusicTrackMetadata;
  if (typeof m.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(m.id)
    || m.provider !== "elevenlabs" || m.model !== "music_v1" || m.format !== "mp3_44100_128"
    || typeof m.createdAt !== "string" || m.createdAt.length > 40 || !Number.isFinite(Date.parse(m.createdAt))) {
    throw new Error("음원 제작 정보가 올바르지 않습니다.");
  }
  return {
    id: m.id.toLowerCase(), createdAt: m.createdAt, provider: m.provider, model: m.model, format: m.format,
    brief: parseMusicBrief(m.brief), termsUrl: MUSIC_TERMS_URL,
    ...(typeof m.songId === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(m.songId) ? { songId: m.songId } : {}),
  };
}
function parseRow(raw: string | null, ownerId: string): MusicRow | null {
  if (raw === null || raw === "") return null;
  if (raw.length > MAX_ROW_LENGTH) throw new Error("저장된 음원이 크기 제한을 초과했습니다.");
  const row = JSON.parse(raw) as MusicRow;
  if (!row || row.version !== 1 || row.ownerId !== ownerId || typeof row.audioBase64 !== "string"
    || row.audioBase64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.audioBase64)) {
    throw new Error("음원 보관함의 데이터 또는 계정 범위가 올바르지 않습니다.");
  }
  return { version: 1, ownerId, metadata: metadata(row.metadata), audioBase64: row.audioBase64 };
}
function decodeAudio(base64: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  if (bytes.byteLength > MUSIC_MAX_BYTES || !isMp3(bytes)) throw new Error("보관함 음원이 올바른 MP3가 아닙니다.");
  return new Blob([bytes], { type: "audio/mpeg" });
}
async function encodeTrack(track: LocalMusicTrack): Promise<string> {
  ownerKey(track.ownerId);
  // Snapshot metadata before the first await, so later form edits cannot change a queued save.
  const cleanMetadata = metadata(track.metadata);
  const ownerId = track.ownerId;
  const audio = track.audio;
  if (!(audio instanceof Blob) || audio.type !== "audio/mpeg" || audio.size > MUSIC_MAX_BYTES || audio.size <= 10) {
    throw new Error("저장할 MP3 음원을 확인해 주세요.");
  }
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (!isMp3(bytes)) throw new Error("저장할 MP3 음원을 확인해 주세요.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  const raw = JSON.stringify({ version: 1, ownerId, metadata: cleanMetadata, audioBase64: btoa(binary) });
  if (raw.length > MAX_ROW_LENGTH) throw new Error("저장할 음원의 크기 제한을 초과했습니다.");
  return raw;
}

/** Serializes read-modify-write across tabs as well as independently created repository clients.
 * No timeout races are placed around an in-flight write: completion must remain unambiguous.
 */
const withProductLock: MusicLibraryLock = async (name, operation) => {
  if (typeof navigator === "undefined" || !navigator.locks) {
    throw new Error("이 환경에서는 안전한 음원 저장을 지원하지 않습니다. MP3를 다운로드해 주세요.");
  }
  return navigator.locks.request(name, { mode: "exclusive", signal: AbortSignal.timeout(10_000) }, operation);
};

export function createMusicLibrary(acquireDatabase: () => Promise<Database>, lock: MusicLibraryLock = withProductLock) {
  async function access<T>(ownerId: string, operation: (database: Database, rows: (MusicRow | null)[], keys: string[]) => Promise<T>): Promise<T> {
    const scope = ownerKey(ownerId);
    return lock(`${MUSIC_LIBRARY_NAMESPACE}:${scope}`, async () => {
      const database = await acquireDatabase();
      const keys = Array.from({ length: MAX_TRACKS }, (_, slot) => `${scope}:slot:${slot}`);
      const rows: (MusicRow | null)[] = [];
      for (const key of keys) rows.push(parseRow(await database.kvGet(MUSIC_LIBRARY_NAMESPACE, key), ownerId));
      return operation(database, rows, keys);
    });
  }
  return {
    load(ownerId: string): Promise<LocalMusicTrack[]> {
      return access(ownerId, async (_database, rows) => rows
        .filter((row): row is MusicRow => row !== null)
        .map((row) => ({ metadata: row.metadata, ownerId, audio: decodeAudio(row.audioBase64) }))
        .sort((a, b) => Date.parse(b.metadata.createdAt) - Date.parse(a.metadata.createdAt)));
    },
    async save(track: LocalMusicTrack): Promise<void> {
      const raw = await encodeTrack(track);
      const row = parseRow(raw, track.ownerId)!;
      await access(row.ownerId, async (database, rows, keys) => {
        const existing = rows.findIndex((item) => item?.metadata.id === row.metadata.id);
        const slot = existing >= 0 ? existing : rows.findIndex((item) => item === null);
        if (slot < 0) throw new Error("보관함은 계정당 20곡까지입니다. MP3를 다운로드하거나 기존 곡을 삭제해 주세요.");
        // One bounded SQLite row contains both audio and metadata: no partial two-file commit.
        await database.kvSet(MUSIC_LIBRARY_NAMESPACE, keys[slot], raw);
      });
    },
    async remove(id: string, ownerId: string): Promise<void> {
      await access(ownerId, async (database, rows, keys) => {
        const slot = rows.findIndex((row) => row?.metadata.id === id.toLowerCase());
        // Empty rows are reusable tombstones; the fixed twenty slots bound even deleted metadata.
        if (slot >= 0) await database.kvSet(MUSIC_LIBRARY_NAMESPACE, keys[slot], "");
      });
    },
  };
}
const library = createMusicLibrary(async () => {
  const { acquireStudioLocalDatabase } = await import("../studio-local-database-runtime");
  return acquireStudioLocalDatabase();
});
export const loadMusicTracks = library.load;
export const saveMusicTrack = library.save;
export const deleteMusicTrack = library.remove;
