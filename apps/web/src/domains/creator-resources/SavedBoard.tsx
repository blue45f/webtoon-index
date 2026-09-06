import { useState } from "react";

import { RESOURCE_BUTTON, RESOURCE_INPUT } from "./navigation";
import { downloadText } from "./workspace";

import type { BoardSort, DeadlineFilter } from "@/shared/lib/creator-resource-workflow";
import type { CreatorResource, ResourceProvider } from "@/shared/lib/creator-resources";

import { selectBoardResources } from "@/shared/lib/creator-resource-workflow";
import { attributionMarkdown, deadlineLabel, isProvider, RESOURCE_LABELS } from "@/shared/lib/creator-resources";

export function SavedBoard({ items, onRemove, disabled = false }: { items: readonly CreatorResource[]; onRemove: (id: string) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<ResourceProvider | "all">("all");
  const [sort, setSort] = useState<BoardSort>("saved");
  const [deadline, setDeadline] = useState<DeadlineFilter>("all");
  const canFilterDeadline = provider === "all" || provider === "bizinfo";
  const visible = selectBoardResources(items, { query, provider, sort, deadline: canFilterDeadline ? deadline : "all" });
  return <section aria-labelledby="saved-board-title" className="space-y-5 rounded-2xl border border-line bg-panel p-5 sm:p-6">
    <h2 id="saved-board-title" className="text-xl font-bold">저장한 자료 찾기</h2>
    <div className="grid gap-4 sm:grid-cols-2">
      <label htmlFor="board-query" className="text-sm font-semibold">제목·저작자·ISBN 검색
        <input id="board-query" type="search" maxLength={80} value={query} className={`${RESOURCE_INPUT} mt-2`} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label htmlFor="board-provider" className="text-sm font-semibold">제공처
        <select id="board-provider" className={`${RESOURCE_INPUT} mt-2`} value={provider} onChange={(event) => setProvider(isProvider(event.target.value) ? event.target.value : "all")}>
          <option value="all">모든 제공처</option>{Object.entries(RESOURCE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label htmlFor="board-sort" className="text-sm font-semibold">정렬
        <select id="board-sort" className={`${RESOURCE_INPUT} mt-2`} value={sort} onChange={(event) => setSort(event.target.value as BoardSort)}>
          <option value="saved">마지막에 추가한 자료</option><option value="recent">조회일 최신순</option><option value="title">제목순</option><option value="deadline">마감일 빠른순</option>
        </select>
      </label>
      <label htmlFor="board-deadline" className="text-sm font-semibold">공고 마감 날짜
        <select id="board-deadline" className={`${RESOURCE_INPUT} mt-2`} value={canFilterDeadline ? deadline : "all"} disabled={!canFilterDeadline} onChange={(event) => setDeadline(event.target.value as DeadlineFilter)}>
          <option value="all">전체 자료</option><option value="upcoming">오늘 이후 마감 날짜</option><option value="expired">마감일 경과</option><option value="unknown">마감일 원문 확인</option>
        </select>
      </label>
    </div>
    <p className="text-xs leading-6 text-fg-2">현재 브라우저의 저장 자료만 검색합니다. 마감 날짜 분류는 접수 중임을 보증하지 않습니다. 정확한 접수 시간은 원문에서 확인하세요.</p>
    <div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-fg-2">전체 {items.length}개 중 {visible.length}개 표시</p>
      <button className={RESOURCE_BUTTON} disabled={!visible.length} onClick={() => downloadText("selected-creator-sources.md", attributionMarkdown(visible))}>표시된 자료 출처 내보내기</button>
    </div>
    <div className="grid gap-4 md:grid-cols-2">{visible.map((item) => <article key={item.id} className="min-w-0 rounded-xl border border-line bg-canvas p-4">
      <p className="text-xs text-accent">{RESOURCE_LABELS[item.provider]} · {item.license === "CC0" ? "CC0" : "메타데이터"}</p>
      <h3 className="mt-2 break-words font-bold">{item.title}</h3>
      <p className="mt-2 text-sm text-fg-2">{item.creator || "저작자·기관 원문 확인"}</p>
      {item.provider === "bizinfo" && <p className="mt-2 text-sm">{deadlineLabel(item.deadline)}</p>}
      <div className="mt-3 flex flex-wrap gap-2"><a className={RESOURCE_BUTTON} href={item.sourceUrl} target="_blank" rel="noopener noreferrer">원문 확인 ↗</a>
        <button className={RESOURCE_BUTTON} disabled={disabled} aria-label={`${item.title} 저장 해제`} onClick={() => onRemove(item.id)}>저장 해제</button>
      </div>
    </article>)}</div>
    {!visible.length && <p className="rounded-xl border border-dashed border-line p-5 text-sm text-fg-2">{items.length ? "조건에 맞는 저장 자료가 없습니다. 검색어나 필터를 바꿔보세요." : "아직 저장한 자료가 없습니다. 기회센터·레퍼런스·도서 검색에서 보드에 저장을 선택하세요."}</p>}
  </section>;
}
