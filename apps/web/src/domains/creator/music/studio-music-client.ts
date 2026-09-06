import type { MusicBrief, MusicStatus, MusicTrackMetadata } from "@toonspectrum/core/studio-music";

import { isMp3, MUSIC_MAX_BYTES, MUSIC_TERMS_URL, parseMusicBrief } from "@toonspectrum/core/studio-music";
import { api } from "@/src/infrastructure/api";


export interface LocalMusicTrack { metadata: MusicTrackMetadata; audio: Blob; ownerId: string }
export async function getMusicStatus(signal: AbortSignal): Promise<MusicStatus> {
  const result = await api.get<MusicStatus>("/studio-music/status", { signal, timeout: 8000, retry: 0 });
  if (!result || typeof result.enabled !== "boolean" || result.provider !== "elevenlabs" || result.maxSeconds !== 60 || !["ready", "disabled", "configuration-required"].includes(result.reason)) throw new Error("음악 서비스 상태를 확인할 수 없습니다.");
  return result;
}
export async function generateMusic(brief: MusicBrief, ownerId: string, requestId: string, signal: AbortSignal): Promise<LocalMusicTrack> {
  const result = await api.post<{ audioBase64: string; metadata: MusicTrackMetadata }>("/studio-music/generate", parseMusicBrief(brief), {
    signal, timeout: 55_000, retry: 0, headers: { "Idempotency-Key": requestId },
  });
  const m = result?.metadata;
  if (!m || m.id !== requestId || m.provider !== "elevenlabs" || m.model !== "music_v1" || m.format !== "mp3_44100_128" || typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt)) || typeof result.audioBase64 !== "string" || result.audioBase64.length > Math.ceil(MUSIC_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.audioBase64)) throw new Error("생성된 음악 응답을 확인할 수 없습니다.");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(result.audioBase64), (character) => character.charCodeAt(0)); }
  catch { throw new Error("음원 데이터를 읽을 수 없습니다."); }
  if (bytes.byteLength > MUSIC_MAX_BYTES || !isMp3(bytes)) throw new Error("올바른 MP3 음원이 아닙니다.");
  const metadata: MusicTrackMetadata = {
    id: m.id, createdAt: m.createdAt, provider: m.provider, model: m.model, format: m.format,
    brief: parseMusicBrief(m.brief), termsUrl: MUSIC_TERMS_URL,
    ...(typeof m.songId === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(m.songId) ? { songId: m.songId } : {}),
  };
  return { audio: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/mpeg" }), metadata, ownerId };
}
