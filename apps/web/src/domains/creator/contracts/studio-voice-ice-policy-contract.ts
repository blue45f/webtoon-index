import { z } from "zod";

const STUDIO_VOICE_ICE_URL_MAX_LENGTH = 2_048;
const STUDIO_VOICE_ICE_SERVER_MAX_URLS = 8;
const STUDIO_VOICE_ICE_POLICY_MAX_SERVERS = 4;
const STUDIO_VOICE_ICE_URL_PATTERN =
  /^(stun|stuns|turn|turns):(?:\[[0-9a-f:.]+\]|(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?))(?::([1-9]\d{0,4}))?(?:\?transport=(udp|tcp))?$/iu;

function studioVoiceIceUrlParts(value: string): {
  scheme: "stun" | "stuns" | "turn" | "turns";
  port: number | null;
  transport: "udp" | "tcp" | null;
} | null {
  const match = STUDIO_VOICE_ICE_URL_PATTERN.exec(value);
  if (!match) return null;
  const scheme = match[1]?.toLowerCase() as
    | "stun"
    | "stuns"
    | "turn"
    | "turns";
  const port = match[2] ? Number(match[2]) : null;
  const transport = match[3]?.toLowerCase() as "udp" | "tcp" | undefined;
  if (port !== null && port > 65_535) return null;
  if ((scheme === "stuns" || scheme === "turns") && transport === "udp") {
    return null;
  }
  return { scheme, port, transport: transport ?? null };
}

export const StudioVoiceIceUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(STUDIO_VOICE_ICE_URL_MAX_LENGTH)
  .refine(
    (value) => studioVoiceIceUrlParts(value) !== null,
    "음성 연결 서버 주소는 사용자 정보나 임의 쿼리 없이 유효한 stun:, stuns:, turn:, turns: 형식이어야 합니다."
  );

export const StudioVoiceIceServerSchema = z
  .object({
    urls: z.array(StudioVoiceIceUrlSchema).min(1).max(STUDIO_VOICE_ICE_SERVER_MAX_URLS),
    username: z.string().min(1).max(512).optional(),
    credential: z.string().min(1).max(2_048).optional(),
    credentialType: z.literal("password").optional(),
  })
  .strict()
  .superRefine((server, context) => {
    const hasUsername = server.username !== undefined;
    const hasCredential = server.credential !== undefined;
    const hasCredentialType = server.credentialType !== undefined;
    const hasTurnUrl = server.urls.some((url) => /^(?:turn|turns):/i.test(url));
    const hasStunUrl = server.urls.some((url) => /^(?:stun|stuns):/i.test(url));
    if (hasUsername !== hasCredential || hasCredential !== hasCredentialType) {
      context.addIssue({
        code: "custom",
        message: "TURN 사용자 이름, 자격 증명, 자격 증명 형식은 함께 제공되어야 합니다.",
      });
    }
    if ((hasUsername || hasCredential || hasCredentialType) && !hasTurnUrl) {
      context.addIssue({
        code: "custom",
        message: "TURN 자격 증명은 turn: 또는 turns: 주소에만 사용할 수 있습니다.",
      });
    }
    if (hasTurnUrl && !(hasUsername && hasCredential && hasCredentialType)) {
      context.addIssue({
        code: "custom",
        message: "TURN 주소에는 완전한 단기 자격 증명이 필요합니다.",
      });
    }
    if (hasTurnUrl && hasStunUrl) {
      context.addIssue({
        code: "custom",
        message: "STUN과 TURN 주소는 별도 서버 항목으로 제공해야 합니다.",
      });
    }
  });

export const StudioVoiceIcePolicyResponseSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(["direct", "stun", "turn"]),
    iceServers: z.array(StudioVoiceIceServerSchema).max(STUDIO_VOICE_ICE_POLICY_MAX_SERVERS),
    issuedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    ttlSeconds: z.number().int().min(0).max(86_400),
  })
  .strict()
  .superRefine((policy, context) => {
    const allUrls = policy.iceServers.flatMap((server) => server.urls);
    const hasStunUrl = allUrls.some((url) => /^(?:stun|stuns):/i.test(url));
    const hasCredentialedTurn = policy.iceServers.some(
      (server) =>
        server.username !== undefined &&
        server.credential !== undefined &&
        server.urls.some((url) => /^(?:turn|turns):/i.test(url))
    );

    if (policy.mode === "direct") {
      if (policy.iceServers.length > 0 || policy.expiresAt !== null || policy.ttlSeconds !== 0) {
        context.addIssue({
          code: "custom",
          message: "직접 연결 정책은 외부 서버나 만료 자격 증명을 포함할 수 없습니다.",
        });
      }
      return;
    }

    if (policy.mode === "stun") {
      const onlyStunUrls = allUrls.every((url) => /^(?:stun|stuns):/i.test(url));
      if (
        !hasStunUrl ||
        !onlyStunUrls ||
        hasCredentialedTurn ||
        policy.expiresAt !== null ||
        policy.ttlSeconds !== 0
      ) {
        context.addIssue({
          code: "custom",
          message: "STUN 정책은 자격 증명 없는 STUN 주소만 포함해야 합니다.",
        });
      }
      return;
    }

    if (!hasCredentialedTurn || policy.expiresAt === null || policy.ttlSeconds < 1) {
      context.addIssue({
        code: "custom",
        message: "TURN 정책에는 만료되는 TURN 자격 증명이 필요합니다.",
      });
      return;
    }
    const issuedAt = Date.parse(policy.issuedAt);
    const expiresAt = Date.parse(policy.expiresAt);
    if (expiresAt <= issuedAt || expiresAt - issuedAt !== policy.ttlSeconds * 1_000) {
      context.addIssue({
        code: "custom",
        message: "TURN 정책의 발급 시각, 만료 시각, TTL이 서로 일치해야 합니다.",
      });
    }
  });

export type StudioVoiceIceServer = z.infer<typeof StudioVoiceIceServerSchema>;
export type StudioVoiceIcePolicyResponse = z.infer<
  typeof StudioVoiceIcePolicyResponseSchema
>;
export type StudioVoiceIcePolicyMode = StudioVoiceIcePolicyResponse["mode"];
