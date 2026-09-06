/** Preset discovery shares the existing catalog/commit authority; favorites are UI preferences. */
import { Search, Sparkles, Star, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { STUDIO_FOCUS_RING, StudioEmptyState, studioSegmentChipClass } from "../studio-panel-ui";

import { CHARACTER_GENRE_TAG_LABELS } from "./character-shaper-catalog";
import { countCharacterAvailability, discoverCharacterEntries } from "./character-shaper-discovery";
import { CharacterSlotPreview } from "./character-shaper-preview";
import {
  CHARACTER_HAND_SIDE_OPTIONS,
  CHARACTER_SHELF_COLUMNS,
  characterSlotSelection,
  collectShelfTags,
  isCharacterEntrySelected,
  isCharacterMultiSlot,
  listShelfEntries,
  moveCharacterGridIndex,
  pushCharacterShaperKeyLayer,
} from "./character-shaper-ui-model";
import { CharacterSlotCard } from "./CharacterSlotCard";
import { useCharacterShaperFavorites } from "./useCharacterShaperFavorites";

import type { CharacterGenreTag, CharacterSlotAvailability, CharacterSlotEntry } from "./character-shaper-contract";
import type { CharacterShelfCollection } from "./character-shaper-discovery";
import type { CharacterShaperShelfProps } from "./character-shaper-ui-contract";
import type { CharacterGridDirection } from "./character-shaper-ui-model";

import { cn } from "@/shared/lib/utils";

const SEARCH_DEBOUNCE_MS = 120;
const COLLECTIONS: readonly { readonly id: CharacterShelfCollection; readonly label: string }[] = [
  { id: "all", label: "모두" },
  { id: "favorites", label: "즐겨찾기" },
  { id: "selected", label: "선택됨" },
];

export function CharacterShaperShelf(props: CharacterShaperShelfProps) {
  // A slot is a search-session boundary, even when both slots' external query is the empty string.
  // Unmounting cancels an in-flight debounce/IME edit so it cannot leak into the next slot.
  return <CharacterShaperShelfContent key={props.slot} {...props} />;
}

function CharacterShaperShelfContent({
  binding, slot, query, tag, onQueryChange, onTagChange, onHoverEntry, onCommitEntry,
}: CharacterShaperShelfProps) {
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfterRemoval = useRef<number | null>(null);
  const favorites = useCharacterShaperFavorites();
  const [collection, setCollection] = useState<CharacterShelfCollection>("all");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [draft, setDraft] = useState(query);
  const [syncedQuery, setSyncedQuery] = useState(query);
  const [composing, setComposing] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const queryChangeRef = useRef(onQueryChange);
  useEffect(() => { queryChangeRef.current = onQueryChange; });

  if (syncedQuery !== query) {
    setSyncedQuery(query);
    setDraft(query);
  }
  useEffect(() => {
    if (composing || draft === query) return;
    const timer = window.setTimeout(() => queryChangeRef.current(draft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, query, composing]);

  useEffect(() => {
    if (draft.length === 0) return;
    return pushCharacterShaperKeyLayer((event) => {
      if (event.key !== "Escape" || event.target !== searchRef.current || event.isComposing || composing) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      setDraft("");
      queryChangeRef.current("");
      return true;
    }, window);
  }, [draft, composing]);

  const slotEntries = useMemo(() => listShelfEntries(binding.catalog.entries, slot), [binding.catalog.entries, slot]);
  const meta = binding.catalog.slots.find((candidate) => candidate.id === slot);
  const slotLabel = meta?.label ?? slot;
  const tags = useMemo(() => collectShelfTags(slotEntries), [slotEntries]);
  const favoriteSet = useMemo(() => new Set(favorites.ids), [favorites.ids]);
  const selection = characterSlotSelection(binding.recipe, slot);
  const selectedSet = new Set(selection);
  const availability = new Map(slotEntries.map((entry) => [entry.id, binding.evaluate(entry)]));
  const statuses = new Map([...availability].map(([id, result]) => [id, result.status]));
  const counts = countCharacterAvailability(slotEntries.map((entry) => entry.id), statuses);
  const visible = discoverCharacterEntries(slotEntries, {
    query, tag, collection, favorites: favoriteSet, selected: selectedSet, onlyAvailable,
    availability: statuses, tagLabels: CHARACTER_GENRE_TAG_LABELS,
  });
  const filtering = query.trim().length > 0 || tag !== null || collection !== "all" || onlyAvailable;
  const multi = isCharacterMultiSlot(slot);
  const equipped = multi ? slotEntries.filter((entry) => selectedSet.has(entry.id)) : [];
  const featured = slotEntries.filter((entry) => entry.featured);
  const lockReason = binding.busyReason ?? (binding.compareActive ? "처음 상태 비교를 마친 뒤에 적용해 주세요." : null);
  const focusedIndex = focusedId ? visible.findIndex((entry) => entry.id === focusedId) : -1;
  const rovingIndex = focusedIndex >= 0 ? focusedIndex : Math.max(0, visible.findIndex((entry) => selectedSet.has(entry.id)));

  const focusCardAt = (index: number) => {
    gridRef.current?.querySelectorAll<HTMLElement>("[data-character-slot-card]")[index]?.focus();
  };
  const navigateFrom = (index: number, direction: CharacterGridDirection) => {
    focusCardAt(moveCharacterGridIndex(index, visible.length, direction, CHARACTER_SHELF_COLUMNS));
  };
  useEffect(() => {
    const index = focusAfterRemoval.current;
    if (index === null) return;
    focusAfterRemoval.current = null;
    const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-character-slot-card]");
    if (cards?.length) cards[Math.min(index, cards.length - 1)]?.focus();
    else searchRef.current?.focus();
  });

  const clearSearch = () => { setDraft(""); onQueryChange(""); };
  const clearFilters = () => {
    clearSearch(); onTagChange(null); setCollection("all"); setOnlyAvailable(false);
  };
  const commitEntry = (entry: CharacterSlotEntry) => {
    if (lockReason || binding.evaluate(entry).status === "unavailable") return;
    onCommitEntry(entry);
  };
  const presentAvailability = (entry: CharacterSlotEntry): CharacterSlotAvailability => {
    const actual = availability.get(entry.id) ?? binding.evaluate(entry);
    return lockReason ? { ...actual, status: "unavailable", reason: lockReason } : actual;
  };
  const tagLabel = (genre: CharacterGenreTag): string => CHARACTER_GENRE_TAG_LABELS[genre] ?? genre;
  const emptyTitle = collection === "favorites" ? "조건에 맞는 즐겨찾기가 없습니다"
    : collection === "selected" ? "조건에 맞는 선택 항목이 없습니다" : "검색 결과가 없습니다";

  return (
    <div data-character-shaper-shelf={slot} className="flex h-full min-h-0 min-w-0 flex-col bg-panel">
      <div className="shrink-0 border-b border-line px-3 pb-2.5 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold tracking-tight text-fg">{slotLabel}</h3>
            {meta?.hint ? <p className="mt-0.5 line-clamp-1 text-[0.7rem] leading-snug text-fg-3">{meta.hint}</p> : null}
          </div>
          <span role="status" className="shrink-0 rounded-md border border-line/70 bg-card px-1.5 py-0.5 text-[0.66rem] font-semibold tabular-nums text-fg-3">
            {filtering ? `${visible.length}/${slotEntries.length}` : `${slotEntries.length}개`}
          </span>
        </div>
        <div className="relative mt-2">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input ref={searchRef} id={searchId} type="search" value={draft} maxLength={512}
            autoComplete="off" spellCheck={false} enterKeyHint="search" placeholder="이름·키워드·초성 검색"
            aria-label={`${slotLabel} 프리셋 검색`} data-character-shaper-search="true"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => { setDraft(event.currentTarget.value); setComposing(false); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || composing) return;
              if (event.key === "Escape" && draft.length > 0) {
                event.preventDefault(); event.stopPropagation(); clearSearch();
              }
            }}
            className={cn("h-11 w-full rounded-xl border border-line bg-card pl-8 pr-12 text-[0.8rem] text-fg placeholder:text-fg-3", "[&::-webkit-search-cancel-button]:hidden", STUDIO_FOCUS_RING)} />
          {draft.length > 0 ? <button type="button" aria-label="검색 지우기" onClick={clearSearch}
            className={cn("absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-fg-3 hover:bg-raised hover:text-fg", STUDIO_FOCUS_RING)}><X size={14} aria-hidden /></button> : null}
        </div>

      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div className="px-3 pb-2">
        <div role="group" aria-label="프리셋 모아보기" className="mt-2 grid grid-cols-3 gap-1">
          {COLLECTIONS.map((item) => <button key={item.id} type="button" aria-pressed={collection === item.id}
            onClick={() => setCollection(item.id)} className={cn(studioSegmentChipClass(collection === item.id), "min-h-11 min-w-0 px-1")}>
            {item.label}
          </button>)}
        </div>
        <button type="button" aria-pressed={onlyAvailable} onClick={() => setOnlyAvailable((current) => !current)}
          className={cn(studioSegmentChipClass(onlyAvailable), "mt-1 min-h-11 w-full justify-between gap-1")}
          title="부분 적용과 적용 불가 항목을 제외합니다. 모델이 바뀌면 다시 계산합니다.">
          <span>완전 지원만</span><span className="text-[0.65rem] tabular-nums">지원 {counts.available}개</span>
        </button>
        <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3" data-character-capability-counts="true">
          완전 지원 {counts.available} · 일부 적용 {counts.partial} · 적용 불가 {counts.unavailable}
        </p>
        {tags.length > 0 ? (
          <div role="group" aria-label="장르 필터" className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" aria-pressed={tag === null} onClick={() => onTagChange(null)} className={cn(studioSegmentChipClass(tag === null), "shrink-0")}>전체</button>
            {tags.map((genre) => <button key={genre} type="button" aria-pressed={tag === genre} onClick={() => onTagChange(tag === genre ? null : genre)} className={cn(studioSegmentChipClass(tag === genre), "shrink-0")}>{tagLabel(genre)}</button>)}
          </div>
        ) : null}
        {slot === "hand-pose" ? (
          <div role="group" aria-label="적용할 손" className="mt-2 grid grid-cols-3 gap-1 rounded-xl border border-line bg-card p-1">
            {CHARACTER_HAND_SIDE_OPTIONS.map((option) => <button key={option.value} type="button" disabled={lockReason !== null}
              aria-pressed={binding.handSide === option.value} onClick={() => binding.setHandSide(option.value)}
              className={cn("min-h-11 rounded-lg text-[0.74rem] font-semibold transition-colors disabled:opacity-45 motion-reduce:transition-none", STUDIO_FOCUS_RING, binding.handSide === option.value ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-raised hover:text-fg")}>{option.label}</button>)}
          </div>
        ) : null}
        </div>
        {lockReason ? <p role="status" className="m-3 rounded-lg border border-warn/45 bg-warn/10 p-2 text-[0.7rem] text-warn">{lockReason}</p> : null}
        {favorites.notice ? (
          <div className="mx-3 mt-2 space-y-1.5">
            <p role="status" className="text-[0.65rem] text-warn">{favorites.notice}</p>
            {favorites.hasPendingChanges ? (
              <button type="button" onClick={favorites.retrySave}
                aria-label="즐겨찾기 저장 다시 시도"
                className={cn("min-h-11 w-full rounded-lg border border-line bg-card px-3 text-[0.72rem] font-semibold text-fg-2 hover:bg-raised", STUDIO_FOCUS_RING)}>
                저장 다시 시도
              </button>
            ) : null}
          </div>
        ) : null}
        {multi && equipped.length > 0 ? (
          <section aria-label="장착 중" className="border-b border-line/70 px-3 py-2.5">
            <p className="mb-1.5 text-[0.66rem] font-semibold tracking-wide text-fg-3">장착 중 · {equipped.length}</p>
            <ul className="flex flex-wrap gap-1.5">
              {equipped.map((entry) => <li key={entry.id} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-accent/45 bg-accent-soft pl-3 pr-1 text-[0.72rem] font-semibold text-fg">
                <span className="max-w-[9rem] truncate">{entry.label}</span>
                <button type="button" disabled={lockReason !== null} aria-label={`${entry.label} 해제`}
                  onClick={() => { if (!lockReason) binding.remove(slot, entry.id); }}
                  className={cn("grid size-11 place-items-center rounded-full text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-45", STUDIO_FOCUS_RING)}><X size={13} aria-hidden /></button>
              </li>)}
            </ul>
          </section>
        ) : null}
        {!filtering && featured.length > 0 ? (
          <section aria-label="추천" className="border-b border-line/70 px-3 py-2.5">
            <p className="mb-1.5 inline-flex items-center gap-1 text-[0.66rem] font-semibold tracking-wide text-fg-3"><Sparkles size={12} aria-hidden className="text-accent" />추천</p>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {featured.map((entry) => {
                const status = presentAvailability(entry);
                const selected = isCharacterEntrySelected(binding.recipe, entry);
                const blocked = status.status === "unavailable";
                return <button key={entry.id} type="button" aria-pressed={selected} aria-disabled={blocked || undefined}
                  title={status.reason ?? entry.hint} data-character-shaper-featured={entry.id}
                  onClick={() => commitEntry(entry)} onPointerEnter={() => onHoverEntry(entry.id)}
                  onPointerLeave={() => onHoverEntry(null)} onFocus={() => onHoverEntry(entry.id)}
                  className={cn("flex min-h-11 shrink-0 items-center gap-2 rounded-xl border py-1 pl-1 pr-3 text-left text-[0.72rem] font-semibold", STUDIO_FOCUS_RING, selected ? "border-accent bg-accent-soft text-fg" : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg", blocked && "cursor-not-allowed opacity-55")}>
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-canvas/70"><CharacterSlotPreview spec={entry.preview} size={36} selected={selected} title={entry.label} /></span>
                  <span className="max-w-[7.5rem] truncate">{entry.label}</span>
                </button>;
              })}
            </div>
          </section>
        ) : null}
        {slotEntries.length === 0 ? <div className="p-3"><StudioEmptyState icon={<Sparkles size={18} aria-hidden />} title="이 슬롯에는 아직 프리셋이 없습니다" description="카탈로그가 준비되면 여기에 카드가 나타납니다." /></div>
          : visible.length === 0 ? <div className="p-3"><StudioEmptyState icon={<Search size={18} aria-hidden />} title={emptyTitle}
            description={collection === "favorites" ? "모두에서 카드 아래 별을 눌러 추가하거나 다른 필터를 해제해 보세요." : "다른 검색어를 입력하거나 필터를 해제해 보세요."}
            action={<button type="button" onClick={clearFilters} className={cn("inline-flex min-h-11 items-center rounded-lg border border-line bg-card px-3 text-[0.75rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg", STUDIO_FOCUS_RING)}>검색·필터 지우기</button>} /></div>
          : <div ref={gridRef} role="group" aria-label={`${slotLabel} 프리셋`} data-character-shaper-grid="true" className="grid grid-cols-2 items-start gap-2 p-3">
            {visible.map((entry, index) => (
              <div key={entry.id} className="min-w-0">
                <CharacterSlotCard entry={entry} availability={presentAvailability(entry)} selected={isCharacterEntrySelected(binding.recipe, entry)}
                  tabIndex={index === rovingIndex ? 0 : -1} onCommit={commitEntry} onHover={onHoverEntry}
                  onFocus={(id) => { setFocusedId(id); onHoverEntry(id); }} onKeyNavigate={(direction) => navigateFrom(index, direction)} />
                <button type="button" tabIndex={index === rovingIndex ? 0 : -1} aria-pressed={favoriteSet.has(entry.id)}
                  aria-label={`${entry.label} 즐겨찾기 ${favoriteSet.has(entry.id) ? "해제" : "추가"}`}
                  onFocus={() => setFocusedId(entry.id)}
                  onClick={() => {
                    const enabled = !favoriteSet.has(entry.id);
                    if (!enabled && collection === "favorites") { focusAfterRemoval.current = index; onHoverEntry(null); }
                    favorites.setFavorite(entry.id, enabled);
                  }}
                  className={cn("mt-1 flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-line bg-card text-[0.68rem] hover:bg-raised", STUDIO_FOCUS_RING, favoriteSet.has(entry.id) ? "text-accent" : "text-fg-3")}>
                  <Star size={13} aria-hidden fill={favoriteSet.has(entry.id) ? "currentColor" : "none"} />즐겨찾기
                </button>
              </div>
            ))}
          </div>}
        <p className="px-3 pb-3 text-[0.62rem] leading-relaxed text-fg-3">
          프리셋 그림은 형태 안내입니다. 실제 메시·재질 결과는 3D 화면에서 확인하세요. 즐겨찾기는 이 브라우저에만 저장됩니다.
        </p>
      </div>
    </div>
  );
}
