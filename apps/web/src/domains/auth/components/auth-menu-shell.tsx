import { UserRound } from "lucide-react";
import { lazy, Suspense, useState, type ComponentType } from "react";

import { useT } from "@/shared/lib/i18n";
import { keepInlineText } from "@/shared/lib/text";
import { useSession } from "@/src/compat/auth-session-store";

type AuthMenuProps = {
  defaultOpen?: boolean;
  defaultMenuOpen?: boolean;
};
type AuthMenuModule = { default: ComponentType<AuthMenuProps> };

let authMenuPromise: Promise<AuthMenuModule> | null = null;

function loadAuthMenu(): Promise<AuthMenuModule> {
  authMenuPromise ??= import("./auth-menu").then((mod) => ({ default: mod.AuthMenu }));
  return authMenuPromise;
}

const AuthMenu = lazy(loadAuthMenu);

function preloadAuthMenu(): void {
  void loadAuthMenu();
}

function AuthMenuFallback({ onClick }: { onClick: () => void }) {
  const { data: session, status } = useSession();
  const t = useT();

  if (status === "authenticated") {
    const initial = (session.user.name ?? session.user.email ?? "U").charAt(0).toUpperCase();
    return (
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={preloadAuthMenu}
        onFocus={preloadAuthMenu}
        className="grid size-10 place-items-center overflow-hidden rounded-xl border border-line bg-accent text-sm font-bold text-on-accent outline-none transition-transform active:scale-95"
        aria-label="계정 메뉴"
      >
        {initial}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={preloadAuthMenu}
      onFocus={preloadAuthMenu}
      aria-label={t("nav.login")}
      className="flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-card px-3 text-sm font-medium text-fg-2 [text-wrap:nowrap] [word-break:keep-all] transition-colors hover:border-line-strong hover:text-fg"
    >
      <UserRound size={16} className="shrink-0" />
      <span className="hidden min-w-max whitespace-nowrap [text-wrap:nowrap] [word-break:keep-all] xl:inline-block">
        {keepInlineText(t("nav.login"))}
      </span>
    </button>
  );
}

export function AuthMenuShell() {
  const { status } = useSession();
  const [enabled, setEnabled] = useState(false);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [defaultMenuOpen, setDefaultMenuOpen] = useState(false);

  const openAuth = () => {
    const authenticated = status === "authenticated";
    setDefaultOpen(!authenticated);
    setDefaultMenuOpen(authenticated);
    setEnabled(true);
  };

  if (!enabled) {
    return <AuthMenuFallback onClick={openAuth} />;
  }

  return (
    <Suspense fallback={<AuthMenuFallback onClick={openAuth} />}>
      <AuthMenu defaultOpen={defaultOpen} defaultMenuOpen={defaultMenuOpen} />
    </Suspense>
  );
}
