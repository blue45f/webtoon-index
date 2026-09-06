import { BookOpen, Check, Copy, ExternalLink, Printer, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ManualArticleView } from "./ManualArticleView";
import { MANUAL_ARTICLES, MANUAL_CATEGORIES, MANUAL_UPDATED, type ManualArticle } from "./studio-manual-data";
import { findManualArticle, MANUAL_BASE_PATH, MANUAL_QUERY_LIMIT, manualArticleHref, searchManual } from "./studio-manual-search";

import "./studio-manual.css";

function ManualContents({ activeId, onNavigate }: { readonly activeId?: string; readonly onNavigate: () => void }) {
  return (
    <nav aria-label="전체 매뉴얼 목차" className="manual-contents">
      <Link to={MANUAL_BASE_PATH} onClick={onNavigate} aria-current={activeId ? undefined : "page"}>매뉴얼 홈</Link>
      {MANUAL_CATEGORIES.map((category) => (
        <section key={category.id}>
          <h2>{category.title}</h2>
          {MANUAL_ARTICLES.filter((article) => article.category === category.id).map((article) => (
            <Link key={article.id} to={manualArticleHref(article.id)} onClick={onNavigate} aria-current={activeId === article.id ? "page" : undefined}>{article.title}</Link>
          ))}
        </section>
      ))}
    </nav>
  );
}

function ManualCards({ articles, onNavigate }: { readonly articles: readonly ManualArticle[]; readonly onNavigate: () => void }) {
  return (
    <div className="manual-cards">
      {articles.map((article) => (
        <Link className="manual-card" key={article.id} to={manualArticleHref(article.id)} onClick={onNavigate}>
          <span className="manual-eyebrow">{MANUAL_CATEGORIES.find((category) => category.id === article.category)?.title}</span>
          <h2>{article.title}<span aria-hidden="true"> ↗</span></h2>
          <p>{article.summary}</p>
        </Link>
      ))}
    </div>
  );
}

function ManualCopyButton() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [fallback, setFallback] = useState("");
  async function copyAddress() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(window.location.href);
      setStatus("copied");
    } catch {
      setFallback(window.location.href);
      setStatus("failed");
    }
  }
  return (
    <div className="manual-copy">
      <button type="button" onClick={() => { void copyAddress(); }}>{status === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}주소 복사</button>
      <span role="status" className="manual-copy-status">{status === "copied" ? "주소를 복사했습니다." : status === "failed" ? "복사 권한이 없습니다. 아래 주소를 선택해 복사하세요." : ""}</span>
      {status === "failed" && <input aria-label="직접 복사할 매뉴얼 주소" readOnly value={fallback} onFocus={(event) => event.currentTarget.select()} />}
    </div>
  );
}

function ManualHome({ query, category, onReset, onNavigate }: { readonly query: string; readonly category: string; readonly onReset: () => void; readonly onNavigate: () => void }) {
  const articles = searchManual(query, category);
  const filtered = query.trim().length > 0 || category !== "all";
  return (
    <>
      {!filtered && (
        <section className="manual-start" aria-labelledby="manual-start-title">
          <div><span className="manual-eyebrow">QUICK START</span><h2 id="manual-start-title">처음이라면, 한 컷부터.</h2><p>도구를 전부 외우기보다 작은 작업 하나를 완성해 보세요.</p></div>
          <ol>{[
            ["getting-started", "작업 준비"], ["brushes", "그리기"], ["lettering", "대사 넣기"], ["save-recovery", "안전하게 보관"],
          ].map(([id, title], index) => <li key={id}><Link to={manualArticleHref(id ?? "getting-started")} onClick={onNavigate}><span aria-hidden="true">0{index + 1}</span>{title} →</Link></li>)}</ol>
        </section>
      )}
      <div className="manual-results-heading"><h2>{filtered ? "검색 결과" : "기능별 매뉴얼"}</h2><p role="status">{articles.length}개 문서</p></div>
      {articles.length > 0 ? <ManualCards articles={articles} onNavigate={onNavigate} /> : (
        <div className="manual-empty"><h2>검색 결과가 없습니다</h2><p>짧은 기능 이름이나 다른 표현으로 찾아보세요. 예: 브러시, 버킷, 복구.</p><button type="button" onClick={onReset}>전체 문서 보기</button></div>
      )}
    </>
  );
}

export function StudioManualPage() {
  const { articleId } = useParams<{ articleId: string }>();
  const article = findManualArticle(articleId);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentsRef = useRef<HTMLDetailsElement>(null);
  const title = articleId && !article ? "문서를 찾을 수 없습니다" : article?.title ?? "스튜디오 매뉴얼";
  const searching = query.trim().length > 0 || category !== "all";

  useEffect(() => {
    document.title = `${title} · ToonStudio 사용자 매뉴얼`;
  }, [title]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target;
      if (event.defaultPrevented || event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function resetSearch() {
    setQuery("");
    setCategory("all");
  }
  function navigateDocument() {
    resetSearch();
    if (contentsRef.current) contentsRef.current.open = false;
  }

  return (
    <div className="studio-manual bg-canvas text-fg" lang="ko" data-testid="studio-manual">
      <a className="manual-skip" href="#manual-content">매뉴얼 본문으로 건너뛰기</a>
      <header className="manual-header manual-no-print">
        <Link className="manual-brand" to={MANUAL_BASE_PATH} onClick={navigateDocument}><BookOpen size={22} aria-hidden="true" /><span>ToonStudio <small>사용자 매뉴얼</small></span></Link>
        <a className="manual-open" href="/studio" target="_blank" rel="noopener noreferrer">스튜디오 열기<span className="manual-sr-only"> (새 탭)</span><ExternalLink size={15} aria-hidden="true" /></a>
      </header>
      <div className="manual-layout">
        <aside className="manual-sidebar manual-no-print"><ManualContents activeId={articleId} onNavigate={navigateDocument} /><p className="manual-updated">한국어 매뉴얼<br /><time dateTime={MANUAL_UPDATED}>2026.09.06 업데이트</time></p></aside>
        <div className="manual-main-column">
          <details ref={contentsRef} className="manual-mobile-contents manual-no-print"><summary>전체 목차 열기</summary><ManualContents activeId={articleId} onNavigate={navigateDocument} /></details>
          <div className="manual-search-bar manual-no-print" role="search" aria-label="매뉴얼 검색">
            <div className="manual-search-input"><Search size={19} aria-hidden="true" /><label className="manual-sr-only" htmlFor="manual-search">매뉴얼 검색어</label><input ref={searchRef} id="manual-search" type="search" placeholder="기능이나 궁금한 내용을 검색하세요" maxLength={MANUAL_QUERY_LIMIT} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") resetSearch(); }} /><kbd aria-hidden="true">/</kbd></div>
            <label className="manual-sr-only" htmlFor="manual-category">매뉴얼 분류</label><select id="manual-category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">전체 분류</option>{MANUAL_CATEGORIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>
            {searching && <button type="button" onClick={resetSearch}>검색 초기화</button>}
          </div>
          <article id="manual-content" tabIndex={-1} className="manual-content" aria-labelledby="manual-title">
            <nav className="manual-breadcrumb manual-no-print" aria-label="현재 위치"><Link to={MANUAL_BASE_PATH} onClick={navigateDocument}>매뉴얼</Link>{articleId && <><span aria-hidden="true">/</span><span>{title}</span></>}</nav>
            <div className="manual-title-row"><div><p className="manual-eyebrow">TOONSTUDIO USER GUIDE</p><h1 id="manual-title">{searching ? "매뉴얼 검색" : title}</h1></div></div>
            {!articleId && !searching && <p className="manual-summary">처음 시작하는 한 컷부터 복잡한 작업의 문제 해결까지.<br />필요한 순간, 필요한 기능을 찾아보세요.</p>}
            <div className="manual-actions manual-no-print"><ManualCopyButton key={articleId ?? "index"} /><button type="button" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />인쇄</button>{article && <a href={article.workspace} target="_blank" rel="noopener noreferrer">관련 작업 공간 열기<span className="manual-sr-only"> (새 탭)</span><ExternalLink size={15} aria-hidden="true" /></a>}</div>
            {searching || !articleId ? <ManualHome query={query} category={category} onReset={resetSearch} onNavigate={navigateDocument} /> : article ? <ManualArticleView article={article} /> : <div className="manual-empty"><p>주소가 변경되었거나 존재하지 않는 문서입니다. 목차 또는 검색으로 필요한 기능을 찾아보세요.</p><Link to={MANUAL_BASE_PATH}>매뉴얼 홈으로 돌아가기 →</Link></div>}
          </article>
          <footer className="manual-footer manual-no-print"><p>제작 강좌는 표현 방법을 배우는 곳, 매뉴얼은 프로그램 조작을 찾아보는 곳입니다.</p><Link to="/feedback">설명이 부족하거나 기능에 문제가 있나요? 의견 보내기 →</Link><p>작업 공간·기기·사용자 설정에 따라 제공되는 기능이 다를 수 있습니다. 실제 화면의 지원 안내를 함께 확인하세요.</p></footer>
        </div>
      </div>
    </div>
  );
}
