import { createHmac } from "node:crypto";

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { z } from "zod";

import { rateLimit } from "../../../../web/src/shared/lib/rate-limit";
import {
  StudioVoiceIcePolicyResponseSchema,
  StudioVoiceIceUrlSchema,
  type StudioVoiceIcePolicyResponse,
} from "../../../../web/src/shared/lib/studio-voice-ice-policy-contract";

import { CreatorService } from "./creator.service";

const STUDIO_VOICE_TURN_DEFAULT_TTL_SECONDS = 900;
const STUDIO_VOICE_TURN_MIN_TTL_SECONDS = 300;
const STUDIO_VOICE_TURN_MAX_TTL_SECONDS = 86_400;
const STUDIO_VOICE_ICE_MAX_URLS_PER_KIND = 8;

const OptionalEnvironmentStringSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim().length > 0 ? value : undefined,
  z.string().optional()
);

const StudioVoiceIceEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    STUDIO_VOICE_STUN_URLS: OptionalEnvironmentStringSchema,
    STUDIO_VOICE_TURN_URLS: OptionalEnvironmentStringSchema,
    STUDIO_VOICE_TURN_SHARED_SECRET: OptionalEnvironmentStringSchema,
    STUDIO_VOICE_TURN_REQUIRED: z.preprocess(
      (value) => typeof value === "string" ? value.trim().toLowerCase() : value,
      z.enum(["true", "false"]).default("false")
    ),
    STUDIO_VOICE_TURN_TTL_SECONDS: z.preprocess(
      (value) => typeof value === "string" && value.trim().length === 0 ? undefined : value,
      z.coerce
        .number()
        .int()
        .min(STUDIO_VOICE_TURN_MIN_TTL_SECONDS)
        .max(STUDIO_VOICE_TURN_MAX_TTL_SECONDS)
        .default(STUDIO_VOICE_TURN_DEFAULT_TTL_SECONDS)
    ),
  })
  .strict()
  .superRefine((environment, context) => {
    const hasTurnUrls = environment.STUDIO_VOICE_TURN_URLS !== undefined;
    const hasTurnSecret = environment.STUDIO_VOICE_TURN_SHARED_SECRET !== undefined;
    if (hasTurnUrls !== hasTurnSecret) {
      context.addIssue({
        code: "custom",
        message: "STUDIO_VOICE_TURN_URLS와 STUDIO_VOICE_TURN_SHARED_SECRET은 함께 설정해야 합니다.",
      });
    }
    if (
      environment.STUDIO_VOICE_TURN_SHARED_SECRET !== undefined &&
      environment.STUDIO_VOICE_TURN_SHARED_SECRET.length < 32
    ) {
      context.addIssue({
        code: "custom",
        path: ["STUDIO_VOICE_TURN_SHARED_SECRET"],
        message: "TURN 공유 비밀은 최소 32자여야 합니다.",
      });
    }
    if (environment.STUDIO_VOICE_TURN_REQUIRED === "true" && !hasTurnUrls) {
      context.addIssue({
        code: "custom",
        path: ["STUDIO_VOICE_TURN_REQUIRED"],
        message: "상용 TURN 필수 모드에서는 TURN 주소와 공유 비밀을 반드시 설정해야 합니다.",
      });
    }
  });

export interface StudioVoiceIceConfiguration {
  stunUrls: readonly string[];
  turnUrls: readonly string[];
  turnSharedSecret: string | null;
  turnTtlSeconds: number;
  turnRequired: boolean;
  production: boolean;
}

export const STUDIO_VOICE_ICE_CONFIGURATION = Symbol(
  "STUDIO_VOICE_ICE_CONFIGURATION"
);

function parseIceUrls(
  value: string | undefined,
  expectedKind: "stun" | "turn"
): readonly string[] {
  if (!value) return [];
  const urls = [...new Set(value.split(/[\s,]+/u).map((url) => url.trim()).filter(Boolean))];
  if (urls.length > STUDIO_VOICE_ICE_MAX_URLS_PER_KIND) {
    throw new Error(`Studio ${expectedKind.toUpperCase()} 주소는 최대 ${STUDIO_VOICE_ICE_MAX_URLS_PER_KIND}개까지 설정할 수 있습니다.`);
  }
  for (const url of urls) {
    StudioVoiceIceUrlSchema.parse(url);
    const pattern = expectedKind === "stun" ? /^(?:stun|stuns):/i : /^(?:turn|turns):/i;
    if (!pattern.test(url)) {
      throw new Error(`STUDIO_VOICE_${expectedKind.toUpperCase()}_URLS에 ${expectedKind}: 계열이 아닌 주소가 포함되어 있습니다.`);
    }
  }
  return Object.freeze(urls);
}

export function resolveStudioVoiceIceConfiguration(
  environment: NodeJS.ProcessEnv
): StudioVoiceIceConfiguration {
  const parsed = StudioVoiceIceEnvironmentSchema.parse({
    NODE_ENV: environment.NODE_ENV,
    STUDIO_VOICE_STUN_URLS: environment.STUDIO_VOICE_STUN_URLS,
    STUDIO_VOICE_TURN_URLS: environment.STUDIO_VOICE_TURN_URLS,
    STUDIO_VOICE_TURN_SHARED_SECRET: environment.STUDIO_VOICE_TURN_SHARED_SECRET,
    STUDIO_VOICE_TURN_REQUIRED: environment.STUDIO_VOICE_TURN_REQUIRED,
    STUDIO_VOICE_TURN_TTL_SECONDS: environment.STUDIO_VOICE_TURN_TTL_SECONDS,
  });
  const turnUrls = parseIceUrls(parsed.STUDIO_VOICE_TURN_URLS, "turn");
  if (parsed.STUDIO_VOICE_TURN_REQUIRED === "true") {
    const hasUdpPath = turnUrls.some(
      (url) => /^turn:/iu.test(url) && !/\?transport=tcp$/iu.test(url)
    );
    const hasTcpOrTlsPath = turnUrls.some(
      (url) => /^turns:/iu.test(url) || /\?transport=tcp$/iu.test(url)
    );
    if (!hasUdpPath || !hasTcpOrTlsPath) {
      throw new Error(
        "상용 TURN 필수 모드에는 UDP 경로와 TCP/TLS 경로가 모두 필요합니다."
      );
    }
  }
  return Object.freeze({
    stunUrls: parseIceUrls(parsed.STUDIO_VOICE_STUN_URLS, "stun"),
    turnUrls,
    turnSharedSecret: parsed.STUDIO_VOICE_TURN_SHARED_SECRET ?? null,
    turnTtlSeconds: parsed.STUDIO_VOICE_TURN_TTL_SECONDS,
    turnRequired: parsed.STUDIO_VOICE_TURN_REQUIRED === "true",
    production: parsed.NODE_ENV === "production",
  });
}

export function issueStudioVoiceIcePolicy(options: {
  configuration: StudioVoiceIceConfiguration;
  userId: string;
  workId: string;
  nowMs?: number;
}): StudioVoiceIcePolicyResponse {
  const { configuration, userId, workId } = options;
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new Error("TURN 자격 증명 발급 시각이 올바르지 않습니다.");
  }

  const iceServers: StudioVoiceIcePolicyResponse["iceServers"] = [];
  const issuedAtSeconds = Math.floor(nowMs / 1_000);
  const issuedAt = new Date(issuedAtSeconds * 1_000).toISOString();
  if (configuration.stunUrls.length > 0) {
    iceServers.push({ urls: [...configuration.stunUrls] });
  }

  if (configuration.turnUrls.length === 0 || !configuration.turnSharedSecret) {
    return StudioVoiceIcePolicyResponseSchema.parse({
      version: 1,
      mode: configuration.stunUrls.length > 0 ? "stun" : "direct",
      iceServers,
      issuedAt,
      expiresAt: null,
      ttlSeconds: 0,
    });
  }

  const expiresAtSeconds = issuedAtSeconds + configuration.turnTtlSeconds;
  const opaqueIdentity = createHmac("sha256", configuration.turnSharedSecret)
    .update("toonspectrum-studio-voice-identity-v1\0")
    .update(workId)
    .update("\0")
    .update(userId)
    .digest("base64url")
    .slice(0, 32);
  const username = `${expiresAtSeconds}:${opaqueIdentity}`;
  const credential = createHmac("sha1", configuration.turnSharedSecret)
    .update(username)
    .digest("base64");
  iceServers.push({
    urls: [...configuration.turnUrls],
    username,
    credential,
    credentialType: "password",
  });

  return StudioVoiceIcePolicyResponseSchema.parse({
    version: 1,
    mode: "turn",
    iceServers,
    issuedAt,
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    ttlSeconds: configuration.turnTtlSeconds,
  });
}

@Injectable()
export class StudioVoiceIcePolicyService {
  constructor(
    @Inject(CreatorService)
    private readonly creatorService: CreatorService,
    @Inject(STUDIO_VOICE_ICE_CONFIGURATION)
    private readonly configuration: StudioVoiceIceConfiguration
  ) {}

  async issueScreenShare(
    userId: string,
    workId: string
  ): Promise<StudioVoiceIcePolicyResponse> {
    if (
      !rateLimit(`studio-screen-ice:user:${userId}`, 60, 60 * 60_000) ||
      !rateLimit(`studio-screen-ice:work:${userId}:${workId}`, 12, 60_000)
    ) {
      throw new HttpException(
        "화면 공유 연결 설정 요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.",
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    const team = await this.creatorService.getWorkTeam(userId, workId);
    if (
      team.workId !== workId ||
      team.viewer.userId !== userId ||
      team.viewer.status !== "active" ||
      !team.viewer.capabilities.view
    ) {
      throw new ForbiddenException("이 작품의 화면 공유를 볼 권한이 없습니다.");
    }
    return issueStudioVoiceIcePolicy({
      configuration: this.configuration,
      userId,
      workId,
    });
  }
}

export const studioVoiceIceConfigurationProvider = {
  provide: STUDIO_VOICE_ICE_CONFIGURATION,
  useFactory: (): StudioVoiceIceConfiguration =>
    resolveStudioVoiceIceConfiguration(process.env),
};
