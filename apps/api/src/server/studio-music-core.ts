import { createHash } from "node:crypto";

import { buildMusicPrompt, isMp3, MUSIC_MAX_BYTES, parseMusicBrief } from "@toonspectrum/core/studio-music";

import type { MusicBrief, MusicStatus } from "@toonspectrum/core/studio-music";

export class MusicError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "MusicError"; }
}
type Environment = Record<string, string | undefined>;
type Transport = typeof fetch;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function redisUrl(env: Environment): string | null {
  try {
    const url = new URL(env.UPSTASH_REDIS_REST_URL ?? "");
    return url.protocol === "https:" && url.hostname.endsWith(".upstash.io") && !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
export function musicStatus(env: Environment): MusicStatus {
  const configured = !!env.ELEVENLABS_API_KEY?.trim() && !!env.UPSTASH_REDIS_REST_TOKEN?.trim() && !!redisUrl(env) && env.STUDIO_MUSIC_LICENSE_ACKNOWLEDGED === "true";
  const enabled = env.STUDIO_MUSIC_ENABLED === "true" && configured;
  return { enabled, reason: enabled ? "ready" : env.STUDIO_MUSIC_ENABLED !== "true" ? "disabled" : "configuration-required", provider: "elevenlabs", maxSeconds: 60 };
}
/** One atomic operation: duplicate/conflict check, global + per-user budgets, receipt.
 * Receipts outlive timeouts. Unknown upstream outcomes NEVER trigger automatic regeneration.
 * Hash tag keeps all keys in one Redis cluster slot; no memory-only production fallback.
 */
export const MUSIC_ADMISSION_LUA = `
local receipt = redis.call('GET', KEYS[1])
if receipt then
  if receipt == ARGV[1] then return 'duplicate' else return 'conflict' end
end
local seconds = tonumber(ARGV[2])
local userUsed = tonumber(redis.call('GET', KEYS[2]) or '0')
local totalUsed = tonumber(redis.call('GET', KEYS[3]) or '0')
if userUsed + seconds > tonumber(ARGV[3]) then return 'user-limit' end
if totalUsed + seconds > tonumber(ARGV[4]) then return 'global-limit' end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 172800)
redis.call('INCRBY', KEYS[2], seconds)
redis.call('EXPIRE', KEYS[2], 172800)
redis.call('INCRBY', KEYS[3], seconds)
redis.call('EXPIRE', KEYS[3], 172800)
return 'accepted'
`;
function limit(value: string | undefined, fallback: number, max: number): number {
  const n = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 15 || n > max) throw new MusicError(503, "음악 생성 사용량 설정을 확인해야 합니다.");
  return n;
}
function digest(input: string): string { return createHash("sha256").update(input).digest("hex"); }
async function admit(env: Environment, user: string, key: string, brief: MusicBrief, transport: Transport, signal: AbortSignal): Promise<void> {
  const userKey = digest(user);
  const day = new Date().toISOString().slice(0, 10); // Budgets reset at 00:00 UTC (09:00 KST).
  const command = ["EVAL", MUSIC_ADMISSION_LUA, 3,
    `{studio-music}:request:${userKey}:${key}`, `{studio-music}:user:${day}:${userKey}`, `{studio-music}:total:${day}`,
    digest(JSON.stringify(brief)), brief.seconds,
    limit(env.STUDIO_MUSIC_USER_DAILY_SECONDS, 180, 3600), limit(env.STUDIO_MUSIC_GLOBAL_DAILY_SECONDS, 1200, 86400)];
  let result: unknown;
  try {
    const response = await transport(redisUrl(env)!, {
      method: "POST", headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command), redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error("coordination unavailable"); }
    const data = await response.json() as { result?: unknown; error?: unknown };
    result = data.error ? undefined : data.result;
  } catch { throw new MusicError(503, "사용량 제한 서버에 연결할 수 없어 유료 생성을 시작하지 않았습니다."); }
  if (result === "accepted") return;
  if (result === "duplicate" || result === "conflict") throw new MusicError(409, "이미 접수된 생성 요청입니다. 자동으로 다시 과금하지 않습니다. 새 생성은 별도 요청입니다.");
  if (result === "user-limit" || result === "global-limit") throw new MusicError(429, "오늘의 음악 생성 한도에 도달했습니다. 한도는 한국 시각 오전 9시에 초기화됩니다.");
  throw new MusicError(503, "사용량 확인에 실패해 유료 생성을 시작하지 않았습니다.");
}
async function readAudio(response: Response): Promise<Buffer> {
  if (!/^(audio\/mpeg|audio\/mp3|application\/octet-stream)(;|$)/i.test(response.headers.get("content-type") ?? "") || !response.body) {
    await response.body?.cancel();
    throw new MusicError(502, "음악 공급자가 올바른 MP3 음원을 반환하지 않았습니다.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MUSIC_MAX_BYTES) throw new MusicError(502, "생성 음원이 안전한 전송 크기를 초과했습니다.");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!isMp3(bytes)) throw new MusicError(502, "생성된 음원을 확인할 수 없습니다.");
  return bytes;
}
export async function composeMusic(
  env: Environment, userId: string | undefined, idempotencyKey: string | undefined, input: unknown,
  clientSignal: AbortSignal, transport: Transport = fetch,
): Promise<{ audio: Buffer; brief: MusicBrief; songId?: string }> {
  if (!userId) throw new MusicError(401, "음악을 생성하려면 로그인이 필요합니다.");
  if (!musicStatus(env).enabled) throw new MusicError(503, "음악 생성은 아직 활성화되지 않았습니다. 운영자가 API·이용 조건·사용량 제한 설정을 확인해야 합니다.");
  if (!idempotencyKey || !uuid.test(idempotencyKey)) throw new MusicError(400, "올바른 생성 요청 ID가 필요합니다.");
  let brief: MusicBrief;
  try { brief = parseMusicBrief(input); } catch (error) { throw new MusicError(400, error instanceof Error ? error.message : "음악 설정을 확인해 주세요."); }
  const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(48_000)]);
  if (signal.aborted) throw new MusicError(499, "생성을 취소했습니다.");
  await admit(env, userId, idempotencyKey.toLowerCase(), brief, transport, signal);
  try {
    signal.throwIfAborted();
    const response = await transport("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
      method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ prompt: buildMusicPrompt(brief), music_length_ms: brief.seconds * 1000, model_id: "music_v1", force_instrumental: !brief.vocals, store_for_inpainting: false }),
      signal, redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel(); // Never expose upstream body, credentials or echoed lyrics.
      if (response.status === 422 || response.status === 400) throw new MusicError(400, "장면 또는 가사를 공급자가 처리하지 못했습니다. 권리 침해 가능 표현이나 요청 내용을 확인해 주세요.");
      if (response.status === 429) throw new MusicError(429, "음악 공급자의 사용량 또는 동시 생성 한도에 도달했습니다. 자동 재시도하지 않습니다.");
      if (response.status === 401 || response.status === 403) throw new MusicError(503, "음악 공급자 API 권한·요금제 설정을 확인해야 합니다.");
      throw new MusicError(502, "음악 공급자 연결에 실패했습니다. 자동 재시도하지 않습니다.");
    }
    const audio = await readAudio(response);
    const rawId = response.headers.get("song-id");
    const songId = rawId && /^[a-zA-Z0-9_-]{1,160}$/.test(rawId) ? rawId : undefined;
    return { audio, brief, ...(songId ? { songId } : {}) };
  } catch (error) {
    if (error instanceof MusicError) throw error;
    if (clientSignal.aborted) throw new MusicError(499, "생성을 취소했습니다. 공급자가 이미 처리한 요청은 과금될 수 있습니다.");
    if (signal.aborted) throw new MusicError(504, "생성 응답 시간이 초과되었습니다. 이미 처리 중일 수 있어 자동 재시도하지 않습니다.");
    throw new MusicError(502, "음악 응답을 받지 못했습니다. 이미 처리 중일 수 있어 자동 재시도하지 않습니다.");
  }
}
