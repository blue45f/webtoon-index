import { api, toApiError } from "@/src/infrastructure/api";

export type StudioServerAiTask = "composition" | "scenario" | "translation" | "dialogue" | "palette";
/** 서버가 구성할 수 있는 텍스트 AI 공급자. 서버 studio-ai-provider.ts의 allowlist와 일치해야 한다. */
export type StudioServerAiProvider = "zai" | "deepseek" | "openrouter";

const STUDIO_SERVER_AI_PROVIDER_LABELS: Record<StudioServerAiProvider, string> = {
  zai: "Z.ai",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
};

/** UI 표시용 공급자 이름 — failover 문구 등에서 이진 삼항식 대신 공통으로 쓴다. */
export function studioServerAiProviderLabel(provider: StudioServerAiProvider): string {
  return STUDIO_SERVER_AI_PROVIDER_LABELS[provider];
}
export type StudioServerAiProviderPreference = "auto" | StudioServerAiProvider;

/**
 * 서버가 다른 공급자로 요청을 넘겨도 되는, 비용이 발생하기 전 확인 가능한 사유만 공개한다.
 * 공급자 원문 오류·응답 본문·키는 이 공개 계약에 포함하지 않는다.
 */
export type StudioServerAiFailoverReason = "billing_quota_exhausted";

/** 성공 응답의 공급자 전환 이력. actual*은 최상위 provider/model과 반드시 일치해야 한다. */
export interface StudioServerAiFailoverMetadata {
  attemptedProvider: StudioServerAiProvider;
  attemptedModel: string;
  actualProvider: StudioServerAiProvider;
  actualModel: string;
  reason: StudioServerAiFailoverReason;
}

export type StudioServerAiStatus = {
  configured: boolean;
  provider: StudioServerAiProvider | "none";
  model: string;
  providers: Array<{
    id: StudioServerAiProvider;
    label: string;
    configured: boolean;
    model: string;
  }>;
  selection: {
    default: "auto";
    order: StudioServerAiProvider[];
    fallback: boolean;
  };
  capabilities: string[];
  requiresAuth: boolean;
  quota?: {
    enforced: boolean;
    timezone: "UTC";
    failureMode: "closed";
    dailyRequestLimit: number;
    dailyTokenLimit: number;
    globalDailyRequestLimit?: number;
    globalDailyTokenLimit?: number;
  };
};

export type StudioServerAiCompletion = {
  content: string;
  provider: StudioServerAiProvider;
  model: string;
  requestId?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  failover?: StudioServerAiFailoverMetadata;
};

export type StudioServerAiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "invalid_input" | "network_error" | "http_error" | "parse_error"; error: string };

export async function getStudioServerAiStatus(signal?: AbortSignal): Promise<StudioServerAiStatus> {
  return api.get<StudioServerAiStatus>("/studio-ai/status", { signal });
}

const MAX_MODEL_CODE_UNITS = 200;
const MAX_REQUEST_ID_CODE_UNITS = 240;
const MAX_TOKEN_COUNT = 2_147_483_647;
const STUDIO_SERVER_AI_OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;

/**
 * Canonical retry key shared with the Studio AI controller contract. The opaque ASCII identity is
 * exact: whitespace, Unicode normalization, and truncation must never turn an invalid caller value
 * into a different durable receipt key.
 */
export function canonicalStudioServerAiOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return STUDIO_SERVER_AI_OPERATION_ID_PATTERN.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function studioServerAiProvider(value: unknown): StudioServerAiProvider | undefined {
  return value === "zai" || value === "deepseek" || value === "openrouter" ? value : undefined;
}

function boundedText(value: unknown, maxCodeUnits: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxCodeUnits ? trimmed : undefined;
}

function optionalTokenCount(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_TOKEN_COUNT
    ? value
    : undefined;
}

function parseUsage(value: unknown): StudioServerAiCompletion["usage"] {
  if (!isRecord(value)) return undefined;
  const promptTokens = optionalTokenCount(value.promptTokens);
  const completionTokens = optionalTokenCount(value.completionTokens);
  const totalTokens = optionalTokenCount(value.totalTokens);
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) return undefined;
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

/**
 * 선택 필드인 전환 이력은 완전히 유효하고 최상위 실제 공급자와 일치할 때만 유지한다.
 * 서버 구버전과의 호환을 위해 누락·손상된 선택 메타데이터는 성공 본문을 폐기하지 않고 생략한다.
 */
export function parseStudioServerAiFailoverMetadata(
  value: unknown,
  actual: Pick<StudioServerAiCompletion, "provider" | "model">
): StudioServerAiFailoverMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const attemptedProvider = studioServerAiProvider(value.attemptedProvider);
  const attemptedModel = boundedText(value.attemptedModel, MAX_MODEL_CODE_UNITS);
  const actualProvider = studioServerAiProvider(value.actualProvider);
  const actualModel = boundedText(value.actualModel, MAX_MODEL_CODE_UNITS);
  if (
    !attemptedProvider
    || !attemptedModel
    || !actualProvider
    || !actualModel
    || value.reason !== "billing_quota_exhausted"
    || attemptedProvider === actualProvider
    || actualProvider !== actual.provider
    || actualModel !== actual.model
  ) {
    return undefined;
  }
  return {
    attemptedProvider,
    attemptedModel,
    actualProvider,
    actualModel,
    reason: "billing_quota_exhausted",
  };
}

/**
 * ky의 제네릭 캐스트를 런타임 검증으로 바꾼다. 허용 목록 필드만 새 객체에 복사하므로 서버나
 * 상류 공급자가 실수로 보낸 원문 오류·시크릿 필드는 성공 결과와 provenance에 전파되지 않는다.
 */
export function parseStudioServerAiCompletion(value: unknown): StudioServerAiCompletion | undefined {
  if (!isRecord(value)) return undefined;
  const content = boundedText(value.content, 100_000);
  const provider = studioServerAiProvider(value.provider);
  const model = boundedText(value.model, MAX_MODEL_CODE_UNITS);
  if (!content || !provider || !model) return undefined;
  const requestId = boundedText(value.requestId, MAX_REQUEST_ID_CODE_UNITS);
  const usage = parseUsage(value.usage);
  const failover = parseStudioServerAiFailoverMetadata(value.failover, { provider, model });
  return {
    content,
    provider,
    model,
    ...(requestId ? { requestId } : {}),
    ...(usage ? { usage } : {}),
    ...(failover ? { failover } : {}),
  };
}

export async function completeStudioServerText(
  input: {
    task: StudioServerAiTask;
    provider?: StudioServerAiProviderPreference;
    promptVersion: 1;
    system: string;
    user: string;
    /** Stable tracked operation ID; sent only as the server's bounded idempotency header. */
    operationId?: string;
  },
  signal?: AbortSignal
): Promise<StudioServerAiResult<StudioServerAiCompletion>> {
  const idempotencyKey = canonicalStudioServerAiOperationId(input.operationId);
  if (!idempotencyKey) {
    return {
      ok: false,
      code: "invalid_input",
      error: "서버 AI 요청 식별자가 올바르지 않아요.",
    };
  }
  const { operationId: _operationId, ...request } = input;
  try {
    const raw = await api.post<unknown>("/studio-ai/chat", request, {
      signal,
      headers: { "Idempotency-Key": idempotencyKey },
    });
    const data = parseStudioServerAiCompletion(raw);
    if (!data) return { ok: false, code: "parse_error", error: "서버 AI 응답 형식을 확인하지 못했어요." };
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      code: "http_error",
      error: (await toApiError(error, "서버 AI 요청에 실패했어요.")).message,
    };
  }
}
