import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LoaderCircle, LogOut, Library, RotateCcw, UserRound, Settings as SettingsIcon, Shield } from "lucide-react";
import { useState, useEffect, useId, useRef } from "react";

import { AuthModal } from "./auth-modal";

import { resolveSignupAvatarImage } from "@/shared/lib/avatar";
import { useT } from "@/shared/lib/i18n";
import { cn, keepInlineText } from "@/shared/lib/utils";
import { useSession, signOut } from "@/src/compat/auth-session-store";
import Link from "@/src/compat/router-link";
import { adminFetch, type AdminMe } from "@/src/domains/admin/components/admin-client";

function safeProfileImageSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  const dataImage = resolveSignupAvatarImage(value);
  if (dataImage) return dataImage;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

// 메뉴 항목 공통 스타일 — 기존 hover/focus-visible 시각을 Radix data-[highlighted]로 매핑(키보드/마우스 동일).
const ITEM_CLASS =
  "flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-sm text-fg-2 outline-none transition-colors hover:bg-raised hover:text-fg focus-visible:bg-raised focus-visible:text-fg data-[highlighted]:bg-raised data-[highlighted]:text-fg";

export function AuthMenu({
  defaultOpen = false,
  defaultMenuOpen = false,
}: {
  defaultOpen?: boolean;
  defaultMenuOpen?: boolean;
}) {
  const { data: session, status } = useSession();
  const [modal, setModal] = useState(defaultOpen);
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(defaultMenuOpen);
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const loginTriggerRef = useRef<HTMLButtonElement>(null);
  const signOutInFlightRef = useRef(false);
  const signOutStatusId = useId();
  const t = useT();
  const uid = session?.user?.id;

  useEffect(() => {
    if (defaultOpen) setModal(true);
  }, [defaultOpen]);

  // 관리자 콘솔 링크 노출 — 세션 role(화이트리스트 승격 반영) + /api/admin/me 프로브.
  // 프로브는 세션 role 이 stale 한 탭/캐시에서도 링크가 보이도록 하는 2차 게이트.
  useEffect(() => {
    if (status !== "authenticated" || !uid) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    adminFetch<AdminMe>("/me", uid)
      .then(() => {
        if (alive) setIsAdmin(true);
      })
      .catch(() => {
        if (alive) setIsAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, [status, uid]);

  if (status !== "authenticated") {
    return (
      <>
        <button
          ref={loginTriggerRef}
          onClick={() => setModal(true)}
          aria-label={t("nav.login")}
          className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-card px-3 text-sm font-medium text-fg-2 [text-wrap:nowrap] [word-break:keep-all] transition-colors hover:border-line-strong hover:text-fg"
        >
          <UserRound size={16} className="shrink-0" />
          <span className="hidden min-w-max whitespace-nowrap [text-wrap:nowrap] [word-break:keep-all] xl:inline-block">
            {keepInlineText(t("nav.login"))}
          </span>
        </button>
        {modal && (
          <AuthModal
            onClose={() => setModal(false)}
            returnFocusRef={loginTriggerRef}
          />
        )}
      </>
    );
  }

  const u = session.user;
  const initial = (u.name ?? u.email ?? "U").charAt(0).toUpperCase();
  const imageSrc = safeProfileImageSrc(u.image);
  const userEmail = (u.email ?? "").trim().toLowerCase();
  // 서버 세션이 admin 을 주면 즉시 표시. 화이트리스트 이메일은 배포 지연/세션 stale 대비 폴백.
  const showAdmin =
    (u.role ?? "") === "admin" ||
    (u.role ?? "") === "operator" ||
    userEmail === "blue45f@gmail.com" ||
    isAdmin;
  const fallbackName = t("auth.menu.fallbackName");

  async function handleSignOut() {
    // State is committed on the next render; the ref closes the same-frame
    // double-click/keyboard window before React can disable the menu item.
    if (signOutInFlightRef.current) return;
    signOutInFlightRef.current = true;
    setSignOutPending(true);
    setSignOutError(null);
    try {
      const result = await signOut();
      if (result.ok) {
        // The old menu closed on a successful selection. Keep that behavior
        // even if session-provider propagation takes another render.
        setMenuOpen(false);
      } else {
        setSignOutError(result.error);
      }
    } catch {
      setSignOutError("로그아웃 확인에 실패했어요. 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      signOutInFlightRef.current = false;
      setSignOutPending(false);
    }
  }

  const signOutLabel = signOutPending
    ? "실시간 연결 정리 중…"
    : signOutError
      ? "로그아웃 다시 시도"
      : t("auth.menu.signOut");

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenu.Trigger
        className="grid size-10 place-items-center overflow-hidden rounded-xl border border-line bg-accent text-sm font-bold text-on-accent outline-none transition-transform active:scale-95"
        aria-label={t("auth.menu.triggerLabel")}
      >
        {imageSrc ? <img src={imageSrc} alt="" className="h-full w-full object-cover" /> : initial}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-52 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-xl shadow-[oklch(0.1_0.02_70/0.42)] data-[state=open]:animate-[fade-up_0.16s_var(--ease-out-expo)_both]"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-fg">{u.name ?? fallbackName}</p>
            <p className="truncate text-xs text-fg-3">{u.email}</p>
          </div>
          {showAdmin && (
            <DropdownMenu.Item asChild>
              <Link href="/admin" className={ITEM_CLASS}>
                <Shield size={15} /> {t("auth.menu.adminPanel")}
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item asChild>
            <Link href="/me" className={ITEM_CLASS}>
              <UserRound size={15} /> {t("auth.menu.profile")}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/library" className={ITEM_CLASS}>
              <Library size={15} /> {t("nav.library")}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/settings" className={ITEM_CLASS}>
              <SettingsIcon size={15} /> {t("auth.menu.settings")}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={signOutPending}
            onSelect={(event) => {
              event.preventDefault();
              void handleSignOut();
            }}
            aria-busy={signOutPending}
            aria-describedby={signOutError ? signOutStatusId : undefined}
            className={cn(ITEM_CLASS, "hover:text-bad focus-visible:text-bad data-[highlighted]:text-bad data-[disabled]:cursor-wait data-[disabled]:opacity-60")}
          >
            {signOutPending ? (
              <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : signOutError ? (
              <RotateCcw size={15} aria-hidden />
            ) : (
              <LogOut size={15} aria-hidden />
            )}
            {signOutLabel}
          </DropdownMenu.Item>
          {signOutError ? (
            <p
              id={signOutStatusId}
              className="border-t border-line px-4 py-2 text-xs leading-relaxed text-bad"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {signOutError}
            </p>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
