import { z } from "zod";

import {
  STUDIO_DRAFT_COLLABORATION_FINAL_STATUSES,
  STUDIO_DRAFT_COLLABORATION_PROVISION_INTENTS,
  STUDIO_DRAFT_COLLABORATION_POLICY,
  type StudioDraftCollaborationProvisionIntent,
  type StudioDraftCollaborationPromotionRequest,
  type StudioDraftCollaborationProvisionRequest,
  type StudioDraftCollaborationTemporaryRoom,
} from "./studio-draft-collaboration";

import { api, apiPath } from "@/src/infrastructure/api";

const DRAFT_COLLABORATION_ROOMS_PATH = "/creator/draft-collaboration/rooms";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const MAX_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_TRACKED_MUTATIONS = 256;
const MAX_GRAPH_REVISION = 2_147_483_647;

const DraftDocumentIdSchema = z
  .string()
  .regex(
    /^draft_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
const DraftRoomIdSchema = z
  .string()
  .regex(
    /^draft-room_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
const MutationIdSchema = z.string().uuid();
const ExactScopeSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value.trim() === value);
const GraphRevisionSchema = z.number().int().min(0).max(MAX_GRAPH_REVISION);
const WorkRevisionSchema = z.number().int().min(1).max(MAX_GRAPH_REVISION);
const IsoDateTimeSchema = z.iso.datetime({ offset: true });
const ProvisionIntentSchema = z.enum(
  STUDIO_DRAFT_COLLABORATION_PROVISION_INTENTS
);

const ProvisionRequestSchema = z
  .object({
    version: z.literal(1),
    draftDocumentId: DraftDocumentIdSchema,
    ownerScopeKey: ExactScopeSchema,
    intent: ProvisionIntentSchema,
    clientMutationId: MutationIdSchema,
    initialSnapshotByteLength: z
      .number()
      .int()
      .min(0)
      .max(STUDIO_DRAFT_COLLABORATION_POLICY.maxInitialSnapshotBytes),
    requestedAt: IsoDateTimeSchema,
  })
  .strict();

const PromotionRequestSchema = z
  .object({
    version: z.literal(1),
    draftDocumentId: DraftDocumentIdSchema,
    roomId: DraftRoomIdSchema,
    ownerScopeKey: ExactScopeSchema,
    targetWorkId: ExactScopeSchema,
    expectedGraphRevision: GraphRevisionSchema.refine(
      (revision) => revision < MAX_GRAPH_REVISION
    ),
    expectedWorkRevision: WorkRevisionSchema,
    finalStatus: z.enum(STUDIO_DRAFT_COLLABORATION_FINAL_STATUSES),
    clientMutationId: MutationIdSchema,
    requestedAt: IsoDateTimeSchema,
  })
  .strict();

const RoomResponseSchema = z
  .object({
    version: z.literal(1),
    roomId: DraftRoomIdSchema,
    draftDocumentId: DraftDocumentIdSchema,
    provisionalWorkId: ExactScopeSchema,
    ownerScopeKey: ExactScopeSchema,
    status: z.enum(["active", "promoted"]),
    graphRevision: GraphRevisionSchema,
    initialSnapshotByteLength: z
      .number()
      .int()
      .min(0)
      .max(STUDIO_DRAFT_COLLABORATION_POLICY.maxInitialSnapshotBytes),
    provisionIntent: ProvisionIntentSchema,
    provisionedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    promotedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((room, context) => {
    const provisionedAt = Date.parse(room.provisionedAt);
    const expiresAt = Date.parse(room.expiresAt);
    const promotedAt = room.promotedAt === null ? null : Date.parse(room.promotedAt);
    if (provisionedAt >= expiresAt) {
      context.addIssue({
        code: "custom",
        message: "room expiry must follow provisioning",
        path: ["expiresAt"],
      });
    }
    if (room.status === "active" && room.promotedAt !== null) {
      context.addIssue({
        code: "custom",
        message: "active room cannot include promotion metadata",
        path: ["promotedAt"],
      });
    }
    if (
      room.status === "promoted"
      && (
        promotedAt === null
        || promotedAt < provisionedAt
        || promotedAt >= expiresAt
        || room.graphRevision < 1
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "promoted room metadata is inconsistent",
        path: ["status"],
      });
    }
  });

type ParsedProvisionRequest = z.output<typeof ProvisionRequestSchema>;
type ParsedPromotionRequest = z.output<typeof PromotionRequestSchema>;
type ParsedRoomResponse = z.output<typeof RoomResponseSchema>;

export type CreatorDraftCollaborationRoomStatus = "active" | "promoted";

export interface CreatorDraftCollaborationRoomResponse
  extends StudioDraftCollaborationTemporaryRoom {
  readonly status: CreatorDraftCollaborationRoomStatus;
  readonly initialSnapshotByteLength: number;
  readonly provisionIntent: StudioDraftCollaborationProvisionIntent;
  readonly promotedAt: string | null;
}

export interface CreatorDraftCollaborationRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface CreatorDraftCollaborationTransportRequest {
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type CreatorDraftCollaborationTransport = (
  request: CreatorDraftCollaborationTransportRequest
) => Promise<Response>;

export interface CreatorDraftCollaborationClientDependencies {
  readonly transport?: CreatorDraftCollaborationTransport;
  readonly now?: () => number;
}

export interface CreatorDraftCollaborationClient {
  provision(
    request: StudioDraftCollaborationProvisionRequest,
    options?: CreatorDraftCollaborationRequestOptions
  ): Promise<CreatorDraftCollaborationRoomResponse>;
  promote(
    request: StudioDraftCollaborationPromotionRequest,
    options?: CreatorDraftCollaborationRequestOptions
  ): Promise<CreatorDraftCollaborationRoomResponse>;
}

export class CreatorDraftCollaborationInputError extends Error {
  constructor(message = "초안 협업 요청 형식이 올바르지 않습니다.") {
    super(message);
    this.name = "CreatorDraftCollaborationInputError";
  }
}

export class CreatorDraftCollaborationResponseContractError extends Error {
  constructor(message = "초안 협업 서버 응답 형식이 올바르지 않습니다.") {
    super(message);
    this.name = "CreatorDraftCollaborationResponseContractError";
  }
}

export class CreatorDraftCollaborationTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`초안 협업 요청이 ${timeoutMs}ms 안에 완료되지 않았습니다.`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class CreatorDraftCollaborationNetworkError extends Error {
  constructor(cause: unknown) {
    super("초안 협업 서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.", {
      cause,
    });
    this.name = "CreatorDraftCollaborationNetworkError";
  }
}

export type CreatorDraftCollaborationHttpErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "expired"
  | "conflict"
  | "rate-limited"
  | "request"
  | "server";

export class CreatorDraftCollaborationHttpError extends Error {
  readonly kind: CreatorDraftCollaborationHttpErrorKind;
  readonly status: number;
  readonly serverCode: string | null;
  readonly retryAfterMs: number | null;
  readonly currentGraphRevision: number | null;
  readonly currentWorkRevision: number | null;

  constructor(input: {
    readonly kind: CreatorDraftCollaborationHttpErrorKind;
    readonly status: number;
    readonly message: string;
    readonly serverCode?: string | null;
    readonly retryAfterMs?: number | null;
    readonly currentGraphRevision?: number | null;
    readonly currentWorkRevision?: number | null;
  }) {
    super(input.message);
    this.name = "CreatorDraftCollaborationHttpError";
    this.kind = input.kind;
    this.status = input.status;
    this.serverCode = input.serverCode ?? null;
    this.retryAfterMs = input.retryAfterMs ?? null;
    this.currentGraphRevision = input.currentGraphRevision ?? null;
    this.currentWorkRevision = input.currentWorkRevision ?? null;
  }
}

interface ErrorPayload {
  readonly code: string | null;
  readonly message: string | null;
  readonly retryAfterSeconds: number | null;
  readonly currentGraphRevision: number | null;
  readonly currentWorkRevision: number | null;
}

interface CombinedAbort {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeServerString(value: unknown, maxLength: number): string | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value.trim() !== value
  ) {
    return null;
  }
  return value;
}

function parseErrorPayload(value: unknown): ErrorPayload {
  if (!isPlainRecord(value)) {
    return {
      code: null,
      message: null,
      retryAfterSeconds: null,
      currentGraphRevision: null,
      currentWorkRevision: null,
    };
  }
  const retryAfterSeconds =
    Number.isSafeInteger(value.retryAfterSeconds)
    && (value.retryAfterSeconds as number) >= 0
    && (value.retryAfterSeconds as number) * 1_000 <= MAX_RETRY_AFTER_MS
      ? (value.retryAfterSeconds as number)
      : null;
  const currentGraphRevision =
    Number.isSafeInteger(value.currentGraphRevision)
    && (value.currentGraphRevision as number) >= 0
    && (value.currentGraphRevision as number) <= MAX_GRAPH_REVISION
      ? (value.currentGraphRevision as number)
      : null;
  const currentWorkRevision =
    Number.isSafeInteger(value.currentWorkRevision)
    && (value.currentWorkRevision as number) >= 1
    && (value.currentWorkRevision as number) <= MAX_GRAPH_REVISION
      ? (value.currentWorkRevision as number)
      : null;
  return {
    code: safeServerString(value.code, 120),
    message: safeServerString(value.message, 500),
    retryAfterSeconds,
    currentGraphRevision,
    currentWorkRevision,
  };
}

function boundedTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new CreatorDraftCollaborationInputError(
      `timeoutMs는 1~${MAX_REQUEST_TIMEOUT_MS} 사이의 정수여야 합니다.`
    );
  }
  return timeoutMs;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError");
}

function combineAbort(signal: AbortSignal | undefined, timeoutMs: number): CombinedAbort {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const handleExternalAbort = () => controller.abort(signal ? abortReason(signal) : undefined);
  if (signal?.aborted) {
    handleExternalAbort();
  } else {
    signal?.addEventListener("abort", handleExternalAbort, { once: true });
    timeoutId = setTimeout(() => {
      controller.abort(new CreatorDraftCollaborationTimeoutError(timeoutMs));
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      signal?.removeEventListener("abort", handleExternalAbort);
      if (timeoutId !== null) clearTimeout(timeoutId);
    },
  };
}

function contentTypeIsJson(response: Response): boolean {
  const contentType = response.headers.get("content-type");
  if (!contentType) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function declaredResponseBytes(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (!raw || !/^(?:0|[1-9]\d{0,9})$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredBytes = declaredResponseBytes(response);
  if (declaredBytes !== null && declaredBytes > MAX_RESPONSE_BYTES) {
    throw new CreatorDraftCollaborationResponseContractError(
      "초안 협업 서버 응답이 허용 크기를 초과했습니다."
    );
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new CreatorDraftCollaborationResponseContractError(
      "초안 협업 서버 응답이 허용 크기를 초과했습니다."
    );
  }
  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CreatorDraftCollaborationResponseContractError();
  }
}

function retryAfterFromHeader(response: Response, now: number): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  if (/^(?:0|[1-9]\d{0,8})$/u.test(value)) {
    return Math.min(Number(value) * 1_000, MAX_RETRY_AFTER_MS);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - now), MAX_RETRY_AFTER_MS);
}

function defaultHttpMessage(status: number): string {
  switch (status) {
    case 401:
      return "로그인한 뒤 초안 협업을 다시 시도해 주세요.";
    case 403:
      return "현재 계정에는 이 초안 협업 작업을 수행할 권한이 없습니다.";
    case 404:
      return "임시 협업 작업실을 찾을 수 없습니다.";
    case 409:
      return "협업 상태가 먼저 변경되었습니다. 최신 상태를 확인해 주세요.";
    case 410:
      return "임시 협업 작업실이 만료되었습니다. 새 작업실을 만들어 주세요.";
    case 429:
      return "초안 협업 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return status >= 500
        ? "초안 협업 서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
        : "초안 협업 요청을 처리할 수 없습니다.";
  }
}

function httpErrorKind(status: number): CreatorDraftCollaborationHttpErrorKind {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not-found";
    case 409:
      return "conflict";
    case 410:
      return "expired";
    case 429:
      return "rate-limited";
    default:
      return status >= 500 ? "server" : "request";
  }
}

function createHttpError(
  response: Response,
  payload: ErrorPayload,
  now: number
): CreatorDraftCollaborationHttpError {
  const headerRetryAfter = retryAfterFromHeader(response, now);
  const bodyRetryAfter =
    payload.retryAfterSeconds === null ? null : payload.retryAfterSeconds * 1_000;
  return new CreatorDraftCollaborationHttpError({
    kind: httpErrorKind(response.status),
    status: response.status,
    message: payload.message ?? defaultHttpMessage(response.status),
    serverCode: payload.code,
    retryAfterMs:
      response.status === 429 ? (headerRetryAfter ?? bodyRetryAfter) : null,
    currentGraphRevision:
      response.status === 409 ? payload.currentGraphRevision : null,
    currentWorkRevision:
      response.status === 409 ? payload.currentWorkRevision : null,
  });
}

async function defaultTransport(
  request: CreatorDraftCollaborationTransportRequest
): Promise<Response> {
  return api.raw.post(apiPath(request.path), {
    json: request.body,
    headers: request.headers,
    signal: request.signal,
    credentials: "include",
    cache: "no-store",
    retry: 0,
    timeout: false,
    throwHttpErrors: false,
  });
}

function parseProvisionRequest(
  request: StudioDraftCollaborationProvisionRequest
): ParsedProvisionRequest {
  const parsed = ProvisionRequestSchema.safeParse(request);
  if (!parsed.success) throw new CreatorDraftCollaborationInputError();
  return parsed.data;
}

function parsePromotionRequest(
  request: StudioDraftCollaborationPromotionRequest
): ParsedPromotionRequest {
  const parsed = PromotionRequestSchema.safeParse(request);
  if (!parsed.success) throw new CreatorDraftCollaborationInputError();
  return parsed.data;
}

function parsedRoom(value: unknown): ParsedRoomResponse {
  const parsed = RoomResponseSchema.safeParse(value);
  if (!parsed.success) throw new CreatorDraftCollaborationResponseContractError();
  return parsed.data;
}

function toPublicRoom(room: ParsedRoomResponse): CreatorDraftCollaborationRoomResponse {
  return {
    version: 1,
    roomId: room.roomId,
    provisionalWorkId: room.provisionalWorkId,
    draftDocumentId: room.draftDocumentId,
    ownerScopeKey: room.ownerScopeKey,
    graphRevision: room.graphRevision,
    provisionedAt: room.provisionedAt,
    expiresAt: room.expiresAt,
    status: room.status,
    initialSnapshotByteLength: room.initialSnapshotByteLength,
    provisionIntent: room.provisionIntent,
    promotedAt: room.promotedAt,
  };
}

function knownClientError(error: unknown): boolean {
  return (
    error instanceof CreatorDraftCollaborationInputError
    || error instanceof CreatorDraftCollaborationResponseContractError
    || error instanceof CreatorDraftCollaborationTimeoutError
    || error instanceof CreatorDraftCollaborationHttpError
    || error instanceof CreatorDraftCollaborationNetworkError
  );
}

/**
 * Creates a lazy draft-room adapter. Keep this module behind `import()` from Studio so opening the
 * editor does not pull collaboration networking or Zod into the startup graph.
 */
export function createCreatorDraftCollaborationClient(
  dependencies: CreatorDraftCollaborationClientDependencies = {}
): CreatorDraftCollaborationClient {
  const transport = dependencies.transport ?? defaultTransport;
  const now = dependencies.now ?? (() => Date.now());
  const mutationFingerprints = new Map<string, string>();

  const assertMutationFingerprint = (
    operation: "provision" | "promote",
    ownerScopeKey: string,
    mutationId: string,
    fingerprint: string
  ) => {
    const key = `${operation}:${ownerScopeKey}:${mutationId}`;
    const existing = mutationFingerprints.get(key);
    if (existing !== undefined && existing !== fingerprint) {
      throw new CreatorDraftCollaborationInputError(
        "같은 요청 식별자를 서로 다른 초안 협업 작업에 재사용할 수 없습니다."
      );
    }
    mutationFingerprints.delete(key);
    mutationFingerprints.set(key, fingerprint);
    while (mutationFingerprints.size > MAX_TRACKED_MUTATIONS) {
      const oldestKey = mutationFingerprints.keys().next().value as string | undefined;
      if (!oldestKey) break;
      mutationFingerprints.delete(oldestKey);
    }
  };

  const execute = async (
    path: string,
    body: Readonly<Record<string, unknown>>,
    mutationId: string,
    options: CreatorDraftCollaborationRequestOptions
  ): Promise<ParsedRoomResponse> => {
    const timeoutMs = boundedTimeoutMs(options.timeoutMs);
    const combined = combineAbort(options.signal, timeoutMs);
    try {
      if (combined.signal.aborted) throw abortReason(combined.signal);
      const response = await transport({
        path,
        body,
        headers: {
          Accept: "application/json",
          "Idempotency-Key": mutationId,
        },
        signal: combined.signal,
      });
      if (combined.signal.aborted) throw abortReason(combined.signal);
      const text = await readBoundedResponseText(response);
      if (!response.ok) {
        const payload =
          text && contentTypeIsJson(response)
            ? parseErrorPayload(parseJson(text))
            : parseErrorPayload(null);
        throw createHttpError(response, payload, now());
      }
      if (!text || !contentTypeIsJson(response)) {
        throw new CreatorDraftCollaborationResponseContractError();
      }
      return parsedRoom(parseJson(text));
    } catch (error) {
      if (combined.signal.aborted) throw abortReason(combined.signal);
      if (knownClientError(error)) throw error;
      throw new CreatorDraftCollaborationNetworkError(error);
    } finally {
      combined.dispose();
    }
  };

  return Object.freeze({
    async provision(
      request: StudioDraftCollaborationProvisionRequest,
      options: CreatorDraftCollaborationRequestOptions = {}
    ) {
      const parsed = parseProvisionRequest(request);
      const body = {
        draftDocumentId: parsed.draftDocumentId,
        ownerScopeKey: parsed.ownerScopeKey,
        intent: parsed.intent,
        clientMutationId: parsed.clientMutationId,
        initialSnapshotByteLength: parsed.initialSnapshotByteLength,
      };
      assertMutationFingerprint(
        "provision",
        parsed.ownerScopeKey,
        parsed.clientMutationId,
        JSON.stringify(body)
      );
      const room = await execute(
        DRAFT_COLLABORATION_ROOMS_PATH,
        body,
        parsed.clientMutationId,
        options
      );
      if (
        room.draftDocumentId !== parsed.draftDocumentId
        || room.ownerScopeKey !== parsed.ownerScopeKey
        || (room.status === "active" && Date.parse(room.expiresAt) <= now())
      ) {
        throw new CreatorDraftCollaborationResponseContractError(
          "다른 초안 또는 만료된 협업 작업실 응답을 받았습니다."
        );
      }
      return toPublicRoom(room);
    },

    async promote(
      request: StudioDraftCollaborationPromotionRequest,
      options: CreatorDraftCollaborationRequestOptions = {}
    ) {
      const parsed = parsePromotionRequest(request);
      const body = {
        draftDocumentId: parsed.draftDocumentId,
        ownerScopeKey: parsed.ownerScopeKey,
        targetWorkId: parsed.targetWorkId,
        expectedGraphRevision: parsed.expectedGraphRevision,
        expectedWorkRevision: parsed.expectedWorkRevision,
        finalStatus: parsed.finalStatus,
        clientMutationId: parsed.clientMutationId,
      };
      assertMutationFingerprint(
        "promote",
        parsed.ownerScopeKey,
        parsed.clientMutationId,
        `${parsed.roomId}:${JSON.stringify(body)}`
      );
      const room = await execute(
        `${DRAFT_COLLABORATION_ROOMS_PATH}/${encodeURIComponent(parsed.roomId)}/promote`,
        body,
        parsed.clientMutationId,
        options
      );
      if (
        room.status !== "promoted"
        || room.roomId !== parsed.roomId
        || room.draftDocumentId !== parsed.draftDocumentId
        || room.ownerScopeKey !== parsed.ownerScopeKey
        || room.provisionalWorkId !== parsed.targetWorkId
        || room.graphRevision !== parsed.expectedGraphRevision + 1
      ) {
        throw new CreatorDraftCollaborationResponseContractError(
          "임시 협업 작업실과 저장된 작품의 연결 응답이 일치하지 않습니다."
        );
      }
      return toPublicRoom(room);
    },
  });
}

const defaultClient = createCreatorDraftCollaborationClient();

export function provisionCreatorDraftCollaborationRoom(
  request: StudioDraftCollaborationProvisionRequest,
  options?: CreatorDraftCollaborationRequestOptions
): Promise<CreatorDraftCollaborationRoomResponse> {
  return defaultClient.provision(request, options);
}

export function promoteCreatorDraftCollaborationRoom(
  request: StudioDraftCollaborationPromotionRequest,
  options?: CreatorDraftCollaborationRequestOptions
): Promise<CreatorDraftCollaborationRoomResponse> {
  return defaultClient.promote(request, options);
}
