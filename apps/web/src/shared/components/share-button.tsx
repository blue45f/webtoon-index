import { Share2, Check, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

// 작품 공유 버튼 — 모바일은 OS 공유 시트(navigator.share, 카카오/인스타 등), 데스크톱은 링크 복사 + X/페북.
export function ShareButton({
  title,
  slug,
  className,
}: {
  title: string;
  slug: string;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const url =
    typeof window !== "undefined"
      ? `${globalThis.location.origin}/title/${encodeURIComponent(slug)}`
      : `/title/${encodeURIComponent(slug)}`;
  const shareText = `${title} · ${t("app.name")}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function onShare() {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({ title: shareText, url });
        return;
      } catch {
        /* 사용자 취소 — 메뉴로 폴백 */
      }
    }
    setOpen((o) => !o);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard 차단 환경 무시 */
    }
  }

  const x = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
  const fb = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  const itemCls =
    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg-2 transition-colors hover:bg-raised hover:text-fg";

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={onShare}
        aria-label={t("share.triggerAria")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-sm font-medium text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
      >
        <Share2 size={15} />
        {t("share.triggerLabel")}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-44 overflow-hidden rounded-xl border border-line-strong bg-panel p-1 shadow-2xl shadow-[oklch(0.1_0.02_70/0.42)]">
          <button type="button" onClick={copyLink} className={itemCls}>
            {copied ? (
              <Check size={15} className="text-good" />
            ) : (
              <Link2 size={15} />
            )}
            {copied ? t("share.copySuccess") : t("share.copy")}
          </button>
          <a
            href={x}
            target="_blank"
            rel="noopener noreferrer"
            className={itemCls}
          >
            {t("share.social.x")}
          </a>
          <a
            href={fb}
            target="_blank"
            rel="noopener noreferrer"
            className={itemCls}
          >
            {t("share.social.facebook")}
          </a>
        </div>
      )}
    </div>
  );
}
