import { useEffect, useId, useState } from "react";

import {
  normalizeStudioContinuityValue,
  type StudioContinuityNamedValues,
  type StudioStoryBeat,
} from "./studio-continuity";

import { cn } from "@/shared/lib/utils";

export type StudioContinuityMetadataValue = Omit<StudioStoryBeat, "sceneId">;

export interface StudioContinuityMetadataEditorProps {
  value: StudioContinuityMetadataValue;
  onChange: (next: StudioContinuityMetadataValue) => void;
  disabled?: boolean;
  compact?: boolean;
}

type NamedValueEntry = {
  key: string;
  normalizedKey: string;
  value: string;
};

const MAX_TEXT_LENGTH = 240;
const MAX_NAME_LENGTH = 80;
const MAX_LIST_ITEMS = 24;
const MAX_DRAFT_LENGTH = 4_000;

function cleanText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeCharacterNames(values: readonly string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const name = cleanText(value, MAX_NAME_LENGTH);
    if (!name) continue;
    const key = normalizeStudioContinuityValue(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= MAX_LIST_ITEMS) break;
  }

  return names;
}

function parseCharacterNames(value: string): string[] {
  return normalizeCharacterNames(value.split(/[,\n]+/));
}

function formatCharacterNames(values: readonly string[] | undefined): string {
  return normalizeCharacterNames(values ?? []).join("\n");
}

function normalizeNamedEntries(
  entries: ReadonlyArray<readonly [string, string | null | undefined]>
): Record<string, string> | undefined {
  const normalized: NamedValueEntry[] = [];
  const seen = new Set<string>();

  for (const [rawKey, rawValue] of entries) {
    if (typeof rawValue !== "string") continue;
    const key = cleanText(rawKey, MAX_NAME_LENGTH);
    const value = cleanText(rawValue);
    if (!key || !value) continue;
    const normalizedKey = normalizeStudioContinuityValue(key);
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    normalized.push({ key, normalizedKey, value });
    if (normalized.length >= MAX_LIST_ITEMS) break;
  }

  normalized.sort(
    (a, b) =>
      compareText(a.normalizedKey, b.normalizedKey) ||
      compareText(a.key, b.key) ||
      compareText(a.value, b.value)
  );

  if (normalized.length === 0) return undefined;
  return Object.fromEntries(normalized.map((entry) => [entry.key, entry.value]));
}

function normalizeNamedValues(
  values: StudioContinuityNamedValues | undefined
): Record<string, string> | undefined {
  return normalizeNamedEntries(Object.entries(values ?? {}));
}

function parseNamedValues(value: string): Record<string, string> | undefined {
  const entries: Array<readonly [string, string]> = [];

  for (const line of value.split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;
    entries.push([line.slice(0, separatorIndex), line.slice(separatorIndex + 1)]);
  }

  return normalizeNamedEntries(entries);
}

function formatNamedValues(values: StudioContinuityNamedValues | undefined): string {
  const normalized = normalizeNamedValues(values);
  if (!normalized) return "";
  return Object.entries(normalized)
    .map(([key, value]) => `${key} = ${value}`)
    .join("\n");
}

function normalizeScalar(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return cleanText(value) || undefined;
}

function normalizeMetadata(value: StudioContinuityMetadataValue): StudioContinuityMetadataValue {
  const characterNames = normalizeCharacterNames(value.characterNames ?? []);
  const location = normalizeScalar(value.location);
  const time = normalizeScalar(value.time);
  const costumes = normalizeNamedValues(value.costumes);
  const props = normalizeNamedValues(value.props);
  const transitionLocation = normalizeScalar(value.transitionExplanations?.location);
  const transitionTime = normalizeScalar(value.transitionExplanations?.time);
  const transitionCostumes = normalizeNamedValues(value.transitionExplanations?.costumes);
  const transitionProps = normalizeNamedValues(value.transitionExplanations?.props);
  const hasTransition =
    !!transitionLocation || !!transitionTime || !!transitionCostumes || !!transitionProps;

  return {
    ...(characterNames.length > 0 ? { characterNames } : {}),
    ...(location ? { location } : {}),
    ...(time ? { time } : {}),
    ...(costumes ? { costumes } : {}),
    ...(props ? { props } : {}),
    ...(hasTransition
      ? {
          transitionExplanations: {
            ...(transitionLocation ? { location: transitionLocation } : {}),
            ...(transitionTime ? { time: transitionTime } : {}),
            ...(transitionCostumes ? { costumes: transitionCostumes } : {}),
            ...(transitionProps ? { props: transitionProps } : {}),
          },
        }
      : {}),
  };
}

function canonicalizeScalarDraft(value: string): string {
  return normalizeScalar(value) ?? "";
}

function canonicalizeCharacterDraft(value: string): string {
  return formatCharacterNames(parseCharacterNames(value));
}

function canonicalizeNamedDraft(value: string): string {
  return formatNamedValues(parseNamedValues(value));
}

interface DraftInputProps {
  id: string;
  describedBy: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
}

function DraftInput({
  id,
  describedBy,
  value,
  placeholder,
  disabled,
  onValueChange,
}: DraftInputProps) {
  const [draft, setDraft] = useState(value);
  const canonicalDraft = canonicalizeScalarDraft(draft);

  useEffect(() => {
    if (canonicalDraft !== value) setDraft(value);
  }, [canonicalDraft, value]);

  return (
    <input
      id={id}
      type="text"
      value={draft}
      onChange={(event) => {
        const next = event.target.value.slice(0, MAX_TEXT_LENGTH);
        setDraft(next);
        onValueChange(next);
      }}
      onBlur={() => setDraft(value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-describedby={describedBy}
      autoComplete="off"
      maxLength={MAX_TEXT_LENGTH}
      className="min-h-9 w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-xs leading-relaxed text-fg outline-none transition-colors duration-200 placeholder:text-fg-2 hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:bg-raised/40 disabled:text-fg-3"
    />
  );
}

interface DraftTextareaProps extends DraftInputProps {
  rows: number;
  canonicalize: (value: string) => string;
}

function DraftTextarea({
  id,
  describedBy,
  value,
  placeholder,
  disabled,
  onValueChange,
  rows,
  canonicalize,
}: DraftTextareaProps) {
  const [draft, setDraft] = useState(value);
  const canonicalDraft = canonicalize(draft);

  useEffect(() => {
    if (canonicalDraft !== value) setDraft(value);
  }, [canonicalDraft, value]);

  return (
    <textarea
      id={id}
      value={draft}
      onChange={(event) => {
        const next = event.target.value.slice(0, MAX_DRAFT_LENGTH);
        setDraft(next);
        onValueChange(next);
      }}
      onBlur={() => setDraft(value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-describedby={describedBy}
      rows={rows}
      spellCheck
      maxLength={MAX_DRAFT_LENGTH}
      className="w-full resize-y rounded-lg border border-line bg-panel px-2.5 py-2 text-xs leading-relaxed text-fg outline-none transition-colors duration-200 placeholder:text-fg-2 hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:bg-raised/40 disabled:text-fg-3"
    />
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[0.7rem] font-semibold text-fg-2">
      {children}
    </label>
  );
}

function FieldHelp({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1 text-[0.65rem] leading-relaxed text-fg-2">
      {children}
    </p>
  );
}

export function StudioContinuityMetadataEditor({
  value,
  onChange,
  disabled = false,
  compact = false,
}: StudioContinuityMetadataEditorProps) {
  const id = useId();
  const rows = compact ? 2 : 3;
  const update = (patch: Partial<StudioContinuityMetadataValue>) => {
    onChange(normalizeMetadata({ ...value, ...patch }));
  };
  const updateTransition = (
    patch: Partial<NonNullable<StudioContinuityMetadataValue["transitionExplanations"]>>
  ) => {
    update({
      transitionExplanations: {
        ...value.transitionExplanations,
        ...patch,
      },
    });
  };

  const charactersId = `${id}-characters`;
  const charactersHelpId = `${charactersId}-help`;
  const locationId = `${id}-location`;
  const locationHelpId = `${locationId}-help`;
  const timeId = `${id}-time`;
  const timeHelpId = `${timeId}-help`;
  const costumesId = `${id}-costumes`;
  const costumesHelpId = `${costumesId}-help`;
  const propsId = `${id}-props`;
  const propsHelpId = `${propsId}-help`;
  const locationTransitionId = `${id}-location-transition`;
  const locationTransitionHelpId = `${locationTransitionId}-help`;
  const timeTransitionId = `${id}-time-transition`;
  const timeTransitionHelpId = `${timeTransitionId}-help`;
  const costumeTransitionId = `${id}-costume-transition`;
  const costumeTransitionHelpId = `${costumeTransitionId}-help`;
  const propTransitionId = `${id}-prop-transition`;
  const propTransitionHelpId = `${propTransitionId}-help`;

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-card/35 text-fg",
        compact ? "p-2.5" : "p-3 sm:p-4"
      )}
      aria-disabled={disabled || undefined}
    >
      <fieldset disabled={disabled}>
        <legend className="px-1 text-xs font-bold text-fg">장면 설정</legend>
        <p className="mt-1 max-w-[70ch] text-[0.68rem] leading-relaxed text-fg-2">
          이 장면에서 명시된 사실만 적어 주세요. 이름과 상태는 공백을 정리하고 중복을 제거해 저장합니다.
        </p>

        <div className={cn("mt-3 grid grid-cols-1 sm:grid-cols-2", compact ? "gap-2.5" : "gap-3")}>
          <div className="sm:col-span-2">
            <FieldLabel htmlFor={charactersId}>등장 캐릭터</FieldLabel>
            <DraftTextarea
              id={charactersId}
              describedBy={charactersHelpId}
              value={formatCharacterNames(value.characterNames)}
              onValueChange={(next) => update({ characterNames: parseCharacterNames(next) })}
              canonicalize={canonicalizeCharacterDraft}
              placeholder={"민아, 도윤\n또는 한 줄에 한 명"}
              rows={rows}
              disabled={disabled}
            />
            <FieldHelp id={charactersHelpId}>쉼표 또는 줄바꿈으로 구분합니다. 같은 이름은 한 번만 저장해요.</FieldHelp>
          </div>

          <div>
            <FieldLabel htmlFor={locationId}>장소</FieldLabel>
            <DraftInput
              id={locationId}
              describedBy={locationHelpId}
              value={normalizeScalar(value.location) ?? ""}
              onValueChange={(next) => update({ location: normalizeScalar(next) })}
              placeholder="학교 옥상"
              disabled={disabled}
            />
            <FieldHelp id={locationHelpId}>직전 장면과 정확히 비교할 장소 이름입니다.</FieldHelp>
          </div>

          <div>
            <FieldLabel htmlFor={timeId}>시간</FieldLabel>
            <DraftInput
              id={timeId}
              describedBy={timeHelpId}
              value={normalizeScalar(value.time) ?? ""}
              onValueChange={(next) => update({ time: normalizeScalar(next) })}
              placeholder="방과 후"
              disabled={disabled}
            />
            <FieldHelp id={timeHelpId}>예: 같은 날 아침, 사흘 뒤 밤.</FieldHelp>
          </div>

          <div>
            <FieldLabel htmlFor={costumesId}>캐릭터별 의상</FieldLabel>
            <DraftTextarea
              id={costumesId}
              describedBy={costumesHelpId}
              value={formatNamedValues(value.costumes)}
              onValueChange={(next) => update({ costumes: parseNamedValues(next) })}
              canonicalize={canonicalizeNamedDraft}
              placeholder={"민아 = 교복\n도윤 = 체육복"}
              rows={rows}
              disabled={disabled}
            />
            <FieldHelp id={costumesHelpId}>한 줄에 이름 = 상태 형식으로 적습니다.</FieldHelp>
          </div>

          <div>
            <FieldLabel htmlFor={propsId}>소품별 상태</FieldLabel>
            <DraftTextarea
              id={propsId}
              describedBy={propsHelpId}
              value={formatNamedValues(value.props)}
              onValueChange={(next) => update({ props: parseNamedValues(next) })}
              canonicalize={canonicalizeNamedDraft}
              placeholder={"우산 = 민아가 들고 있음\n편지 = 가방 안"}
              rows={rows}
              disabled={disabled}
            />
            <FieldHelp id={propsHelpId}>소유자·위치·손상 여부처럼 이어져야 할 상태를 적습니다.</FieldHelp>
          </div>
        </div>
      </fieldset>

      <fieldset disabled={disabled} className={cn("border-t border-line", compact ? "mt-3 pt-3" : "mt-4 pt-4")}>
        <legend className="px-1 text-xs font-bold text-fg">전환 설명</legend>
        <p className="mt-1 max-w-[70ch] text-[0.68rem] leading-relaxed text-fg-2">
          직전 장면과 값이 달라지는 것이 의도라면 이유를 남겨 주세요. 설명이 있는 변화는 연속성 경고에서 제외됩니다.
        </p>

        <div className={cn("mt-3 grid grid-cols-1 sm:grid-cols-2", compact ? "gap-2.5" : "gap-3")}>
          <div>
            <FieldLabel htmlFor={locationTransitionId}>장소 전환 이유</FieldLabel>
            <DraftInput
              id={locationTransitionId}
              describedBy={locationTransitionHelpId}
              value={normalizeScalar(value.transitionExplanations?.location) ?? ""}
              onValueChange={(next) => updateTransition({ location: normalizeScalar(next) })}
              placeholder="계단을 올라 옥상으로 이동"
              disabled={disabled}
            />
            <FieldHelp id={locationTransitionHelpId}>장소가 바뀌지 않았다면 비워 둡니다.</FieldHelp>
          </div>

          <div>
            <FieldLabel htmlFor={timeTransitionId}>시간 전환 이유</FieldLabel>
            <DraftInput
              id={timeTransitionId}
              describedBy={timeTransitionHelpId}
              value={normalizeScalar(value.transitionExplanations?.time) ?? ""}
              onValueChange={(next) => updateTransition({ time: normalizeScalar(next) })}
              placeholder="다음 날 아침으로 전환"
              disabled={disabled}
            />
            <FieldHelp id={timeTransitionHelpId}>시간이 바뀌지 않았다면 비워 둡니다.</FieldHelp>
          </div>

          <div>
            <FieldLabel htmlFor={costumeTransitionId}>의상 변경 이유</FieldLabel>
            <DraftTextarea
              id={costumeTransitionId}
              describedBy={costumeTransitionHelpId}
              value={formatNamedValues(value.transitionExplanations?.costumes)}
              onValueChange={(next) => updateTransition({ costumes: parseNamedValues(next) })}
              canonicalize={canonicalizeNamedDraft}
              placeholder={"민아 = 체육 수업을 위해 갈아입음\n도윤 = 비에 젖어 교체"}
              rows={rows}
              disabled={disabled}
            />
            <FieldHelp id={costumeTransitionHelpId}>한 줄에 이름 = 변경 이유 형식으로 적습니다.</FieldHelp>
          </div>

          <div>
            <FieldLabel htmlFor={propTransitionId}>소품 변경 이유</FieldLabel>
            <DraftTextarea
              id={propTransitionId}
              describedBy={propTransitionHelpId}
              value={formatNamedValues(value.transitionExplanations?.props)}
              onValueChange={(next) => updateTransition({ props: parseNamedValues(next) })}
              canonicalize={canonicalizeNamedDraft}
              placeholder={"우산 = 도윤에게 건넴\n편지 = 가방에서 꺼냄"}
              rows={rows}
              disabled={disabled}
            />
            <FieldHelp id={propTransitionHelpId}>한 줄에 이름 = 변경 이유 형식으로 적습니다.</FieldHelp>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
