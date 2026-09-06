import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

import { MANUAL_ARTICLES, MANUAL_SHORTCUTS, type ManualArticle } from "./studio-manual-data";
import { findManualArticle, manualArticleHref } from "./studio-manual-search";

export function ManualArticleView({ article }: { readonly article: ManualArticle }) {
  const { hash } = useLocation();
  const index = MANUAL_ARTICLES.findIndex((entry) => entry.id === article.id);
  const previous = MANUAL_ARTICLES[index - 1];
  const next = MANUAL_ARTICLES[index + 1];

  useEffect(() => {
    let anchor: string;
    try {
      anchor = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const knownAnchor = article.sections.some((section) => section.id === anchor)
      || (article.id === "shortcuts" && anchor === "shortcut-table");
    if (!knownAnchor) return;
    // The lazy article may mount after the browser's initial fragment navigation.
    // Run after the app shell's focus/scroll restoration and limit this to known section IDs.
    const frame = requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [article, hash]);

  return (
    <>
      <p className="manual-summary">{article.summary}</p>
      <details className="manual-inline-toc manual-no-print">
        <summary>이 문서의 목차</summary>
        <nav aria-label="문서 내 목차">
          {article.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}
          {article.id === "shortcuts" && <a href="#shortcut-table">기본 단축키 표</a>}
        </nav>
      </details>
      {article.sections.map((section) => (
        <section className="manual-section" key={section.id} aria-labelledby={section.id}>
          <h2 id={section.id}><a href={`#${section.id}`}>{section.title}</a></h2>
          {section.paragraphs.map((text) => <p key={text}>{text}</p>)}
          {section.steps && <ol>{section.steps.map((text) => <li key={text}>{text}</li>)}</ol>}
          {section.note && <aside className="manual-note"><strong>확인하세요</strong><p>{section.note}</p></aside>}
        </section>
      ))}
      {article.id === "shortcuts" && (
        <section className="manual-section" aria-labelledby="shortcut-table">
          <h2 id="shortcut-table">기본 단축키 표</h2>
          <div className="manual-table-wrap">
            <table>
              <caption>스튜디오 기본 단축키 일부. 사용자 지정 키맵은 스튜디오의 단축키 도움말에서 확인하세요.</caption>
              <thead><tr><th scope="col">키</th><th scope="col">동작</th></tr></thead>
              <tbody>{MANUAL_SHORTCUTS.map((row) => <tr key={row.keys}><th scope="row"><kbd>{row.keys}</kbd></th><td>{row.action}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      <section className="manual-related manual-no-print" aria-label="관련 매뉴얼">
        <h2>함께 보면 좋은 문서</h2>
        <div className="manual-tags">{article.related.map((id) => {
          const related = findManualArticle(id);
          return related ? <Link key={id} to={manualArticleHref(id)}>{related.title} →</Link> : null;
        })}</div>
      </section>
      <nav className="manual-pagination manual-no-print" aria-label="이전 다음 문서">
        <div>{previous && <Link to={manualArticleHref(previous.id)}><span>← 이전 문서</span>{previous.title}</Link>}</div>
        <div>{next && <Link to={manualArticleHref(next.id)}><span>다음 문서 →</span>{next.title}</Link>}</div>
      </nav>
    </>
  );
}
