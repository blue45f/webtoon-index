
import {
  Bookmark,
  BookOpen,
  CheckCircle2,
  FolderHeart,
  PenLine,
  Star,
  UserRound,
  Eye,
  Heart,
  MessageCircle,
  Check,
  Loader2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { AuthModal } from "@/domains/auth/components/auth-modal";
import { AvatarUploader } from "@/shared/components/avatar-uploader";
import { CoverImage } from "@/shared/components/cover-image";
import { Container } from "@/shared/components/section";
import { buttonClass } from "@/shared/components/ui/button-utils";
import { useT } from "@/shared/lib/i18n";
import { useApp, useHydrated } from "@/shared/lib/store";
import { cn, formatCount, relativeDate } from "@/shared/lib/utils";
import { useSession, signOut } from "@/src/compat/auth-session-store";
import Link from "@/src/compat/router-link";
import { ErrorState } from "@/src/components/error-state";
import { api } from "@/src/infrastructure/api";
import { listWorks, getCurrentUserId, type WorkSummary } from "@/src/infrastructure/creator-client";
import { deleteMyAccount, updateMyProfile } from "@/src/infrastructure/me-client";

type Tab = "posts" | "activity" | "profile";
const TABS: { id: Tab; labelKey: string }[] = [
  { id: "posts", labelKey: "account.tabs.posts" },
  { id: "activity", labelKey: "account.tabs.activity" },
  { id: "profile", labelKey: "account.tabs.profile" },
];

function isTab(value: string | null): value is Tab {
  return value === "posts" || value === "activity" || value === "profile";
}

// ── 로그아웃 상태 안내 ──────────────────────────────
function SignInPrompt() {
  const [modal, setModal] = useState(false);
  const t = useT();
  return (
    <Container size="prose" className="py-10 sm:py-16">
      <div className="relative overflow-hidden rounded-2xl border border-dashed border-line bg-gradient-to-b from-card/55 to-panel/30 p-8 text-center sm:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-2 h-28 w-28 -translate-x-1/2 rounded-full opacity-50 blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.72 0.185 42 / 0.3), transparent 70%)" }}
        />
        <span className="pf-glow relative mx-auto mb-3 grid size-12 place-items-center rounded-2xl border border-accent/30 bg-accent-soft/60 text-accent">
          <UserRound size={24} />
        </span>
        <h1 className="relative text-lg font-bold text-fg">{t("account.signIn.title")}</h1>
        <p className="relative mt-1.5 text-sm leading-relaxed text-fg-2">
          {t("account.signIn.message")}
        </p>
        <button
          type="button"
          onClick={() => setModal(true)}
          className={buttonClass({ variant: "solid", className: "relative mt-5 gap-1.5" })}
        >
          <UserRound size={16} />
          {t("account.signIn.cta")}
        </button>
      </div>
      {modal && <AuthModal onClose={() => setModal(false)} />}
    </Container>
  );
}

// ── 내 게시물(창작물) 그리드 ───────────────────────────
function PostCard({ work }: { work: WorkSummary }) {
  return (
    <Link
      href={`/create/${work.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel/30 transition-colors hover:border-line-strong"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-raised/40">
        <CoverImage
          src={work.cover}
          alt={work.title}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          fallback={
            <span className="grid h-full w-full place-items-center bg-gradient-to-br from-raised to-card text-fg-3">
              <PenLine size={28} />
            </span>
          }
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-fg group-hover:text-accent">
          {work.title}
        </h3>
        <div className="mt-auto flex items-center gap-3 pt-1.5 text-[0.72rem] text-fg-3">
          <span className="inline-flex items-center gap-1">
            <Heart size={12} className={cn(work.liked && "fill-accent text-accent")} />
            <span className="numeral">{formatCount(work.likes)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle size={12} />
            <span className="numeral">{formatCount(work.comments)}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye size={12} />
            <span className="numeral">{formatCount(work.views)}</span>
          </span>
          <span className="ml-auto shrink-0">{relativeDate(work.createdAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function PostsTab({ userId }: { userId: string }) {
  const t = useT();
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listWorks({ userId }, controller.signal)
      .then((result) => {
        if (alive) setWorks(result);
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : t("account.posts.errorTitle"));
        setWorks([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [userId, reloadKey, t]);

  if (error) {
    return (
      <ErrorState
        title={t("account.posts.errorTitle")}
        message={error}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    );
  }
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-2xl border border-line bg-panel/30">
            <span className="skeleton block aspect-[3/4]" />
            <div className="space-y-2 p-3">
              <span className="skeleton block h-4 w-full" />
              <span className="skeleton block h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (works.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-card/40 p-12 text-center">
        <PenLine size={26} className="mx-auto mb-3 text-fg-3" />
        <p className="text-sm font-medium text-fg">{t("account.posts.emptyTitle")}</p>
        <p className="mt-1 text-xs text-fg-3">{t("account.posts.emptyMessage")}</p>
        <Link
          href="/studio"
          className={buttonClass({ size: "sm", variant: "outline", className: "mt-4 gap-1.5" })}
        >
          <PenLine size={14} />
          {t("account.posts.cta")}
        </Link>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {works.map((work) => (
        <PostCard key={work.id} work={work} />
      ))}
    </div>
  );
}

// ── 내 활동(로컬 스토어 요약) ───────────────────────────
function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Star;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel/40 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none text-fg numeral">{value}</p>
        <p className="mt-1 text-xs text-fg-3">{label}</p>
      </div>
    </div>
  );
}

function ActivityTab() {
  const t = useT();
  const hydrated = useHydrated();
  const reviews = useApp((s) => s.reviews);
  const reads = useApp((s) => s.reads);
  const collections = useApp((s) => s.collections);

  if (!hydrated) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="skeleton block h-[4.5rem] rounded-2xl" />
        ))}
      </div>
    );
  }

  const reviewCount = Object.keys(reviews).length;
  const readEntries = Object.entries(reads);
  const wantCount = readEntries.filter(([, s]) => s === "want").length;
  const readingCount = readEntries.filter(([, s]) => s === "reading").length;
  const doneCount = readEntries.filter(([, s]) => s === "done").length;
  const collectionCount = collections.length;

  // 최근 리뷰(createdAt 기준 내림차순) — 작품 메타가 로컬에 없어 titleId로 상세 링크만 제공.
  const recentReviews = Object.values(reviews)
    .slice()
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 6);

  const empty =
    reviewCount === 0 && wantCount === 0 && readingCount === 0 && doneCount === 0 && collectionCount === 0;

  if (empty) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-card/40 p-12 text-center">
        <Star size={26} className="mx-auto mb-3 text-fg-3" />
        <p className="text-sm font-medium text-fg">{t("account.activity.emptyTitle")}</p>
        <p className="mt-1 text-xs text-fg-3">{t("account.activity.emptyMessage")}</p>
        <Link
          href="/ranking"
          className={buttonClass({ size: "sm", variant: "outline", className: "mt-4 gap-1.5" })}
        >
          {t("account.activity.viewTitlesCta")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Star} label={t("account.activity.stat.reviews")} value={reviewCount} />
        <StatCard icon={Bookmark} label={t("account.activity.stat.want")} value={wantCount} />
        <StatCard icon={BookOpen} label={t("account.activity.stat.reading")} value={readingCount} />
        <StatCard icon={CheckCircle2} label={t("account.activity.stat.done")} value={doneCount} />
        <StatCard icon={FolderHeart} label={t("account.activity.stat.collections")} value={collectionCount} />
      </div>

      {recentReviews.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-fg-3">
            {t("account.activity.recentReviewsTitle")}
          </h2>
          <ul className="space-y-2">
            {recentReviews.map((review) => (
              <li key={review.titleId}>
                <Link
                  href={`/title/${review.titleId}`}
                  className="flex items-start gap-3 rounded-xl border border-line bg-panel/30 p-3 transition-colors hover:border-line-strong"
                >
                  <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                    <Star size={12} className="fill-accent" />
                    {review.rating.toFixed(1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-fg-2">
                      {review.text || `(${t("account.activity.recentNoText")})`}
                    </p>
                    {review.createdAt && (
                      <p className="mt-1 text-[0.7rem] text-fg-3">{relativeDate(review.createdAt)}</p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[0.72rem] leading-relaxed text-fg-3">
        {t("account.activity.storageHint").split("{link}")[0]}
        <Link href="/library" className="text-accent underline-offset-2 hover:underline">
          {t("route.library")}
        </Link>
        {t("account.activity.storageHint").split("{link}")[1]}
      </p>
    </div>
  );
}

// ── 프로필 편집(아바타 + 이름 + 소개) ─────────────────
function ProfileTab() {
  const t = useT();
  const { data: session } = useSession();
  const user = session?.user;
  const fallbackInitial = (user?.name ?? user?.email ?? "U").charAt(0).toUpperCase();

  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState("");
  const [image, setImage] = useState<string | null>(user?.image ?? null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 서버 프로필(소개 포함)을 불러와 폼 초기값을 채운다(세션엔 bio가 없음).
  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    // 공유 ky 클라이언트가 HttpOnly 세션 쿠키를 포함한다. 베스트에포트라 실패는 무시.
    api
      .get<{ profile?: { name?: string | null; bio?: string | null; image?: string | null } }>("/me")
      .then((data) => {
        if (!alive || !data?.profile) return;
        setName((prev) => prev || data.profile?.name || "");
        setBio((prev) => prev || data.profile?.bio || "");
        setImage((prev) => prev ?? data.profile?.image ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateMyProfile({ name: name.trim(), bio: bio.trim(), image });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("account.profile.errorSave"));
    } finally {
      setSaving(false);
    }
  };

  const onDeleteAccount = async () => {
    if (!globalThis.confirm(t("account.profile.confirmDelete"))) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMyAccount();
      const logout = await signOut();
      if (!logout.ok) throw new Error(logout.error);
      globalThis.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("account.profile.errorDelete"));
      setDeleting(false);
    }
  };

  const nameInvalid = name.trim().length === 0;

  return (
    <div className="max-w-xl space-y-6">
      <section className="rounded-2xl border border-line bg-panel/40 p-5">
        <h2 className="mb-1 text-sm font-semibold text-fg">{t("account.profile.photoTitle")}</h2>
        <p className="mb-4 text-[0.78rem] leading-relaxed text-fg-2">{t("account.profile.photoDesc")}</p>
        <AvatarUploader
          value={image}
          fallbackText={fallbackInitial}
          onChange={setImage}
          onError={setError}
          disabled={saving}
        />
      </section>

      <section className="rounded-2xl border border-line bg-panel/40 p-5 space-y-4">
        <div>
          <label htmlFor="profile-name" className="mb-1.5 block text-sm font-semibold text-fg">
            {t("account.profile.nameLabel")}
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-fg outline-none transition-colors focus:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/40"
            placeholder={t("account.profile.namePlaceholder")}
          />
        </div>
        <div>
          <label htmlFor="profile-bio" className="mb-1.5 block text-sm font-semibold text-fg">
            {t("account.profile.bioLabel")}
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            maxLength={280}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            disabled={saving}
            className="w-full resize-none rounded-xl border border-line bg-card px-3.5 py-2.5 text-sm text-fg outline-none transition-colors focus:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/40"
            placeholder={t("account.profile.bioPlaceholder")}
          />
          <p className="mt-1 text-right text-[0.7rem] text-fg-3 numeral">
            {t("account.profile.bioLength").replace("{length}", String(bio.length))}
          </p>
        </div>
      </section>

      {error && (
        <p className="rounded-xl border border-bad/40 bg-bad/10 px-3.5 py-2.5 text-sm text-bad" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || deleting || nameInvalid}
          className={buttonClass({ variant: "solid", className: "gap-1.5" })}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
          {saving ? t("account.profile.saving") : saved ? t("account.profile.saved") : t("account.profile.saveButton")}
        </button>
        {nameInvalid && <span className="text-xs text-fg-3">{t("account.profile.nameRequired")}</span>}
      </div>

      <section className="rounded-2xl border border-bad/30 bg-bad/5 p-5">
        <h2 className="text-sm font-semibold text-fg">{t("account.profile.deleteTitle")}</h2>
        <p className="mt-1.5 text-[0.78rem] leading-relaxed text-fg-3">
          {t("account.profile.deleteDesc")}
        </p>
        <button
          type="button"
          onClick={onDeleteAccount}
          disabled={saving || deleting}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-bad/45 px-3 py-2 text-xs font-semibold text-bad transition-colors hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {deleting ? t("account.profile.deleting") : t("account.profile.deleteTitle")}
        </button>
      </section>
    </div>
  );
}

export function AccountPage() {
  const t = useT();
  const { status } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = isTab(tabParam) ? tabParam : "posts";
  const userId = getCurrentUserId();

  if (status !== "authenticated" || !userId) {
    return <SignInPrompt />;
  }

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  return (
    <Container size="wide" className="py-6 sm:py-10">
      <header className="mb-6 sm:mb-7">
        <p className="eyebrow flex items-center gap-1.5 text-accent">
          <UserRound size={14} /> {t("account.page.eyebrow")}
        </p>
        <h1 className="mt-2 text-[clamp(1.6rem,7vw,1.875rem)] font-bold tracking-tight sm:text-4xl">
          {t("account.page.title")}
        </h1>
        <p className="lede mt-2 max-w-xl text-pretty text-sm leading-relaxed text-fg-2">
          {t("account.page.subtitle")}
        </p>
      </header>

      <div
        role="tablist"
        aria-label={t("account.page.tabsAria")}
        className="rail -mx-4 mb-6 flex gap-1.5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0"
      >
        {TABS.map((option) => {
          const on = option.id === tab;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(option.id)}
              className={cn(
                "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
                on
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-2 hover:text-fg"
              )}
            >
              {t(option.labelKey)}
            </button>
          );
        })}
      </div>

      {tab === "posts" && <PostsTab userId={userId} />}
      {tab === "activity" && <ActivityTab />}
      {tab === "profile" && <ProfileTab />}
    </Container>
  );
}
