import { ArrowLeft, Ban, CheckCircle2, Eye, EyeOff, ImageOff, MessagesSquare, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { loadAdminI18nLocale } from "./admin-i18n-loader";
import { adminFetch, type AdminApiError } from "./components/admin-client";
import { AdminGateFallback } from "./components/admin-gate";
import { useAdminGate } from "./components/admin-gate-state";
import { CreatorMarketplaceModerationBoard } from "./components/CreatorMarketplaceModerationBoard";

import type { FanCafeScopeFilter } from "@/shared/lib/types";
import type { SharedAssetModerationQueueItem } from "@/src/infrastructure/creator-client";

import { Container } from "@/shared/components/section";
import { COMMUNITY_SCOPE_LABEL_WITH_ALL } from "@/shared/lib/community-ui";
import { useI18n, useT } from "@/shared/lib/i18n";
import { cn, relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { verifyStudioSharedAssetContent } from "@/src/domains/creator/studio-shared-asset-content";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import {
  getSharedAssetContent,
  listSharedAssetModerationQueue,
  moderateSharedAsset,
} from "@/src/infrastructure/creator-client";

interface ModerationPost {
  id: string;
  scope: string;
  targetId: string;
  targetLabel: string;
  kind: string;
  title: string;
  excerpt: string;
  imageCount: number;
  hidden: boolean;
  createdAt: string | null;
  author: { id: string; name: string | null; email: string | null };
  replyCount: number;
}
// 커뮤니티 모더레이션 분할 라우트(/admin/community) — 게시글 숨김/해제·첨부 제거·완전 삭제.
export function AdminCommunityPage() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  useDocumentTitle(t("admin.community.title"));
  const { gate, uid } = useAdminGate();

  useEffect(() => {
    void loadAdminI18nLocale(lang);
  }, [lang]);

  return (
    <Container size="wide" className="py-10">
      <header className="mb-8">
        <p className="eyebrow flex items-center gap-1.5 text-accent">
          <MessagesSquare size={13} /> {t("admin.community.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{t("admin.community.title")}</h1>
        <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-3">
          {t("admin.community.desc")}
        </p>
        <Link href="/admin" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">
          <ArrowLeft size={13} />
          {t("admin.members.backToConsole")}
        </Link>
      </header>

      <AdminGateFallback gate={gate} />
      {gate.kind === "admin" && uid && (
        <div className="space-y-10">
          <CreatorMarketplaceModerationBoard />
          <AssetModerationBoard />
          <ModerationBoard uid={uid} />
        </div>
      )}
    </Container>
  );
}


function AssetModerationBoard() {
  const [items, setItems] = useState<SharedAssetModerationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inspectionBusyId, setInspectionBusyId] = useState<string | null>(null);
  const [originalInspection, setOriginalInspection] = useState<{
    assetId: string;
    dataUrl: string;
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const t = useT();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listSharedAssetModerationQueue({ status: "open", limit: 20 })
      .then((data) => {
        if (alive) setItems(data);
      })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : "Error loading reports.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshTick]);

  async function review(
    item: SharedAssetModerationQueueItem,
    status: "published" | "under_review" | "rejected"
  ) {
    if (busyId) return;
    setBusyId(item.reportId);
    setError(null);
    try {
      await moderateSharedAsset(item.asset.id, { status, note: notes[item.reportId]?.trim() || undefined });
      if (status === "under_review") {
        setItems((current) => current.map((candidate) => candidate.reportId === item.reportId
          ? { ...candidate, asset: { ...candidate.asset, moderationStatus: status } }
          : candidate));
      } else {
        setItems((current) => current.filter((candidate) => candidate.asset.id !== item.asset.id));
        setOriginalInspection((current) => current?.assetId === item.asset.id ? null : current);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function inspectOriginal(item: SharedAssetModerationQueueItem) {
    if (originalInspection?.assetId === item.asset.id) {
      setOriginalInspection(null);
      return;
    }
    if (inspectionBusyId) return;
    setInspectionBusyId(item.asset.id);
    setError(null);
    try {
      const content = await getSharedAssetContent(item.asset.id);
      const verified = await verifyStudioSharedAssetContent(item.asset, content);
      setOriginalInspection({ assetId: item.asset.id, dataUrl: verified.dataUrl });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Error inspecting original.");
    } finally {
      setInspectionBusyId(null);
    }
  }

  return (
    <section aria-labelledby="asset-moderation-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-1.5 text-warn"><ShieldAlert size={13} /> ASSET REPORTS</p>
          <h2 id="asset-moderation-title" className="mt-1 text-xl font-bold text-fg">{t("admin.community.assetReportsTitle")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-fg-3">{t("admin.community.assetReportsDesc")}</p>
        </div>
        <button type="button" onClick={() => setRefreshTick((tick) => tick + 1)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-fg-2 hover:bg-raised">
          <RefreshCw size={13} className={cn(loading && "animate-spin motion-reduce:animate-none")} /> {t("admin.community.refreshReports")}
        </button>
      </div>

      {error && <p className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}
      {loading ? (
        <div className="space-y-2.5">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="skeleton h-40 rounded-xl" />)}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card/40 p-8 text-center text-sm text-fg-3">{t("admin.community.noAssetReports")}</div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const busy = busyId === item.reportId;
            const showingOriginal = originalInspection?.assetId === item.asset.id;
            const loadingOriginal = inspectionBusyId === item.asset.id;
            return (
              <li key={item.reportId} className="grid gap-4 rounded-2xl border border-line bg-card/60 p-4 sm:grid-cols-[9rem_1fr]">
                <div className="space-y-2">
                  <div className="flex h-36 items-center justify-center overflow-hidden rounded-xl border border-line bg-raised/50">
                    <img
                      src={showingOriginal ? originalInspection.dataUrl : item.asset.previewDataUrl}
                      alt={item.asset.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(inspectionBusyId && !loadingOriginal)}
                    aria-pressed={showingOriginal}
                    onClick={() => void inspectOriginal(item)}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-line px-2 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-45"
                  >
                    <Eye size={12} />
                    {loadingOriginal ? t("admin.community.verifying") : showingOriginal ? t("admin.community.previewData") : t("admin.community.verifyOriginal")}
                  </button>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[0.68rem] text-fg-3">
                    <span className="rounded-full bg-bad/10 px-2 py-0.5 font-semibold text-bad">{item.reason}</span>
                    <span>{item.asset.licenseLabel ?? item.asset.license}</span>
                    {item.asset.containsAi && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">AI</span>}
                    <span className="ml-auto">Reports {item.asset.reportCount ?? 1}</span>
                  </div>
                  <h3 className="mt-2 truncate text-sm font-bold text-fg">{item.asset.name}</h3>
                  <p className="mt-1 text-xs text-fg-3">{item.asset.author.name} · {item.reporter.id}</p>
                  {item.details && <p className="mt-2 rounded-lg bg-raised/60 px-3 py-2 text-xs leading-relaxed text-fg-2">{item.details}</p>}
                  <input
                    value={notes[item.reportId] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [item.reportId]: event.target.value.slice(0, 500) }))}
                    placeholder={t("admin.community.notePlaceholder")}
                    className="mt-3 min-h-11 w-full rounded-lg border border-line bg-canvas/50 px-3 text-xs text-fg outline-none focus:border-accent"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={() => void review(item, "published")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-good/40 px-3 text-xs font-semibold text-good hover:bg-good/10 disabled:opacity-45"><CheckCircle2 size={13} /> {t("admin.community.approveAsset")}</button>
                    <button type="button" disabled={busy} onClick={() => void review(item, "under_review")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-warn/40 px-3 text-xs font-semibold text-warn hover:bg-warn/10 disabled:opacity-45"><ShieldAlert size={13} /> {t("admin.community.reviewAsset")}</button>
                    <button type="button" disabled={busy} onClick={() => void review(item, "rejected")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-bad/40 px-3 text-xs font-semibold text-bad hover:bg-bad/10 disabled:opacity-45"><Ban size={13} /> {t("admin.community.rejectAsset")}</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ModerationBoard({ uid }: { uid: string }) {
  const [posts, setPosts] = useState<ModerationPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<FanCafeScopeFilter>("all");
  const [visibility, setVisibility] = useState<"all" | "visible" | "hidden">("all");
  const [searchText, setSearchText] = useState("");
  const [queryText, setQueryText] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const t = useT();

  const scopeFilters: { value: FanCafeScopeFilter; label: string }[] = (
    ["all", "title", "author", "pencafe", "cafe"] as const
  ).map((value) => ({ value, label: COMMUNITY_SCOPE_LABEL_WITH_ALL[value] }));

  const visibilityFilters = [
    { value: "all", label: t("admin.revenue.filterAll") },
    { value: "visible", label: t("admin.plans.statusActive") },
    { value: "hidden", label: t("admin.community.hidePost") },
  ] as const;

  useEffect(() => {
    const timer = setTimeout(() => setQueryText(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "100" });
    if (scope !== "all") params.set("scope", scope);
    if (visibility !== "all") params.set("visibility", visibility);
    if (queryText) params.set("q", queryText);
    adminFetch<{ items: ModerationPost[] }>(`/community/posts?${params.toString()}`, uid)
      .then((data) => alive && setPosts(data.items ?? []))
      .catch((e: AdminApiError) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [queryText, refreshTick, scope, uid, visibility]);

  async function run(postId: string, action: () => Promise<void>) {
    if (busyId) return;
    setBusyId(postId);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleHidden(post: ModerationPost) {
    void run(post.id, async () => {
      await adminFetch(`/content/fan_post/${encodeURIComponent(post.id)}/visibility`, uid, {
        method: "POST",
        body: JSON.stringify({ hidden: !post.hidden }),
      });
      setPosts((current) => current.map((item) => (item.id === post.id ? { ...item, hidden: !post.hidden } : item)));
    });
  }

  function clearAttachments(post: ModerationPost) {
    if (!globalThis.confirm(`${post.imageCount}`)) return;
    void run(post.id, async () => {
      await adminFetch(`/community/posts/${encodeURIComponent(post.id)}/attachments/clear`, uid, { method: "POST" });
      setPosts((current) => current.map((item) => (item.id === post.id ? { ...item, imageCount: 0 } : item)));
    });
  }

  function deletePost(post: ModerationPost) {
    if (!globalThis.confirm(`"${post.title}"`)) return;
    void run(post.id, async () => {
      await adminFetch(`/community/posts/${encodeURIComponent(post.id)}`, uid, { method: "DELETE" });
      setPosts((current) => current.filter((item) => item.id !== post.id));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-xl border border-line bg-canvas/40 px-3 py-2 text-xs">
          <Search size={14} />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            maxLength={80}
            aria-label={t("admin.community.searchPostPlaceholder")}
            placeholder={t("admin.community.searchPostPlaceholder")}
            className="h-7 w-56 min-w-0 border-none bg-transparent text-xs outline-none placeholder:text-fg-3"
          />
        </div>
        <div className="inline-flex flex-wrap rounded-xl border border-line bg-raised/40">
          {scopeFilters.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setScope(option.value)}
              aria-pressed={scope === option.value}
              className={cn(
                "px-2.5 py-1.5 text-xs font-medium transition-colors first:rounded-l-xl last:rounded-r-xl",
                scope === option.value ? "bg-accent text-on-accent" : "text-fg-3 hover:text-fg"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-xl border border-line bg-raised/40">
          {visibilityFilters.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setVisibility(option.value as "all" | "visible" | "hidden")}
              aria-pressed={visibility === option.value}
              className={cn(
                "px-2.5 py-1.5 text-xs font-medium transition-colors first:rounded-l-xl last:rounded-r-xl",
                visibility === option.value ? "bg-accent text-on-accent" : "text-fg-3 hover:text-fg"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setRefreshTick((tick) => tick + 1)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-fg-3 transition-colors hover:text-fg"
        >
          <RefreshCw size={13} className={cn(loading && "animate-spin motion-reduce:animate-none")} /> {t("admin.members.refresh")}
        </button>
      </div>

      {(error || actionError) && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error ?? actionError}</p>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center text-sm text-fg-3">
          {t("admin.community.noPosts")}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {posts.map((post) => {
            const busy = busyId === post.id;
            return (
              <li
                key={post.id}
                className={cn("rounded-xl border border-line bg-card/60 p-4", post.hidden && "opacity-75")}
              >
                <div className="flex flex-wrap items-center gap-2 text-[0.68rem] text-fg-3">
                  <span className="rounded-full border border-line bg-raised/45 px-2 py-0.5 font-medium">
                    {COMMUNITY_SCOPE_LABEL_WITH_ALL[(post.scope as FanCafeScopeFilter) ?? "all"] ?? post.scope} ·{" "}
                    {post.targetLabel}
                  </span>
                  {post.hidden && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 font-medium text-warn">
                      <EyeOff size={10} /> {t("admin.community.hidePost")}
                    </span>
                  )}
                  {post.imageCount > 0 && (
                    <span className="rounded-full bg-raised/60 px-2 py-0.5">Img {post.imageCount}</span>
                  )}
                  <span className="ml-auto">{post.createdAt ? relativeDate(post.createdAt) : "—"}</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-fg">
                  {post.hidden ? (
                    post.title
                  ) : (
                    <Link
                      href={`/community/post/${encodeURIComponent(post.id)}`}
                      className="transition-colors hover:text-accent"
                    >
                      {post.title}
                    </Link>
                  )}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-3">{post.excerpt}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.68rem] text-fg-3">
                  <span>
                    {post.author.name ?? "—"}
                    {post.author.email ? ` · ${post.author.email}` : ""}
                  </span>
                  <span>· {post.replyCount}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleHidden(post)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:border-accent/45 hover:text-accent disabled:opacity-45"
                  >
                    {post.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                    {post.hidden ? t("admin.community.unhidePost") : t("admin.community.hidePost")}
                  </button>
                  {post.imageCount > 0 && (
                    <button
                      type="button"
                      onClick={() => clearAttachments(post)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:border-warn/45 hover:text-warn disabled:opacity-45"
                    >
                      <ImageOff size={13} />
                      {t("admin.community.clearAttachments")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deletePost(post)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-45"
                  >
                    <Trash2 size={13} />
                    {t("admin.community.deletePost")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
