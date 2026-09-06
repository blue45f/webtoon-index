import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import { hashPassword, verifyPassword } from "../../../../web/src/shared/lib/auth-crypto";
import {
  resolveSignupAvatar,
  resolveSignupAvatarImage,
} from "../../../../web/src/shared/lib/avatar";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { db, users } from "../../db";
import { StudioRealtimeRevocationService } from "../../infrastructure/studio-realtime-revocation/studio-realtime-revocation.client";
import {
  UPSTASH_COORDINATION_PORT,
  type UpstashCoordinationPort,
} from "../../infrastructure/upstash-coordination/upstash-coordination.port";
import { resolveEffectiveAdminRole } from "../../server/admin-emails";
import { getAppConfig } from "../../server/app-config";
import {
  buildAuthorizeUrl,
  consumeHandoff,
  createDemoUser,
  GoogleAuthConfigurationError,
  GoogleAuthCredentialError,
  handleGoogleIdToken,
  handleOAuthCallback,
  isAuthorizationCodeFlowConfigured,
  isOAuthProvider,
  issueState,
  listAuthProviders,
  OAuthAccountBlockedError,
  providerMode,
  verifyState,
  webAppBaseUrl,
} from "../../server/oauth";
import {
  signSession,
  verifySessionToken,
} from "../../server/session";
import {
  ensureUserLifecycleSchema,
  getUserAuthBlock,
  normalizeSessionVersion,
  revokeUserSessions,
} from "../../server/user-lifecycle";
import {
  AUTH_SESSION_COOKIE_NAME,
  resolveSessionCookieValue,
  resolveSessionCookieClearOptions,
  resolveSessionCookieOptions,
} from "../../session-cookie";

import { AuthClientIpPolicy, resolveAuthClientIp } from "./auth-client-ip";
import { isAllowedAuthRequestOrigin } from "./auth-origin";
import {
  AUTH_RATE_LIMIT_POLICIES,
  AUTH_RATE_LIMIT_WINDOW_MS,
  createAuthRateLimitSubjectFingerprint,
  LocalAuthRateLimiter,
  type AuthRateLimitAction,
} from "./auth-rate-limit";
import {
  AuthRateLimitDependencyError,
  type AuthRateLimitConfig,
} from "./auth-rate-limit.config";
import { resolveAuthSessionUser } from "./auth-session-profile";
import { GoogleIdTokenDto, type AuthSessionResponse } from "./auth.dto";
import { AUTH_CLIENT_IP_POLICY, AUTH_RATE_LIMIT_CONFIG } from "./auth.tokens";

import type { Request, Response } from "express";

interface AuthPayload {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  avatar?: unknown;
  image?: unknown;
}

type AuthRole = "admin" | "creator" | "operator" | "user";
type AuthResponseUser = ReturnType<typeof authResponseUser>;
type AuthCompletionResponse = Readonly<{
  ok: true;
  user: AuthResponseUser;
  demo?: true;
}>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const AUTH_RATE_LIMIT_LOCAL_LIMITER = new LocalAuthRateLimiter();

@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly rateLimitDistributed: boolean;
  private readonly clientIpPolicy: AuthClientIpPolicy;
  private readonly coordination: UpstashCoordinationPort | null;

  constructor(
    @Inject(AUTH_RATE_LIMIT_CONFIG)
    rateLimitConfig: AuthRateLimitConfig,
    @Inject(AUTH_CLIENT_IP_POLICY)
    clientIpPolicy: AuthClientIpPolicy,
    @Inject(UPSTASH_COORDINATION_PORT)
    coordination: UpstashCoordinationPort | null,
    @Inject(StudioRealtimeRevocationService)
    private readonly realtimeRevocation: StudioRealtimeRevocationService =
      new StudioRealtimeRevocationService({ enabled: false }),
  ) {
    if (rateLimitConfig.distributed && !coordination) {
      throw new AuthRateLimitDependencyError();
    }
    this.rateLimitDistributed = rateLimitConfig.distributed;
    this.clientIpPolicy = clientIpPolicy;
    this.coordination = coordination;
  }

  @Get("providers")
  async getProviders() {
    const config = await getAppConfig();
    return listAuthProviders({
      kakao: config.authKakao,
      naver: config.authNaver,
    });
  }

  /**
   * Browser session truth source. `sessionAuth` has already verified the
   * HttpOnly cookie (or the temporary legacy header) and replaced x-user-id
   * with the canonical user id before this controller runs.
   */
  @Get("session")
  @Header("Cache-Control", "private, no-store, max-age=0")
  @Header("Pragma", "no-cache")
  async getSession(
    @Headers("x-user-id") userId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    if (!userId) {
      clearAuthSessionCookie(response);
      return { authenticated: false, user: null };
    }

    const user = await resolveAuthSessionUser(userId);
    if (!user) {
      clearAuthSessionCookie(response);
      return { authenticated: false, user: null };
    }
    return { authenticated: true, user };
  }

  // 실제 OAuth 시작 — 인가 URL로 리다이렉트(설정된 제공자만).
  @Get("oauth/:provider/start")
  oauthStart(@Param("provider") provider: string, @Res() res: Response) {
    if (!isOAuthProvider(provider))
      throw new BadRequestException({ error: "지원하지 않는 제공자예요." });
    if (providerMode(provider) === "demo") {
      // 카카오·네이버의 명시적 데모 제공자만 체험 흐름으로 보낸다.
      return res.redirect(`${webAppBaseUrl()}/auth/callback#demo=${provider}`);
    }
    // Google의 기본 GIS 흐름은 client ID만 사용한다. 레거시 redirect 경로가
    // 설정되지 않은 경우 state secret을 읽기 전에 안전하게 거부한다.
    if (!isAuthorizationCodeFlowConfigured(provider)) {
      throw new ServiceUnavailableException({
        error: "이 로그인 제공자의 리다이렉트 로그인이 설정되지 않았어요.",
      });
    }
    const url = buildAuthorizeUrl(provider, issueState(provider));
    if (!url) {
      throw new ServiceUnavailableException({
        error: "이 로그인 제공자의 리다이렉트 로그인이 설정되지 않았어요.",
      });
    }
    return res.redirect(url);
  }

  // 제공자 콜백 — code 교환 → 사용자 upsert → HttpOnly 세션 쿠키 발급 후 프론트 복귀.
  // Vercel serverless 인스턴스 사이에는 프로세스 로컬 Map이 공유되지 않으므로, 이 경로는
  // 핸드오프 토큰을 사용하지 않는다. URL fragment에는 PII나 세션 자격 증명을 넣지 않는다.
  @Get("oauth/:provider/callback")
  async oauthCallback(
    @Param("provider") provider: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const web = webAppBaseUrl();
    if (!isOAuthProvider(provider))
      return res.redirect(`${web}/auth/callback#error=unsupported`);
    if (error)
      return res.redirect(
        `${web}/auth/callback#error=${encodeURIComponent(error)}`,
      );
    if (!isAuthorizationCodeFlowConfigured(provider)) {
      return res.redirect(`${web}/auth/callback#error=oauth_unavailable`);
    }
    if (!verifyState(provider, state))
      return res.redirect(`${web}/auth/callback#error=bad_state`);
    if (!code) return res.redirect(`${web}/auth/callback#error=no_code`);
    try {
      const user = await handleOAuthCallback(provider, code);
      const token = signSession(
        user.id,
        normalizeSessionVersion(user.sessionVersion),
      );
      applyAuthSessionCookie(res, token);
      return res.redirect(`${web}/auth/callback#session=1`);
    } catch {
      this.logOAuthFailure(
        "authorization-code",
        provider,
        "authorization-code-processing-failed",
      );
      return res.redirect(`${web}/auth/callback#error=oauth_failed`);
    }
  }

  // GIS(Google Identity Services) ID 토큰 로그인 — 프론트 GIS 버튼이 받은 ID 토큰을 서버 검증.
  // 인가-코드/리다이렉트 없이 직접 세션을 발급한다(서명·aud·iss·exp 는 google-auth-library 가 검증).
  @Post("oauth/google/id-token")
  async oauthGoogleIdToken(
    @Body(new ZodValidationPipe(GoogleIdTokenDto)) body: GoogleIdTokenDto,
    @Headers("origin") origin: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthCompletionResponse> {
    if (!isAllowedAuthRequestOrigin(origin)) {
      throw new ForbiddenException({
        error: "허용되지 않은 사이트에서 보낸 로그인 요청이에요.",
      });
    }
    await this.enforceRateLimit("oauth-google-idtoken", req);
    let user;
    try {
      user = await handleGoogleIdToken(body.idToken);
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      if (err instanceof GoogleAuthConfigurationError) {
        throw new ServiceUnavailableException({
          error: "Google 로그인이 아직 설정되지 않았어요.",
        });
      }
      if (err instanceof GoogleAuthCredentialError) {
        throw new UnauthorizedException({
          error: "Google 로그인 정보가 만료되었거나 올바르지 않아요. 다시 시도해 주세요.",
        });
      }
      if (err instanceof OAuthAccountBlockedError) {
        throw new ForbiddenException({ error: err.publicMessage });
      }
      // DB·외부 라이브러리의 내부 오류 메시지나 자격 증명 세부정보는 응답에 노출하지 않는다.
      this.logOAuthFailure(
        "google-id-token",
        "google",
        "google-id-token-persistence-failed",
      );
      throw new ServiceUnavailableException({
        error: "Google 로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    }
    const token = signSession(user.id, normalizeSessionVersion(user.sessionVersion));
    applyAuthSessionCookie(response, token);
    return {
      ok: true,
      user: authResponseUser(user),
    };
  }

  /**
   * Keep production OAuth failures diagnosable without logging authorization
   * codes, ID tokens, provider payloads, email addresses, or database details.
   */
  private logOAuthFailure(
    flow: "authorization-code" | "google-id-token",
    provider: string,
    reasonCode:
      | "authorization-code-processing-failed"
      | "google-id-token-persistence-failed",
  ): void {
    this.logger.error({
      event: "auth.oauth.failure",
      flow,
      provider: provider.slice(0, 24),
      reasonCode,
    });
  }

  // 핸드오프 토큰 → HttpOnly 쿠키 세션 + 공개 사용자 객체. 핸드오프는 1회용이다.
  @Post("oauth/exchange")
  oauthExchange(
    @Body() body: { token?: unknown },
    @Res({ passthrough: true }) response: Response,
  ): AuthCompletionResponse {
    const user = consumeHandoff(
      typeof body?.token === "string" ? body.token : undefined,
    );
    if (!user)
      throw new HttpException(
        { error: "만료되었거나 잘못된 로그인 토큰이에요." },
        HttpStatus.UNAUTHORIZED,
      );
    const token = signSession(user.id, normalizeSessionVersion(user.sessionVersion));
    applyAuthSessionCookie(response, token);
    return {
      ok: true,
      user: authResponseUser(user),
    };
  }

  // 데모 폴백 로그인 — 실제 제공자 미설정 시에만 허용. 명확히 [데모] 사용자.
  @Post("oauth/:provider/demo")
  async oauthDemo(
    @Param("provider") provider: string,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthCompletionResponse> {
    if (!isOAuthProvider(provider))
      throw new BadRequestException({ error: "지원하지 않는 제공자예요." });
    const mode = providerMode(provider);
    if (mode === "disabled") {
      throw new ServiceUnavailableException({
        error: "이 로그인 제공자의 설정이 완료되지 않았어요.",
      });
    }
    if (mode !== "demo") {
      throw new HttpException(
        { error: "이 제공자는 실제 OAuth가 설정되어 데모를 쓸 수 없어요." },
        HttpStatus.CONFLICT,
      );
    }
    await this.enforceRateLimit("oauth-demo", req);
    const user = await createDemoUser(provider);
    const token = signSession(user.id, normalizeSessionVersion(user.sessionVersion));
    applyAuthSessionCookie(response, token);
    return {
      ok: true,
      user: authResponseUser(user),
      demo: true,
    };
  }

  @Post("signup")
  async signup(
    @Body() body: AuthPayload,
    @Req() req: Request,
  ) {
    await this.enforceRateLimit("signup", req);
    await ensureUserLifecycleSchema();

    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const name = String(body.name ?? "").trim() || email.split("@")[0];
    const avatar = resolveSignupAvatar(body.avatar);
    const image = resolveSignupAvatarImage(body.image);

    if (!EMAIL_RE.test(email))
      throw new BadRequestException({
        error: "이메일 형식이 올바르지 않아요.",
      });
    if (password.length < 6)
      throw new BadRequestException({
        error: "비밀번호는 6자 이상이어야 해요.",
      });

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing) {
      throw new HttpException(
        { error: "이미 가입된 이메일이에요." },
        HttpStatus.CONFLICT,
      );
    }

    await db
      .insert(users)
      .values({
        email,
        name,
        image,
        avatar,
        passwordHash: hashPassword(password),
      });
    return { ok: true };
  }

  @Post("login")
  async login(
    @Body() body: AuthPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthCompletionResponse> {
    await this.enforceRateLimit("login", req);
    await ensureUserLifecycleSchema();

    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    if (!email || !password)
      throw new BadRequestException({
        error: "이메일 또는 비밀번호를 확인해 주세요.",
      });

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpException(
        { error: "이메일 또는 비밀번호를 확인해 주세요." },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const block = getUserAuthBlock(user);
    if (block) throw new HttpException({ error: block }, HttpStatus.FORBIDDEN);

    const token = signSession(user.id, normalizeSessionVersion(user.sessionVersion));
    applyAuthSessionCookie(response, token);

    return {
      ok: true,
      user: authResponseUser(user),
    };
  }

  @Post("logout")
  async logout(
    @Headers("x-user-id") userId: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const signedCookiePrincipal = verifySessionToken(
      resolveSessionCookieValue(request.headers.cookie),
    );
    const actorId = userId ?? signedCookiePrincipal?.userId;
    if (!actorId) {
      clearAuthSessionCookie(response);
      return { ok: true };
    }
    try {
      const revoked = await revokeUserSessions(actorId);
      if (!revoked.ok || revoked.sessionVersion === null) {
        throw new Error("session revocation did not advance");
      }
      await this.realtimeRevocation.revokeSessionVersion(
        actorId,
        revoked.sessionVersion,
      );
      clearAuthSessionCookie(response);
      return { ok: true };
    } catch {
      // Keep the signed cookie on a failed durable revocation. Even if its DB
      // session version has already advanced, the next /logout request may
      // safely recover its actor id solely to retry closing realtime sockets.
      throw new ServiceUnavailableException({
        error: "로그아웃 세션 정리를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    }
  }

  private async enforceRateLimit(
    action: AuthRateLimitAction,
    req: Request,
  ): Promise<void> {
    const policy = AUTH_RATE_LIMIT_POLICIES[action];
    const sourceIp = resolveAuthClientIp(req, this.clientIpPolicy);
    const identity = `${action}:${sourceIp}`;

    if (!this.rateLimitDistributed) {
      const decision = AUTH_RATE_LIMIT_LOCAL_LIMITER.consume(
        identity,
        policy.limit,
        AUTH_RATE_LIMIT_WINDOW_MS,
      );
      if (decision.status === "rate-limited") throw authRateLimitExceeded();
      if (decision.status === "saturated") {
        throw new ServiceUnavailableException({
          error: "인증 요청 한도 검증 용량이 일시적으로 부족합니다.",
        });
      }
      return;
    }

    if (!this.coordination) {
      throw new ServiceUnavailableException({
        error: "인증 요청 한도 검증 인프라가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
      });
    }

    try {
      const decision = await this.coordination.consumeRateLimit({
        scope: "auth",
        subjectFingerprint: createAuthRateLimitSubjectFingerprint(
          action,
          sourceIp,
        ),
        maximumRequests: policy.limit,
        windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
      });
      if (!decision.accepted) throw authRateLimitExceeded();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        error: "인증 요청 한도 검증 인프라가 일시적으로 응답하지 않습니다.",
      });
    }
  }
}

function normalizeEmail(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

function applyAuthSessionCookie(response: Response, token: string): void {
  response.cookie(
    AUTH_SESSION_COOKIE_NAME,
    token,
    resolveSessionCookieOptions(),
  );
}

function clearAuthSessionCookie(response: Response): void {
  response.clearCookie(
    AUTH_SESSION_COOKIE_NAME,
    resolveSessionCookieClearOptions(),
  );
}

function normalizeRole(value: string | null | undefined): AuthRole {
  const role = String(value ?? "").toLowerCase();
  if (role === "admin" || role === "creator" || role === "operator")
    return role;
  return "user";
}

export function authResponseUser(user: {
  readonly id: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly image?: string | null;
  readonly role?: string | null;
}) {
  // 로그인 직후 응답에도 ADMIN_EMAILS 화이트리스트를 반영한다.
  // (resolveAuthSessionUser 와 동일 규칙 — 메뉴가 role===admin 만으로도 열리게)
  const email = user.email ?? null;
  return {
    id: user.id,
    name: user.name ?? null,
    email,
    image: user.image ?? null,
    role: resolveEffectiveAdminRole(normalizeRole(user.role), email),
  };
}

function authRateLimitExceeded(): HttpException {
  return new HttpException(
    { error: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
