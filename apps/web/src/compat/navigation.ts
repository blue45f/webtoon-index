import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from "react-router-dom";

interface NavigateOptions {
  scroll?: boolean;
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  const [params] = useRouterSearchParams();
  return params;
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    back: () => navigate(-1),
    forward: () => navigate(1),
    push: (href: string, options?: NavigateOptions) => {
      navigate(href);
      if (options?.scroll === false) return;
      globalThis.requestAnimationFrame(() => globalThis.scrollTo({ top: 0, left: 0 }));
    },
    replace: (href: string, options?: NavigateOptions) => {
      navigate(href, { replace: true });
      if (options?.scroll === false) return;
      globalThis.requestAnimationFrame(() => globalThis.scrollTo({ top: 0, left: 0 }));
    },
    refresh: () => globalThis.location.reload(),
    prefetch: async () => undefined,
  };
}

export function notFound(): never {
  throw new Error("not_found");
}

export function redirect(href: string): never {
  globalThis.location.assign(href);
  throw new Error(`redirect:${href}`);
}
