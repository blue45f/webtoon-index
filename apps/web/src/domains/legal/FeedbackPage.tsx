import { ArrowDown, ArrowUpRight, Bug, Check, Lightbulb, MessageSquarePlus, MessagesSquare, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";

import { FeedbackComposer } from "./feedback/FeedbackComposer";
import { FeedbackPostCard } from "./feedback/FeedbackPostCard";
import { useFeedbackFeed } from "./feedback/use-feedback-feed";
import "./feedback/feedback-community.css";

import type { FeedbackFilters } from "./feedback/use-feedback-feed";
import type { FeedbackEntry, FeedbackKind } from "@toonspectrum/core/feedback";

import { Container } from "@/shared/components/container";
import { useApp, useHydrated } from "@/shared/lib/store";
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABELS, FEEDBACK_PROGRESS, FEEDBACK_PROGRESS_LABELS, isFeedbackKind } from "@toonspectrum/core/feedback";

const EMPTY_FILTERS: FeedbackFilters = { category: "all", progress: "all", query: "", mine: false, tag: "" };
const INTAKES = [
  { kind: "bug", icon: Bug, title: "버그를 발견했어요", description: "불편했던 순간과 재현 방법을 알려주세요.", action: "버그 제보" },
  { kind: "idea", icon: Lightbulb, title: "이런 아이디어는 어때요?", description: "더 즐겁게 창작할 수 있는 생각을 나눠요.", action: "아이디어 제안" },
  { kind: "request", icon: Sparkles, title: "이 기능이 필요해요", description: "작업에 꼭 필요한 도구와 개선을 요청해요.", action: "기능 요청" },
] as const;
function initialKind(): FeedbackKind {
  if (typeof window === "undefined") return "bug";
  const kind = new URLSearchParams(window.location.search).get("type");
  return isFeedbackKind(kind) ? kind : "bug";
}
export function FeedbackPage() {
  const userId = useApp((state) => state.userId);
  const hydrated = useHydrated();
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [filters, setFilters] = useState<FeedbackFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [composerOpen, setComposerOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 761px)").matches);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const composer = useRef<HTMLDetailsElement | null>(null);
  const board = useRef<HTMLElement | null>(null);
  const feed = useFeedbackFeed(filters, userId);
  const chooseKind = (selected: FeedbackKind) => {
    setKind(selected); setComposerOpen(true);
    window.requestAnimationFrame(() => { composer.current?.scrollIntoView({ block: "nearest" }); composer.current?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true }); });
  };
  const searchExisting = (query: string) => {
    setSearch(query); setFilters({ ...EMPTY_FILTERS, query });
    board.current?.scrollIntoView({ block: "start" });
  };
  const created = (entry: FeedbackEntry) => {
    setNotice("제보가 등록되었습니다. 운영자의 검토와 다른 사용자의 의견을 이곳에서 확인할 수 있어요.");
    setFilters({ ...EMPTY_FILTERS, category: entry.category }); setSearch(""); setExpandedId(entry.id); feed.refresh();
    board.current?.scrollIntoView({ block: "start" });
  };
  const filtered = filters.category !== "all" || filters.progress !== "all" || !!filters.query || !!filters.tag || filters.mine;
  return <Container size="default" className="feedback-community">
    <header className="fb-hero">
      <div>
        <p className="fb-eyebrow"><MessagesSquare size={15} aria-hidden="true" /> TOONSTUDIO · COMMUNITY</p>
        <h1>제보·제안 커뮤니티</h1>
        <p className="fb-hero-title">더 나은 창작 경험,<br /><em>함께 만들어가요.</em></p>
        <p className="fb-hero-description">버그는 고치고, 아이디어는 키우고, 필요한 기능은 함께 논의해요.<br className="fb-desktop-break" /> 여러분의 의견과 운영자의 처리 과정을 한곳에서 확인하세요.</p>
      </div>
      <div className="fb-hero-aside">
        <span className="fb-small-label">당신의 한마디가 바꾸는 스튜디오</span>
        <div className="fb-process" aria-label="제보 처리 과정"><span><b>01</b>접수</span><span><b>02</b>검토·논의</span><span><b>03</b>반영 안내</span></div>
        <button className="fb-button fb-primary" type="button" onClick={() => chooseKind(kind)}><MessageSquarePlus size={17} aria-hidden="true" /> 제보 작성 <ArrowDown size={15} aria-hidden="true" /></button>
        <p className="fb-caption">누구나 읽고, 로그인 후 참여할 수 있어요.</p>
      </div>
    </header>
    <div className="fb-intakes" aria-label="제보 유형 선택">{INTAKES.map((intake) => <button type="button" key={intake.kind} className="fb-intake" data-kind={intake.kind} onClick={() => chooseKind(intake.kind)}><span className="fb-intake-icon"><intake.icon size={21} aria-hidden="true" /></span><span className="fb-intake-copy"><strong>{intake.title}</strong><span>{intake.description}</span><small>{intake.action} <ArrowUpRight size={13} aria-hidden="true" /></small></span></button>)}</div>
    <div className="fb-layout">
      <section className="fb-board" ref={board} aria-labelledby="fb-board-heading">
        <div className="fb-board-heading"><div><p className="fb-eyebrow">VOICE OF CREATORS</p><h2 id="fb-board-heading">함께 나누는 제보와 제안</h2></div><button type="button" className="fb-icon-button" onClick={feed.refresh} disabled={feed.loading} aria-label="제보 목록 새로고침"><RefreshCw size={17} aria-hidden="true" /></button></div>
        <form role="search" className="fb-search" onSubmit={(event) => { event.preventDefault(); setFilters((previous) => ({ ...previous, query: search.trim() })); }}><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="fb-search-input">제보 검색</label><input id="fb-search-input" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} placeholder="같은 제보가 있는지 먼저 찾아보세요" type="search" /><button className="fb-button" type="submit">검색</button></form>
        <div className="fb-tabs" role="group" aria-label="제보 유형 필터">{(["all", ...FEEDBACK_KINDS] as const).map((value) => <button type="button" key={value} aria-pressed={filters.category === value} onClick={() => setFilters((previous) => ({ ...previous, category: value }))}>{value === "all" ? "전체" : FEEDBACK_KIND_LABELS[value]}</button>)}</div>
        <div className="fb-filters"><div className="fb-status-filter"><label htmlFor="fb-progress-filter">처리 상태</label><select id="fb-progress-filter" value={filters.progress} onChange={(event) => setFilters((previous) => ({ ...previous, progress: event.target.value as FeedbackFilters["progress"] }))}><option value="all">전체 상태</option>{FEEDBACK_PROGRESS.map((value) => <option key={value} value={value}>{FEEDBACK_PROGRESS_LABELS[value]}</option>)}</select></div><button type="button" className="fb-my-posts" aria-pressed={filters.mine && !!userId} disabled={!userId} title={!userId ? "로그인 후 사용할 수 있어요" : undefined} onClick={() => setFilters((previous) => ({ ...previous, mine: !previous.mine }))}><Check size={13} aria-hidden="true" /> 내 제보</button><span className="fb-caption fb-order">최신순</span></div>
        {filtered && <div className="fb-active-filters">{filters.query && <span>검색: {filters.query}</span>}{filters.tag && <span>태그: #{filters.tag}</span>}<button type="button" className="fb-text-button" onClick={() => { setFilters(EMPTY_FILTERS); setSearch(""); }}>필터 초기화 <X size={13} aria-hidden="true" /></button></div>}
        {notice && <p className="fb-success fb-confirmation" role="status"><Check size={17} aria-hidden="true" />{notice}<button type="button" className="fb-icon-button" aria-label="등록 알림 닫기" onClick={() => setNotice("")}><X size={15} aria-hidden="true" /></button></p>}
        <div aria-busy={feed.loading}>
          {feed.loading && (feed.items.length
            ? <p className="fb-caption" role="status">최신 제보를 확인하고 있어요. 작성 중인 내용은 유지됩니다.</p>
            : <div className="fb-skeletons" role="status" aria-label="제보 목록 불러오는 중">{[0, 1, 2].map((key) => <div key={key} className="fb-skeleton" />)}</div>)}
          {feed.error && <div className="fb-empty" role="alert"><MessagesSquare size={30} aria-hidden="true" /><h3>제보 목록을 불러오지 못했어요</h3><p>{feed.error}</p>{feed.items.length > 0 && <p>아래는 이전에 불러온 목록입니다. 최신 내용을 확인한 뒤 다시 참여할 수 있어요.</p>}<button type="button" className="fb-button" onClick={feed.refresh}>다시 불러오기</button></div>}
          {/* Keep this list at a stable position while refreshing; inline drafts must not unmount. */}
          {feed.items.length > 0 && <>
            <p className="fb-list-count" role="status">현재 {feed.items.length}개의 제보를 보고 있어요{feed.hasMore ? " · 더 불러올 수 있어요" : ""}</p>
            <ul className="fb-posts">{feed.items.map((post) => <FeedbackPostCard key={`${post.id}:${userId ?? "guest"}`} post={post} userId={userId} canManage={feed.canManage} readOnly={!feed.apiReady} expanded={expandedId === post.id} onToggle={() => setExpandedId((previous) => previous === post.id ? null : post.id)} onUpdated={(patch) => feed.update(post.id, patch)} onTag={(tag) => setFilters((previous) => ({ ...previous, tag }))} />)}</ul>
          </>}
          {!feed.loading && !feed.error && feed.items.length === 0 && <div className="fb-empty"><MessagesSquare size={32} aria-hidden="true" /><h3>{filtered ? "조건에 맞는 제보가 없어요" : "첫 의견을 기다리고 있어요"}</h3><p>{filtered ? "다른 검색어나 필터로 찾아보거나 새 제보를 남겨주세요." : "불편했던 순간이나 떠오른 아이디어를 나눠주세요."}</p><button type="button" className="fb-button" onClick={() => chooseKind(kind)}>새 제보 작성</button></div>}
        </div>
        {feed.moreError && <p className="fb-error" role="alert">{feed.moreError}</p>}
        {feed.hasMore && !feed.loading && <button className="fb-button fb-more" type="button" onClick={() => { void feed.loadMore(); }} disabled={feed.loadingMore}>{feed.loadingMore ? "불러오는 중…" : feed.moreError ? "다음 제보 다시 불러오기" : "제보 더보기"}<ArrowDown size={15} aria-hidden="true" /></button>}
      </section>
      <aside className="fb-sidebar">
        <details ref={composer} className="fb-composer" open={composerOpen} onToggle={(event) => setComposerOpen(event.currentTarget.open)}>
          <summary><span><MessageSquarePlus size={18} aria-hidden="true" />새 제보 작성</span><span className="fb-caption">열기 / 접기</span></summary>
          <div className="fb-composer-content"><FeedbackComposer key={userId ?? "guest"} kind={kind} onKindChange={setKind} userId={userId} hydrated={hydrated} apiReady={feed.apiReady} onCreated={created} onSearch={searchExisting} /></div>
        </details>
        <section className="fb-guidelines" aria-labelledby="fb-guidelines-title"><p className="fb-eyebrow">BETTER TOGETHER</p><h2 id="fb-guidelines-title">좋은 의견이 좋은 도구를 만듭니다</h2><p><b>하나의 글에는 하나의 주제</b><br />관련 기능과 원하는 결과를 구체적으로 알려주세요.</p><p><b>같은 의견에는 공감과 댓글</b><br />중복 제보 대신 경험을 보태면 검토에 도움이 됩니다.</p><p><b>답변과 실제 반영은 구분합니다</b><br />‘운영자 답변’은 응답 여부, ‘처리 상태’는 개선 진행 상황입니다.</p><a href="/support" className="fb-text-button">기존 공개 문의 게시판 <ArrowUpRight size={14} aria-hidden="true" /></a></section>
      </aside>
    </div>
  </Container>;
}
