/**
 * NotifyDesk 네이티브 통합 — 인앱 알림 벨/인박스.
 * ──────────────────────────────────────────────────────────────────────────
 * 공식 SDK(@heejun/deskcloud)의 `createNotifyClient`(pk_ 브라우저 클라이언트)로 수신자
 * 인박스(getInbox)와 미확인 수(getUnreadCount)를 불러오고 읽음 처리(markRead)한다. 화면은
 * 이 앱의 디자인 토큰(panel/card/line/fg/accent)으로 직접 렌더 — 외부 위젯 CSS·번들 없음.
 *
 * 보안: pk_ publishable 키 표면만 사용(브라우저 노출 안전). `@heejun/deskcloud/server`(sk_)는
 * 절대 import 하지 않는다. env-gate: VITE_NOTIFYDESK_URL 미설정 시 마운트되지 않는다.
 *
 * recipientId 는 로그인 사용자면 그 id, 아니면 기기 단위 익명 id(getAnonId)로 폴백한다.
 */
import { createNotifyClient, type NotifyNotification } from "@heejun/deskcloud";
import { Bell, BellOff, Check, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { getAnonId, notifyConfig } from "./config";

import { Button } from "@/shared/components/ui/button";
import { useT } from "@/shared/lib/i18n";
import { useApp } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";

type Phase = "idle" | "loading" | "ready" | "error" | "empty";

const FOCUSABLE =
  'a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

export function NativeNotify() {
  const t = useT();
  const config = useMemo(() => notifyConfig(), []);
  const client = useMemo(() => (config ? createNotifyClient(config) : null), [config]);
  const userId = useApp((s) => s.userId);
  const recipientId = userId ?? getAnonId();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<NotifyNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // 마운트 시 미확인 수 1회 조회(벨 배지).
  useEffect(() => {
    if (!client) return undefined;
    let alive = true;
    client
      .getUnreadCount({ recipientId })
      .then((r) => {
        if (alive) setUnread(r.unreadCount);
      })
      .catch(() => {
        // 배지 조회 실패는 조용히 무시.
      });
    return () => {
      alive = false;
    };
  }, [client, recipientId]);

  const load = useCallback(() => {
    if (!client) return;
    setPhase("loading");
    client
      .getInbox({ recipientId, limit: 20 })
      .then((inbox) => {
        setItems(inbox.items);
        setUnread(inbox.unreadCount);
        setPhase(inbox.items.length > 0 ? "ready" : "empty");
      })
      .catch(() => setPhase("error"));
  }, [client, recipientId]);

  const markAllRead = useCallback(() => {
    if (!client || unread === 0) return;
    setUnread(0);
    setItems((prev) => prev.map((n) => (n.status === "read" ? n : { ...n, status: "read", readAt: new Date().toISOString() })));
    client.markRead({ recipientId, all: true }).catch(() => {
      // 실패 시 다음 열람에서 재동기화되므로 무시.
    });
  }, [client, unread, recipientId]);

  const openPanel = useCallback(() => {
    setOpen(true);
    if (phase === "idle" || phase === "error") load();
  }, [phase, load]);

  const closePanel = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  // 포커스 트랩 + Esc — 패널이 열린 동안만.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePanel();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
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
  }, [open, closePanel]);

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 20);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!client) return null;

  return (
    <div className="fixed left-4 top-20 z-[88]">
      <button
        ref={launcherRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `알림 ${unread}건` : "알림"}
        onClick={open ? closePanel : openPanel}
        className="relative inline-flex size-10 items-center justify-center rounded-full border border-line bg-card/95 text-fg-2 shadow-lg backdrop-blur transition-[color,border-color,transform] duration-150 ease-out-expo hover:-translate-y-0.5 hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <Bell size={17} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-accent px-1 py-0.5 text-[0.625rem] font-bold leading-none text-on-accent tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="absolute left-0 top-12 flex max-h-[min(560px,calc(100vh-8rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-panel text-fg shadow-2xl motion-safe:animate-[fade-up_0.18s_var(--ease-out-expo)_both]"
        >
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h2 id={titleId} className="flex-1 text-sm font-bold tracking-tight text-fg">
              알림
            </h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80"
              >
                <Check size={13} aria-hidden="true" />
                모두 읽음
              </button>
            )}
            <button
              type="button"
              aria-label="닫기"
              onClick={closePanel}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            {phase === "loading" && (
              <div aria-busy="true" className="space-y-3 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <span className="skeleton block h-4 w-2/3" />
                    <span className="skeleton block h-3 w-full" />
                  </div>
                ))}
              </div>
            )}

            {phase === "error" && (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-fg-2">{t("notify.loadError")}</p>
                <div className="mt-3">
                  <Button size="sm" onClick={load}>
                    {t("common.retry")}
                  </Button>
                </div>
              </div>
            )}

            {phase === "empty" && (
              <div className="px-4 py-12 text-center">
                <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-raised text-fg-3">
                  <BellOff size={24} aria-hidden="true" />
                </span>
                <p className="text-sm text-fg-2">{t("notify.empty")}</p>
              </div>
            )}

            {phase === "ready" && (
              <ul className="divide-y divide-line">
                {items.map((n) => {
                  const isUnread = n.status !== "read";
                  return (
                    <li
                      key={n.id}
                      className={cn("flex gap-3 px-4 py-3 transition-colors", isUnread ? "bg-accent-soft/40" : "bg-transparent")}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("mt-1.5 size-2 shrink-0 rounded-full", isUnread ? "bg-accent" : "bg-transparent")}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-pretty text-sm font-semibold text-fg">{n.title}</p>
                        {n.body && <p className="mt-0.5 text-pretty text-sm leading-relaxed text-fg-2">{n.body}</p>}
                        <time className="mt-1 block text-xs text-fg-3" dateTime={n.createdAt}>
                          {relativeTime(n.createdAt)}
                          {isUnread && <span className="sr-only"> · 읽지 않음</span>}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
