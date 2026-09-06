import { zodResolver } from "@hookform/resolvers/zod";
import { X, LogIn, UserPlus, Sparkles, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";

import { ToonSpectrumMark } from "@/shared/components/visual-marks";

import {
  parseAuthProviderDiscovery,
  type AuthProviderDiscovery,
} from "./auth-provider-discovery";
import { GoogleIdentityButton } from "./google-identity-button";

import {
  AVATAR_PRESETS,
  MAX_AVATAR_IMAGE_BYTES,
  pickAvatarPreset,
  resolveSignupAvatar,
  resolveSignupAvatarImage,
} from "@/shared/lib/avatar";
import { withCsrfProtection } from "@/shared/lib/csrf";
import { cn } from "@/shared/lib/utils";
import { signIn } from "@/src/compat/auth-session-store";
import { apiPath } from "@/src/infrastructure/api";

// 실제 OAuth 미설정 시 데모 폴백임을 버튼에 명확히 표시(정직성).
function DemoTag({ dark }: { dark?: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide",
        dark ? "bg-[oklch(0.2_0.02_60/0.16)] text-on-accent" : "border border-line bg-raised text-fg-3"
      )}
    >
      데모
    </span>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const authSchema = z.object({
  email: z.string().trim().min(1, "이메일을 입력해 주세요.").email("이메일 형식을 확인해 주세요."),
  password: z.string().min(6, "비밀번호는 6자 이상이어야 해요."),
  name: z.string(),
  avatar: z.string(),
  image: z.string().nullable(),
});

type AuthFormValues = z.infer<typeof authSchema>;

export function AuthModal({
  onClose,
  returnFocusRef,
}: {
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [providers, setProviders] = useState<AuthProviderDiscovery>({});
  const [providerStatus, setProviderStatus] = useState<"loading" | "ready" | "error">("loading");
  const [providerAttempt, setProviderAttempt] = useState(0);
  const [err, setErr] = useState("");
  const [imageErr, setImageErr] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: "", password: "", name: "", avatar: AVATAR_PRESETS[1].id, image: null },
  });

  const [nameValue, emailValue, avatarValue, imageValue] = watch(["name", "email", "avatar", "image"]);
  const selectedPreset =
    AVATAR_PRESETS.find((preset) => preset.id === avatarValue || preset.color === avatarValue) ?? AVATAR_PRESETS[0];
  const selectedAvatarColor = resolveSignupAvatar(avatarValue);
  const avatarInitial = (nameValue.trim() || emailValue.trim() || "W").slice(0, 1).toUpperCase();
  const avatarBackground = `radial-gradient(circle at 32% 24%, ${selectedPreset.accent}, transparent 35%), linear-gradient(145deg, ${selectedAvatarColor}, oklch(0.26 0.04 60))`;

  // RHF의 register ref 와 포커스용 emailRef 를 함께 연결
  const emailField = register("email");

  useEffect(() => {
    const controller = new AbortController();
    setProviderStatus("loading");
    fetch(apiPath("/auth/providers"), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`provider discovery failed (${response.status})`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        setProviders(parseAuthProviderDiscovery(payload));
        setProviderStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProviders({});
        setProviderStatus("error");
      });
    return () => controller.abort();
  }, [providerAttempt]);

  // Escape 로 닫기 (키보드 접근성)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 포커스 트랩(Tab 순환을 다이얼로그 내부로 가둠) + 닫힐 때 호출 트리거로 포커스 복원.
  // prevActive 캡처는 포커스 이동보다 먼저여야 트리거(예: '로그인' 버튼)가 잡힌다.
  // (autoFocus는 commit 단계라 effect보다 먼저 실행돼 트리거 대신 입력을 캡처하므로 사용하지 않음)
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const explicitReturnTarget = returnFocusRef?.current;
    emailRef.current?.focus(); // 열릴 때 이메일로 포커스 이동
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      // 포커스가 패널 밖이면 무조건 첫 요소로 회수 (배경으로 탭 이탈 방지)
      if (!panelRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (explicitReturnTarget?.isConnected) {
        explicitReturnTarget.focus();
        return;
      }
      if (prevActive?.isConnected) prevActive.focus();
    };
  }, [returnFocusRef]);

  const submit = handleSubmit(async ({ email, password, name, avatar, image }) => {
    setErr("");
    try {
      if (mode === "signup") {
        const r = await fetch(apiPath("/auth/signup"), withCsrfProtection({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name, avatar, image }),
        }));
        if (!r.ok) {
          setErr((await r.json()).error ?? "가입 실패");
          return;
        }
      }
      const res = await signIn("credentials", { email, password, redirect: false });
      if (res?.error) {
        setErr("이메일 또는 비밀번호를 확인해 주세요.");
        return;
      }
      onClose();
    } catch {
      setErr("문제가 발생했어요. 다시 시도해 주세요.");
    }
  });

  const avatarImage = resolveSignupAvatarImage(imageValue);

  const onAvatarImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setImageErr("");
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setImageErr("PNG, JPG, WebP 이미지만 업로드할 수 있어요.");
      return;
    }

    if (file.size > MAX_AVATAR_IMAGE_BYTES) {
      setImageErr("이미지는 180KB 이하로 올려 주세요.");
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    const safeImage = resolveSignupAvatarImage(dataUrl);
    if (!safeImage) {
      setImageErr("이미지를 읽을 수 없어요. 다른 파일을 선택해 주세요.");
      return;
    }

    setValue("image", safeImage, { shouldDirty: true, shouldValidate: true });
  };

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-start justify-center overflow-hidden px-4 py-4 sm:pt-[12vh] sm:pb-6">
      <button
        type="button"
        aria-label="닫기"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[oklch(0.12_0.012_70/0.64)] backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "로그인" : "회원가입"}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-line-strong bg-panel shadow-2xl shadow-[oklch(0.1_0.02_70/0.5)] sm:max-h-[calc(100dvh-7rem)]"
        style={{ animation: "fade-up 0.22s var(--ease-out-expo)" }}
      >
        <button
          type="button"
          aria-label="로그인 창 닫기"
          onClick={onClose}
          className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-xl text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <X size={18} />
        </button>
        <div className="p-6">
          <div className="mb-1 flex items-center gap-2">
            <ToonSpectrumMark className="size-7 rounded-[0.55rem]" />
            <span className="font-display text-lg font-bold">툰스펙트럼</span>
          </div>
          <p className="mb-5 text-sm text-fg-3">
            {mode === "login" ? "다시 오셨네요. 로그인하세요." : "계정을 만들고 취향을 기록하세요."}
          </p>

          <div className="mb-4 inline-flex rounded-lg border border-line bg-card p-0.5">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setErr("");
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === m ? "bg-raised text-fg" : "text-fg-3 hover:text-fg-2"
                )}
              >
                {m === "login" ? "로그인" : "회원가입"}
              </button>
            ))}
          </div>

          <form className="flex flex-col gap-2.5" onSubmit={submit}>
            {mode === "signup" && (
              <>
                <input
                  {...register("name")}
                  placeholder="닉네임"
                  aria-label="닉네임"
                  className="h-11 rounded-xl border border-line bg-canvas px-3.5 text-sm outline-none focus:border-accent/60"
                />
                <Controller
                  control={control}
                  name="avatar"
                  render={({ field }) => (
                    <div className="rounded-xl border border-line bg-canvas p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-fg-2">아바타</span>
                        <button
                          type="button"
                          onClick={() => {
                            const preset = pickAvatarPreset(nameValue, emailValue);
                            field.onChange(preset.id);
                          }}
                          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-[0.72rem] font-medium text-fg-2 transition-colors hover:border-accent/50 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                        >
                          <Sparkles size={13} />
                          추천
                        </button>
                      </div>
                      <div className="mb-3 flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[oklch(0.95_0.01_85/0.16)] text-xl font-bold text-fg shadow-[0_1px_0_oklch(0.95_0.01_85/0.12)_inset]"
                          style={{ background: avatarBackground }}
                        >
                          {avatarImage ? (
                            <img src={avatarImage} alt="" className="h-full w-full object-cover" />
                          ) : (
                            avatarInitial
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-fg">{selectedPreset.name}</p>
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-3">{selectedPreset.tone}</p>
                        </div>
                      </div>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          onChange={onAvatarImageChange}
                        />
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[0.72rem] font-medium text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                        >
                          <ImagePlus size={13} />
                          이미지 업로드
                        </button>
                        {avatarImage && (
                          <button
                            type="button"
                            onClick={() => {
                              setValue("image", null, { shouldDirty: true, shouldValidate: true });
                              setImageErr("");
                            }}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[0.72rem] font-medium text-fg-3 transition-colors hover:border-bad/60 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                          >
                            <Trash2 size={13} />
                            제거
                          </button>
                        )}
                        <span className="text-[0.68rem] text-fg-3">PNG/JPG/WebP · 180KB 이하</span>
                      </div>
                      {imageErr && (
                        <p className="mb-3 text-xs text-bad" role="alert">
                          {imageErr}
                        </p>
                      )}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {AVATAR_PRESETS.map((preset) => {
                          const active = field.value === preset.id || field.value === preset.color;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => field.onChange(preset.id)}
                              aria-label={`${preset.name} 아바타 선택`}
                              aria-pressed={active}
                              className={cn(
                                "flex min-h-14 items-center gap-2 rounded-xl border bg-panel p-2 text-left transition-[border-color,background,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                                active
                                  ? "border-accent bg-accent-soft text-fg"
                                  : "border-line text-fg-2 hover:border-line-strong hover:bg-raised"
                              )}
                            >
                              <span
                                className="size-7 shrink-0 rounded-lg border border-[oklch(0.95_0.01_85/0.14)]"
                                style={{
                                  background: `radial-gradient(circle at 32% 24%, ${preset.accent}, transparent 35%), linear-gradient(145deg, ${preset.color}, oklch(0.26 0.04 60))`,
                                }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-semibold">{preset.name}</span>
                                <span className="mt-0.5 block truncate text-[0.68rem] text-fg-3">{preset.tone}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                />
              </>
            )}
            <input
              {...emailField}
              ref={(el) => {
                emailField.ref(el);
                emailRef.current = el;
              }}
              type="email"
              placeholder="이메일"
              aria-label="이메일"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "auth-email-error" : undefined}
              className="h-11 rounded-xl border border-line bg-canvas px-3.5 text-sm outline-none focus:border-accent/60"
            />
            {errors.email?.message && (
              <p id="auth-email-error" className="text-xs text-bad" role="alert">
                {errors.email.message}
              </p>
            )}
            <input
              {...register("password")}
              type="password"
              placeholder="비밀번호 (6자 이상)"
              aria-label="비밀번호"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? "auth-password-error" : undefined}
              className="h-11 rounded-xl border border-line bg-canvas px-3.5 text-sm outline-none focus:border-accent/60"
            />
            {errors.password?.message && (
              <p id="auth-password-error" className="text-xs text-bad" role="alert">
                {errors.password.message}
              </p>
            )}
            {err && (
              <p className="text-xs text-bad" role="alert">
                {err}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-50"
            >
              {mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
              {isSubmitting ? "처리 중…" : mode === "login" ? "로그인" : "가입하고 시작"}
            </button>
          </form>

          {(providerStatus !== "ready" || providers.kakao || providers.google || providers.naver) && (
            <>
              <div className="my-4 flex items-center gap-3 text-[0.7rem] text-fg-3">
                <span className="h-px flex-1 bg-line" />또는<span className="h-px flex-1 bg-line" />
              </div>
              <div className="flex flex-col gap-2">
                {providerStatus === "loading" && (
                  <div
                    className="flex h-11 animate-pulse items-center justify-center rounded-xl border border-line bg-card text-xs text-fg-3"
                    role="status"
                  >
                    소셜 로그인 확인 중…
                  </div>
                )}
                {providerStatus === "error" && (
                  <div className="rounded-xl border border-line bg-card p-3 text-center">
                    <p className="text-xs leading-relaxed text-fg-3" role="status">
                      소셜 로그인 정보를 불러오지 못했어요. 이메일 로그인은 계속 사용할 수 있어요.
                    </p>
                    <button
                      type="button"
                      onClick={() => setProviderAttempt((value) => value + 1)}
                      className="mt-2 min-h-9 rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      다시 확인
                    </button>
                  </div>
                )}
                {providers.kakao && (
                  <button
                    type="button"
                    onClick={() => signIn("kakao")}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#FEE500] text-sm font-semibold text-[#191600] transition-opacity hover:opacity-90"
                  >
                    카카오로 계속하기
                    {providers.kakao.mode === "demo" && <DemoTag dark />}
                  </button>
                )}
                {providers.google &&
                  (providers.google.mode === "oauth" && providers.google.clientId ? (
                    // 실연동 Google: GIS 공식 버튼(ID 토큰 흐름) — 리다이렉트 없이 모달에서 로그인.
                    <GoogleIdentityButton
                      clientId={providers.google.clientId}
                      onSuccess={onClose}
                      onRedirectFallback={
                        providers.google.redirectAvailable
                          ? () => { void signIn("google"); }
                          : undefined
                      }
                    />
                  ) : (
                    <div
                      className="rounded-xl border border-line bg-card px-3.5 py-3"
                      role="status"
                      aria-label="Google 로그인 설정 필요"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-fg-2">Google로 계속하기</span>
                        <span className="rounded-md border border-line bg-raised px-1.5 py-0.5 text-[0.62rem] font-bold text-fg-3">
                          설정 필요
                        </span>
                      </div>
                      <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                        Google 로그인 설정이 아직 완료되지 않았어요. 지금은 이메일 로그인을 이용해 주세요.
                      </p>
                    </div>
                  ))}
                {providers.naver && (
                  <button
                    type="button"
                    onClick={() => signIn("naver")}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#03C75A] text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    네이버로 계속하기
                    {providers.naver.mode === "demo" && <DemoTag dark />}
                  </button>
                )}
              </div>
              {(providers.kakao?.mode === "demo" || providers.naver?.mode === "demo") && (
                <p className="mt-2 text-center text-[0.66rem] text-fg-3">
                  데모 표시는 실제 소셜 연동이 아직 설정되지 않아 체험용 계정으로 로그인됨을 뜻해요.
                </p>
              )}
            </>
          )}
          <p className="mt-4 text-[0.7rem] leading-relaxed text-fg-3">
            계정을 만들면 평점·리뷰·서재가 DB에 저장되어 어느 기기에서나 이어집니다. 비로그인 시 이
            브라우저에만 저장돼요.
          </p>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
