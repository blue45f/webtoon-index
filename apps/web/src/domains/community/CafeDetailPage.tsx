import { ArrowLeft, Coffee, Crown, DoorOpen, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import type { CommunityCafe } from "@/shared/lib/types";

import { FanCafePanel } from "@/shared/components/fan-cafe-panel";
import { Container } from "@/shared/components/section";
import { resolveApiError, safeParseJson } from "@/shared/lib/http-safe";
import { useApp } from "@/shared/lib/store";
import { relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import { api, apiPath, getApiErrorMessage } from "@/src/infrastructure/api";


// 장르 카페 상세(/community/cafes/:slug) — 카페 소개 + 가입/탈퇴 + 게시판(fan-cafe-panel 재사용).
// 글 작성은 가입 회원에게만 열리고, 미가입자는 composeLock으로 가입 액션을 안내한다.
export function CafeDetailPage() {
  const { slug: rawSlug } = useParams();
  const slug = rawSlug ?? "";
  const userId = useApp((s) => s.userId);
  const sessionToken = useApp((s) => s.sessionToken);

  const [cafe, setCafe] = useState<CommunityCafe | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useDocumentTitle(cafe ? `${cafe.name} 카페` : notFound ? "카페를 찾을 수 없어요" : "장르 카페");

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setNotFound(false);
    api
      .raw(apiPath(`/community/cafes/${encodeURIComponent(slug)}`), {
        cache: "no-store",
        signal: controller.signal,
        throwHttpErrors: false,
        headers: sessionToken ? { "x-user-id": sessionToken } : undefined,
      })
      .then(async (res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        const data = await safeParseJson<unknown>(res);
        if (!res.ok) throw new Error(resolveApiError(data, "카페 정보를 불러오지 못했습니다."));
        return data as CommunityCafe;
      })
      .then((data) => {
        if (data) setCafe(data);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError("카페 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshTick, sessionToken, slug]);

  async function changeMembership(action: "join" | "leave") {
    if (!userId || membershipBusy) return;
    if (action === "leave" && !globalThis.confirm("이 카페에서 탈퇴할까요?")) return;
    setMembershipBusy(true);
    setMembershipError(null);
    const fallback = action === "join" ? "가입하지 못했습니다." : "탈퇴하지 못했습니다.";
    const path = `/community/cafes/${encodeURIComponent(slug)}/membership`;
    const opts = {
      headers: sessionToken ? { "x-user-id": sessionToken } : undefined,
    };
    try {
      const data =
        action === "join"
          ? await api.post<CommunityCafe>(path, undefined, opts)
          : await api.delete<CommunityCafe>(path, opts);
      setCafe(data);
    } catch (err) {
      setMembershipError(await getApiErrorMessage(err, fallback));
    } finally {
      setMembershipBusy(false);
    }
  }

  if (loading && !cafe) {
    return (
      <Container size="wide" className="py-10">
        <div className="skeleton h-40 w-full rounded-3xl" />
        <div className="skeleton mt-6 h-72 w-full rounded-3xl" />
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container size="wide" className="py-16">
        <div className="rounded-3xl border border-dashed border-line bg-card/50 px-6 py-14 text-center">
          <Coffee className="mx-auto mb-3 text-fg-3" size={24} />
          <p className="eyebrow text-accent">GENRE CAFE</p>
          <h1 className="mt-2 text-2xl font-bold">카페를 찾을 수 없어요</h1>
          <p className="mt-2 text-sm text-fg-3">삭제됐거나 비공개 처리된 카페일 수 있습니다.</p>
          <Link
            href="/community/cafes"
            className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
          >
            <ArrowLeft size={15} />
            카페 목록으로
          </Link>
        </div>
      </Container>
    );
  }

  if (error || !cafe) {
    return (
      <Container size="wide" className="py-16">
        <div className="rounded-3xl border border-bad/35 bg-bad/10 px-6 py-10 text-center">
          <p className="text-sm font-medium text-bad">{error ?? "카페 정보를 불러오지 못했습니다."}</p>
          <button
            type="button"
            onClick={() => setRefreshTick((tick) => tick + 1)}
            className="mt-4 rounded-lg border border-bad/35 px-3 py-2 text-xs font-semibold text-bad"
          >
            다시 시도
          </button>
        </div>
      </Container>
    );
  }

  const isMember = Boolean(cafe.viewerIsMember);
  const isOwner = cafe.viewerRole === "owner";
  const composeLock = isMember
    ? null
    : {
        message: userId ? "카페에 가입한 회원만 글을 쓸 수 있어요." : "로그인 후 카페에 가입하면 글을 쓸 수 있어요.",
        actionLabel: userId ? "카페 가입하기" : undefined,
        onAction: userId ? () => void changeMembership("join") : undefined,
      };

  return (
    <Container size="wide" className="relative py-8 lg:py-10">
      <nav aria-label="이동 경로" className="mb-5 flex flex-wrap items-center gap-2 text-xs text-fg-3">
        <Link href="/community" className="transition-colors hover:text-fg">
          커뮤니티
        </Link>
        <span aria-hidden>/</span>
        <Link href="/community/cafes" className="transition-colors hover:text-fg">
          장르 카페
        </Link>
        <span aria-hidden>/</span>
        <span className="text-fg-2">{cafe.name}</span>
      </nav>

      <header className="rounded-3xl border border-line bg-panel/55 p-5 sm:p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-1.5 text-accent">
              <Coffee size={14} />
              GENRE CAFE
            </p>
            <h1 className="mt-2 flex flex-wrap items-center gap-2 text-[clamp(1.4rem,6vw,1.5rem)] font-bold tracking-tight sm:text-3xl">
              {cafe.name}
              <span className="rounded-full border border-line bg-canvas/45 px-2 py-0.5 text-[0.68rem] font-medium text-fg-3">
                {cafe.genre || "자유"}
              </span>
              {isOwner && (
                <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[0.68rem] font-semibold text-accent">
                  <Crown size={11} />
                  카페장
                </span>
              )}
            </h1>
            <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-fg-2">{cafe.description}</p>
            <p className="mt-3 text-xs text-fg-3">
              멤버 <span className="numeral text-fg-2">{cafe.memberCount}</span> · 글{" "}
              <span className="numeral text-fg-2">{cafe.postCount}</span> · 카페장 {cafe.ownerName} ·{" "}
              {relativeDate(cafe.createdAt)} 개설
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {userId ? (
              isMember ? (
                isOwner ? (
                  <p className="rounded-lg border border-line bg-canvas/45 px-3 py-2 text-xs text-fg-3">
                    카페장은 탈퇴할 수 없어요.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => void changeMembership("leave")}
                    disabled={membershipBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-fg-3 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-45"
                  >
                    <DoorOpen size={14} />
                    {membershipBusy ? "처리 중..." : "탈퇴하기"}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => void changeMembership("join")}
                  disabled={membershipBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-45"
                >
                  <UserPlus size={14} />
                  {membershipBusy ? "처리 중..." : "카페 가입하기"}
                </button>
              )
            ) : (
              <p className="rounded-lg border border-line bg-canvas/45 px-3 py-2 text-xs text-fg-3">
                로그인하면 가입할 수 있어요.
              </p>
            )}
            {membershipError && <p className="text-xs text-bad">{membershipError}</p>}
          </div>
        </div>
      </header>

      <section className="mt-6">
        <FanCafePanel scope="cafe" targetId={cafe.slug} targetLabel={cafe.name} composeLock={composeLock} compact />
      </section>
    </Container>
  );
}
