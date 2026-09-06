import { createHash } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";

import { rateLimit } from "../../../../web/src/shared/lib/rate-limit";
import {
  STUDIO_REMOTE_REFERENCE_IMAGE_CONTRACT_VERSION,
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES,
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_REDIRECTS,
  STUDIO_REMOTE_REFERENCE_IMAGE_TIMEOUT_MS,
  StudioRemoteReferenceImageMediaTypeSchema,
  StudioRemoteReferenceImageResponseSchema,
} from "../../../../web/src/shared/lib/studio-remote-reference-image-contract";

import {
  inspectStudioRemoteReferenceImage,
  StudioRemoteReferenceImageFormatError,
} from "./studio-remote-reference-image-format";
import {
  parseStudioRemoteReferenceUrl,
  resolveStudioRemoteReferenceEndpoint,
  STUDIO_REMOTE_REFERENCE_DNS_RESOLVER,
  STUDIO_REMOTE_REFERENCE_HTTP_REQUESTER,
  StudioRemoteReferenceNetworkError,
  StudioRemoteReferenceNetworkPolicyError,
} from "./studio-remote-reference-image.network";

import type {
  StudioRemoteReferenceDnsResolver,
  StudioRemoteReferenceHttpRequester,
  StudioRemoteReferenceHttpResponse,
} from "./studio-remote-reference-image.network";
import type {
  StudioRemoteReferenceImageMediaType,
  StudioRemoteReferenceImageResponse,
} from "../../../../web/src/shared/lib/studio-remote-reference-image-contract";

const REMOTE_REFERENCE_RATE_LIMIT_WINDOW_MS = 60_000;
const REMOTE_REFERENCE_RATE_LIMIT_REQUESTS = 20;
// This cap protects DNS/upstream fetch/stream inspection only. The controller acquires a separate
// delivery lease before calling this service and retains it through Express finish/close so slow
// base64 JSON readers cannot escape the fetch-phase accounting.
const REMOTE_REFERENCE_MAX_CONCURRENT_PER_USER = 2;
const REMOTE_REFERENCE_MAX_CONCURRENT_GLOBAL = 8;
const CLIENT_CLOSED_REQUEST_STATUS = 499;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

type RequestAbortSource = "client" | "timeout" | null;

function safeSingleHeader(
  response: StudioRemoteReferenceHttpResponse,
  name: string
): string | undefined {
  const value = response.headers[name];
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  throw new StudioRemoteReferenceNetworkError("ambiguous_response_header");
}

function declaredContentLength(response: StudioRemoteReferenceHttpResponse): number | null {
  const raw = safeSingleHeader(response, "content-length");
  if (raw === undefined) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new StudioRemoteReferenceNetworkError("invalid_content_length");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new StudioRemoteReferenceNetworkError("invalid_content_length");
  }
  if (value > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES) {
    throw new PayloadTooLargeException("원격 참고 이미지는 3MB 이하만 가져올 수 있습니다.");
  }
  if (value < 1) throw new StudioRemoteReferenceNetworkError("empty_response");
  return value;
}

function declaredImageMediaType(
  response: StudioRemoteReferenceHttpResponse
): StudioRemoteReferenceImageMediaType {
  const contentEncoding = safeSingleHeader(response, "content-encoding")
    ?.trim()
    .toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    throw new UnsupportedMediaTypeException(
      "압축 전송된 원격 이미지는 안전하게 검사할 수 없습니다."
    );
  }
  const raw = safeSingleHeader(response, "content-type");
  const mediaType = raw?.split(";", 1)[0]?.trim().toLowerCase();
  const parsed = StudioRemoteReferenceImageMediaTypeSchema.safeParse(mediaType);
  if (!parsed.success) {
    throw new UnsupportedMediaTypeException(
      "원격 주소가 PNG, JPG, WebP 또는 GIF 이미지로 응답하지 않았습니다."
    );
  }
  return parsed.data;
}

async function readBoundedResponseBody(
  response: StudioRemoteReferenceHttpResponse,
  expectedLength: number | null
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  try {
    for await (const chunk of response.body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new StudioRemoteReferenceNetworkError("invalid_response_chunk");
      }
      if (chunk.byteLength === 0) continue;
      if (chunk.byteLength > STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES - byteLength) {
        throw new PayloadTooLargeException(
          "원격 참고 이미지는 3MB 이하만 가져올 수 있습니다."
        );
      }
      chunks.push(Buffer.from(chunk));
      byteLength += chunk.byteLength;
    }
  } catch (error) {
    response.cancel();
    throw error;
  }

  if (byteLength < 1) throw new StudioRemoteReferenceNetworkError("empty_response");
  if (expectedLength !== null && expectedLength !== byteLength) {
    throw new StudioRemoteReferenceNetworkError("content_length_mismatch");
  }
  return Buffer.concat(chunks, byteLength);
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

@Injectable()
export class StudioRemoteReferenceImageService {
  private activeGlobal = 0;
  private readonly activeByUser = new Map<string, number>();

  constructor(
    @Inject(STUDIO_REMOTE_REFERENCE_DNS_RESOLVER)
    private readonly dnsResolver: StudioRemoteReferenceDnsResolver,
    @Inject(STUDIO_REMOTE_REFERENCE_HTTP_REQUESTER)
    private readonly httpRequester: StudioRemoteReferenceHttpRequester
  ) {}

  async importRemoteImage(
    userId: string,
    sourceUrl: string,
    clientSignal?: AbortSignal
  ): Promise<StudioRemoteReferenceImageResponse> {
    if (!userId) throw new BadRequestException("로그인 사용자 정보를 확인할 수 없습니다.");
    if (!rateLimit(
      `creator-remote-reference:${userId}`,
      REMOTE_REFERENCE_RATE_LIMIT_REQUESTS,
      REMOTE_REFERENCE_RATE_LIMIT_WINDOW_MS
    )) {
      throw new HttpException(
        {
          code: "creator_remote_reference_rate_limited",
          message: "원격 참고 이미지 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    this.acquireConcurrency(userId);

    const operationController = new AbortController();
    let abortSource: RequestAbortSource = null;
    const abortForClient = () => {
      abortSource ??= "client";
      operationController.abort(new Error("client disconnected"));
    };
    if (clientSignal?.aborted) abortForClient();
    else clientSignal?.addEventListener("abort", abortForClient, { once: true });
    const timeout = setTimeout(() => {
      abortSource ??= "timeout";
      operationController.abort(new Error("remote reference timeout"));
    }, STUDIO_REMOTE_REFERENCE_IMAGE_TIMEOUT_MS);
    timeout.unref?.();

    try {
      const { mediaType, payload, width, height, decodedRgbaBytes } =
        await this.fetchValidatedImage(sourceUrl, operationController.signal);
      const sha256 = createHash("sha256").update(payload).digest("hex");
      return StudioRemoteReferenceImageResponseSchema.parse({
        version: STUDIO_REMOTE_REFERENCE_IMAGE_CONTRACT_VERSION,
        mediaType,
        byteLength: payload.byteLength,
        width,
        height,
        decodedRgbaBytes,
        sha256,
        dataUrl: `data:${mediaType};base64,${Buffer.from(payload).toString("base64")}`,
      });
    } catch (error) {
      if (abortSource === "timeout") {
        throw new GatewayTimeoutException(
          "원격 참고 이미지를 가져오는 시간이 초과됐습니다."
        );
      }
      if (abortSource === "client") {
        throw new HttpException("원격 참고 이미지 요청 연결이 종료됐습니다.", CLIENT_CLOSED_REQUEST_STATUS);
      }
      if (error instanceof HttpException) throw error;
      if (error instanceof StudioRemoteReferenceNetworkPolicyError) {
        throw new BadRequestException(
          "공개 인터넷의 HTTP 또는 HTTPS 이미지 주소만 사용할 수 있습니다."
        );
      }
      if (error instanceof StudioRemoteReferenceImageFormatError) {
        if (
          error.code === "decoded_image_too_large" ||
          error.code === "gif_animation_too_large" ||
          error.code === "animation_too_large"
        ) {
          throw new PayloadTooLargeException(
            "이미지 해상도 또는 애니메이션 디코드 비용이 안전 한도를 넘었습니다."
          );
        }
        throw new UnsupportedMediaTypeException(
          "이미지 파일의 형식, MIME 또는 내부 크기 정보를 안전하게 확인하지 못했습니다."
        );
      }
      throw new BadGatewayException(
        "원격 이미지 서버의 응답을 안전하게 가져오지 못했습니다."
      );
    } finally {
      clearTimeout(timeout);
      clientSignal?.removeEventListener("abort", abortForClient);
      this.releaseConcurrency(userId);
    }
  }

  private acquireConcurrency(userId: string): void {
    const activeForUser = this.activeByUser.get(userId) ?? 0;
    if (
      this.activeGlobal >= REMOTE_REFERENCE_MAX_CONCURRENT_GLOBAL ||
      activeForUser >= REMOTE_REFERENCE_MAX_CONCURRENT_PER_USER
    ) {
      throw new HttpException(
        {
          code: "creator_remote_reference_busy",
          message: "처리 중인 원격 참고 이미지가 있습니다. 잠시 후 다시 시도해 주세요.",
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    this.activeGlobal += 1;
    this.activeByUser.set(userId, activeForUser + 1);
  }

  private releaseConcurrency(userId: string): void {
    this.activeGlobal = Math.max(0, this.activeGlobal - 1);
    const activeForUser = this.activeByUser.get(userId) ?? 0;
    if (activeForUser <= 1) this.activeByUser.delete(userId);
    else this.activeByUser.set(userId, activeForUser - 1);
  }

  private async fetchValidatedImage(
    sourceUrl: string,
    signal: AbortSignal
  ): Promise<{
    mediaType: StudioRemoteReferenceImageMediaType;
    payload: Uint8Array;
    width: number;
    height: number;
    decodedRgbaBytes: number;
  }> {
    let currentUrl = parseStudioRemoteReferenceUrl(sourceUrl);
    const visited = new Set<string>();

    for (let redirects = 0; ; redirects += 1) {
      if (visited.has(currentUrl.href)) {
        throw new StudioRemoteReferenceNetworkError("redirect_loop");
      }
      visited.add(currentUrl.href);

      const endpoint = await raceWithAbort(
        resolveStudioRemoteReferenceEndpoint(currentUrl, this.dnsResolver),
        signal
      );
      const response = await this.httpRequester.request({
        url: currentUrl,
        endpoint,
        signal,
      });

      if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
        response.cancel();
        if (redirects >= STUDIO_REMOTE_REFERENCE_IMAGE_MAX_REDIRECTS) {
          throw new StudioRemoteReferenceNetworkError("too_many_redirects");
        }
        const location = safeSingleHeader(response, "location");
        if (!location) throw new StudioRemoteReferenceNetworkError("redirect_without_location");
        let resolvedLocation: URL;
        try {
          resolvedLocation = new URL(location, currentUrl);
        } catch (error) {
          throw new StudioRemoteReferenceNetworkError("invalid_redirect", { cause: error });
        }
        const nextUrl = parseStudioRemoteReferenceUrl(resolvedLocation.href);
        if (currentUrl.protocol === "https:" && nextUrl.protocol !== "https:") {
          throw new StudioRemoteReferenceNetworkPolicyError("https_downgrade");
        }
        currentUrl = nextUrl;
        continue;
      }

      if (response.statusCode !== 200) {
        response.cancel();
        throw new StudioRemoteReferenceNetworkError("upstream_status");
      }
      try {
        const expectedLength = declaredContentLength(response);
        const mediaType = declaredImageMediaType(response);
        const payload = await readBoundedResponseBody(response, expectedLength);
        const metadata = inspectStudioRemoteReferenceImage(mediaType, payload);
        return { ...metadata, payload };
      } catch (error) {
        response.cancel();
        throw error;
      }
    }
  }
}
