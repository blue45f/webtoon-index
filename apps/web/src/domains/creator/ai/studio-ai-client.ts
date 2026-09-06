/**
 * Studio AI 어시스트 — 서버 텍스트 AI + BYOK 범용 REST 클라이언트.
 *
 * 특정 AI 벤더에 종속되지 않는다 — OpenAI Chat Completions / Images(Generations·Edits) API와
 * "호환되는" 엔드포인트라면 무엇이든 붙일 수 있다(대부분의 이미지/텍스트 생성 서비스가 OpenAI 호환
 * 엔드포인트를 제공하거나 유사한 요청/응답 구조를 쓴다). 사용자가 baseUrl + apiKey를 직접 입력하고,
 * 이 모듈은 baseUrl 뒤에 표준 OpenAI 경로(/images/generations, /images/edits, /chat/completions)를
 * 붙여 호출한다 — OpenAI SDK들이 "baseURL + 경로" 구조를 쓰는 것과 동일한 관례(Azure OpenAI처럼
 * 경로가 다른 제공자를 위해 세 경로 모두 개별적으로 override 가능하게 설정에 노출해뒀다).
 *
 * 로그인 사용자의 텍스트 작업은 서버 보유 Z.ai/DeepSeek 설정을 사용할 수 있고, 이미지 작업 및
 * 선택한 BYOK 텍스트 작업은 브라우저에서 제공자로 직접 요청한다. 사용자가 입력한 BYOK 키는 앱
 * 백엔드로 전송하지 않고 탭 수명의 sessionStorage에만 임시 보관한다. 서버 공급자 키는 반대로 서버
 * 환경변수에만 있으며 응답·로그·클라이언트 번들에 노출하지 않는다.
 *
 * 이 파일은 순수 로직이다(DOM/Konva 의존 없음, 결정적) — 유일한 예외는 fetch/주입 저장소
 * 자체지만, 둘 다 인터페이스 뒤에 있어 테스트에서 완전히 모킹 가능하다(studio-brand-kit.ts의
 * "저장소를 주입받는" 패턴과 동일).
 *
 * 텍스트와 이미지 transport를 의도적으로 분리한다. 서버 텍스트 AI가 구성돼 있어도 이미지
 * 생성·편집은 BYOK 이미지 설정을 요구하며, 어느 경로에서도 키를 요청/응답 provenance에 기록하지
 * 않는다(docs/studio-ai-assist-integration.md 참고).
 *
 * 에러 계약: 이 모듈의 모든 async 함수는 **절대 throw하지 않는다** — 항상
 * `StudioAiResult<T>`(성공 { ok:true, data } / 실패 { ok:false, code, error })를 resolve한다.
 * 키 미설정·빈 입력은 fetch를 아예 호출하지 않고 즉시 `{ ok:false, code:"not_configured" | ...}`을
 * 반환한다(호출부가 매번 try/catch를 두지 않아도 되고, "키 없으면 요청 자체가 안 나간다"를
 * 테스트하기도 쉽다).
 */

import {
  buildDialogueSuggestPrompt,
  parseDialogueSuggestResponse,
  type DialogueSuggestionCandidate,
} from "../lettering/studio-dialogue-suggest";
import {
  buildTranslationPrompt,
  parseTranslationResponse,
  type DialogueTranslatableItem,
} from "../lettering/studio-dialogue-translate";
import {
  completeStudioServerText,
  parseStudioServerAiFailoverMetadata,
  type StudioServerAiFailoverMetadata,
  type StudioServerAiTask,
  type StudioServerAiProviderPreference,
} from "../studio-server-ai-client";
import {
  buildStudioWriterRoomAiPrompt,
  parseStudioWriterRoomAiDraft,
  type StudioWriterRoomAiDraft,
} from "../studio-writer-room-ai";

import { normalizeStudioAiCompositionSuggestion } from "./studio-ai-composition-suggestion";
import {
  STUDIO_AI_IMAGE_REFERENCE_LIMITS,
  compileStudioAiImageReferencePromptContexts,
  normalizeStudioAiImageReferences,
  type StudioAiImageReference,
  type StudioAiImageReferenceRole,
} from "./studio-ai-image-reference-roles";

import type { PaletteSuggestion } from "../studio-palette-suggest";
import type { ScenarioScenesPlan } from "../studio-scenario-scenes";
import type { StudioWriterRoomStage } from "../studio-writer-room";

// ── 설정 저장 ──────────────────────────────────────────────────────────────

/** Web Storage 호환 인터페이스 — 호출자가 수명(session/persistent)을 명시적으로 선택한다. */
export interface StudioAiStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const STUDIO_AI_SETTINGS_KEY = "toonspectrum-studio-ai-settings";

export interface StudioAiSettings {
  /** 예: "https://api.openai.com/v1" (끝에 슬래시 없이). 아래 세 경로가 이 뒤에 그대로 붙는다. */
  baseUrl: string;
  /** 절대 앱 서버로 전송하지 않는다 — 탭 세션에만 보관하고 브라우저→제공자 직접 fetch에 사용. */
  apiKey: string;
  imageModel: string;
  textModel: string;
  /** 배경 생성(POST, JSON body) 경로. 기본값은 OpenAI Images Generations. */
  imageGenerationPath: string;
  /** 자동 채색(POST, multipart/form-data) 경로. 기본값은 OpenAI Images Edits. */
  imageEditPath: string;
  /** 콘티→구도 제안(POST, JSON body) 경로. 기본값은 OpenAI Chat Completions. */
  chatCompletionsPath: string;
}

export const STUDIO_AI_DEFAULT_SETTINGS: StudioAiSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  imageModel: "dall-e-3",
  textModel: "gpt-4o-mini",
  imageGenerationPath: "/images/generations",
  imageEditPath: "/images/edits",
  chatCompletionsPath: "/chat/completions",
};

/**
 * 저장된 설정 로드 — 저장소 부재·손상 JSON·필드 누락은 필드 단위로 기본값 폴백한다
 * (studio-reference-panel.deserializeReferencePanelSettings와 동일한 "관대한" 정책 — baseUrl
 * 하나가 깨졌다고 apiKey까지 통째로 잃게 하지 않는다).
 */
export function loadStudioAiSettings(storage: StudioAiStorage | null | undefined): StudioAiSettings {
  if (!storage) return { ...STUDIO_AI_DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(STUDIO_AI_SETTINGS_KEY);
    if (!raw) return { ...STUDIO_AI_DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...STUDIO_AI_DEFAULT_SETTINGS };
    const o = parsed as Record<string, unknown>;
    const str = (key: keyof StudioAiSettings, allowEmpty = false): string => {
      const v = o[key];
      if (typeof v !== "string") return STUDIO_AI_DEFAULT_SETTINGS[key];
      if (!allowEmpty && v.trim().length === 0) return STUDIO_AI_DEFAULT_SETTINGS[key];
      return v;
    };
    return {
      baseUrl: str("baseUrl"),
      apiKey: str("apiKey", true), // 빈 문자열(미설정 상태)도 유효한 값이다.
      imageModel: str("imageModel"),
      textModel: str("textModel"),
      imageGenerationPath: str("imageGenerationPath"),
      imageEditPath: str("imageEditPath"),
      chatCompletionsPath: str("chatCompletionsPath"),
    };
  } catch {
    return { ...STUDIO_AI_DEFAULT_SETTINGS };
  }
}

/** 저장 — 실패(쿼터 초과·시크릿 모드 등)는 조용히 무시한다(studio-brand-kit.ts persist와 동일 정책). */
export function saveStudioAiSettings(storage: StudioAiStorage | null | undefined, settings: StudioAiSettings): void {
  if (!storage) return;
  try {
    storage.setItem(STUDIO_AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 무시.
  }
}

/** 민감 키가 든 설정을 제거한다. removeItem 미지원 테스트 저장소도 기본값 덮어쓰기로 키를 폐기한다. */
export function clearStudioAiSettings(storage: StudioAiStorage | null | undefined): void {
  if (!storage) return;
  try {
    if (storage.removeItem) storage.removeItem(STUDIO_AI_SETTINGS_KEY);
    else storage.setItem(STUDIO_AI_SETTINGS_KEY, JSON.stringify(STUDIO_AI_DEFAULT_SETTINGS));
  } catch {
    // 저장소가 차단돼도 현재 메모리 설정은 호출부가 별도로 비운다.
  }
}

/**
 * Loads BYOK settings from the current tab session. A legacy localStorage value is migrated once
 * for compatibility and then securely removed, so refreshing the same tab keeps the connection
 * while closing the tab ends credential persistence.
 */
export function loadStudioAiSessionSettings(
  sessionStorage: StudioAiStorage | null | undefined,
  legacyPersistentStorage?: StudioAiStorage | null
): StudioAiSettings {
  let hasSessionValue = false;
  try {
    hasSessionValue = Boolean(sessionStorage?.getItem(STUDIO_AI_SETTINGS_KEY));
  } catch {
    // sessionStorage가 차단된 환경은 아래 메모리-only 경로로 폴백한다.
  }
  const settings = hasSessionValue
    ? loadStudioAiSettings(sessionStorage)
    : loadStudioAiSettings(legacyPersistentStorage);
  if (!hasSessionValue && legacyPersistentStorage) saveStudioAiSettings(sessionStorage, settings);
  if (legacyPersistentStorage && legacyPersistentStorage !== sessionStorage) {
    clearStudioAiSettings(legacyPersistentStorage);
  }
  return settings;
}

/** baseUrl과 apiKey가 둘 다 채워져 있어야 "설정 완료"로 간주한다(모델/경로는 기본값으로도 동작). */
export function isStudioAiConfigured(settings: StudioAiSettings): boolean {
  return settings.baseUrl.trim().length > 0 && settings.apiKey.trim().length > 0;
}

/** 텍스트 생성만 서버 보유 Z.ai/DeepSeek를 사용할 수 있다. 이미지 생성/편집은 계속 BYOK 설정을 요구한다. */
export type StudioTextAiTransport =
  | { mode: "byok"; signal?: AbortSignal }
  | {
      mode: "server";
      provider?: StudioServerAiProviderPreference;
      signal?: AbortSignal;
      /** Stable Studio provenance operation ID reused as the paid server request retry key. */
      operationId?: string;
    };

/**
 * Binds an already-tracked Studio operation to a server transport. BYOK requests deliberately keep
 * their original transport unchanged and never receive the app server's idempotency header.
 */
export function studioTextAiTransportForOperation(
  transport: StudioTextAiTransport,
  operationId: string
): StudioTextAiTransport {
  return transport.mode === "server" ? { ...transport, operationId } : transport;
}

export interface StudioAiTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** 저장 가능한 텍스트 생성 이력. API 키·전체 프롬프트·응답 본문은 의도적으로 포함하지 않는다. */
export interface StudioTextAiProvenance {
  provider: string;
  model: string;
  transport: StudioTextAiTransport["mode"];
  promptVersion: 1;
  createdAt: string;
  requestId?: string;
  usage?: StudioAiTokenUsage;
  /** 서버 자동 선택이 잔액 소진을 감지해 다른 공급자로 전환한 경우의 안전한 구조화 이력. */
  failover?: StudioServerAiFailoverMetadata;
}

/** 텍스트 AI 결과에 실제 공급자·모델 감사 정보를 일관되게 붙이는 공통 결과 형태. */
export type StudioTextAiData<T extends object> = T & { textProvenance: StudioTextAiProvenance };

const DEFAULT_TEXT_AI_TRANSPORT: StudioTextAiTransport = { mode: "byok" };

export function isStudioTextAiConfigured(
  settings: StudioAiSettings,
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT
): boolean {
  return transport.mode === "server" || isStudioAiConfigured(settings);
}

// ── 공통 타입 ──────────────────────────────────────────────────────────────

export type StudioAiErrorCode =
  | "not_configured" // API 키/baseUrl 미설정 — fetch를 아예 호출하지 않는다.
  | "invalid_input" // 빈 프롬프트, data URL이 아닌 채색 소스 등 호출 전 검증 실패.
  | "network_error" // fetch 자체가 reject(오프라인, CORS, DNS 등).
  | "http_error" // 2xx 아닌 응답(401/429/500 등).
  | "parse_error"; // 2xx이지만 JSON이 아니거나 기대한 필드가 없음.

export type StudioAiResult<T> = { ok: true; data: T } | { ok: false; code: StudioAiErrorCode; error: string };

export type StudioAiImageSize = "1024x1024" | "1024x1792" | "1792x1024";

export const STUDIO_AI_IMAGE_SIZES: ReadonlyArray<{ value: StudioAiImageSize; label: string }> = [
  { value: "1024x1024", label: "정사각형 (1024×1024)" },
  { value: "1024x1792", label: "세로형 (1024×1792)" },
  { value: "1792x1024", label: "가로형 (1792×1024)" },
];

export const DEFAULT_STUDIO_AI_IMAGE_SIZE: StudioAiImageSize = "1024x1024";

/** Browser-side admission limits applied before a paid multi-reference provider request starts. */
export const STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS = Object.freeze({
  /** OpenAI-compatible GPT Image Edits currently accepts at most 16 multipart image inputs. */
  maxImages: 16,
  /** GPT Image prompt limit; scene text and every compiled role context share this one budget. */
  maxPromptCharacters: 32_000,
  /** Bounds one synchronous base64 decode on memory-constrained mobile browsers. */
  maxDecodedBytesPerImage: 12 * 1_024 * 1_024,
  /** Decoded binary budget, not the larger base64/data-URL character count. */
  maxTotalDecodedBytes: 50 * 1_024 * 1_024,
});

export interface StudioAiResolvedImageReference {
  readonly referenceId: string;
  readonly role: StudioAiImageReferenceRole;
  readonly dataUrl: string;
  readonly label?: string;
  readonly guidance?: string;
}

// ── 내부 HTTP 헬퍼(테스트에서 fetch만 모킹하면 URL/헤더/바디를 전부 검증할 수 있다) ──────────

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function buildUrl(baseUrl: string, path: string): string {
  return `${trimBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

/** 응답 바디를 텍스트로 먼저 읽고(2xx/에러 양쪽에서 재사용), 상태코드/JSON 유효성을 순서대로 판정한다. */
function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

function networkErrorMessage(error: unknown): string {
  if (isAbortError(error)) return "요청이 취소되었습니다.";
  // 브라우저 fetch 실패의 error.message는 "Failed to fetch" 같은 원문 영문이라 그대로 노출하지
  // 않는다 — 사용자가 원인(CORS·오프라인·엔드포인트 오타)을 추측할 수 있는 한국어로 안내한다.
  if (error instanceof TypeError) {
    return "엔드포인트에 연결할 수 없어요. 주소·네트워크 상태와 CORS 허용 여부를 확인해 주세요.";
  }
  return error instanceof Error ? error.message : "네트워크 요청에 실패했습니다.";
}

function createStudioAiAbortError(): Error {
  const error = new Error("The Studio AI operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * Optional prompt/parser chunks are pure client modules, so one bounded importer retry never
 * repeats a provider/model request. A browser may recover a transient module fetch failure on the
 * second import; parse/evaluation failures still fail closed. Validation and configuration checks
 * stay at each callsite, while an already-aborted request does not start a chunk load.
 */
async function loadOptionalStudioAiCodec<T>(
  importCodec: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (signal?.aborted) throw createStudioAiAbortError();
    try {
      const codec = await importCodec();
      if (signal?.aborted) throw createStudioAiAbortError();
      return codec;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw createStudioAiAbortError();
      lastError = error;
    }
  }
  throw lastError;
}

async function parseHttpResponse(res: Response, signal?: AbortSignal): Promise<StudioAiResult<unknown>> {
  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    // fetch가 헤더를 받은 뒤 응답 body를 읽는 도중 취소될 수도 있다. 이 경우에도 요청 단계에서
    // 취소된 것과 같은 network_error 계약을 유지한다(parse_error로 오인하지 않는다).
    if (signal?.aborted || isAbortError(error)) {
      return { ok: false, code: "network_error", error: "요청이 취소되었습니다." };
    }
    return { ok: false, code: "parse_error", error: "응답 본문을 읽지 못했습니다." };
  }
  if (!res.ok) {
    const message = extractErrorMessage(text) ?? (res.statusText || "알 수 없는 오류");
    return { ok: false, code: "http_error", error: `요청이 실패했습니다 (HTTP ${res.status}): ${message}` };
  }
  if (!text) return { ok: true, data: {} };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, code: "parse_error", error: "응답을 해석하지 못했습니다(JSON 형식이 아닙니다)." };
  }
}

/** OpenAI류 에러 응답의 관례적 형태(`{ error: { message } }` 또는 `{ error: "..." }`)를 최대한 뽑아본다. */
function extractErrorMessage(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const err = (parsed as Record<string, unknown>).error;
      if (typeof err === "string") return err;
      if (err && typeof err === "object" && typeof (err as Record<string, unknown>).message === "string") {
        return (err as Record<string, unknown>).message as string;
      }
    }
  } catch {
    // 본문이 JSON이 아니면(HTML 에러 페이지 등) 무시하고 null.
  }
  return null;
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  signal?: AbortSignal
): Promise<StudioAiResult<unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (e) {
    return { ok: false, code: "network_error", error: networkErrorMessage(e) };
  }
  return parseHttpResponse(res, signal);
}

async function postForm(
  url: string,
  apiKey: string,
  form: FormData,
  signal?: AbortSignal
): Promise<StudioAiResult<unknown>> {
  let res: Response;
  try {
    // Content-Type을 직접 지정하지 않는다 — FormData를 body로 넘기면 fetch가 boundary를 포함한
    // multipart/form-data Content-Type을 자동으로 설정한다(직접 지정하면 boundary가 빠져 서버가
    // 파싱하지 못한다).
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (e) {
    return { ok: false, code: "network_error", error: networkErrorMessage(e) };
  }
  return parseHttpResponse(res, signal);
}

async function postTextCompletion(
  settings: StudioAiSettings,
  request: {
    task: StudioServerAiTask;
    system: string;
    user: string;
    temperature: number;
    maxTokens: number;
    responseFormat: "text" | "json";
  },
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT
): Promise<StudioAiResult<unknown>> {
  if (transport.mode === "server") {
    const result = await completeStudioServerText(
      {
        task: request.task,
        promptVersion: 1,
        system: request.system,
        user: request.user,
        operationId: transport.operationId,
        ...(transport.provider ? { provider: transport.provider } : {}),
      },
      transport.signal
    );
    if (!result.ok) return result;
    // 기존 OpenAI 호환 응답 파서를 그대로 재사용할 수 있도록 최소 choices envelope로 정규화한다.
    return {
      ok: true,
      data: {
        choices: [{ message: { content: result.data.content } }],
        provider: result.data.provider,
        model: result.data.model,
        requestId: result.data.requestId,
        usage: result.data.usage,
        failover: result.data.failover,
      },
    };
  }
  const url = buildUrl(settings.baseUrl, settings.chatCompletionsPath);
  return postJson(url, settings.apiKey, {
    model: settings.textModel,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    temperature: request.temperature,
    max_tokens: request.maxTokens,
  }, transport.signal);
}

function extractFirstB64Json(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const data = (json as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as Record<string, unknown> | undefined;
  const b64 = first?.b64_json;
  return typeof b64 === "string" && b64.length > 0 ? b64 : null;
}

function extractFirstChatContent(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const choices = (json as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
}

function textProviderFromSettings(settings: StudioAiSettings): string {
  try {
    return new URL(settings.baseUrl).hostname.slice(0, 120) || "custom";
  } catch {
    return settings.baseUrl.trim().slice(0, 120) || "custom";
  }
}

function optionalTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 2_147_483_647)
    : undefined;
}

function extractTextAiProvenance(
  json: unknown,
  settings: StudioAiSettings,
  transport: StudioTextAiTransport
): StudioTextAiProvenance {
  const record = json && typeof json === "object" && !Array.isArray(json)
    ? json as Record<string, unknown>
    : {};
  const usageRecord = record.usage && typeof record.usage === "object" && !Array.isArray(record.usage)
    ? record.usage as Record<string, unknown>
    : {};
  const promptTokens = optionalTokenCount(usageRecord.promptTokens ?? usageRecord.prompt_tokens);
  const completionTokens = optionalTokenCount(
    usageRecord.completionTokens ?? usageRecord.completion_tokens
  );
  const totalTokens = optionalTokenCount(usageRecord.totalTokens ?? usageRecord.total_tokens);
  const usage = promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined
    ? {
        ...(promptTokens !== undefined ? { promptTokens } : {}),
        ...(completionTokens !== undefined ? { completionTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
      }
    : undefined;
  const rawProvider = typeof record.provider === "string" ? record.provider.trim().slice(0, 120) : "";
  const rawModel = typeof record.model === "string" ? record.model.trim().slice(0, 200) : "";
  const rawRequestId = typeof record.requestId === "string"
    ? record.requestId.trim().slice(0, 240)
    : "";
  const provider = rawProvider || (
    transport.mode === "server"
      ? transport.provider === "zai"
        ? "zai"
        : transport.provider === "deepseek"
          ? "deepseek"
          : transport.provider === "openrouter"
            ? "openrouter"
            : "server-auto"
      : textProviderFromSettings(settings)
  );
  const model = rawModel || settings.textModel.trim().slice(0, 200) || "unknown";
  const failover = transport.mode === "server"
    && (provider === "zai" || provider === "deepseek" || provider === "openrouter")
    ? parseStudioServerAiFailoverMetadata(record.failover, { provider, model })
    : undefined;
  return {
    provider,
    model,
    transport: transport.mode,
    promptVersion: 1,
    createdAt: new Date().toISOString(),
    ...(rawRequestId ? { requestId: rawRequestId } : {}),
    ...(usage ? { usage } : {}),
    ...(failover ? { failover } : {}),
  };
}

function parseImageSize(size: StudioAiImageSize): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return { width: 1024, height: 1024 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * data: URL을 Blob으로 되돌린다(순수 문자열 파싱 + atob, DOM 없이 동작). base64/URL-encoded 둘 다
 * 지원한다. data: URL이 아니면 throw한다 — 원격(http/https/blob:) URL은 의도적으로 지원하지 않는다
 * (§5 스코프 축소: 임의 URL을 fetch해 바이트로 바꾸는 건 이 순수 클라이언트의 책임 밖 — CORS 의존이
 * 생기고, "결정적 파싱"이라는 이 함수의 성격도 깨진다).
 *
 * 헤더(`data:` 다음~첫 콤마 전)는 RFC 2397처럼 `;`로 구분된 여러 파라미터를 가질 수 있다(예:
 * `data:text/plain;charset=utf-8;base64,...`) — 첫 세미콜론/콤마까지만 mime으로 읽고 `;base64`만
 * 정확히 매치하던 이전 정규식은 이런 추가 파라미터가 하나라도 끼면 유효한 data URL도 형식 불일치로
 * 오판해 throw했다(예: 대부분의 브라우저 canvas.toDataURL()/FileReader.readAsDataURL() 출력엔 없지만,
 * 외부에서 들어온 이미지에는 charset/name 같은 파라미터가 붙어 있을 수 있다). 첫 콤마로 헤더/페이로드를
 * 먼저 분리한 뒤 헤더를 `;`로 쪼개 파싱하면 파라미터 개수·순서와 무관하게 mime과 base64 플래그를
 * 안정적으로 뽑아낼 수 있다.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex === -1) {
    throw new Error("data URL 형식이 아닙니다(원격 URL 이미지는 지원하지 않습니다).");
  }
  const header = dataUrl.slice("data:".length, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const params = header.split(";");
  const mime = params[0] || "application/octet-stream";
  const isBase64 = params.slice(1).some((p) => p.trim().toLowerCase() === "base64");
  if (isBase64) {
    const bytesConstructor = (
      Uint8Array as typeof Uint8Array & {
        fromBase64?: (encoded: string) => Uint8Array;
      }
    );
    const bytes = bytesConstructor.fromBase64
      ? bytesConstructor.fromBase64(payload)
      : (() => {
          const binary = atob(payload);
          const fallbackBytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            fallbackBytes[i] = binary.charCodeAt(i);
          }
          return fallbackBytes;
        })();
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

const STUDIO_AI_REFERENCE_IMAGE_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
] as const);

type StudioAiReferenceImageMimeType =
  (typeof STUDIO_AI_REFERENCE_IMAGE_MIME_TYPES)[number];

interface PreparedStudioAiRoleReference {
  readonly reference: StudioAiImageReference;
  readonly dataUrl: string;
}

interface StudioAiReferenceImageDataUrlMetadata {
  readonly mimeType: StudioAiReferenceImageMimeType;
  readonly decodedBytes: number;
  readonly extension: "png" | "jpg" | "webp";
}

const STRICT_BASE64_PAYLOAD_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function compareCanonicalText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeResolvedRoleReference(
  value: StudioAiResolvedImageReference,
): StudioAiImageReference | null {
  const normalized = normalizeStudioAiImageReferences([
    {
      id: value.referenceId,
      role: value.role,
      assetId: value.referenceId,
      label: value.label,
      guidance: value.guidance,
    },
  ]);
  return normalized.length === 1 ? normalized[0] ?? null : null;
}

function prepareStudioAiRoleReferences(
  values: readonly StudioAiResolvedImageReference[],
): StudioAiResult<readonly PreparedStudioAiRoleReference[]> {
  if (values.length === 0) {
    return {
      ok: false,
      code: "invalid_input",
      error: "역할이 지정된 기준 이미지를 한 개 이상 선택하세요.",
    };
  }
  if (values.length > STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxImages) {
    return {
      ok: false,
      code: "invalid_input",
      error: `기준 이미지는 최대 ${STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxImages}개까지 사용할 수 있습니다.`,
    };
  }

  const candidates: PreparedStudioAiRoleReference[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || typeof value.dataUrl !== "string") {
      return {
        ok: false,
        code: "invalid_input",
        error: "기준 이미지 정보가 올바르지 않습니다.",
      };
    }
    const reference = normalizeResolvedRoleReference(value);
    if (!reference || reference.id !== value.referenceId.trim()) {
      return {
        ok: false,
        code: "invalid_input",
        error: "기준 이미지의 ID 또는 역할이 올바르지 않습니다.",
      };
    }
    candidates.push({ reference, dataUrl: value.dataUrl });
  }

  candidates.sort((left, right) =>
    compareCanonicalText(left.reference.role, right.reference.role) ||
    compareCanonicalText(left.reference.id, right.reference.id) ||
    compareCanonicalText(left.reference.label ?? "", right.reference.label ?? "") ||
    compareCanonicalText(
      left.reference.guidance ?? "",
      right.reference.guidance ?? "",
    )
  );
  const prepared: PreparedStudioAiRoleReference[] = [];
  const byId = new Map<string, PreparedStudioAiRoleReference>();
  const seenDataUrlsByRole: Record<
    StudioAiImageReferenceRole,
    Set<string>
  > = {
    character: new Set(),
    method: new Set(),
    style: new Set(),
  };
  const perRole: Record<StudioAiImageReferenceRole, number> = {
    character: 0,
    method: 0,
    style: 0,
  };
  for (const candidate of candidates) {
    const previous = byId.get(candidate.reference.id);
    if (previous) {
      if (
        previous.reference.role !== candidate.reference.role ||
        previous.dataUrl !== candidate.dataUrl ||
        previous.reference.label !== candidate.reference.label ||
        previous.reference.guidance !== candidate.reference.guidance
      ) {
        return {
          ok: false,
          code: "invalid_input",
          error: `중복된 기준 이미지 ID(${candidate.reference.id})의 내용이 서로 다릅니다.`,
        };
      }
      continue;
    }
    const seenRoleDataUrls = seenDataUrlsByRole[candidate.reference.role];
    if (seenRoleDataUrls.has(candidate.dataUrl)) continue;
    if (
      perRole[candidate.reference.role] >=
      STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole
    ) {
      return {
        ok: false,
        code: "invalid_input",
        error: `한 역할에는 기준 이미지를 최대 ${STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole}개까지 사용할 수 있습니다.`,
      };
    }
    prepared.push(candidate);
    byId.set(candidate.reference.id, candidate);
    seenRoleDataUrls.add(candidate.dataUrl);
    perRole[candidate.reference.role] += 1;
  }
  return { ok: true, data: prepared };
}

function inspectStudioAiReferenceImageDataUrl(
  dataUrl: string,
): StudioAiResult<StudioAiReferenceImageDataUrlMetadata> {
  const commaIndex = dataUrl.indexOf(",");
  if (
    !dataUrl.startsWith("data:")
    || commaIndex <= "data:".length
    || commaIndex > 256
  ) {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지는 PNG, JPEG 또는 WebP base64 data URL이어야 합니다.",
    };
  }
  const headerParts = dataUrl
    .slice("data:".length, commaIndex)
    .split(";")
    .map((part) => part.trim());
  const mimeType = headerParts[0]?.toLowerCase();
  if (
    !STUDIO_AI_REFERENCE_IMAGE_MIME_TYPES.includes(
      mimeType as StudioAiReferenceImageMimeType,
    )
  ) {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지는 PNG, JPEG 또는 WebP 형식만 사용할 수 있습니다.",
    };
  }
  if (!headerParts.slice(1).some((part) => part.toLowerCase() === "base64")) {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지는 base64로 인코딩된 data URL이어야 합니다.",
    };
  }
  const payload = dataUrl.slice(commaIndex + 1);
  if (payload.length === 0 || payload.length % 4 !== 0) {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지의 base64 데이터가 올바르지 않습니다.",
    };
  }
  const padding =
    payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const decodedBytes = (payload.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes <= 0) {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지의 디코딩 크기가 올바르지 않습니다.",
    };
  }
  if (
    decodedBytes >
    STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxDecodedBytesPerImage
  ) {
    return {
      ok: false,
      code: "invalid_input",
      error: `기준 이미지 한 장의 디코딩 크기는 ${STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxDecodedBytesPerImage.toLocaleString()}바이트를 넘을 수 없습니다.`,
    };
  }
  if (!STRICT_BASE64_PAYLOAD_PATTERN.test(payload)) {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지의 base64 데이터가 올바르지 않습니다.",
    };
  }
  const canonicalMimeType = mimeType as StudioAiReferenceImageMimeType;
  return {
    ok: true,
    data: {
      mimeType: canonicalMimeType,
      decodedBytes,
      extension:
        canonicalMimeType === "image/png"
          ? "png"
          : canonicalMimeType === "image/jpeg"
            ? "jpg"
            : "webp",
    },
  };
}

async function matchesStudioAiReferenceImageSignature(
  blob: Blob,
  mimeType: StudioAiReferenceImageMimeType,
): Promise<boolean> {
  if (mimeType === "image/png") {
    const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === "image/jpeg") {
    const [head, tail] = await Promise.all([
      blob.slice(0, 2).arrayBuffer(),
      blob.slice(Math.max(0, blob.size - 2), blob.size).arrayBuffer(),
    ]);
    const headBytes = new Uint8Array(head);
    const tailBytes = new Uint8Array(tail);
    return (
      blob.size >= 4 &&
      headBytes[0] === 0xff &&
      headBytes[1] === 0xd8 &&
      tailBytes[0] === 0xff &&
      tailBytes[1] === 0xd9
    );
  }
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

// ── 기능별 얇은 래퍼 ─────────────────────────────────────────────────────────

/**
 * (1) 배경 생성 — 텍스트 프롬프트를 OpenAI Images Generations 형태 API로 보내 배경 이미지를 받는다.
 * response_format:"b64_json"을 항상 요청한다 — 응답이 바로 data URL로 변환 가능해 원격 이미지
 * URL을 별도로 fetch할 필요가 없고(CORS/캔버스 오염 위험 원천 차단), 캔버스 export(toDataURL 등)도
 * 항상 안전하다. 제공자가 b64_json을 지원하지 않고 url만 반환하면 parse_error로 실패한다(§5).
 */
export async function generateBackgroundImage(
  settings: StudioAiSettings,
  prompt: string,
  opts: { size?: StudioAiImageSize; signal?: AbortSignal } = {}
): Promise<StudioAiResult<{ dataUrl: string; width: number; height: number }>> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "배경 프롬프트를 입력하세요." };
  if (!isStudioAiConfigured(settings)) {
    return { ok: false, code: "not_configured", error: "설정에서 API 키를 등록하세요." };
  }
  const size = opts.size ?? DEFAULT_STUDIO_AI_IMAGE_SIZE;
  const url = buildUrl(settings.baseUrl, settings.imageGenerationPath);
  const result = await postJson(url, settings.apiKey, {
    model: settings.imageModel,
    prompt: trimmed,
    n: 1,
    size,
    response_format: "b64_json",
  }, opts.signal);
  if (!result.ok) return result;
  const b64 = extractFirstB64Json(result.data);
  if (!b64) return { ok: false, code: "parse_error", error: "응답에서 이미지 데이터(b64_json)를 찾을 수 없습니다." };
  const { width, height } = parseImageSize(size);
  return { ok: true, data: { dataUrl: `data:image/png;base64,${b64}`, width, height } };
}

/**
 * (2) 자동 채색 — 선화 이미지(data URL) + 채색 지시 프롬프트를 OpenAI Images Edits 형태 API로
 * 보낸다. §5 스코프 축소: 마스크(mask) 파라미터는 보내지 않는다 — "이미지 전체 + 텍스트 프롬프트"만
 * 보내는 단순화 버전이다(원본 API는 마스크로 편집 영역을 한정할 수 있지만, 그러려면 캔버스 위에 별도
 * 마스크 그리기 UI가 필요해 스코프를 넘어선다). 결과 dataUrl은 호출부가 **같은 요소의 src만
 * 교체**하는 데 쓴다(위치/크기는 그대로 — studio-bg-remove.ts/StudioLineCleanupPanel과 동일 관례).
 */
export async function colorizeLineArt(
  settings: StudioAiSettings,
  lineArtSrc: string,
  prompt: string
): Promise<StudioAiResult<{ dataUrl: string }>> {
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "채색 지시 프롬프트를 입력하세요." };
  if (!lineArtSrc) return { ok: false, code: "invalid_input", error: "채색할 이미지가 없습니다." };
  if (!isStudioAiConfigured(settings)) {
    return { ok: false, code: "not_configured", error: "설정에서 API 키를 등록하세요." };
  }
  let blob: Blob;
  try {
    blob = dataUrlToBlob(lineArtSrc);
  } catch (e) {
    return { ok: false, code: "invalid_input", error: e instanceof Error ? e.message : "이미지를 읽지 못했습니다." };
  }
  const form = new FormData();
  form.set("image", blob, "lineart.png");
  form.set("prompt", trimmed);
  form.set("model", settings.imageModel);
  form.set("n", "1");
  form.set("response_format", "b64_json");
  const url = buildUrl(settings.baseUrl, settings.imageEditPath);
  const result = await postForm(url, settings.apiKey, form);
  if (!result.ok) return result;
  const b64 = extractFirstB64Json(result.data);
  if (!b64) return { ok: false, code: "parse_error", error: "응답에서 이미지 데이터(b64_json)를 찾을 수 없습니다." };
  return { ok: true, data: { dataUrl: `data:image/png;base64,${b64}` } };
}

/**
 * 캐릭터 일관성 생성용 프롬프트 조합(순수 함수, 단위 테스트 대상 — fetch 없음). 사용자가 입력한
 * "상황" 텍스트만 그대로 Images Edits API에 보내면, 참고 이미지의 외모를 얼마나 반영할지가 전적으로
 * 모델(제공자) 재량에 맡겨진다. 그래서 고정 지시문으로 감싸 "참고 이미지 속 캐릭터의 겉모습은 유지한
 * 채 상황만 새로 그려달라"는 의도를 매 요청에 명시적으로 실어 보낸다 — studio-dialogue-translate.ts의
 * buildTranslationPrompt와 동일하게, 프롬프트 조합은 fetch 오케스트레이션(아래
 * generateConsistentCharacterImage)과 분리해 독립적으로 테스트 가능하게 둔다.
 */
export function buildCharacterConsistencyPrompt(situationPrompt: string): string {
  const trimmed = situationPrompt.trim();
  return (
    "제공된 참고 이미지 속 캐릭터의 얼굴 생김새·헤어스타일·의상·색상 등 겉모습을 최대한 그대로 유지한 " +
    `채, 다음 상황을 그려주세요: ${trimmed} ` +
    "(캐릭터의 정체성과 외모는 바꾸지 말고, 포즈·표정·배경·상황만 새롭게 그립니다.)"
  );
}

/**
 * (2.5) 캐릭터 일관성 유지 생성 — 젠툰(GenToon) 벤치마크의 핵심 차별점("같은 캐릭터를 여러 컷에서
 * 동일 외모로 유지")을 근사한다. 완벽한 일관성엔 IP-Adapter/캐릭터 LoRA 같은 전문 기법(모델 파인튜닝·
 * 임베딩 주입)이 필요한데, 이 프로젝트는 BYOK 클라이언트일 뿐 자체 추론 인프라가 없어 그 방식은
 * 스코프 밖이다(docs/studio-competitor-features.md §3 참고). 대신
 * colorizeLineArt와 완전히 동일한 패턴(마스크 없이 참고 이미지 전체 + 텍스트 프롬프트만 Images Edits
 * API로 전송)으로 근사한다 — 캔버스에서 고른 "기준 캐릭터" 이미지를 참고 이미지로 함께 보내면, 편집
 * 모델이 원본 캐릭터의 외모를 어느 정도 참고해 새 상황을 그려준다.
 *
 * colorizeLineArt와의 차이: 그쪽은 "같은 요소의 src를 교체"(제자리 보정)가 목적이라 결과에 위치/크기
 * 정보가 필요 없지만, 이 기능은 "참고 캐릭터 옆에 새로운 장면의 캐릭터를 추가"하는 것이 목적이라
 * 호출부가 결과를 **별도의 새 이미지 요소**로 캔버스에 삽입한다(기존 요소를 덮어쓰지 않음). 그래서
 * 결과 타입도 colorizeLineArt와 동일하게 dataUrl만 담고, 새 요소의 배치 크기는 호출부가 참고 이미지
 * 요소 자체의 캔버스 표시 크기를 그대로 재사용한다(원본 픽셀 해상도를 알아내려 이미지를 다시 디코딩할
 * 필요가 없다 — generateBackgroundImage가 요청 size 문자열에서 width/height를 동기적으로 아는 것과
 * 같은 이유로 왕복을 줄인 설계).
 *
 * **완벽한 동일 인물 재현은 보장하지 않는다** — UI 문구(StudioAiCharacterConsistencyPanel)로 사용자
 * 기대치를 명시적으로 낮춘다.
 */
export async function generateConsistentCharacterImage(
  settings: StudioAiSettings,
  referenceImageSrc: string,
  situationPrompt: string,
  opts: { signal?: AbortSignal } = {}
): Promise<StudioAiResult<{ dataUrl: string }>> {
  const trimmed = situationPrompt.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "새로 그리고 싶은 상황을 입력하세요." };
  if (!referenceImageSrc) return { ok: false, code: "invalid_input", error: "기준 캐릭터 이미지를 선택하세요." };
  if (!isStudioAiConfigured(settings)) {
    return { ok: false, code: "not_configured", error: "설정에서 API 키를 등록하세요." };
  }
  let blob: Blob;
  try {
    blob = dataUrlToBlob(referenceImageSrc);
  } catch (e) {
    return { ok: false, code: "invalid_input", error: e instanceof Error ? e.message : "기준 이미지를 읽지 못했습니다." };
  }
  const form = new FormData();
  form.set("image", blob, "character-reference.png");
  form.set("prompt", buildCharacterConsistencyPrompt(trimmed));
  form.set("model", settings.imageModel);
  form.set("n", "1");
  form.set("response_format", "b64_json");
  const url = buildUrl(settings.baseUrl, settings.imageEditPath);
  const result = await postForm(url, settings.apiKey, form, opts.signal);
  if (!result.ok) return result;
  const b64 = extractFirstB64Json(result.data);
  if (!b64) return { ok: false, code: "parse_error", error: "응답에서 이미지 데이터(b64_json)를 찾을 수 없습니다." };
  return { ok: true, data: { dataUrl: `data:image/png;base64,${b64}` } };
}

/**
 * Character / Method(camera·composition·staging) / Style reference inputs are compiled into
 * independent prompt scopes and uploaded in canonical role order as OpenAI-compatible `image[]`
 * multipart fields. Admission is fail-closed and happens before the single paid request; provider
 * rejection never triggers a hidden fallback or retry.
 */
export async function generateImageWithRoleReferences(
  settings: StudioAiSettings,
  references: readonly StudioAiResolvedImageReference[],
  scenePrompt: string,
  opts: { signal?: AbortSignal } = {},
): Promise<StudioAiResult<{ dataUrl: string }>> {
  if (typeof scenePrompt !== "string") {
    return {
      ok: false,
      code: "invalid_input",
      error: "새로 그리고 싶은 장면을 입력하세요.",
    };
  }
  const trimmedScenePrompt = scenePrompt.trim();
  if (!trimmedScenePrompt) {
    return {
      ok: false,
      code: "invalid_input",
      error: "새로 그리고 싶은 장면을 입력하세요.",
    };
  }
  if (!Array.isArray(references)) {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지 목록이 올바르지 않습니다.",
    };
  }
  let preparedResult: StudioAiResult<
    readonly PreparedStudioAiRoleReference[]
  >;
  try {
    preparedResult = prepareStudioAiRoleReferences(references);
  } catch {
    return {
      ok: false,
      code: "invalid_input",
      error: "기준 이미지 정보를 안전하게 읽지 못했습니다.",
    };
  }
  if (!preparedResult.ok) return preparedResult;
  if (!isStudioAiConfigured(settings)) {
    return {
      ok: false,
      code: "not_configured",
      error: "설정에서 API 키를 등록하세요.",
    };
  }
  if (opts.signal?.aborted) {
    return {
      ok: false,
      code: "network_error",
      error: "요청이 취소되었습니다.",
    };
  }

  const prepared = preparedResult.data;
  const document = {
    version: 1 as const,
    references: prepared.map(({ reference }) => reference),
  };
  const contexts = compileStudioAiImageReferencePromptContexts(document);
  const orderedBindings = [
    ...contexts.character.bindings.map((binding) => ({
      ...binding,
      role: "character" as const,
    })),
    ...contexts.method.bindings.map((binding) => ({
      ...binding,
      role: "method" as const,
    })),
    ...contexts.style.bindings.map((binding) => ({
      ...binding,
      role: "style" as const,
    })),
  ];
  const hasCharacterReference = contexts.character.bindings.length > 0;
  const basePrompt = hasCharacterReference
    ? buildCharacterConsistencyPrompt(trimmedScenePrompt)
    : trimmedScenePrompt;
  const attachmentBindingPrompt = [
    "[TOONSPECTRUM_MULTIPART_IMAGE_BINDINGS_V1]",
    JSON.stringify({
      rule:
        "Multipart image[] attachments and bindings use the same 1-based order; Image 1 is bindings[0], Image 2 is bindings[1], and so on.",
      bindings: orderedBindings.map((binding, index) => ({
        image: index + 1,
        token: binding.token,
        role: binding.role,
      })),
    }),
    "[/TOONSPECTRUM_MULTIPART_IMAGE_BINDINGS_V1]",
  ].join("\n");
  const providerPrompt = [
    basePrompt,
    attachmentBindingPrompt,
    contexts.combinedPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (
    providerPrompt.length >
    STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxPromptCharacters
  ) {
    return {
      ok: false,
      code: "invalid_input",
      error: `장면 프롬프트와 기준 이미지 지시문의 합계는 ${STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxPromptCharacters.toLocaleString()}자를 넘을 수 없습니다.`,
    };
  }

  const preparedByReferenceId = new Map(
    prepared.map((entry) => [entry.reference.id, entry] as const),
  );
  const inspected: Array<{
    entry: PreparedStudioAiRoleReference;
    metadata: StudioAiReferenceImageDataUrlMetadata;
    filename: string;
  }> = [];
  let totalDecodedBytes = 0;

  // Inspect every small header/length first. A request that exceeds the aggregate budget should
  // fail before we synchronously decode even the first base64 payload.
  for (const [index, binding] of orderedBindings.entries()) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        code: "network_error",
        error: "요청이 취소되었습니다.",
      };
    }
    const entry = preparedByReferenceId.get(binding.referenceId);
    if (!entry) {
      return {
        ok: false,
        code: "invalid_input",
        error: "기준 이미지 binding을 해석하지 못했습니다.",
      };
    }
    const metadata = inspectStudioAiReferenceImageDataUrl(entry.dataUrl);
    if (!metadata.ok) return metadata;
    totalDecodedBytes += metadata.data.decodedBytes;
    if (
      totalDecodedBytes >
      STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxTotalDecodedBytes
    ) {
      return {
        ok: false,
        code: "invalid_input",
        error: `기준 이미지의 전체 디코딩 크기는 ${STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxTotalDecodedBytes.toLocaleString()}바이트를 넘을 수 없습니다.`,
      };
    }
    inspected.push({
      entry,
      metadata: metadata.data,
      filename: `${String(index + 1).padStart(2, "0")}-${binding.token}.${metadata.data.extension}`,
    });
  }

  const admitted: Array<{
    blob: Blob;
    filename: string;
  }> = [];
  for (const candidate of inspected) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        code: "network_error",
        error: "요청이 취소되었습니다.",
      };
    }

    let blob: Blob;
    try {
      blob = dataUrlToBlob(candidate.entry.dataUrl);
      if (
        blob.size !== candidate.metadata.decodedBytes ||
        blob.type.toLowerCase() !== candidate.metadata.mimeType
      ) {
        return {
          ok: false,
          code: "invalid_input",
          error: "기준 이미지의 형식 또는 디코딩 크기가 선언과 일치하지 않습니다.",
        };
      }
      if (
        !(await matchesStudioAiReferenceImageSignature(
          blob,
          candidate.metadata.mimeType,
        ))
      ) {
        return {
          ok: false,
          code: "invalid_input",
          error: "기준 이미지의 실제 파일 형식이 MIME 선언과 일치하지 않습니다.",
        };
      }
      if (opts.signal?.aborted) {
        return {
          ok: false,
          code: "network_error",
          error: "요청이 취소되었습니다.",
        };
      }
    } catch (error) {
      return {
        ok: false,
        code: opts.signal?.aborted ? "network_error" : "invalid_input",
        error: opts.signal?.aborted
          ? "요청이 취소되었습니다."
          : error instanceof Error
            ? error.message
            : "기준 이미지를 읽지 못했습니다.",
      };
    }
    admitted.push({
      blob,
      filename: candidate.filename,
    });
  }

  if (opts.signal?.aborted) {
    return {
      ok: false,
      code: "network_error",
      error: "요청이 취소되었습니다.",
    };
  }
  const form = new FormData();
  for (const image of admitted) {
    form.append("image[]", image.blob, image.filename);
  }
  form.set("prompt", providerPrompt);
  form.set("model", settings.imageModel);
  form.set("n", "1");
  form.set("response_format", "b64_json");
  const result = await postForm(
    buildUrl(settings.baseUrl, settings.imageEditPath),
    settings.apiKey,
    form,
    opts.signal,
  );
  if (!result.ok) return result;
  const b64 = extractFirstB64Json(result.data);
  if (!b64) {
    return {
      ok: false,
      code: "parse_error",
      error: "응답에서 이미지 데이터(b64_json)를 찾을 수 없습니다.",
    };
  }
  return {
    ok: true,
    data: { dataUrl: `data:image/png;base64,${b64}` },
  };
}

/** 콘티→그림 변환의 "장면 구성 제안" 시스템 프롬프트 — 완전한 이미지 생성이 아니라(기능 1과
 *  중복되므로) 구도/카메라앵글/인물배치 텍스트 조언으로 의도적으로 좁혔다. */
const SCENE_COMPOSITION_SYSTEM_PROMPT =
  "당신은 한국 웹툰 연출을 돕는 어시스턴트입니다. 사용자가 입력한 짧은 시나리오나 대사를 읽고, " +
  "이 장면을 그릴 때 참고할 구도(롱샷/미디엄샷/클로즈업 등), 카메라 앵글, 등장인물 배치, 컷 분할 " +
  "아이디어를 한국어 짧은 불릿 3~5개로 제안하세요. 실제 이미지나 그림을 생성하지 말고, 연출 " +
  "아이디어를 담은 텍스트 제안만 하세요.";

/**
 * (3) 콘티→그림 변환(장면 구성 제안) — 시나리오/대사 텍스트를 OpenAI Chat Completions 형태 API로
 * 보내 구도·카메라앵글·인물배치 제안 텍스트를 받는다. 이미지 생성 기능(1)과의 차별화를 위해
 * "그림 자동 생성"이 아니라 "연출 조언"으로 스코프를 좁혔다(§5).
 */
export async function suggestSceneComposition(
  settings: StudioAiSettings,
  sceneText: string,
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT
): Promise<StudioAiResult<StudioTextAiData<{ suggestion: string }>>> {
  const trimmed = sceneText.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "장면 시나리오/대사를 입력하세요." };
  if (!isStudioTextAiConfigured(settings, transport)) {
    return { ok: false, code: "not_configured", error: "서버 AI에 로그인하거나 설정에서 API 키를 등록하세요." };
  }
  const result = await postTextCompletion(settings, {
    task: "composition",
    system: SCENE_COMPOSITION_SYSTEM_PROMPT,
    user: trimmed,
    temperature: 0.7,
    maxTokens: 400,
    responseFormat: "text",
  }, transport);
  if (!result.ok) return result;
  const content = extractFirstChatContent(result.data);
  if (!content) return { ok: false, code: "parse_error", error: "응답에서 제안 텍스트를 찾을 수 없습니다." };
  return {
    ok: true,
    data: {
      suggestion: normalizeStudioAiCompositionSuggestion(content),
      textProvenance: extractTextAiProvenance(result.data, settings, transport),
    },
  };
}

/**
 * (4.5) 시나리오 자동 생성 — "장면 분할" 1단계(투닝/투툰/WeToon 벤치마크,
 * docs/studio-competitor-features.md §4 로드맵 참고). 스토리 아이디어 텍스트 하나를 OpenAI Chat
 * Completions 형태 API로 보내, 여러 장면(각 장면의 배경/상황 묘사 + 대사 스크립트)으로 나눈 JSON을
 * 받는다. 프롬프트 구성·응답 파싱은 studio-scenario-scenes.ts(순수)에 맡기고, 이 함수는 fetch
 * 오케스트레이션 + 에러 계약(StudioAiResult) 변환만 담당한다(suggestSceneComposition과 동일한
 * "얇은 래퍼" 성격).
 *
 * 이미지 생성은 이 함수의 책임이 아니다 — 호출부(StudioPage.tsx)가 studio-scenario-layout.ts로 각
 * 장면을 프레임+말풍선 배치로 변환한 뒤, 장면마다 순차적으로 generateBackgroundImage(첫 장면 —
 * "기준 캐릭터" 확립) 또는 generateConsistentCharacterImage(다음 장면들 — 첫 장면 이미지를 참고해
 * 외모 유지)를 호출한다.
 */
export async function generateScenarioScenes(
  settings: StudioAiSettings,
  storyText: string,
  opts: { sceneCountHint?: number; characterContext?: string; signal?: AbortSignal } = {},
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT,
  importScenarioCodec: () => Promise<typeof import("../studio-scenario-scenes")> = () =>
    import("../studio-scenario-scenes")
): Promise<StudioAiResult<StudioTextAiData<ScenarioScenesPlan>>> {
  const trimmed = storyText.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "스토리 아이디어를 입력하세요." };
  if (!isStudioTextAiConfigured(settings, transport)) {
    return { ok: false, code: "not_configured", error: "서버 AI에 로그인하거나 설정에서 API 키를 등록하세요." };
  }
  const signal = opts.signal ?? transport.signal;
  let scenarioCodec: typeof import("../studio-scenario-scenes");
  try {
    scenarioCodec = await loadOptionalStudioAiCodec(importScenarioCodec, signal);
  } catch (error) {
    return { ok: false, code: "network_error", error: networkErrorMessage(error) };
  }
  const { buildScenarioScenesPrompt, parseScenarioScenesResponse } = scenarioCodec;
  const { system, user } = buildScenarioScenesPrompt(trimmed, opts.sceneCountHint, opts.characterContext);
  const result = await postTextCompletion(settings, {
    task: "scenario",
    system,
    user,
    temperature: 0.7,
    maxTokens: 1800,
    responseFormat: "json",
  }, { ...transport, signal });
  if (!result.ok) return result;
  const content = extractFirstChatContent(result.data);
  if (!content) return { ok: false, code: "parse_error", error: "응답에서 장면 구성 텍스트를 찾을 수 없습니다." };
  const parsed = parseScenarioScenesResponse(content);
  if (!parsed.ok) return { ok: false, code: "parse_error", error: parsed.error };
  return {
    ok: true,
    data: {
      ...parsed.data,
      textProvenance: extractTextAiProvenance(result.data, settings, transport),
    },
  };
}

/**
 * Writer Room 단계 초안 생성. 모델 결과는 현재 문서에 적용하지 않고 엄격하게 파싱한 후보만
 * 반환한다. 호출부는 현재 값과 후보를 함께 보여준 뒤 사용자의 명시적 승인에서만 문서를 바꿔야 한다.
 */
export async function generateStudioWriterRoomDraft(
  settings: StudioAiSettings,
  input: {
    stage: StudioWriterRoomStage;
    document: unknown;
    characterContext?: string;
    direction?: string;
    signal?: AbortSignal;
  },
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT
): Promise<StudioAiResult<StudioTextAiData<StudioWriterRoomAiDraft>>> {
  if (!isStudioTextAiConfigured(settings, transport)) {
    return {
      ok: false,
      code: "not_configured",
      error: "서버 AI에 로그인하거나 설정에서 API 키를 등록하세요.",
    };
  }
  const prompt = buildStudioWriterRoomAiPrompt(input);
  const result = await postTextCompletion(settings, {
    task: "scenario",
    system: prompt.system,
    user: prompt.user,
    temperature: 0.55,
    maxTokens: 2_400,
    responseFormat: "json",
  }, { ...transport, signal: input.signal ?? transport.signal });
  if (!result.ok) return result;
  const content = extractFirstChatContent(result.data);
  if (!content) {
    return { ok: false, code: "parse_error", error: "응답에서 Writer Room 초안을 찾을 수 없습니다." };
  }
  const parsed = parseStudioWriterRoomAiDraft(content, input.stage);
  if (!parsed.ok) return { ok: false, code: "parse_error", error: parsed.error };
  return {
    ok: true,
    data: {
      ...parsed.data,
      textProvenance: extractTextAiProvenance(result.data, settings, transport),
    },
  };
}

/**
 * (4) 대사 번역 — 말풍선/텍스트 요소 배치(청크 1개 분량)를 OpenAI Chat Completions 형태 API로 보내
 * 대상 언어로 번역한 결과를 받는다. 기능(3)의 SCENE_COMPOSITION_SYSTEM_PROMPT와 동일하게 프롬프트
 * 구성은 studio-dialogue-translate.ts(순수·단위테스트 가능)에 맡기고, 이 함수는 fetch 오케스트레이션만
 * 담당한다(studio-ai-client.ts의 "얇은 래퍼" 성격 유지 — 파싱 실패해도 throw하지 않고 StudioAiResult로
 * 감싼다는 계약은 동일).
 */
export async function translateDialogueBatch(
  settings: StudioAiSettings,
  items: DialogueTranslatableItem[],
  targetLocaleLabel: string,
  glossary: string,
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT
): Promise<StudioAiResult<StudioTextAiData<{ translations: { id: string; text: string }[] }>>> {
  if (items.length === 0) return { ok: false, code: "invalid_input", error: "번역할 대사가 없습니다." };
  if (!isStudioTextAiConfigured(settings, transport)) {
    return { ok: false, code: "not_configured", error: "서버 AI에 로그인하거나 설정에서 API 키를 등록하세요." };
  }
  const { system, user } = buildTranslationPrompt(items, targetLocaleLabel, glossary);
  const result = await postTextCompletion(settings, {
    task: "translation",
    system,
    user,
    temperature: 0.3, // 창작적 변주보다 일관된 번역이 목적 — 장면 구성 제안(0.7)보다 낮춘다.
    maxTokens: Math.max(400, items.length * 120),
    responseFormat: "json",
  }, transport);
  if (!result.ok) return result;
  const content = extractFirstChatContent(result.data);
  if (!content) return { ok: false, code: "parse_error", error: "응답에서 번역 텍스트를 찾을 수 없습니다." };
  const parsed = parseTranslationResponse(content, items.map((it) => it.id));
  if (!parsed.ok) return { ok: false, code: "parse_error", error: parsed.error };
  return {
    ok: true,
    data: {
      translations: [...parsed.translations].map(([id, text]) => ({ id, text })),
      textProvenance: extractTextAiProvenance(result.data, settings, transport),
    },
  };
}

/**
 * (5) 대사/나레이션 제안 — 장면 상황 텍스트(+ 선택적으로 캔버스에 이미 배치된 대사 맥락)를 OpenAI
 * Chat Completions 형태 API로 보내, 자연스러운 대사·나레이션 후보 여러 개를 받는다. 프롬프트 구성·
 * 응답 파싱은 studio-dialogue-suggest.ts(순수)에 맡기고, 이 함수는 fetch 오케스트레이션 + 에러 계약
 * (StudioAiResult) 변환만 담당한다(suggestSceneComposition/generateScenarioScenes와 동일한 "얇은
 * 래퍼" 성격).
 *
 * 결과 후보는 그 자체로 캔버스에 삽입되지 않는다 — 호출부(StudioPage.tsx)가 후보를 고르면
 * studio-dialogue-suggest.formatDialogueSuggestionLine으로 "이름: 대사" 미니 문법 한 줄로 바꿔
 * 기존 "대사 한 번에"(parseDialogueScript → layoutDialogueBubbles) 스크립트에 추가하거나, 선택된
 * 말풍선·텍스트 요소에 직접 삽입한다(studio-dialogue-batch.applyDialogueTextEdit 재사용 — 이중 구현
 * 없음).
 */
export async function suggestDialogueLines(
  settings: StudioAiSettings,
  situationText: string,
  opts: { existingContext?: string } = {},
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT
): Promise<StudioAiResult<StudioTextAiData<{ candidates: DialogueSuggestionCandidate[] }>>> {
  const trimmed = situationText.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "장면 상황을 입력하세요." };
  if (!isStudioTextAiConfigured(settings, transport)) {
    return { ok: false, code: "not_configured", error: "서버 AI에 로그인하거나 설정에서 API 키를 등록하세요." };
  }
  const { system, user } = buildDialogueSuggestPrompt(trimmed, opts.existingContext ?? "");
  const result = await postTextCompletion(settings, {
    task: "dialogue",
    system,
    user,
    temperature: 0.8, // 서로 다른 후보 여러 개가 목적 — 장면 구성 제안(0.7)보다 살짝 높여 다양성을 늘린다.
    maxTokens: 500,
    responseFormat: "json",
  }, transport);
  if (!result.ok) return result;
  const content = extractFirstChatContent(result.data);
  if (!content) return { ok: false, code: "parse_error", error: "응답에서 대사 제안을 찾을 수 없습니다." };
  const parsed = parseDialogueSuggestResponse(content);
  if (!parsed.ok) return { ok: false, code: "parse_error", error: parsed.error };
  return {
    ok: true,
    data: {
      candidates: parsed.data,
      textProvenance: extractTextAiProvenance(result.data, settings, transport),
    },
  };
}

/**
 * (6) 색상 팔레트 추천 — 장르/무드 텍스트를 OpenAI Chat Completions 형태 API로 보내, 그 장면에 어울리는
 * 색상 팔레트(5~6색, 각 색의 용도 설명 포함)를 받는다. 프롬프트 구성·응답 파싱은
 * studio-palette-suggest.ts(순수)에 맡기고, 이 함수는 fetch 오케스트레이션 + 에러 계약
 * (StudioAiResult) 변환만 담당한다(suggestDialogueLines와 동일한 "얇은 래퍼" 성격).
 *
 * 결과 색상은 studio-palette-library.StudioNamedPalette.colors와 이미 같은 정규화된 hex 문자열
 * 형식이라(studio-palette-suggest.ts가 normalizeHexColor를 통과한 값만 반환), 호출부가
 * `createPalette(name, colors.map(c => c.hex))`로 바로 "내 팔레트에 저장"할 수 있다 — 새 팔레트 타입을
 * 만들지 않는다.
 */
export async function suggestColorPalette(
  settings: StudioAiSettings,
  moodText: string,
  transport: StudioTextAiTransport = DEFAULT_TEXT_AI_TRANSPORT,
  importPaletteCodec: () => Promise<typeof import("../studio-palette-suggest")> = () =>
    import("../studio-palette-suggest")
): Promise<StudioAiResult<StudioTextAiData<PaletteSuggestion>>> {
  const trimmed = moodText.trim();
  if (!trimmed) return { ok: false, code: "invalid_input", error: "장르/무드를 입력하세요." };
  if (!isStudioTextAiConfigured(settings, transport)) {
    return { ok: false, code: "not_configured", error: "서버 AI에 로그인하거나 설정에서 API 키를 등록하세요." };
  }
  let paletteCodec: typeof import("../studio-palette-suggest");
  try {
    paletteCodec = await loadOptionalStudioAiCodec(importPaletteCodec, transport.signal);
  } catch (error) {
    return { ok: false, code: "network_error", error: networkErrorMessage(error) };
  }
  const { buildPaletteSuggestPrompt, parsePaletteSuggestResponse } = paletteCodec;
  const { system, user } = buildPaletteSuggestPrompt(trimmed);
  const result = await postTextCompletion(settings, {
    task: "palette",
    system,
    user,
    temperature: 0.7,
    maxTokens: 500,
    responseFormat: "json",
  }, transport);
  if (!result.ok) return result;
  const content = extractFirstChatContent(result.data);
  if (!content) return { ok: false, code: "parse_error", error: "응답에서 팔레트 제안을 찾을 수 없습니다." };
  const parsed = parsePaletteSuggestResponse(content);
  if (!parsed.ok) return { ok: false, code: "parse_error", error: parsed.error };
  return {
    ok: true,
    data: {
      ...parsed.data,
      textProvenance: extractTextAiProvenance(result.data, settings, transport),
    },
  };
}

/**
 * 설정 화면의 "테스트" 버튼용 — 가장 저렴한 호출(Chat Completions, max_tokens:1)로 baseUrl+apiKey
 * 조합이 실제로 유효한지 확인한다. 이미지 생성/편집 엔드포인트까지 각각 검증하진 않는다(§5 — 셋 다
 * 검증하려면 실제 이미지 호출 비용이 들어 사용자 동의 없이 실행하기 부담스럽다. 공유 baseUrl/apiKey
 * 조합이 유효하면 나머지 두 엔드포인트도 대개 함께 유효하다는 가정).
 */
export async function testAiConnection(
  settings: StudioAiSettings
): Promise<StudioAiResult<{ latencyMs: number }>> {
  if (!isStudioAiConfigured(settings)) {
    return { ok: false, code: "not_configured", error: "설정에서 API 키를 등록하세요." };
  }
  const url = buildUrl(settings.baseUrl, settings.chatCompletionsPath);
  const startedAt = Date.now();
  const result = await postJson(url, settings.apiKey, {
    model: settings.textModel,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  });
  if (!result.ok) return result;
  return { ok: true, data: { latencyMs: Date.now() - startedAt } };
}
