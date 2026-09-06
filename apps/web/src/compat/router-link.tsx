import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router-dom";

type Href =
  | string
  | {
      pathname?: string;
      query?: Record<string, string | number | boolean | null | undefined>;
    };

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: Href;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
};

function hrefToString(href: Href): string {
  if (typeof href === "string") return href;
  const pathname = href.pathname ?? "/";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(href.query ?? {})) {
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function isExternalHref(href: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//");
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function LinkCompat(
  { href, replace, ...props },
  ref
) {
  const to = hrefToString(href);
  const { prefetch, scroll, ...linkProps } = props;
  const replaceFlag = replace || ((prefetch !== undefined || scroll !== undefined) && false);
  if (isExternalHref(to) || linkProps.target) {
    // 제네릭 Link 래퍼 — 콘텐츠(children)는 호출부가 linkProps에 담아 전달한다.
    // eslint-disable-next-line jsx-a11y/anchor-has-content
    return <a ref={ref} href={to} {...linkProps} />;
  }
  return <RouterLink ref={ref} to={to} replace={replaceFlag} {...linkProps} />;
});

export default Link;
