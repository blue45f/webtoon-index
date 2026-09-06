import { useState } from "react";
import { Link } from "react-router-dom";

import { RESOURCE_BUTTON, RESOURCE_INPUT } from "./navigation";
import { ResourceLayout } from "./ResourceLayout";
import { RESOURCE_SOURCES } from "./sources";

export function SourcesPage() {
  const [query, setQuery] = useState("");
  const rows = RESOURCE_SOURCES.filter((source) => `${source.name} ${source.category} ${source.status}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <ResourceLayout title="공식 자료·API 안내" intro="구현된 검색 어댑터와 공식 링크 안내를 구분합니다. 이 목록은 서비스 연결 성공을 보증하는 실시간 상태 페이지가 아닙니다.">
    <section className="space-y-3 rounded-2xl border border-line bg-panel p-6">
      <h2 className="text-xl font-bold">산업 자료를 읽을 때</h2>
      <p className="leading-8 text-fg-2">도서 대출, 작품 조회수, 매출, 산업 종사자 수는 서로 다른 지표입니다. 조사연도·발표일·단위·집계 범위가 다르면 합산하거나 하나의 인기 점수로 표시하지 않습니다. 현재 이 페이지는 공식 자료 안내이며, KOSIS 통계 수집이나 새로운 산업 차트를 구현한 것은 아닙니다.</p>
      <Link className={RESOURCE_BUTTON} to="/insights">기존 인사이트 보기</Link>
    </section>
    <label htmlFor="resource-source-filter" className="block font-semibold">제공처·분야·연결 상태 필터<input id="resource-source-filter" type="search" className={`${RESOURCE_INPUT} mt-2`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 창작 기회, 인증키, 통계" /></label>
    <p role="status" className="text-sm text-fg-2">{rows.length}개 제공처</p>
    <div className="grid gap-4 md:grid-cols-2">{rows.map((source) => <article key={source.name} className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-5">
      <p className="text-xs font-semibold text-accent">{source.category} · {source.status}</p><h2 className="text-lg font-bold">{source.name}</h2><p className="flex-1 text-sm leading-7 text-fg-2">{source.note}</p>
      <a className={RESOURCE_BUTTON} href={source.url} target="_blank" rel="noopener noreferrer">공식 안내 확인 ↗</a>
    </article>)}</div>
  </ResourceLayout>;
}
