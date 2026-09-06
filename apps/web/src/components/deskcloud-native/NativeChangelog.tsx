/**
 * ChangelogDesk 네이티브 통합 — 인앱 "What's new" 체인지로그.
 * ──────────────────────────────────────────────────────────────────────────
 * 공식 SDK(@heejun/deskcloud)의 `createChangelogClient`(pk_ 브라우저 클라이언트)로 게시된
 * 체인지로그 벽(getWall)과 미확인 수(getUnreadCount)를 불러오고, 열람 시 마지막으로 본 지점을
 * 기록한다(markSeen). 화면은 이 앱의 디자인 토큰(canvas/panel/card/line/fg/accent)과
 * 컴포넌트(Button)로 직접 렌더 — 외부 위젯 CSS·번들 없음.
 *
 * 보안: pk_ publishable 키 표면만 사용(브라우저 노출 안전). `@heejun/deskcloud/server`(sk_)는
 * 절대 import 하지 않는다. env-gate: VITE_CHANGELOGDESK_URL 미설정 시 마운트되지 않는다.
 *
 * 본문은 서버가 새니타이즈해 내려주지만, 브라우저에서도 허용된 태그만 React 노드로 변환한다.
 */
import { createChangelogClient, type ChangelogEntry, type ChangelogEntryTag } from "@heejun/deskcloud";
import { Megaphone, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { changelogConfig, getAnonId } from "./config";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

type Phase = "idle" | "loading" | "ready" | "error" | "empty";

const FOCUSABLE =
  'a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

const TAG_META: Record<ChangelogEntryTag, { label: string; cls: string }> = {
  new: { label: "신규", cls: "bg-accent-soft text-accent" },
  improved: { label: "개선", cls: "bg-good/15 text-good" },
  fixed: { label: "수정", cls: "bg-raised text-fg-2" },
  announcement: { label: "공지", cls: "bg-bad/12 text-bad" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

const ALLOWED_BODY_TAGS = new Set(["P", "UL", "OL", "LI", "CODE", "STRONG", "EM", "BR", "A"]);

function renderBodyNode(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof HTMLElement)) return null;
  const children = Array.from(node.childNodes).map((child, index) => renderBodyNode(child, key + "-" + index));
  if (!ALLOWED_BODY_TAGS.has(node.tagName)) return children;
  if (node.tagName === "BR") return <br key={key} />;
  if (node.tagName === "A") {
    const href = node.getAttribute("href");
    if (!href) return children;
    try {
      const url = new URL(href, globalThis.location.origin);
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) return children;
      return <a key={key} href={url.href} target="_blank" rel="noreferrer">{children}</a>;
    } catch { return children; }
  }
  const Tag = node.tagName.toLowerCase() as "p" | "ul" | "ol" | "li" | "code" | "strong" | "em";
  return <Tag key={key}>{children}</Tag>;
}

function renderChangelogBody(bodyHtml: string): ReactNode {
  if (typeof DOMParser === "undefined") return bodyHtml;
  const document = new DOMParser().parseFromString(bodyHtml, "text/html");
  return Array.from(document.body.childNodes).map((node, index) => renderBodyNode(node, "body-" + index));
}

export function NativeChangelog() {
  const config = useMemo(() => changelogConfig(), []);
  const client = useMemo(() => (config ? createChangelogClient(config) : null), [config]);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [latestId, setLatestId] = useState<string | null>(null);

  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // 마운트 시 미확인 수 1회 조회(벨 배지). env-gate 통과 시에만.
  useEffect(() => {
    if (!client) return undefined;
    let alive = true;
    client
      .getUnreadCount({ anonId: getAnonId() })
      .then((r) => {
        if (!alive) return;
        setUnread(r.unreadCount);
        setLatestId(r.latestEntryId);
      })
      .catch(() => {
        // 배지 조회 실패는 조용히 무시(런처는 그대로 노출).
      });
    return () => {
      alive = false;
    };
  }, [client]);

  const load = useCallback(() => {
    if (!client) return;
    setPhase("loading");
    client
      .getWall({ limit: 20 })
      .then((wall) => {
        setEntries(wall.items);
        setPhase(wall.items.length > 0 ? "ready" : "empty");
      })
      .catch(() => setPhase("error"));
  }, [client]);

  const markRead = useCallback(() => {
    if (!client || unread === 0) return;
    setUnread(0);
    client.markSeen({ anonId: getAnonId(), ...(latestId ? { lastSeenEntryId: latestId } : {}) }).catch(() => {
      // 실패 시 다음 마운트에서 다시 조회되므로 무시.
    });
  }, [client, unread, latestId]);

  const openDialog = useCallback(() => {
    setOpen(true);
    if (phase === "idle" || phase === "error") load();
    markRead();
  }, [phase, load, markRead]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  // 포커스 트랩 + Esc — 다이얼로그가 열린 동안만.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeDialog();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, closeDialog]);

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 20);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!client) return null;

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          aria-haspopup="dialog"
          aria-label={unread > 0 ? `새 소식 ${unread}건` : "새 소식"}
          onClick={openDialog}
          className="fixed bottom-6 right-4 z-[88] inline-flex items-center gap-2 rounded-full border border-line bg-card/95 px-3.5 py-2 text-sm font-medium text-fg-2 shadow-lg backdrop-blur transition-[color,border-color,transform] duration-150 ease-out-expo hover:-translate-y-0.5 hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <Sparkles size={15} aria-hidden="true" />
          새 소식
          {unread > 0 && (
            <span className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[0.6875rem] font-bold leading-none text-on-accent tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          role="presentation"
          className="fixed inset-0 z-[95] flex items-end justify-end bg-canvas/70 p-4 backdrop-blur-sm motion-safe:animate-[fade-up_0.16s_var(--ease-out-expo)_both] sm:items-start sm:pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[min(680px,calc(100vh-2rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-panel text-fg shadow-2xl motion-safe:animate-[fade-up_0.2s_var(--ease-out-expo)_both]"
          >
            <header className="flex items-center gap-2.5 border-b border-line px-5 py-4">
              <Sparkles size={18} className="text-accent" aria-hidden="true" />
              <h2 id={titleId} className="flex-1 text-base font-bold tracking-tight text-fg">
                새 소식
              </h2>
              <button
                type="button"
                aria-label="닫기"
                onClick={closeDialog}
                className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {phase === "loading" && (
                <div aria-busy="true" className="space-y-5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="space-y-2">
                      <span className="skeleton block h-4 w-1/3" />
                      <span className="skeleton block h-5 w-3/4" />
                      <span className="skeleton block h-12 w-full" />
                    </div>
                  ))}
                </div>
              )}

              {phase === "error" && (
                <div className="py-10 text-center">
                  <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-bad/15 text-bad">
                    <Megaphone size={24} aria-hidden="true" />
                  </span>
                  <p className="text-sm text-fg-2">소식을 불러오지 못했어요.</p>
                  <div className="mt-4">
                    <Button size="sm" onClick={load}>
                      다시 시도
                    </Button>
                  </div>
                </div>
              )}

              {phase === "empty" && (
                <div className="py-10 text-center">
                  <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
                    <Sparkles size={24} aria-hidden="true" />
                  </span>
                  <p className="text-sm text-fg-2">아직 게시된 소식이 없어요.</p>
                </div>
              )}

              {phase === "ready" && (
                <ol className="space-y-6">
                  {entries.map((entry) => {
                    const tag = TAG_META[entry.tag];
                    return (
                      <li key={entry.id} className="border-b border-line pb-6 last:border-0 last:pb-0">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", tag.cls)}>{tag.label}</span>
                          {entry.version && <span className="text-xs font-medium text-fg-3 tabular-nums">{entry.version}</span>}
                          <span className="flex-1" />
                          <time className="text-xs text-fg-3" dateTime={entry.publishedAt ?? undefined}>
                            {formatDate(entry.publishedAt ?? entry.createdAt)}
                          </time>
                        </div>
                        <h3 className="text-pretty text-sm font-bold text-fg">{entry.title}</h3>
                        <div className="changelog-body mt-1.5 text-sm leading-relaxed text-fg-2 [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-raised [&_code]:px-1 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_ul]:my-2">
                          {renderChangelogBody(entry.bodyHtml)}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
