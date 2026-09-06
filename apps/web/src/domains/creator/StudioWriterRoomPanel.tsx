import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpenText,
  Check,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  UserRoundCog,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { confirmStudioDestructiveAction } from "./studio-destructive-action-preview";
import { studioDeleteWriterRoomItemRequest } from "./studio-destructive-command-catalog";
import { SFX_CATEGORIES, SFX_LIBRARY } from "./studio-sfx-presets";
import {
  admitStudioWriterRoomStage,
  setStudioWriterRoomStageCompleted,
  STUDIO_WRITER_ROOM_LIMITS,
  STUDIO_WRITER_ROOM_SFX_EMPHASIS,
  STUDIO_WRITER_ROOM_SFX_SCALES,
  STUDIO_WRITER_ROOM_STAGES,
  type StudioWriterRoomBeat,
  type StudioWriterRoomDialogue,
  type StudioWriterRoomDocument,
  type StudioWriterRoomEpisodeOutline,
  type StudioWriterRoomPanel,
  type StudioWriterRoomPremise,
  type StudioWriterRoomScene,
  type StudioWriterRoomSfx,
  type StudioWriterRoomStage,
  type StudioWriterRoomStages,
  type StudioWriterRoomSynopsis,
} from "./studio-writer-room";
import { STUDIO_WRITER_ROOM_STAGE_META } from "./studio-writer-room-ui";
import {
  StudioWriterRoomAiReviewPanel,
  StudioWriterRoomCanvasPlanHandoff,
  StudioWriterRoomSuggestionsPanel,
  type StudioWriterRoomAiReview,
  type StudioWriterRoomCanvasPlanSummary,
} from "./StudioWriterRoomReviewSurfaces";

import type { StudioCharacterBibleEntry } from "./studio-character-bible";

export type { StudioWriterRoomCanvasPlanSummary } from "./StudioWriterRoomReviewSurfaces";

export interface StudioWriterRoomPanelProps {
  open: boolean;
  onClose: () => void;
  document: StudioWriterRoomDocument;
  onChange: (document: StudioWriterRoomDocument) => void;
  characters: readonly StudioCharacterBibleEntry[];
  onRequestAi?: (stage: StudioWriterRoomStage) => void | Promise<void>;
  aiBusy?: boolean;
  aiError?: string | null;
  aiDirection?: string;
  onAiDirectionChange?: (value: string) => void;
  aiReview?: StudioWriterRoomAiReview | null;
  onApplyAiReview?: () => void;
  onDiscardAiReview?: () => void;
  onCancelAi?: () => void;
  onOpenCharacterBible?: () => void;
  /** Read-only projection summary. Passing it never applies or mutates the canvas. */
  canvasPlan?: StudioWriterRoomCanvasPlanSummary;
  /** Explicit user action that applies a ready projection to newly created pages. */
  onApplyCanvasPlan?: () => void | Promise<void>;
  canvasApplyBusy?: boolean;
}

const FIELD_CLASS =
  "mt-1.5 min-h-11 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35";
const ICON_BUTTON_CLASS =
  "grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35";

const EMPHASIS_LABELS: Record<(typeof STUDIO_WRITER_ROOM_SFX_EMPHASIS)[number], string> = {
  quiet: "조용하게",
  normal: "보통",
  strong: "강하게",
};

const SCALE_LABELS: Record<(typeof STUDIO_WRITER_ROOM_SFX_SCALES)[number], string> = {
  small: "작게",
  medium: "중간",
  large: "크게",
};

function createWriterRoomId(prefix: string, existingIds: readonly string[]): string {
  const existing = new Set(existingIds);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const randomPart = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const id = `${prefix}-${randomPart}`.slice(0, STUDIO_WRITER_ROOM_LIMITS.maxIdLength);
    if (!existing.has(id)) return id;
  }
  return `${prefix}-${Date.now().toString(36)}-${existingIds.length}`.slice(
    0,
    STUDIO_WRITER_ROOM_LIMITS.maxIdLength
  );
}

function orderedItems<Item extends { id: string; order: number }>(items: readonly Item[]): Item[] {
  return [...items].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
}

function moveItem<Item extends { id: string; order: number }>(
  items: readonly Item[],
  id: string,
  delta: -1 | 1
): Item[] {
  const sorted = orderedItems(items);
  const from = sorted.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= sorted.length) return sorted;
  const [moved] = sorted.splice(from, 1);
  if (!moved) return sorted;
  sorted.splice(to, 0, moved);
  return sorted.map((item, index) => ({ ...item, order: index }));
}

function updateItem<Item extends { id: string; order: number }>(
  items: readonly Item[],
  id: string,
  patch: Partial<Item>
): Item[] {
  return orderedItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

function clampOrder(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(STUDIO_WRITER_ROOM_LIMITS.maxOrder, Math.trunc(value)));
}

function nextOrder(items: readonly { order: number }[]): number {
  return Math.min(
    STUDIO_WRITER_ROOM_LIMITS.maxOrder,
    items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1
  );
}

function askBeforeDelete(label: string, onDelete: () => void) {
  void (async () => {
    if (
      !(await confirmStudioDestructiveAction(studioDeleteWriterRoomItemRequest(label)))
    ) {
      return;
    }
    onDelete();
  })();
}

function toggleId(ids: readonly string[], id: string, checked: boolean): string[] {
  if (checked) return ids.includes(id) ? [...ids] : [...ids, id];
  return ids.filter((candidate) => candidate !== id);
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
  hint?: string;
  rows?: number;
}

function TextField({ id, label, value, onChange, placeholder, maxLength, hint, rows }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <label htmlFor={id} className="block min-w-0 text-xs font-semibold text-fg-2">
      {label}
      {rows ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={rows}
          aria-describedby={hintId}
          className={`${FIELD_CLASS} resize-y`}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-describedby={hintId}
          className={FIELD_CLASS}
        />
      )}
      {hint && (
        <span id={hintId} className="mt-1 block text-[0.68rem] font-normal leading-relaxed text-fg-3">
          {hint}
        </span>
      )}
    </label>
  );
}

interface CharacterPickerProps {
  id: string;
  selectedIds: readonly string[];
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (ids: string[]) => void;
  onOpenCharacterBible?: () => void;
}

function CharacterPicker({
  id,
  selectedIds,
  characters,
  onChange,
  onOpenCharacterBible,
}: CharacterPickerProps) {
  const knownIds = new Set(characters.map((character) => character.id));
  const missingIds = selectedIds.filter((characterId) => !knownIds.has(characterId));

  return (
    <fieldset className="min-w-0">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <legend className="text-xs font-semibold text-fg-2">등장인물 참조</legend>
        {onOpenCharacterBible && (
          <button
            type="button"
            onClick={onOpenCharacterBible}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[0.68rem] font-semibold text-accent transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <UserRoundCog size={13} aria-hidden /> 바이블 편집
          </button>
        )}
      </div>
      {characters.length === 0 && missingIds.length === 0 ? (
        <div className="mt-1.5 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 text-xs text-fg-3">
          <span>캐릭터 바이블에 등장인물을 먼저 등록하세요.</span>
          {onOpenCharacterBible && (
            <button
              type="button"
              onClick={onOpenCharacterBible}
              className="min-h-9 shrink-0 rounded-lg border border-line px-2.5 font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              열기
            </button>
          )}
        </div>
      ) : (
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2" aria-label="등장인물 선택">
          {characters.map((character) => {
            const checked = selectedIds.includes(character.id);
            return (
              <label
                key={character.id}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
                  checked
                    ? "border-accent/50 bg-accent-soft text-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
                }`}
              >
                <input
                  id={`${id}-${character.id}`}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    onChange(toggleId(selectedIds, character.id, event.currentTarget.checked))
                  }
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1 truncate">
                  <strong className="font-semibold text-fg">
                    {character.name || "이름 없는 캐릭터"}
                  </strong>
                  {character.role && <span className="ml-1 text-fg-3">· {character.role}</span>}
                </span>
              </label>
            );
          })}
          {missingIds.map((characterId) => (
            <label
              key={characterId}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-warn/35 bg-warn/10 px-3 text-xs text-warn focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-warn"
            >
              <input
                id={`${id}-${characterId}`}
                type="checkbox"
                checked
                onChange={(event) =>
                  onChange(toggleId(selectedIds, characterId, event.currentTarget.checked))
                }
                className="size-4"
              />
              <span className="min-w-0 truncate">삭제된 캐릭터 참조 · {characterId}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

interface ReferencePickerProps {
  id: string;
  label: string;
  selectedIds: readonly string[];
  options: readonly { id: string; label: string }[];
  onChange: (ids: string[]) => void;
  emptyText: string;
}

function ReferencePicker({
  id,
  label,
  selectedIds,
  options,
  onChange,
  emptyText,
}: ReferencePickerProps) {
  const knownIds = new Set(options.map((option) => option.id));
  const missingIds = selectedIds.filter((selectedId) => !knownIds.has(selectedId));
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-fg-2">{label}</legend>
      {options.length === 0 && missingIds.length === 0 ? (
        <p className="mt-1.5 rounded-lg border border-dashed border-line px-3 py-3 text-xs text-fg-3">
          {emptyText}
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {options.map((option) => {
            const checked = selectedIds.includes(option.id);
            return (
              <label
                key={option.id}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
                  checked
                    ? "border-accent/50 bg-accent-soft text-fg"
                    : "border-line bg-card text-fg-2 hover:bg-raised"
                }`}
              >
                <input
                  id={`${id}-${option.id}`}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    onChange(toggleId(selectedIds, option.id, event.currentTarget.checked))
                  }
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
          {missingIds.map((missingId) => (
            <label
              key={missingId}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-warn/35 bg-warn/10 px-3 text-xs text-warn"
            >
              <input
                id={`${id}-${missingId}`}
                type="checkbox"
                checked
                onChange={(event) =>
                  onChange(toggleId(selectedIds, missingId, event.currentTarget.checked))
                }
                className="size-4"
              />
              누락된 참조 · {missingId}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

interface SelectReferenceProps {
  id: string;
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (value: string) => void;
  emptyLabel: string;
}

function SelectReference({ id, label, value, options, onChange, emptyLabel }: SelectReferenceProps) {
  const hasCurrent = !value || options.some((option) => option.id === value);
  return (
    <label htmlFor={id} className="block text-xs font-semibold text-fg-2">
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={FIELD_CLASS}
      >
        <option value="">{emptyLabel}</option>
        {!hasCurrent && <option value={value}>누락된 참조 · {value}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface ItemFrameProps {
  id: string;
  index: number;
  count: number;
  order: number;
  label: string;
  detail?: string;
  deleteLabel: string;
  onOrderChange: (order: number) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  children: ReactNode;
  defaultOpen?: boolean;
}

function ItemFrame({
  id,
  index,
  count,
  order,
  label,
  detail,
  deleteLabel,
  onOrderChange,
  onMove,
  onDelete,
  children,
  defaultOpen,
}: ItemFrameProps) {
  const [expanded, setExpanded] = useState(defaultOpen === true);
  return (
    <details
      className="group border-b border-line last:border-b-0 [contain-intrinsic-size:48px] [content-visibility:auto]"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden hover:bg-raised/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-raised text-[0.65rem] font-bold tabular-nums text-fg-3 group-open:bg-accent group-open:text-on-accent">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-fg">{label}</span>
          {detail && <span className="mt-0.5 block truncate text-[0.65rem] text-fg-3">{detail}</span>}
        </span>
        <span className="text-[0.65rem] tabular-nums text-fg-3">순서 {order}</span>
      </summary>
      <div className="border-t border-line bg-card/30 px-3 py-3 sm:px-4 sm:py-4">
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label htmlFor={`${id}-order`} className="w-24 text-[0.68rem] font-semibold text-fg-3">
            정렬 순서
            <input
              id={`${id}-order`}
              type="number"
              min={0}
              max={STUDIO_WRITER_ROOM_LIMITS.maxOrder}
              value={order}
              onChange={(event) => {
                if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                  onOrderChange(clampOrder(event.currentTarget.valueAsNumber));
                }
              }}
              className={`${FIELD_CLASS} tabular-nums`}
            />
          </label>
          <div className="ml-auto flex items-center gap-1" aria-label={`${label} 순서와 삭제`}>
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={index === 0}
              aria-label={`${label} 위로 이동`}
              className={ICON_BUTTON_CLASS}
            >
              <ArrowUp size={15} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={index >= count - 1}
              aria-label={`${label} 아래로 이동`}
              className={ICON_BUTTON_CLASS}
            >
              <ArrowDown size={15} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => askBeforeDelete(deleteLabel, onDelete)}
              aria-label={`${deleteLabel} 삭제`}
              className={`${ICON_BUTTON_CLASS} hover:border-bad/45 hover:bg-bad/10 hover:text-bad focus-visible:outline-bad`}
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </details>
  );
}

interface CollectionHeaderProps {
  title: string;
  description: string;
  count: number;
  onAdd: () => void;
  addLabel: string;
}

export function StudioWriterRoomCollectionHeader({
  title,
  description,
  count,
  onAdd,
  addLabel,
}: CollectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-line px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-bold text-fg">{title}</h4>
        <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">{description}</p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className={`${BUTTON_CLASS} bg-accent text-on-accent hover:border-accent hover:bg-accent-hover hover:text-on-accent`}
      >
        <Plus size={14} aria-hidden /> {addLabel}
      </button>
      <span className="w-full text-right text-[0.65rem] tabular-nums text-fg-3 sm:w-auto sm:self-center">
        {count.toLocaleString("ko-KR")}개
      </span>
    </div>
  );
}

function EmptyCollection({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-32 place-items-center px-5 py-8 text-center">
      <div className="max-w-sm">
        <BookOpenText size={22} className="mx-auto text-fg-3" aria-hidden />
        <p className="mt-2 text-xs font-semibold text-fg-2">{title}</p>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">{description}</p>
      </div>
    </div>
  );
}

interface TextStageEditorProps<Content extends StudioWriterRoomPremise | StudioWriterRoomSynopsis> {
  stage: "premise" | "synopsis";
  content: Content;
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (content: Content) => void;
  onOpenCharacterBible?: () => void;
}

function TextStageEditor<Content extends StudioWriterRoomPremise | StudioWriterRoomSynopsis>({
  stage,
  content,
  characters,
  onChange,
  onOpenCharacterBible,
}: TextStageEditorProps<Content>) {
  const premise = stage === "premise";
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6">
      <TextField
        id={`writer-room-${stage}-text`}
        label={premise ? "작품을 설명하는 한 문장" : "전체 이야기"}
        value={content.text}
        onChange={(text) => onChange({ ...content, text })}
        placeholder={
          premise
            ? "예: 기억을 잃을수록 강해지는 퇴마사가 사라진 형을 찾기 위해 금지된 도시로 들어간다."
            : "도입, 상승, 위기, 절정, 결말의 인과와 주인공의 감정 변화를 적어보세요."
        }
        maxLength={STUDIO_WRITER_ROOM_LIMITS.maxTextLength}
        rows={premise ? 4 : 12}
        hint={
          premise
            ? "주인공 + 목표 + 장애물 + 차별점이 드러나면 다음 단계의 기준이 선명해집니다."
            : "결말을 숨기지 않고 적어야 이후 장면과 복선을 안정적으로 검토할 수 있어요."
        }
      />
      <CharacterPicker
        id={`writer-room-${stage}-characters`}
        selectedIds={content.characterIds}
        characters={characters}
        onChange={(characterIds) => onChange({ ...content, characterIds })}
        onOpenCharacterBible={onOpenCharacterBible}
      />
    </div>
  );
}

interface EpisodeOutlineEditorProps {
  content: StudioWriterRoomEpisodeOutline;
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (content: StudioWriterRoomEpisodeOutline) => void;
  onOpenCharacterBible?: () => void;
}

function EpisodeOutlineEditor({
  content,
  characters,
  onChange,
  onOpenCharacterBible,
}: EpisodeOutlineEditorProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6">
      <TextField
        id="writer-room-episode-title"
        label="회차 제목"
        value={content.title}
        onChange={(title) => onChange({ ...content, title })}
        placeholder="예: 12화 · 문이 열린 밤"
        maxLength={STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength}
      />
      <TextField
        id="writer-room-episode-summary"
        label="회차 흐름과 마지막 훅"
        value={content.summary}
        onChange={(summary) => onChange({ ...content, summary })}
        placeholder="이번 회차에서 달성할 목표, 중간 전환, 마지막 컷의 질문이나 충격을 적어보세요."
        maxLength={STUDIO_WRITER_ROOM_LIMITS.maxTextLength}
        rows={9}
        hint="독자가 다음 회차를 눌러야 할 이유를 마지막 한두 문장에 구체적으로 남기세요."
      />
      <CharacterPicker
        id="writer-room-episode-characters"
        selectedIds={content.characterIds}
        characters={characters}
        onChange={(characterIds) => onChange({ ...content, characterIds })}
        onOpenCharacterBible={onOpenCharacterBible}
      />
    </div>
  );
}

interface BeatsEditorProps {
  items: readonly StudioWriterRoomBeat[];
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (items: StudioWriterRoomBeat[]) => void;
  onOpenCharacterBible?: () => void;
}

function BeatsEditor({ items, characters, onChange, onOpenCharacterBible }: BeatsEditorProps) {
  const sorted = orderedItems(items);
  const add = () => {
    const id = createWriterRoomId("beat", items.map((item) => item.id));
    onChange([
      ...sorted,
      { id, order: nextOrder(items), title: "", summary: "", characterIds: [] },
    ]);
  };
  return (
    <section className="mx-auto my-4 max-w-5xl overflow-hidden rounded-xl border border-line bg-card/20">
      <StudioWriterRoomCollectionHeader
        title="감정과 사건의 비트"
        description="한 비트에는 독자의 기대나 감정이 한 번 변하는 사건 하나만 둡니다."
        count={items.length}
        onAdd={add}
        addLabel="비트 추가"
      />
      {sorted.length === 0 ? (
        <EmptyCollection
          title="첫 비트를 추가하세요"
          description="도입 정보, 갈등 상승, 반전, 감정 보상, 다음 화 훅 순서로 시작하면 편합니다."
        />
      ) : (
        sorted.map((beat, index) => (
          <ItemFrame
            key={beat.id}
            id={`writer-room-beat-${beat.id}`}
            index={index}
            count={sorted.length}
            order={beat.order}
            label={beat.title || "제목 없는 비트"}
            detail={beat.summary || "사건과 감정 변화를 입력하세요."}
            deleteLabel={beat.title || "이 비트"}
            onOrderChange={(order) => onChange(updateItem(items, beat.id, { order }))}
            onMove={(delta) => onChange(moveItem(items, beat.id, delta))}
            onDelete={() => onChange(items.filter((item) => item.id !== beat.id))}
            defaultOpen={!beat.title && !beat.summary}
          >
            <TextField
              id={`writer-room-beat-${beat.id}-title`}
              label="비트 제목"
              value={beat.title}
              onChange={(title) => onChange(updateItem(items, beat.id, { title }))}
              placeholder="예: 금지 구역의 첫 경고"
              maxLength={STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength}
            />
            <TextField
              id={`writer-room-beat-${beat.id}-summary`}
              label="사건과 감정 변화"
              value={beat.summary}
              onChange={(summary) => onChange(updateItem(items, beat.id, { summary }))}
              placeholder="무슨 일이 일어나고, 그 전후로 인물이나 독자의 감정이 어떻게 달라지는지 적어보세요."
              maxLength={STUDIO_WRITER_ROOM_LIMITS.maxTextLength}
              rows={5}
            />
            <CharacterPicker
              id={`writer-room-beat-${beat.id}-characters`}
              selectedIds={beat.characterIds}
              characters={characters}
              onChange={(characterIds) =>
                onChange(updateItem(items, beat.id, { characterIds }))
              }
              onOpenCharacterBible={onOpenCharacterBible}
            />
          </ItemFrame>
        ))
      )}
    </section>
  );
}

interface ScenesEditorProps {
  items: readonly StudioWriterRoomScene[];
  beats: readonly StudioWriterRoomBeat[];
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (items: StudioWriterRoomScene[]) => void;
  onOpenCharacterBible?: () => void;
}

function ScenesEditor({
  items,
  beats,
  characters,
  onChange,
  onOpenCharacterBible,
}: ScenesEditorProps) {
  const sorted = orderedItems(items);
  const beatOptions = orderedItems(beats).map((beat, index) => ({
    id: beat.id,
    label: `${index + 1}. ${beat.title || "제목 없는 비트"}`,
  }));
  const add = () => {
    const id = createWriterRoomId("scene", items.map((item) => item.id));
    onChange([
      ...sorted,
      {
        id,
        order: nextOrder(items),
        beatIds: [],
        heading: "",
        summary: "",
        location: "",
        time: "",
        characterIds: [],
      },
    ]);
  };
  return (
    <section className="mx-auto my-4 max-w-5xl overflow-hidden rounded-xl border border-line bg-card/20">
      <StudioWriterRoomCollectionHeader
        title="장면 설계"
        description="같은 장소와 시간 안에서 이어지는 행동을 한 장면으로 묶습니다."
        count={items.length}
        onAdd={add}
        addLabel="장면 추가"
      />
      {sorted.length === 0 ? (
        <EmptyCollection
          title="비트를 장면으로 옮겨보세요"
          description="장소나 시간이 바뀌면 새 장면으로 나누고, 필요한 비트를 연결하세요."
        />
      ) : (
        sorted.map((scene, index) => (
          <ItemFrame
            key={scene.id}
            id={`writer-room-scene-${scene.id}`}
            index={index}
            count={sorted.length}
            order={scene.order}
            label={scene.heading || "제목 없는 장면"}
            detail={[scene.location, scene.time].filter(Boolean).join(" · ") || scene.summary}
            deleteLabel={scene.heading || "이 장면"}
            onOrderChange={(order) => onChange(updateItem(items, scene.id, { order }))}
            onMove={(delta) => onChange(moveItem(items, scene.id, delta))}
            onDelete={() => onChange(items.filter((item) => item.id !== scene.id))}
            defaultOpen={!scene.heading && !scene.summary}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id={`writer-room-scene-${scene.id}-heading`}
                label="장면 제목"
                value={scene.heading}
                onChange={(heading) => onChange(updateItem(items, scene.id, { heading }))}
                placeholder="예: 지하철 막차 — 플랫폼"
                maxLength={STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength}
              />
              <TextField
                id={`writer-room-scene-${scene.id}-location`}
                label="장소"
                value={scene.location}
                onChange={(location) => onChange(updateItem(items, scene.id, { location }))}
                placeholder="예: 폐쇄된 4번 승강장"
                maxLength={STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength}
              />
              <TextField
                id={`writer-room-scene-${scene.id}-time`}
                label="시간"
                value={scene.time}
                onChange={(time) => onChange(updateItem(items, scene.id, { time }))}
                placeholder="예: 자정 직전 · 비 오는 밤"
                maxLength={STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength}
              />
            </div>
            <TextField
              id={`writer-room-scene-${scene.id}-summary`}
              label="장면 안의 행동과 변화"
              value={scene.summary}
              onChange={(summary) => onChange(updateItem(items, scene.id, { summary }))}
              placeholder="장면 시작 상태, 핵심 행동, 끝났을 때 달라진 점을 적어보세요."
              maxLength={STUDIO_WRITER_ROOM_LIMITS.maxTextLength}
              rows={5}
            />
            <ReferencePicker
              id={`writer-room-scene-${scene.id}-beats`}
              label="이 장면이 수행하는 비트"
              selectedIds={scene.beatIds}
              options={beatOptions}
              onChange={(beatIds) => onChange(updateItem(items, scene.id, { beatIds }))}
              emptyText="비트 단계에서 항목을 만들면 이 장면에 연결할 수 있어요."
            />
            <CharacterPicker
              id={`writer-room-scene-${scene.id}-characters`}
              selectedIds={scene.characterIds}
              characters={characters}
              onChange={(characterIds) =>
                onChange(updateItem(items, scene.id, { characterIds }))
              }
              onOpenCharacterBible={onOpenCharacterBible}
            />
          </ItemFrame>
        ))
      )}
    </section>
  );
}

interface PanelsEditorProps {
  items: readonly StudioWriterRoomPanel[];
  scenes: readonly StudioWriterRoomScene[];
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (items: StudioWriterRoomPanel[]) => void;
  onOpenCharacterBible?: () => void;
}

function PanelsEditor({
  items,
  scenes,
  characters,
  onChange,
  onOpenCharacterBible,
}: PanelsEditorProps) {
  const sorted = orderedItems(items);
  const sceneOptions = orderedItems(scenes).map((scene, index) => ({
    id: scene.id,
    label: `${index + 1}. ${scene.heading || "제목 없는 장면"}`,
  }));
  const add = () => {
    const id = createWriterRoomId("panel", items.map((item) => item.id));
    onChange([
      ...sorted,
      {
        id,
        order: nextOrder(items),
        sceneId: sceneOptions[0]?.id ?? "",
        shot: "",
        action: "",
        characterIds: [],
      },
    ]);
  };
  return (
    <section className="mx-auto my-4 max-w-5xl overflow-hidden rounded-xl border border-line bg-card/20">
      <StudioWriterRoomCollectionHeader
        title="세로 스크롤 컷 플랜"
        description="한 컷에는 독자가 한눈에 읽을 수 있는 핵심 행동 하나만 둡니다."
        count={items.length}
        onAdd={add}
        addLabel="컷 추가"
      />
      {sorted.length === 0 ? (
        <EmptyCollection
          title="첫 컷을 설계하세요"
          description="와이드 전경, 인물 반응, 손이나 소품의 인서트처럼 시선 흐름을 번갈아 구성해 보세요."
        />
      ) : (
        sorted.map((panel, index) => (
          <ItemFrame
            key={panel.id}
            id={`writer-room-panel-${panel.id}`}
            index={index}
            count={sorted.length}
            order={panel.order}
            label={panel.shot || `컷 ${index + 1}`}
            detail={panel.action || "화면에 보일 핵심 행동을 입력하세요."}
            deleteLabel={panel.shot || `컷 ${index + 1}`}
            onOrderChange={(order) => onChange(updateItem(items, panel.id, { order }))}
            onMove={(delta) => onChange(moveItem(items, panel.id, delta))}
            onDelete={() => onChange(items.filter((item) => item.id !== panel.id))}
            defaultOpen={!panel.shot && !panel.action}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectReference
                id={`writer-room-panel-${panel.id}-scene`}
                label="연결 장면"
                value={panel.sceneId}
                options={sceneOptions}
                onChange={(sceneId) => onChange(updateItem(items, panel.id, { sceneId }))}
                emptyLabel="장면 미연결"
              />
              <TextField
                id={`writer-room-panel-${panel.id}-shot`}
                label="샷과 구도"
                value={panel.shot}
                onChange={(shot) => onChange(updateItem(items, panel.id, { shot }))}
                placeholder="예: 로우 앵글 미디엄 클로즈업"
                maxLength={STUDIO_WRITER_ROOM_LIMITS.maxShortTextLength}
              />
            </div>
            <TextField
              id={`writer-room-panel-${panel.id}-action`}
              label="화면에 보이는 행동"
              value={panel.action}
              onChange={(action) => onChange(updateItem(items, panel.id, { action }))}
              placeholder="독자가 실제 그림에서 확인할 수 있는 동작, 표정, 소품 변화를 적어보세요."
              maxLength={STUDIO_WRITER_ROOM_LIMITS.maxTextLength}
              rows={5}
            />
            <CharacterPicker
              id={`writer-room-panel-${panel.id}-characters`}
              selectedIds={panel.characterIds}
              characters={characters}
              onChange={(characterIds) =>
                onChange(updateItem(items, panel.id, { characterIds }))
              }
              onOpenCharacterBible={onOpenCharacterBible}
            />
          </ItemFrame>
        ))
      )}
    </section>
  );
}

interface DialogueEditorProps {
  items: readonly StudioWriterRoomDialogue[];
  panels: readonly StudioWriterRoomPanel[];
  characters: readonly StudioCharacterBibleEntry[];
  onChange: (items: StudioWriterRoomDialogue[]) => void;
}

function DialogueEditor({ items, panels, characters, onChange }: DialogueEditorProps) {
  const sorted = orderedItems(items);
  const panelOptions = orderedItems(panels).map((panel, index) => ({
    id: panel.id,
    label: `${index + 1}. ${panel.shot || panel.action || "내용 없는 컷"}`,
  }));
  const add = () => {
    const id = createWriterRoomId("dialogue", items.map((item) => item.id));
    onChange([
      ...sorted,
      {
        id,
        order: nextOrder(items),
        panelId: panelOptions[0]?.id ?? "",
        characterId: null,
        text: "",
      },
    ]);
  };
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-card/20">
      <StudioWriterRoomCollectionHeader
        title="컷별 대사"
        description="말풍선 하나에 한 호흡을 두고, 화자의 바이블 말투와 대조해 검토합니다."
        count={items.length}
        onAdd={add}
        addLabel="대사 추가"
      />
      {sorted.length === 0 ? (
        <EmptyCollection
          title="대사를 컷에 연결하세요"
          description="화자가 없는 내레이션도 추가할 수 있습니다."
        />
      ) : (
        sorted.map((dialogue, index) => {
          const speaker = characters.find((character) => character.id === dialogue.characterId);
          return (
            <ItemFrame
              key={dialogue.id}
              id={`writer-room-dialogue-${dialogue.id}`}
              index={index}
              count={sorted.length}
              order={dialogue.order}
              label={speaker?.name || (dialogue.characterId ? "삭제된 화자" : "내레이션")}
              detail={dialogue.text || "대사를 입력하세요."}
              deleteLabel={`${speaker?.name || "이"} 대사`}
              onOrderChange={(order) => onChange(updateItem(items, dialogue.id, { order }))}
              onMove={(delta) => onChange(moveItem(items, dialogue.id, delta))}
              onDelete={() => onChange(items.filter((item) => item.id !== dialogue.id))}
              defaultOpen={!dialogue.text}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectReference
                  id={`writer-room-dialogue-${dialogue.id}-panel`}
                  label="연결 컷"
                  value={dialogue.panelId}
                  options={panelOptions}
                  onChange={(panelId) =>
                    onChange(updateItem(items, dialogue.id, { panelId }))
                  }
                  emptyLabel="컷 미연결"
                />
                <label
                  htmlFor={`writer-room-dialogue-${dialogue.id}-speaker`}
                  className="block text-xs font-semibold text-fg-2"
                >
                  화자
                  <select
                    id={`writer-room-dialogue-${dialogue.id}-speaker`}
                    value={dialogue.characterId ?? ""}
                    onChange={(event) =>
                      onChange(
                        updateItem(items, dialogue.id, {
                          characterId: event.currentTarget.value || null,
                        })
                      )
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="">내레이션 / 화자 없음</option>
                    {dialogue.characterId &&
                      !characters.some((character) => character.id === dialogue.characterId) && (
                        <option value={dialogue.characterId}>
                          삭제된 화자 · {dialogue.characterId}
                        </option>
                      )}
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name || "이름 없는 캐릭터"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <TextField
                id={`writer-room-dialogue-${dialogue.id}-text`}
                label="대사 또는 내레이션"
                value={dialogue.text}
                onChange={(text) => onChange(updateItem(items, dialogue.id, { text }))}
                placeholder="말풍선 한 개에 들어갈 한 호흡을 적어보세요."
                maxLength={STUDIO_WRITER_ROOM_LIMITS.maxDialogueLength}
                rows={4}
              />
            </ItemFrame>
          );
        })
      )}
    </section>
  );
}

interface SfxEditorProps {
  items: readonly StudioWriterRoomSfx[];
  panels: readonly StudioWriterRoomPanel[];
  onChange: (items: StudioWriterRoomSfx[]) => void;
}

function SfxEditor({ items, panels, onChange }: SfxEditorProps) {
  const sorted = orderedItems(items);
  const panelOptions = orderedItems(panels).map((panel, index) => ({
    id: panel.id,
    label: `${index + 1}. ${panel.shot || panel.action || "내용 없는 컷"}`,
  }));
  const add = () => {
    const id = createWriterRoomId("sfx", items.map((item) => item.id));
    onChange([
      ...sorted,
      {
        id,
        order: nextOrder(items),
        panelId: panelOptions[0]?.id ?? "",
        presetId: SFX_LIBRARY[0]?.id ?? null,
        customText: "",
        style: { emphasis: "normal", scale: "medium" },
      },
    ]);
  };
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-card/20">
      <StudioWriterRoomCollectionHeader
        title="효과음 레터링"
        description="프리셋을 고르거나 직접 입력하고, 장면의 강도에 맞춰 크기와 강조를 지정합니다."
        count={items.length}
        onAdd={add}
        addLabel="효과음 추가"
      />
      {sorted.length === 0 ? (
        <EmptyCollection
          title="소리의 리듬을 추가하세요"
          description="충격음뿐 아니라 정적, 움직임, 환경음을 배치하면 스크롤의 속도가 살아납니다."
        />
      ) : (
        sorted.map((sfx, index) => {
          const preset = SFX_LIBRARY.find((candidate) => candidate.id === sfx.presetId);
          return (
            <ItemFrame
              key={sfx.id}
              id={`writer-room-sfx-${sfx.id}`}
              index={index}
              count={sorted.length}
              order={sfx.order}
              label={sfx.customText || preset?.text || "효과음"}
              detail={`${EMPHASIS_LABELS[sfx.style.emphasis]} · ${SCALE_LABELS[sfx.style.scale]}`}
              deleteLabel={sfx.customText || preset?.label || "이 효과음"}
              onOrderChange={(order) => onChange(updateItem(items, sfx.id, { order }))}
              onMove={(delta) => onChange(moveItem(items, sfx.id, delta))}
              onDelete={() => onChange(items.filter((item) => item.id !== sfx.id))}
              defaultOpen={!sfx.presetId && !sfx.customText}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectReference
                  id={`writer-room-sfx-${sfx.id}-panel`}
                  label="연결 컷"
                  value={sfx.panelId}
                  options={panelOptions}
                  onChange={(panelId) => onChange(updateItem(items, sfx.id, { panelId }))}
                  emptyLabel="컷 미연결"
                />
                <label
                  htmlFor={`writer-room-sfx-${sfx.id}-preset`}
                  className="block text-xs font-semibold text-fg-2"
                >
                  효과음 프리셋
                  <select
                    id={`writer-room-sfx-${sfx.id}-preset`}
                    value={sfx.presetId ?? ""}
                    onChange={(event) =>
                      onChange(
                        updateItem(items, sfx.id, {
                          presetId: event.currentTarget.value || null,
                        })
                      )
                    }
                    className={FIELD_CLASS}
                  >
                    <option value="">프리셋 없음 · 직접 입력</option>
                    {SFX_CATEGORIES.map((category) => (
                      <optgroup key={category.id} label={category.label}>
                        {SFX_LIBRARY.filter((candidate) => candidate.category === category.id).map(
                          (candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.label} · {candidate.text}
                            </option>
                          )
                        )}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </div>
              <TextField
                id={`writer-room-sfx-${sfx.id}-custom-text`}
                label="직접 입력 효과음"
                value={sfx.customText}
                onChange={(customText) => onChange(updateItem(items, sfx.id, { customText }))}
                placeholder="프리셋 문구를 바꾸거나 새로운 효과음을 입력하세요."
                maxLength={STUDIO_WRITER_ROOM_LIMITS.maxSfxTextLength}
                hint="직접 입력 문구가 있으면 프리셋보다 우선해 사용합니다."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <label
                  htmlFor={`writer-room-sfx-${sfx.id}-emphasis`}
                  className="block text-xs font-semibold text-fg-2"
                >
                  강조 강도
                  <select
                    id={`writer-room-sfx-${sfx.id}-emphasis`}
                    value={sfx.style.emphasis}
                    onChange={(event) =>
                      onChange(
                        updateItem(items, sfx.id, {
                          style: {
                            ...sfx.style,
                            emphasis: event.currentTarget
                              .value as StudioWriterRoomSfx["style"]["emphasis"],
                          },
                        })
                      )
                    }
                    className={FIELD_CLASS}
                  >
                    {STUDIO_WRITER_ROOM_SFX_EMPHASIS.map((emphasis) => (
                      <option key={emphasis} value={emphasis}>
                        {EMPHASIS_LABELS[emphasis]}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  htmlFor={`writer-room-sfx-${sfx.id}-scale`}
                  className="block text-xs font-semibold text-fg-2"
                >
                  글자 크기
                  <select
                    id={`writer-room-sfx-${sfx.id}-scale`}
                    value={sfx.style.scale}
                    onChange={(event) =>
                      onChange(
                        updateItem(items, sfx.id, {
                          style: {
                            ...sfx.style,
                            scale: event.currentTarget.value as StudioWriterRoomSfx["style"]["scale"],
                          },
                        })
                      )
                    }
                    className={FIELD_CLASS}
                  >
                    {STUDIO_WRITER_ROOM_SFX_SCALES.map((scale) => (
                      <option key={scale} value={scale}>
                        {SCALE_LABELS[scale]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </ItemFrame>
          );
        })
      )}
    </section>
  );
}

interface DialogueSfxEditorProps {
  dialogue: readonly StudioWriterRoomDialogue[];
  sfx: readonly StudioWriterRoomSfx[];
  panels: readonly StudioWriterRoomPanel[];
  characters: readonly StudioCharacterBibleEntry[];
  onDialogueChange: (items: StudioWriterRoomDialogue[]) => void;
  onSfxChange: (items: StudioWriterRoomSfx[]) => void;
}

function DialogueSfxEditor({
  dialogue,
  sfx,
  panels,
  characters,
  onDialogueChange,
  onSfxChange,
}: DialogueSfxEditorProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-5">
      <DialogueEditor
        items={dialogue}
        panels={panels}
        characters={characters}
        onChange={onDialogueChange}
      />
      <SfxEditor items={sfx} panels={panels} onChange={onSfxChange} />
    </div>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("hidden") && element.offsetParent !== null);
}

export function StudioWriterRoomPanel({
  open,
  onClose,
  document,
  onChange,
  characters,
  onRequestAi,
  aiBusy = false,
  aiError = null,
  aiDirection = "",
  onAiDirectionChange,
  aiReview = null,
  onApplyAiReview,
  onDiscardAiReview,
  onCancelAi,
  onOpenCharacterBible,
  canvasPlan,
  onApplyCanvasPlan,
  canvasApplyBusy = false,
}: StudioWriterRoomPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState<StudioWriterRoomStage>("premise");
  const [actionError, setActionError] = useState<string | null>(null);
  const [requestingAi, setRequestingAi] = useState(false);
  const completedCount = STUDIO_WRITER_ROOM_STAGES.reduce(
    (count, stage) => count + (document.completion[stage] ? 1 : 0),
    0
  );
  const progressPercent = Math.round(
    (completedCount / STUDIO_WRITER_ROOM_STAGES.length) * 100
  );
  const activeIndex = STUDIO_WRITER_ROOM_STAGES.indexOf(activeStage);
  const pendingCount = document.suggestions.filter(
    (suggestion) => suggestion.status === "pending"
  ).length;
  const effectiveAiBusy = aiBusy || requestingAi;

  useEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;
    const body = globalThis.document.body;
    const previousOverflow = body.style.overflow;
    const previousFocus = globalThis.document.activeElement as HTMLElement | null;
    body.style.overflow = "hidden";
    const frame = globalThis.requestAnimationFrame(() => dialogRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof globalThis.document === "undefined") return null;

  const emitStage = <Stage extends StudioWriterRoomStage>(
    stage: Stage,
    content: StudioWriterRoomStages[Stage]
  ) => {
    try {
      const receipt = admitStudioWriterRoomStage(document, stage, content);
      if (receipt.kind === "rejected") {
        setActionError(
          receipt.reason === "byte-budget-exceeded"
            ? "Writer Room 문서가 2,000,000바이트 저장 예산을 초과해 변경하지 않았어요."
            : "Writer Room 변경을 안전하게 읽을 수 없어 기존 문서를 유지했어요."
        );
        return;
      }
      onChange(receipt.document);
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Writer Room 변경을 저장하지 못했어요.");
    }
  };

  const selectStage = (stage: StudioWriterRoomStage) => {
    setActiveStage(stage);
    setActionError(null);
  };

  const onStageKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (activeIndex + 1) % STUDIO_WRITER_ROOM_STAGES.length;
    else if (event.key === "ArrowLeft") {
      nextIndex = (activeIndex - 1 + STUDIO_WRITER_ROOM_STAGES.length) % STUDIO_WRITER_ROOM_STAGES.length;
    } else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = STUDIO_WRITER_ROOM_STAGES.length - 1;
    else return;
    event.preventDefault();
    const stage = STUDIO_WRITER_ROOM_STAGES[nextIndex];
    if (!stage) return;
    selectStage(stage);
    globalThis.document.getElementById(`writer-room-tab-${stage}`)?.focus();
  };

  const requestAi = async () => {
    if (!onRequestAi || effectiveAiBusy) return;
    setRequestingAi(true);
    setActionError(null);
    try {
      await onRequestAi(activeStage);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "AI 제안을 받지 못했어요.");
    } finally {
      setRequestingAi(false);
    }
  };

  const stageEditor = (() => {
    switch (activeStage) {
      case "premise":
        return (
          <TextStageEditor
            stage="premise"
            content={document.stages.premise}
            characters={characters}
            onChange={(content) => emitStage("premise", content)}
            onOpenCharacterBible={onOpenCharacterBible}
          />
        );
      case "synopsis":
        return (
          <TextStageEditor
            stage="synopsis"
            content={document.stages.synopsis}
            characters={characters}
            onChange={(content) => emitStage("synopsis", content)}
            onOpenCharacterBible={onOpenCharacterBible}
          />
        );
      case "episode-outline":
        return (
          <EpisodeOutlineEditor
            content={document.stages["episode-outline"]}
            characters={characters}
            onChange={(content) => emitStage("episode-outline", content)}
            onOpenCharacterBible={onOpenCharacterBible}
          />
        );
      case "beats":
        return (
          <BeatsEditor
            items={document.stages.beats.items}
            characters={characters}
            onChange={(items) => emitStage("beats", { items })}
            onOpenCharacterBible={onOpenCharacterBible}
          />
        );
      case "scenes":
        return (
          <ScenesEditor
            items={document.stages.scenes.items}
            beats={document.stages.beats.items}
            characters={characters}
            onChange={(items) => emitStage("scenes", { items })}
            onOpenCharacterBible={onOpenCharacterBible}
          />
        );
      case "panel-plan":
        return (
          <PanelsEditor
            items={document.stages["panel-plan"].items}
            scenes={document.stages.scenes.items}
            characters={characters}
            onChange={(items) => emitStage("panel-plan", { items })}
            onOpenCharacterBible={onOpenCharacterBible}
          />
        );
      case "dialogue-sfx":
        return (
          <DialogueSfxEditor
            dialogue={document.stages["dialogue-sfx"].dialogue}
            sfx={document.stages["dialogue-sfx"].sfx}
            panels={document.stages["panel-plan"].items}
            characters={characters}
            onDialogueChange={(dialogue) =>
              emitStage("dialogue-sfx", {
                ...document.stages["dialogue-sfx"],
                dialogue,
              })
            }
            onSfxChange={(sfx) =>
              emitStage("dialogue-sfx", {
                ...document.stages["dialogue-sfx"],
                sfx,
              })
            }
          />
        );
    }
  })();

  const modal = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-writer-room-title"
      aria-describedby="studio-writer-room-description"
      tabIndex={-1}
      className="fixed inset-0 z-[90] h-[100dvh] bg-[oklch(0.08_0.01_70/0.9)] text-fg focus:outline-none"
    >
      <div className="mx-auto flex h-full w-full max-w-[100rem] flex-col overflow-hidden border-line bg-panel sm:border-x">
        <header
          className="shrink-0 border-b border-line bg-panel px-3 pb-3 sm:px-5"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <BookOpenText size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="studio-writer-room-title" className="text-base font-bold tracking-tight text-fg">
                  Writer Room
                </h2>
                <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.65rem] tabular-nums text-fg-3">
                  {completedCount}/{STUDIO_WRITER_ROOM_STAGES.length} 완료
                </span>
                {pendingCount > 0 && (
                  <span className="rounded-full border border-cool/35 bg-cool/10 px-2 py-0.5 text-[0.65rem] tabular-nums text-cool">
                    제안 {pendingCount}
                  </span>
                )}
              </div>
              <p
                id="studio-writer-room-description"
                className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-fg-3"
              >
                기획에서 대사까지 한 흐름으로 설계하고, AI 제안은 승인한 항목만 반영합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Writer Room 닫기"
              className={ICON_BUTTON_CLASS}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-raised"
              role="progressbar"
              aria-label="Writer Room 진행률"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="shrink-0 text-[0.68rem] font-semibold tabular-nums text-fg-2">
              {progressPercent}%
            </span>
          </div>
        </header>

        <nav
          className="shrink-0 overflow-x-auto border-b border-line bg-card/35 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Writer Room 단계"
        >
          <div className="flex min-w-max px-2 sm:px-4" role="tablist" aria-label="작가실 단계">
            {STUDIO_WRITER_ROOM_STAGES.map((stage, index) => {
              const selected = stage === activeStage;
              const complete = document.completion[stage];
              return (
                <button
                  key={stage}
                  id={`writer-room-tab-${stage}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`writer-room-panel-${stage}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectStage(stage)}
                  onKeyDown={onStageKeyDown}
                  className={`relative inline-flex min-h-12 items-center gap-1.5 px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:px-4 ${
                    selected ? "text-fg" : "text-fg-3 hover:text-fg"
                  }`}
                >
                  <span
                    className={`grid size-5 place-items-center rounded-full text-[0.62rem] tabular-nums ${
                      complete
                        ? "bg-good/15 text-good"
                        : selected
                          ? "bg-accent text-on-accent"
                          : "bg-raised text-fg-3"
                    }`}
                    aria-hidden
                  >
                    {complete ? <Check size={11} /> : index + 1}
                  </span>
                  {STUDIO_WRITER_ROOM_STAGE_META[stage].shortLabel}
                  {selected && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />}
                </button>
              );
            })}
          </div>
        </nav>

        {(actionError || aiError) && (
          <p
            role="alert"
            className="shrink-0 border-b border-bad/35 bg-bad/10 px-4 py-2 text-xs leading-relaxed text-bad sm:px-5"
          >
            {actionError || aiError}
          </p>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-fg">
              {STUDIO_WRITER_ROOM_STAGE_META[activeStage].label}
            </h3>
            <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
              {STUDIO_WRITER_ROOM_STAGE_META[activeStage].description}
            </p>
          </div>
          <label
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${
              document.completion[activeStage]
                ? "border-good/40 bg-good/10 text-good"
                : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg"
            }`}
          >
            <input
              type="checkbox"
              checked={document.completion[activeStage]}
              onChange={(event) => {
                try {
                  onChange(
                    setStudioWriterRoomStageCompleted(
                      document,
                      activeStage,
                      event.currentTarget.checked
                    )
                  );
                  setActionError(null);
                } catch (cause) {
                  setActionError(
                    cause instanceof Error ? cause.message : "단계 완료 상태를 바꾸지 못했어요."
                  );
                }
              }}
              className="size-4 accent-[var(--color-good)]"
            />
            단계 완료
          </label>
          {onRequestAi ? (
            <>
              <button
                type="button"
                onClick={() => void requestAi()}
                disabled={effectiveAiBusy}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-55"
              >
                {effectiveAiBusy ? (
                  <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <Sparkles size={14} aria-hidden />
                )}
                {effectiveAiBusy ? "초안 만드는 중…" : "AI 검토 초안"}
              </button>
              {effectiveAiBusy && onCancelAi ? (
                <button type="button" onClick={onCancelAi} className={BUTTON_CLASS}>
                  생성 취소
                </button>
              ) : null}
              {onAiDirectionChange ? (
                <label className="basis-full text-[0.68rem] font-semibold text-fg-2">
                  AI에 추가로 요청할 방향 <span className="font-normal text-fg-3">(선택)</span>
                  <input
                    type="text"
                    value={aiDirection}
                    onChange={(event) => onAiDirectionChange(event.currentTarget.value.slice(0, 2_000))}
                    maxLength={2_000}
                    placeholder="예: 15세 이용가, 미스터리 톤, 마지막 컷에 강한 훅"
                    disabled={effectiveAiBusy}
                    className={FIELD_CLASS}
                  />
                </label>
              ) : null}
            </>
          ) : (
            <span className="inline-flex min-h-9 items-center rounded-lg border border-line px-2.5 text-[0.68rem] text-fg-3">
              직접 작성 모드
            </span>
          )}
        </div>

        {aiReview ? (
          <StudioWriterRoomAiReviewPanel
            review={aiReview}
            currentValue={document.stages[aiReview.stage]}
            onApply={onApplyAiReview}
            onDiscard={onDiscardAiReview}
          />
        ) : null}

        {canvasPlan ? (
          <StudioWriterRoomCanvasPlanHandoff
            plan={canvasPlan}
            onApply={onApplyCanvasPlan}
            busy={canvasApplyBusy}
            onError={setActionError}
          />
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto xl:grid xl:grid-cols-[minmax(0,1fr)_23rem] xl:overflow-hidden">
          <main
            id={`writer-room-panel-${activeStage}`}
            role="tabpanel"
            aria-labelledby={`writer-room-tab-${activeStage}`}
            tabIndex={0}
            className="min-h-0 bg-canvas focus:outline-none xl:overflow-y-auto"
          >
            {stageEditor}
          </main>
          <StudioWriterRoomSuggestionsPanel
            stage={activeStage}
            document={document}
            characters={characters}
            onChange={onChange}
            onError={setActionError}
          />
        </div>

        <footer
          className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3 pt-2 sm:px-5"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <span className="hidden min-w-0 flex-1 truncate text-[0.68rem] text-fg-3 sm:block">
            변경 내용은 현재 작품 문서와 함께 저장됩니다. · Esc로 닫기
          </span>
          <button
            type="button"
            onClick={() => {
              const previous = STUDIO_WRITER_ROOM_STAGES[activeIndex - 1];
              if (previous) selectStage(previous);
            }}
            disabled={activeIndex <= 0}
            className={`${BUTTON_CLASS} flex-1 sm:flex-none`}
          >
            <ArrowLeft size={14} aria-hidden /> 이전
          </button>
          {activeIndex < STUDIO_WRITER_ROOM_STAGES.length - 1 ? (
            <button
              type="button"
              onClick={() => {
                const next = STUDIO_WRITER_ROOM_STAGES[activeIndex + 1];
                if (next) selectStage(next);
              }}
              className={`${BUTTON_CLASS} flex-1 bg-accent text-on-accent hover:border-accent hover:bg-accent-hover hover:text-on-accent sm:flex-none`}
            >
              다음 <ArrowRight size={14} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className={`${BUTTON_CLASS} flex-1 bg-accent text-on-accent hover:border-accent hover:bg-accent-hover hover:text-on-accent sm:flex-none`}
            >
              Writer Room 닫기
            </button>
          )}
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, globalThis.document.body);
}
