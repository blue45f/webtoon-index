import {
  collectDialogueItems,
  isDialogueElement,
  type DialogueBatchItem,
  type DialoguePageLike,
} from "./studio-dialogue-batch";

/**
 * Text interchange for lettering, translation and timed-comic workflows.
 *
 * The codecs deliberately operate on a small, renderer-independent cue model. StudioPage can map
 * cues to bubbles in one history transaction, while translators can use spreadsheet/subtitle tools
 * without loading the canvas renderer. Every parser is bounded and rejects malformed UTF-8, NULs,
 * oversized records and non-finite timing values before any document mutation is attempted.
 */

export const STUDIO_DIALOGUE_INTERCHANGE_SCHEMA = "toonspectrum.dialogue-script" as const;
export const STUDIO_DIALOGUE_INTERCHANGE_VERSION = 1 as const;

export const STUDIO_DIALOGUE_INTERCHANGE_LIMITS = Object.freeze({
  maxFileBytes: 8 * 1024 * 1024,
  maxCues: 20_000,
  maxCueCodeUnits: 20_000,
  maxSpeakerCodeUnits: 200,
  maxNoteCodeUnits: 2_000,
  maxCsvColumns: 32,
  maxCsvCellCodeUnits: 32_000,
  maxTimestampMs: 7 * 24 * 60 * 60 * 1_000,
  maxFdxXmlElements: 100_000,
  maxFdxXmlDepth: 32,
  maxFdxXmlAttributes: 100_000,
  maxFdxXmlAttributesPerElement: 32,
  maxFdxParagraphs: 60_000,
  maxFdxTextFragments: 200_000,
  maxFdxLossPreviewItems: 2_000,
});

export type StudioDialogueInterchangeFormat =
  | "txt"
  | "markdown"
  | "csv"
  | "tsv"
  | "json"
  | "fountain"
  | "fdx"
  | "srt"
  | "vtt";

export interface StudioDialogueCue {
  readonly id?: string;
  /** One-based page number for human-facing interchange. */
  readonly page: number;
  /** One-based panel number when known. */
  readonly panel?: number;
  readonly speaker?: string;
  readonly text: string;
  readonly note?: string;
  readonly startMs?: number;
  readonly endMs?: number;
}

export interface StudioDialogueInterchangeDocument {
  readonly title?: string;
  readonly language?: string;
  readonly cues: readonly StudioDialogueCue[];
}

export interface StudioDialogueInterchangeResult {
  readonly document: StudioDialogueInterchangeDocument;
  readonly warnings: readonly string[];
  readonly lossy: boolean;
  readonly lossPreview?: StudioDialogueFdxLossPreview;
}

export interface StudioDialogueSerializedFile {
  readonly text: string;
  readonly extension: `.${StudioDialogueInterchangeFormat}` | ".md";
  readonly mimeType: string;
  readonly warnings: readonly string[];
  readonly lossy: boolean;
}

export type StudioDialogueFdxCoreParagraphType =
  | "Scene Heading"
  | "Action"
  | "Character"
  | "Parenthetical"
  | "Dialogue";

export interface StudioDialogueFdxLossPreviewItem {
  readonly sourceIndex: number;
  readonly sourceType: string;
  readonly preview: string;
  readonly disposition: "mapped" | "context-only" | "dropped";
  readonly page?: number;
  readonly panel?: number;
  readonly cueIndex?: number;
  readonly detail: string;
}

export interface StudioDialogueFdxLossPreview {
  readonly sourceFormat: "fdx";
  readonly sourceParagraphs: number;
  readonly emittedCues: number;
  readonly mappedElements: number;
  readonly contextOnlyElements: number;
  readonly droppedElements: number;
  readonly truncated: boolean;
  readonly items: readonly StudioDialogueFdxLossPreviewItem[];
}

export type StudioDialogueImportMatchMode = "auto" | "id" | "page-order" | "document-order";

export interface StudioDialogueImportApplyResult {
  readonly pages: readonly DialoguePageLike[];
  readonly matched: number;
  readonly changed: number;
  readonly locked: number;
  readonly missing: number;
  readonly droppedMetadata: number;
}

export class StudioDialogueInterchangeError extends Error {
  constructor(
    readonly code:
      | "FILE_TOO_LARGE"
      | "INVALID_ENCODING"
      | "INVALID_FORMAT"
      | "INVALID_CUE"
      | "TOO_MANY_CUES"
      | "XML_BUDGET_EXCEEDED"
      | "UNSUPPORTED_VERSION",
    message: string
  ) {
    super(message);
    this.name = "StudioDialogueInterchangeError";
  }
}

const UTF8 = new TextEncoder();
const FATAL_UTF8 = new TextDecoder("utf-8", { fatal: true });

function fail(code: StudioDialogueInterchangeError["code"], message: string): never {
  throw new StudioDialogueInterchangeError(code, message);
}

function assertFileBudget(text: string): void {
  if (UTF8.encode(text).byteLength > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFileBytes) {
    fail("FILE_TOO_LARGE", "대사 파일은 8MB 이하여야 합니다.");
  }
  if (text.includes("\0")) fail("INVALID_FORMAT", "대사 파일에 NUL 문자가 포함되어 있습니다.");
}

export function decodeStudioDialogueInterchangeText(
  source: string | Uint8Array | ArrayBuffer
): string {
  if (typeof source === "string") {
    assertFileBudget(source);
    return source.replace(/^\uFEFF/u, "");
  }
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.byteLength > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFileBytes) {
    fail("FILE_TOO_LARGE", "대사 파일은 8MB 이하여야 합니다.");
  }
  try {
    const text = FATAL_UTF8.decode(bytes).replace(/^\uFEFF/u, "");
    assertFileBudget(text);
    return text;
  } catch (error) {
    if (error instanceof StudioDialogueInterchangeError) throw error;
    return fail("INVALID_ENCODING", "대사 파일이 올바른 UTF-8 텍스트가 아닙니다.");
  }
}

function finiteInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integer = Math.trunc(value);
  return integer >= minimum && integer <= maximum ? integer : undefined;
}

function optionalBoundedText(value: unknown, maximum: number): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) {
    fail("INVALID_CUE", "대사 메타데이터의 문자열 길이 또는 형식이 올바르지 않습니다.");
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  return normalized || undefined;
}

function normalizeCue(value: unknown, index: number): StudioDialogueCue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("INVALID_CUE", `${index + 1}번째 대사 항목이 객체가 아닙니다.`);
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set(["id", "page", "panel", "speaker", "text", "note", "startMs", "endMs"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) {
    return fail("INVALID_CUE", `${index + 1}번째 대사 항목에 알 수 없는 필드가 있습니다.`);
  }
  const page = finiteInteger(candidate.page, 1, 1_000_000);
  const panel = candidate.panel == null
    ? undefined
    : finiteInteger(candidate.panel, 1, 1_000_000);
  if (page == null || (candidate.panel != null && panel == null)) {
    return fail("INVALID_CUE", `${index + 1}번째 대사의 페이지/컷 번호가 올바르지 않습니다.`);
  }
  if (
    typeof candidate.text !== "string" ||
    candidate.text.length === 0 ||
    candidate.text.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCueCodeUnits ||
    candidate.text.includes("\0")
  ) {
    return fail("INVALID_CUE", `${index + 1}번째 대사 본문의 길이 또는 형식이 올바르지 않습니다.`);
  }
  const text = candidate.text.replace(/\r\n?/gu, "\n").trim();
  if (!text) return fail("INVALID_CUE", `${index + 1}번째 대사가 비어 있습니다.`);
  const startMs = candidate.startMs == null
    ? undefined
    : finiteInteger(candidate.startMs, 0, STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxTimestampMs);
  const endMs = candidate.endMs == null
    ? undefined
    : finiteInteger(candidate.endMs, 0, STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxTimestampMs);
  if (
    (candidate.startMs != null && startMs == null) ||
    (candidate.endMs != null && endMs == null) ||
    (startMs != null && endMs != null && endMs <= startMs)
  ) {
    return fail("INVALID_CUE", `${index + 1}번째 대사의 시간 범위가 올바르지 않습니다.`);
  }
  return {
    ...(optionalBoundedText(candidate.id, 200) ? { id: optionalBoundedText(candidate.id, 200) } : {}),
    page,
    ...(panel == null ? {} : { panel }),
    ...(optionalBoundedText(candidate.speaker, STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxSpeakerCodeUnits)
      ? { speaker: optionalBoundedText(candidate.speaker, STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxSpeakerCodeUnits) }
      : {}),
    text,
    ...(optionalBoundedText(candidate.note, STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxNoteCodeUnits)
      ? { note: optionalBoundedText(candidate.note, STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxNoteCodeUnits) }
      : {}),
    ...(startMs == null ? {} : { startMs }),
    ...(endMs == null ? {} : { endMs }),
  };
}

function normalizeDocument(value: StudioDialogueInterchangeDocument): StudioDialogueInterchangeDocument {
  if (!Array.isArray(value.cues)) fail("INVALID_FORMAT", "대사 목록이 없습니다.");
  if (value.cues.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCues) {
    fail("TOO_MANY_CUES", "한 파일에서 가져올 수 있는 대사는 최대 20,000개입니다.");
  }
  return {
    ...(optionalBoundedText(value.title, 500) ? { title: optionalBoundedText(value.title, 500) } : {}),
    ...(optionalBoundedText(value.language, 50) ? { language: optionalBoundedText(value.language, 50) } : {}),
    cues: value.cues.map(normalizeCue),
  };
}

function parseJson(text: string): StudioDialogueInterchangeResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("INVALID_FORMAT", "JSON 대사 파일의 문법이 올바르지 않습니다.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("INVALID_FORMAT", "JSON 대사 파일의 최상위 값이 객체가 아닙니다.");
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== STUDIO_DIALOGUE_INTERCHANGE_SCHEMA) {
    return fail("INVALID_FORMAT", "ToonSpectrum 대사 JSON 스키마가 아닙니다.");
  }
  if (record.version !== STUDIO_DIALOGUE_INTERCHANGE_VERSION) {
    return fail("UNSUPPORTED_VERSION", "지원하지 않는 대사 JSON 버전입니다.");
  }
  return {
    document: normalizeDocument({
      title: record.title as string | undefined,
      language: record.language as string | undefined,
      cues: record.cues as StudioDialogueCue[],
    }),
    warnings: [],
    lossy: false,
  };
}

function parseDelimitedRows(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      if (cell.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCsvCellCodeUnits) {
        fail("INVALID_FORMAT", "CSV/TSV 셀 하나가 허용 길이를 초과했습니다.");
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
      if (row.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCsvColumns) {
        fail("INVALID_FORMAT", "CSV/TSV 열 수가 허용 범위를 초과했습니다.");
      }
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) fail("INVALID_FORMAT", "CSV/TSV의 따옴표가 닫히지 않았습니다.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const COLUMN_ALIASES: Record<string, string> = {
  page: "page",
  페이지: "page",
  panel: "panel",
  cut: "panel",
  컷: "panel",
  speaker: "speaker",
  character: "speaker",
  화자: "speaker",
  text: "text",
  dialogue: "text",
  대사: "text",
  note: "note",
  memo: "note",
  메모: "note",
  start_ms: "startMs",
  start: "startMs",
  시작: "startMs",
  end_ms: "endMs",
  end: "endMs",
  종료: "endMs",
  id: "id",
};

function parseOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/u.test(trimmed)) fail("INVALID_CUE", `정수가 필요한 칸에 '${trimmed}' 값이 있습니다.`);
  return Number(trimmed);
}

function parseDelimited(text: string, delimiter: "," | "\t"): StudioDialogueInterchangeResult {
  const rows = parseDelimitedRows(text, delimiter).filter((row) => row.some((cell) => cell.trim()));
  const header = rows.shift();
  if (!header) fail("INVALID_FORMAT", "CSV/TSV 파일에 헤더가 없습니다.");
  const columns = header.map((value) => COLUMN_ALIASES[value.trim().toLocaleLowerCase("ko-KR")] ?? "");
  if (!columns.includes("page") || !columns.includes("text")) {
    fail("INVALID_FORMAT", "CSV/TSV 헤더에는 page(페이지)와 text(대사) 열이 필요합니다.");
  }
  if (rows.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCues) {
    fail("TOO_MANY_CUES", "한 파일에서 가져올 수 있는 대사는 최대 20,000개입니다.");
  }
  const warnings: string[] = [];
  const cues = rows.map((row, index) => {
    const candidate: Record<string, unknown> = {};
    columns.forEach((column, columnIndex) => {
      if (!column) return;
      const raw = row[columnIndex] ?? "";
      if (column === "page" || column === "panel" || column === "startMs" || column === "endMs") {
        candidate[column] = parseOptionalInteger(raw);
      } else {
        candidate[column] = raw;
      }
    });
    if (row.length > columns.length && row.slice(columns.length).some((cell) => cell.trim())) {
      warnings.push(`${index + 2}행의 헤더 밖 추가 열은 무시했습니다.`);
    }
    return normalizeCue(candidate, index);
  });
  return { document: { cues }, warnings, lossy: false };
}

function parsePageMarker(line: string): number | undefined {
  const match = /^(?:#{1,2}\s*)?(?:page|페이지)\s*(\d+)\s*:?$/iu.exec(line.trim());
  return match ? Number(match[1]) : undefined;
}

function parsePanelMarker(line: string): number | undefined {
  const match = /^(?:#{1,3}\s*)?(?:panel|cut|컷)\s*(\d+)\s*:?$/iu.exec(line.trim());
  return match ? Number(match[1]) : undefined;
}

function parseColonScript(text: string): StudioDialogueInterchangeResult {
  const cues: StudioDialogueCue[] = [];
  const warnings: string[] = [];
  let page = 1;
  let panel: number | undefined;
  for (const [lineIndex, rawLine] of text.replace(/\r\n?/gu, "\n").split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("<!--") || line.startsWith("//")) continue;
    const pageMarker = parsePageMarker(line.replace(/^@/u, ""));
    if (pageMarker != null) {
      page = pageMarker;
      panel = undefined;
      continue;
    }
    const panelMarker = parsePanelMarker(line.replace(/^@/u, ""));
    if (panelMarker != null) {
      panel = panelMarker;
      continue;
    }
    const dialogue = /^(?:[-*]\s*)?(?:\[([^\]]+)\]\s*)?([^:\n]{1,200}):\s*(.+)$/u.exec(line);
    if (!dialogue) {
      warnings.push(`${lineIndex + 1}행은 '화자: 대사' 형식이 아니어서 메모로 건너뛰었습니다.`);
      continue;
    }
    const location = dialogue[1];
    if (location) {
      const numbers = [...location.matchAll(/(?:p(?:age)?|페이지)\s*(\d+)|(?:c(?:ut)?|panel|컷)\s*(\d+)/giu)];
      for (const match of numbers) {
        if (match[1]) page = Number(match[1]);
        if (match[2]) panel = Number(match[2]);
      }
    }
    cues.push(normalizeCue({ page, panel, speaker: dialogue[2]!.trim(), text: dialogue[3]!.trim() }, cues.length));
    if (cues.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCues) {
      fail("TOO_MANY_CUES", "한 파일에서 가져올 수 있는 대사는 최대 20,000개입니다.");
    }
  }
  if (cues.length === 0) fail("INVALID_FORMAT", "가져올 수 있는 '화자: 대사' 행이 없습니다.");
  return { document: { cues }, warnings, lossy: warnings.length > 0 };
}

function parseFountain(text: string): StudioDialogueInterchangeResult {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const cues: StudioDialogueCue[] = [];
  const warnings: string[] = [];
  let page = 1;
  let panel: number | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line) continue;
    const pageMarker = parsePageMarker(line.replace(/^\.+/u, "").replace(/\s+-.*$/u, ""));
    if (pageMarker != null) {
      page = pageMarker;
      panel = undefined;
      continue;
    }
    const panelComment = /^\[\[\s*(?:panel|cut|컷)\s*(\d+)\s*\]\]$/iu.exec(line);
    const panelHeading = parsePanelMarker(line);
    if (panelComment || panelHeading != null) {
      panel = panelComment ? Number(panelComment[1]) : panelHeading;
      continue;
    }
    const forcedCharacter = line.startsWith("@") ? line.slice(1).trim() : line;
    const character = forcedCharacter.replace(/\s*\([^)]*\)\s*$/u, "");
    const looksLikeCharacter =
      character.length > 0 &&
      character.length <= STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxSpeakerCodeUnits &&
      (line.startsWith("@") || character === character.toLocaleUpperCase("ko-KR")) &&
      !/^(?:INT\.|EXT\.|EST\.|I\/E\.|\.|#|=|>|!)/u.test(line);
    if (!looksLikeCharacter) continue;
    const dialogueLines: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor]!.trim()) {
      const candidate = lines[cursor]!.trim();
      if (/^\(.+\)$/u.test(candidate) && dialogueLines.length === 0) {
        cursor += 1;
        continue;
      }
      dialogueLines.push(candidate);
      cursor += 1;
    }
    if (dialogueLines.length === 0) continue;
    cues.push(normalizeCue({ page, panel, speaker: character, text: dialogueLines.join("\n") }, cues.length));
    index = cursor;
    if (cues.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCues) {
      fail("TOO_MANY_CUES", "한 파일에서 가져올 수 있는 대사는 최대 20,000개입니다.");
    }
  }
  if (cues.length === 0) fail("INVALID_FORMAT", "Fountain 파일에서 대사 블록을 찾지 못했습니다.");
  warnings.push("장면 설명·전환·듀얼 대사·주석은 캔버스 대사로 가져오지 않습니다.");
  return { document: { cues }, warnings, lossy: true };
}

interface ParsedFdxParagraph {
  readonly sourceIndex: number;
  readonly type: string;
  readonly text: string;
}

interface MutableFdxParagraph {
  sourceIndex: number;
  type: string;
  textParts: string[];
  textCodeUnits: number;
}

interface FdxXmlFrame {
  readonly name: string;
  readonly recognized: boolean;
  readonly capturesText: boolean;
  readonly paragraph?: MutableFdxParagraph;
}

interface ParsedFdxXmlTag {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

interface MutableFdxLossPreview {
  mappedElements: number;
  contextOnlyElements: number;
  droppedElements: number;
  truncated: boolean;
  items: StudioDialogueFdxLossPreviewItem[];
}

const FDX_XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/u;
const FDX_PAGE_MARKER = /^TOONSPECTRUM PAGE ([1-9]\d{0,6})$/u;
const FDX_PANEL_MARKER = /^TOONSPECTRUM PANEL ([1-9]\d{0,6})$/u;
const FDX_CORE_PARAGRAPH_TYPES = new Set<StudioDialogueFdxCoreParagraphType>([
  "Scene Heading",
  "Action",
  "Character",
  "Parenthetical",
  "Dialogue",
]);

function isValidXmlCodePoint(value: number): boolean {
  return Number.isSafeInteger(value) && (
    value === 9
    || value === 10
    || value === 13
    || (value >= 32 && value <= 0xd7ff)
    || (value >= 0xe000 && value <= 0xfffd)
    || (value >= 0x10000 && value <= 0x10ffff)
  );
}

function assertSafeXmlCharacters(value: string): void {
  for (let offset = 0; offset < value.length; offset += 1) {
    const codePoint = value.codePointAt(offset);
    if (codePoint == null || !isValidXmlCodePoint(codePoint)) {
      fail("INVALID_FORMAT", "FDX XML에 허용되지 않는 제어 문자 또는 잘못된 Unicode가 있습니다.");
    }
    if (codePoint > 0xffff) offset += 1;
  }
}

function decodeFdxXmlText(value: string): string {
  const entityPattern = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/gu;
  const withoutKnownEntities = value.replaceAll(entityPattern, "");
  if (withoutKnownEntities.includes("&")) {
    return fail("INVALID_FORMAT", "FDX XML에 선언되지 않았거나 잘못된 entity가 있습니다.");
  }
  return value.replaceAll(entityPattern, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const hexadecimal = entity.startsWith("&#x");
    const numeric = Number.parseInt(
      entity.slice(hexadecimal ? 3 : 2, -1),
      hexadecimal ? 16 : 10
    );
    if (!isValidXmlCodePoint(numeric)) {
      return fail("INVALID_FORMAT", "FDX XML의 숫자 문자 entity가 올바르지 않습니다.");
    }
    return String.fromCodePoint(numeric);
  });
}

function findFdxXmlTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
    else if (character === "<") break;
  }
  return fail("INVALID_FORMAT", "FDX XML 태그가 닫히지 않았습니다.");
}

function parseFdxXmlTag(source: string): ParsedFdxXmlTag {
  let offset = 0;
  while (/\s/u.test(source[offset] ?? "")) offset += 1;
  const closing = source[offset] === "/";
  if (closing) {
    offset += 1;
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
  }
  const nameMatch = FDX_XML_NAME.exec(source.slice(offset));
  const name = nameMatch?.[0];
  if (!name) return fail("INVALID_FORMAT", "FDX XML 요소 이름이 올바르지 않습니다.");
  offset += name.length;

  const attributes = new Map<string, string>();
  let selfClosing = false;
  while (offset < source.length) {
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
    if (offset >= source.length) break;
    if (source[offset] === "/") {
      if (closing || source.slice(offset + 1).trim()) {
        return fail("INVALID_FORMAT", "FDX XML self-closing 태그 문법이 올바르지 않습니다.");
      }
      selfClosing = true;
      break;
    }
    if (closing) {
      return fail("INVALID_FORMAT", "FDX XML 닫는 태그에는 attribute를 사용할 수 없습니다.");
    }
    const attributeMatch = FDX_XML_NAME.exec(source.slice(offset));
    const attributeName = attributeMatch?.[0];
    if (!attributeName) {
      return fail("INVALID_FORMAT", "FDX XML attribute 이름이 올바르지 않습니다.");
    }
    if (attributes.has(attributeName)) {
      return fail("INVALID_FORMAT", "FDX XML에 중복 attribute가 있습니다.");
    }
    offset += attributeName.length;
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
    if (source[offset] !== "=") {
      return fail("INVALID_FORMAT", "FDX XML attribute에 등호가 없습니다.");
    }
    offset += 1;
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
    const quote = source[offset];
    if (quote !== '"' && quote !== "'") {
      return fail("INVALID_FORMAT", "FDX XML attribute 값은 따옴표로 감싸야 합니다.");
    }
    const end = source.indexOf(quote, offset + 1);
    if (end < 0) return fail("INVALID_FORMAT", "FDX XML attribute 값이 닫히지 않았습니다.");
    const rawValue = source.slice(offset + 1, end);
    if (rawValue.includes("<")) {
      return fail("INVALID_FORMAT", "FDX XML attribute 값에는 raw '<' 문자를 사용할 수 없습니다.");
    }
    const value = decodeFdxXmlText(rawValue);
    attributes.set(attributeName, value);
    if (attributes.size > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxXmlAttributesPerElement) {
      return fail(
        "XML_BUDGET_EXCEEDED",
        "FDX XML 요소 하나의 attribute 수가 안전 예산을 초과했습니다."
      );
    }
    offset = end + 1;
  }
  return { name, attributes, closing, selfClosing };
}

function appendFdxText(
  frame: FdxXmlFrame | undefined,
  value: string,
  state: { textFragments: number }
): void {
  if (!value) return;
  if (value.includes("]]>")) {
    fail("INVALID_FORMAT", "FDX XML 일반 텍스트에 CDATA 종료 토큰이 있습니다.");
  }
  const decoded = decodeFdxXmlText(value);
  if (!decoded) return;
  if (!frame?.capturesText || !frame.paragraph) {
    if (frame?.name === "Paragraph" && decoded.trim()) {
      fail("INVALID_FORMAT", "FDX Paragraph 본문은 Text 요소 안에 있어야 합니다.");
    }
    return;
  }
  state.textFragments += 1;
  if (state.textFragments > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxTextFragments) {
    fail("XML_BUDGET_EXCEEDED", "FDX Text fragment 수가 안전 예산을 초과했습니다.");
  }
  frame.paragraph.textCodeUnits += decoded.length;
  if (frame.paragraph.textCodeUnits > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCueCodeUnits) {
    fail("XML_BUDGET_EXCEEDED", "FDX Paragraph 본문이 안전 길이 예산을 초과했습니다.");
  }
  frame.paragraph.textParts.push(decoded);
}

function finalizeFdxParagraph(
  paragraph: MutableFdxParagraph,
  paragraphs: ParsedFdxParagraph[]
): void {
  const text = paragraph.textParts.join("").replace(/\r\n?/gu, "\n").trim();
  if (FDX_CORE_PARAGRAPH_TYPES.has(paragraph.type as StudioDialogueFdxCoreParagraphType) && !text) {
    fail("INVALID_CUE", `FDX ${paragraph.type} Paragraph가 비어 있습니다.`);
  }
  paragraphs.push({
    sourceIndex: paragraph.sourceIndex,
    type: paragraph.type,
    text,
  });
}

function parseFdxParagraphs(xml: string): readonly ParsedFdxParagraph[] {
  assertSafeXmlCharacters(xml);
  if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)) {
    return fail("INVALID_FORMAT", "FDX XML의 DTD 및 사용자 정의 entity는 지원하지 않습니다.");
  }
  const stack: FdxXmlFrame[] = [];
  const paragraphs: ParsedFdxParagraph[] = [];
  const textState = { textFragments: 0 };
  let elementCount = 0;
  let attributeCount = 0;
  let rootSeen = false;
  let rootClosed = false;
  let contentCount = 0;
  let sawNonWhitespaceBeforeDeclaration = false;

  const closeFrame = (expectedName: string): void => {
    const frame = stack.pop();
    if (!frame || frame.name !== expectedName) {
      fail("INVALID_FORMAT", "FDX XML 요소의 닫는 순서가 올바르지 않습니다.");
    }
    if (frame.name === "Paragraph" && frame.paragraph) {
      finalizeFdxParagraph(frame.paragraph, paragraphs);
    }
    if (frame.name === "FinalDraft") rootClosed = true;
  };

  let offset = 0;
  while (offset < xml.length) {
    const tagStart = xml.indexOf("<", offset);
    if (tagStart < 0) {
      const trailing = xml.slice(offset);
      appendFdxText(stack.at(-1), trailing, textState);
      if (rootClosed && trailing.trim()) {
        fail("INVALID_FORMAT", "FDX XML 루트 뒤에 텍스트가 있습니다.");
      }
      break;
    }
    const rawText = xml.slice(offset, tagStart);
    appendFdxText(stack.at(-1), rawText, textState);
    if (!rootSeen && rawText.trim()) {
      sawNonWhitespaceBeforeDeclaration = true;
      fail("INVALID_FORMAT", "FDX XML 루트 앞에 텍스트가 있습니다.");
    }

    if (xml.startsWith("<!--", tagStart)) {
      const end = xml.indexOf("-->", tagStart + 4);
      if (end < 0 || xml.slice(tagStart + 4, end).includes("--")) {
        fail("INVALID_FORMAT", "FDX XML 주석이 올바르게 닫히지 않았습니다.");
      }
      if (!rootSeen) sawNonWhitespaceBeforeDeclaration = true;
      offset = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", tagStart)) {
      const end = xml.indexOf("]]>", tagStart + 9);
      if (end < 0) fail("INVALID_FORMAT", "FDX XML CDATA가 닫히지 않았습니다.");
      const frame = stack.at(-1);
      const cdata = xml.slice(tagStart + 9, end);
      if (frame?.capturesText && frame.paragraph) {
        textState.textFragments += 1;
        if (textState.textFragments > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxTextFragments) {
          fail("XML_BUDGET_EXCEEDED", "FDX Text fragment 수가 안전 예산을 초과했습니다.");
        }
        frame.paragraph.textCodeUnits += cdata.length;
        if (frame.paragraph.textCodeUnits > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCueCodeUnits) {
          fail("XML_BUDGET_EXCEEDED", "FDX Paragraph 본문이 안전 길이 예산을 초과했습니다.");
        }
        frame.paragraph.textParts.push(cdata);
      } else if (frame?.name === "Paragraph" && cdata.trim()) {
        fail("INVALID_FORMAT", "FDX Paragraph CDATA는 Text 요소 안에 있어야 합니다.");
      }
      offset = end + 3;
      continue;
    }
    if (xml.startsWith("<?", tagStart)) {
      const end = xml.indexOf("?>", tagStart + 2);
      if (
        end < 0
        || rootSeen
        || sawNonWhitespaceBeforeDeclaration
        || !/^<\?xml(?:\s|$)/u.test(xml.slice(tagStart, end + 2))
      ) {
        fail("INVALID_FORMAT", "FDX XML 선언 위치 또는 형식이 올바르지 않습니다.");
      }
      sawNonWhitespaceBeforeDeclaration = true;
      offset = end + 2;
      continue;
    }
    if (xml.startsWith("<!", tagStart)) {
      fail("INVALID_FORMAT", "FDX XML의 선언 확장은 지원하지 않습니다.");
    }

    const tagEnd = findFdxXmlTagEnd(xml, tagStart);
    const tag = parseFdxXmlTag(xml.slice(tagStart + 1, tagEnd));
    attributeCount += tag.attributes.size;
    if (attributeCount > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxXmlAttributes) {
      fail("XML_BUDGET_EXCEEDED", "FDX XML attribute 총수가 안전 예산을 초과했습니다.");
    }

    if (tag.closing) {
      if (tag.selfClosing) fail("INVALID_FORMAT", "FDX XML 닫는 태그는 self-closing일 수 없습니다.");
      closeFrame(tag.name);
      offset = tagEnd + 1;
      continue;
    }
    if (rootClosed) fail("INVALID_FORMAT", "FDX XML에는 루트 요소가 하나만 있어야 합니다.");
    elementCount += 1;
    if (elementCount > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxXmlElements) {
      fail("XML_BUDGET_EXCEEDED", "FDX XML 요소 수가 안전 예산을 초과했습니다.");
    }
    if (stack.length + 1 > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxXmlDepth) {
      fail("XML_BUDGET_EXCEEDED", "FDX XML 중첩 깊이가 안전 예산을 초과했습니다.");
    }

    const parent = stack.at(-1);
    if (!parent) {
      if (rootSeen || tag.name !== "FinalDraft") {
        fail("INVALID_FORMAT", "FDX XML 루트는 FinalDraft여야 합니다.");
      }
      if (
        tag.attributes.has("DocumentType")
        && tag.attributes.get("DocumentType") !== "Script"
      ) {
        fail("INVALID_FORMAT", "FDX DocumentType은 Script여야 합니다.");
      }
      rootSeen = true;
    }

    const recognizedContent = tag.name === "Content"
      && parent?.name === "FinalDraft"
      && parent.recognized;
    if (recognizedContent) {
      contentCount += 1;
      if (contentCount > 1) fail("INVALID_FORMAT", "FDX Content 요소가 중복되었습니다.");
    }
    const recognizedDualDialogue = tag.name === "DualDialogue"
      && parent?.name === "Content"
      && parent.recognized;
    const recognizedParagraph = tag.name === "Paragraph"
      && (
        (parent?.name === "Content" && parent.recognized)
        || (parent?.name === "DualDialogue" && parent.recognized)
      );
    const recognizedText = tag.name === "Text"
      && parent?.name === "Paragraph"
      && parent.recognized
      && Boolean(parent.paragraph);
    if (parent?.capturesText) {
      fail("INVALID_FORMAT", "지원하는 FDX Text 요소 안에는 다른 XML 요소를 둘 수 없습니다.");
    }

    let paragraph: MutableFdxParagraph | undefined;
    if (recognizedParagraph) {
      if (paragraphs.length >= STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxParagraphs) {
        fail("XML_BUDGET_EXCEEDED", "FDX Paragraph 수가 안전 예산을 초과했습니다.");
      }
      const type = tag.attributes.get("Type");
      if (!type || type.length > 200 || type.includes("\0")) {
        fail("INVALID_FORMAT", "FDX Paragraph Type이 없거나 올바르지 않습니다.");
      }
      paragraph = {
        sourceIndex: paragraphs.length,
        type,
        textParts: [],
        textCodeUnits: 0,
      };
    }
    const frame: FdxXmlFrame = {
      name: tag.name,
      recognized: tag.name === "FinalDraft"
        ? !parent
        : recognizedContent || recognizedDualDialogue || recognizedParagraph || recognizedText,
      capturesText: recognizedText,
      ...(paragraph ? { paragraph } : {}),
      ...(recognizedText && parent?.paragraph ? { paragraph: parent.paragraph } : {}),
    };
    stack.push(frame);
    if (tag.selfClosing) closeFrame(tag.name);
    offset = tagEnd + 1;
  }

  if (stack.length > 0 || !rootSeen || !rootClosed || contentCount !== 1) {
    fail("INVALID_FORMAT", "FDX XML의 FinalDraft/Content 구조가 완전하지 않습니다.");
  }
  if (paragraphs.length === 0) {
    fail("INVALID_FORMAT", "FDX Content에서 Paragraph를 찾지 못했습니다.");
  }
  return Object.freeze(paragraphs);
}

function addFdxLossPreview(
  preview: MutableFdxLossPreview,
  item: StudioDialogueFdxLossPreviewItem
): void {
  if (item.disposition === "mapped") preview.mappedElements += 1;
  else if (item.disposition === "context-only") preview.contextOnlyElements += 1;
  else preview.droppedElements += 1;
  if (preview.items.length < STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFdxLossPreviewItems) {
    preview.items.push(Object.freeze(item));
  } else {
    preview.truncated = true;
  }
}

function fdxPreviewText(value: string): string {
  const singleLine = value.replace(/\s+/gu, " ").trim();
  return singleLine.length <= 160 ? singleLine : `${singleLine.slice(0, 157)}…`;
}

function parseFdx(text: string): StudioDialogueInterchangeResult {
  const paragraphs = parseFdxParagraphs(text);
  const cues: StudioDialogueCue[] = [];
  const warnings: string[] = [];
  const preview: MutableFdxLossPreview = {
    mappedElements: 0,
    contextOnlyElements: 0,
    droppedElements: 0,
    truncated: false,
    items: [],
  };
  let page = 1;
  let panel = 1;
  let sceneCount = 0;
  let actionCount = 0;
  let pendingCharacter: ParsedFdxParagraph | undefined;
  let pendingParentheticals: ParsedFdxParagraph[] = [];

  const dropPending = (detail: string): void => {
    if (pendingCharacter) {
      addFdxLossPreview(preview, {
        sourceIndex: pendingCharacter.sourceIndex,
        sourceType: pendingCharacter.type,
        preview: fdxPreviewText(pendingCharacter.text),
        disposition: "dropped",
        page,
        panel,
        detail,
      });
    }
    for (const parenthetical of pendingParentheticals) {
      addFdxLossPreview(preview, {
        sourceIndex: parenthetical.sourceIndex,
        sourceType: parenthetical.type,
        preview: fdxPreviewText(parenthetical.text),
        disposition: "dropped",
        page,
        panel,
        detail,
      });
    }
    pendingCharacter = undefined;
    pendingParentheticals = [];
  };

  for (const paragraph of paragraphs) {
    if (paragraph.type === "Scene Heading") {
      dropPending("뒤따르는 Dialogue가 없어 cue로 매핑하지 못했습니다.");
      const explicitPage = FDX_PAGE_MARKER.exec(paragraph.text);
      if (explicitPage) {
        page = Number(explicitPage[1]);
        sceneCount = page;
      } else {
        sceneCount += 1;
        page = sceneCount;
      }
      panel = 1;
      actionCount = 0;
      addFdxLossPreview(preview, {
        sourceIndex: paragraph.sourceIndex,
        sourceType: paragraph.type,
        preview: fdxPreviewText(paragraph.text),
        disposition: "context-only",
        page,
        panel,
        detail: explicitPage
          ? "ToonSpectrum 페이지 marker로 복원했습니다."
          : "장면 순서를 1-based 페이지로 매핑했으며 장면 제목 본문은 cue에 저장하지 않습니다.",
      });
      continue;
    }
    if (paragraph.type === "Action") {
      dropPending("Action이 시작되어 미완성 화자 블록을 cue로 매핑하지 못했습니다.");
      const explicitPanel = FDX_PANEL_MARKER.exec(paragraph.text);
      if (explicitPanel) {
        panel = Number(explicitPanel[1]);
        actionCount = 1;
      } else {
        if (actionCount > 0) panel += 1;
        actionCount += 1;
      }
      addFdxLossPreview(preview, {
        sourceIndex: paragraph.sourceIndex,
        sourceType: paragraph.type,
        preview: fdxPreviewText(paragraph.text),
        disposition: "context-only",
        page,
        panel,
        detail: explicitPanel
          ? "ToonSpectrum 컷 marker로 복원했습니다."
          : "Action 순서를 현재 장면의 1-based 컷으로 매핑했으며 본문은 cue에 저장하지 않습니다.",
      });
      continue;
    }
    if (paragraph.type === "Character") {
      dropPending("새 Character가 시작되어 앞선 미완성 화자 블록을 매핑하지 못했습니다.");
      if (paragraph.text.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxSpeakerCodeUnits) {
        fail("INVALID_CUE", "FDX Character가 화자 길이 예산을 초과했습니다.");
      }
      pendingCharacter = paragraph;
      continue;
    }
    if (paragraph.type === "Parenthetical") {
      if (!pendingCharacter) {
        fail("INVALID_CUE", "FDX Parenthetical 앞에 Character가 없습니다.");
      }
      pendingParentheticals.push(paragraph);
      const noteLength = pendingParentheticals.reduce((total, item) => total + item.text.length, 0)
        + Math.max(0, pendingParentheticals.length - 1);
      if (noteLength > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxNoteCodeUnits) {
        fail("INVALID_CUE", "FDX Parenthetical 합계가 cue 메모 길이 예산을 초과했습니다.");
      }
      continue;
    }
    if (paragraph.type === "Dialogue") {
      if (!pendingCharacter) {
        fail("INVALID_CUE", "FDX Dialogue 앞에 Character가 없습니다.");
      }
      if (cues.length >= STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCues) {
        fail("TOO_MANY_CUES", "한 파일에서 가져올 수 있는 대사는 최대 20,000개입니다.");
      }
      const cueIndex = cues.length;
      const note = pendingParentheticals.map((item) => item.text).join("\n") || undefined;
      cues.push(normalizeCue({
        page,
        panel,
        speaker: pendingCharacter.text,
        text: paragraph.text,
        note,
      }, cueIndex));
      addFdxLossPreview(preview, {
        sourceIndex: pendingCharacter.sourceIndex,
        sourceType: pendingCharacter.type,
        preview: fdxPreviewText(pendingCharacter.text),
        disposition: "mapped",
        page,
        panel,
        cueIndex,
        detail: "Character를 cue 화자로 매핑했습니다.",
      });
      for (const parenthetical of pendingParentheticals) {
        addFdxLossPreview(preview, {
          sourceIndex: parenthetical.sourceIndex,
          sourceType: parenthetical.type,
          preview: fdxPreviewText(parenthetical.text),
          disposition: "mapped",
          page,
          panel,
          cueIndex,
          detail: "Parenthetical을 cue 메모로 매핑했습니다.",
        });
      }
      addFdxLossPreview(preview, {
        sourceIndex: paragraph.sourceIndex,
        sourceType: paragraph.type,
        preview: fdxPreviewText(paragraph.text),
        disposition: "mapped",
        page,
        panel,
        cueIndex,
        detail: "Dialogue를 cue 본문으로 매핑했습니다.",
      });
      pendingCharacter = undefined;
      pendingParentheticals = [];
      continue;
    }

    dropPending("지원하지 않는 Paragraph가 화자 블록을 중단했습니다.");
    addFdxLossPreview(preview, {
      sourceIndex: paragraph.sourceIndex,
      sourceType: paragraph.type,
      preview: fdxPreviewText(paragraph.text),
      disposition: "dropped",
      page,
      panel,
      detail: "현재 안전 부분집합에서 지원하지 않는 FDX Paragraph Type입니다.",
    });
  }
  dropPending("파일 끝까지 뒤따르는 Dialogue가 없어 cue로 매핑하지 못했습니다.");
  if (cues.length === 0) fail("INVALID_FORMAT", "FDX 파일에서 Character/Dialogue 대사 블록을 찾지 못했습니다.");

  warnings.push(
    "FDX는 공개 정식 스키마가 아닌 FinalDraft/Content/Paragraph/Text 안전 부분집합으로 처리합니다."
  );
  warnings.push(
    "장면 제목은 페이지, Action 순서는 컷, Character/Dialogue/Parenthetical은 화자·본문·메모로 매핑합니다."
  );
  if (preview.contextOnlyElements > 0) {
    warnings.push("장면 제목과 Action 본문은 위치 문맥으로만 사용되며 loss preview에서 확인할 수 있습니다.");
  }
  if (preview.droppedElements > 0) {
    warnings.push(`${preview.droppedElements}개 FDX 요소를 지원 범위 밖 또는 미완성 블록으로 제외했습니다.`);
  }
  if (preview.truncated) {
    warnings.push("FDX loss preview 상세 목록은 안전한 최대 항목 수에서 잘렸습니다.");
  }
  return {
    document: { cues },
    warnings: Object.freeze(warnings),
    lossy: true,
    lossPreview: Object.freeze({
      sourceFormat: "fdx",
      sourceParagraphs: paragraphs.length,
      emittedCues: cues.length,
      mappedElements: preview.mappedElements,
      contextOnlyElements: preview.contextOnlyElements,
      droppedElements: preview.droppedElements,
      truncated: preview.truncated,
      items: Object.freeze(preview.items),
    }),
  };
}

function parseTimestamp(value: string, vtt: boolean): number | undefined {
  const normalized = value.trim().replace(",", ".");
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})\.(\d{3})$/u.exec(normalized);
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  if (minutes > 59 || seconds > 59 || (!vtt && match[1] == null)) return undefined;
  const result = ((hours * 60 + minutes) * 60 + seconds) * 1_000 + millis;
  return result <= STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxTimestampMs ? result : undefined;
}

function parseTimedText(text: string, vtt: boolean): StudioDialogueInterchangeResult {
  let normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (vtt) {
    if (!/^WEBVTT(?:\s|$)/u.test(normalized)) fail("INVALID_FORMAT", "WEBVTT 헤더가 없습니다.");
    normalized = normalized.replace(/^WEBVTT[^\n]*\n*/u, "");
  }
  const blocks = normalized.split(/\n{2,}/u);
  const cues: StudioDialogueCue[] = [];
  const warnings: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2 || /^(?:NOTE|STYLE|REGION)(?:\s|$)/u.test(lines[0]!)) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = /^(.+?)\s*-->\s*(\S+)(?:\s+.*)?$/u.exec(lines[timingIndex]!);
    if (!timing) continue;
    const startMs = parseTimestamp(timing[1]!, vtt);
    const endMs = parseTimestamp(timing[2]!, vtt);
    if (startMs == null || endMs == null || endMs <= startMs) {
      fail("INVALID_CUE", "자막 시간 범위가 올바르지 않습니다.");
    }
    const payload = lines.slice(timingIndex + 1).join("\n").replace(/<[^>]*>/gu, "").trim();
    if (!payload) continue;
    const firstLineEnd = payload.indexOf("\n");
    const firstLine = firstLineEnd >= 0 ? payload.slice(0, firstLineEnd) : payload;
    const speakerMatch = /^([^:\n]{1,200}):\s*(.*)$/u.exec(firstLine);
    const speaker = speakerMatch?.[1]?.trim();
    const firstDialogue = speakerMatch?.[2] ?? firstLine;
    const remainder = firstLineEnd >= 0 ? payload.slice(firstLineEnd + 1) : "";
    const cueText = [firstDialogue, remainder].filter(Boolean).join("\n");
    cues.push(normalizeCue({ page: 1, speaker, text: cueText, startMs, endMs }, cues.length));
    if (cues.length > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxCues) {
      fail("TOO_MANY_CUES", "한 파일에서 가져올 수 있는 대사는 최대 20,000개입니다.");
    }
  }
  if (cues.length === 0) fail("INVALID_FORMAT", "가져올 수 있는 자막 큐가 없습니다.");
  warnings.push("자막 포맷에는 페이지·컷 배치가 없어 모든 대사를 1페이지로 가져옵니다.");
  return { document: { cues }, warnings, lossy: true };
}

export function parseStudioDialogueInterchange(
  format: StudioDialogueInterchangeFormat,
  source: string | Uint8Array | ArrayBuffer
): StudioDialogueInterchangeResult {
  const text = decodeStudioDialogueInterchangeText(source);
  switch (format) {
    case "json": return parseJson(text);
    case "csv": return parseDelimited(text, ",");
    case "tsv": return parseDelimited(text, "\t");
    case "fountain": return parseFountain(text);
    case "fdx": return parseFdx(text);
    case "srt": return parseTimedText(text, false);
    case "vtt": return parseTimedText(text, true);
    case "txt":
    case "markdown": return parseColonScript(text);
    default: return parseColonScript(text);
  }
}

function csvCell(value: string, delimiter: "," | "\t"): string {
  // Prevent spreadsheet formula execution while preserving a visible, reversible value.
  const safe = /^[=+@]/u.test(value) || /^-\D/u.test(value) ? `'${value}` : value;
  if (safe.includes(delimiter) || /["\r\n]/u.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

function serializeDelimited(document: StudioDialogueInterchangeDocument, delimiter: "," | "\t"): string {
  const header = ["id", "page", "panel", "speaker", "text", "note", "start_ms", "end_ms"];
  const rows = document.cues.map((cue) => [
    cue.id ?? "",
    String(cue.page),
    cue.panel == null ? "" : String(cue.panel),
    cue.speaker ?? "",
    cue.text,
    cue.note ?? "",
    cue.startMs == null ? "" : String(cue.startMs),
    cue.endMs == null ? "" : String(cue.endMs),
  ].map((value) => csvCell(value, delimiter)).join(delimiter));
  return [header.join(delimiter), ...rows].join("\r\n") + "\r\n";
}

function serializeColonScript(document: StudioDialogueInterchangeDocument, markdown: boolean): string {
  const lines: string[] = [];
  let page = -1;
  let panel = -1;
  for (const cue of document.cues) {
    if (cue.page !== page) {
      if (lines.length > 0) lines.push("");
      lines.push(`${markdown ? "## " : "@"}페이지 ${cue.page}`);
      page = cue.page;
      panel = -1;
    }
    if (cue.panel != null && cue.panel !== panel) {
      lines.push(`${markdown ? "### " : "@"}컷 ${cue.panel}`);
      panel = cue.panel;
    }
    lines.push(`${markdown ? "- " : ""}${cue.speaker ?? "대사"}: ${cue.text.replaceAll("\n", " / ")}`);
  }
  return lines.join("\n") + "\n";
}

function serializeFountain(document: StudioDialogueInterchangeDocument): string {
  const lines: string[] = [];
  let page = -1;
  let panel = -1;
  for (const cue of document.cues) {
    if (cue.page !== page) {
      if (lines.length > 0) lines.push("");
      lines.push(`# PAGE ${cue.page}`);
      page = cue.page;
      panel = -1;
    }
    if (cue.panel != null && cue.panel !== panel) {
      lines.push("", `[[PANEL ${cue.panel}]]`);
      panel = cue.panel;
    }
    lines.push("", `@${cue.speaker ?? "DIALOGUE"}`, cue.text, "");
  }
  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd() + "\n";
}

function escapeFdxXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fdxParagraph(type: StudioDialogueFdxCoreParagraphType, value: string): string {
  return `    <Paragraph Type="${type}"><Text>${escapeFdxXml(value)}</Text></Paragraph>\n`;
}

function serializeFdx(document: StudioDialogueInterchangeDocument): string {
  const chunks: string[] = [];
  let byteLength = 0;
  const push = (value: string): void => {
    byteLength += UTF8.encode(value).byteLength;
    if (byteLength > STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxFileBytes) {
      fail("FILE_TOO_LARGE", "FDX 출력이 8MB 안전 예산을 초과했습니다.");
    }
    chunks.push(value);
  };
  push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n');
  push('<FinalDraft DocumentType="Script" Template="No" Version="1">\n');
  push("  <Content>\n");
  let page: number | undefined;
  let panel: number | undefined;
  for (const cue of document.cues) {
    if (cue.page !== page) {
      push(fdxParagraph("Scene Heading", `TOONSPECTRUM PAGE ${cue.page}`));
      page = cue.page;
      panel = undefined;
    }
    if (cue.panel != null && cue.panel !== panel) {
      push(fdxParagraph("Action", `TOONSPECTRUM PANEL ${cue.panel}`));
      panel = cue.panel;
    }
    push(fdxParagraph("Character", cue.speaker ?? "DIALOGUE"));
    if (cue.note) push(fdxParagraph("Parenthetical", cue.note));
    push(fdxParagraph("Dialogue", cue.text));
  }
  push("  </Content>\n");
  push("</FinalDraft>\n");
  return chunks.join("");
}

function formatTimestamp(milliseconds: number, vtt: boolean): string {
  const clamped = Math.max(0, Math.min(STUDIO_DIALOGUE_INTERCHANGE_LIMITS.maxTimestampMs, Math.round(milliseconds)));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const millis = clamped % 1_000;
  const separator = vtt ? "." : ",";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function timedCueRange(cue: StudioDialogueCue, index: number): readonly [number, number, boolean] {
  if (cue.startMs != null && cue.endMs != null) return [cue.startMs, cue.endMs, false];
  const start = index * 3_250;
  return [start, start + 3_000, true];
}

function serializeTimedText(
  document: StudioDialogueInterchangeDocument,
  vtt: boolean
): { text: string; generatedTimings: boolean } {
  let generatedTimings = false;
  const blocks = document.cues.map((cue, index) => {
    const [start, end, generated] = timedCueRange(cue, index);
    generatedTimings ||= generated;
    const payload = cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text;
    const body = `${formatTimestamp(start, vtt)} --> ${formatTimestamp(end, vtt)}\n${payload}`;
    return vtt ? body : `${index + 1}\n${body}`;
  });
  return { text: `${vtt ? "WEBVTT\n\n" : ""}${blocks.join("\n\n")}\n`, generatedTimings };
}

export function serializeStudioDialogueInterchange(
  format: StudioDialogueInterchangeFormat,
  input: StudioDialogueInterchangeDocument
): StudioDialogueSerializedFile {
  const document = normalizeDocument(input);
  let text = "";
  let lossy = false;
  const warnings: string[] = [];
  switch (format) {
    case "json":
      text = `${JSON.stringify({
        schema: STUDIO_DIALOGUE_INTERCHANGE_SCHEMA,
        version: STUDIO_DIALOGUE_INTERCHANGE_VERSION,
        ...document,
      }, null, 2)}\n`;
      break;
    case "csv":
      text = serializeDelimited(document, ",");
      break;
    case "tsv":
      text = serializeDelimited(document, "\t");
      break;
    case "txt":
      text = serializeColonScript(document, false);
      lossy = document.cues.some((cue) => cue.note || cue.startMs != null || cue.endMs != null);
      if (lossy) warnings.push("TXT에는 메모와 시간 정보가 포함되지 않습니다.");
      break;
    case "markdown":
      text = serializeColonScript(document, true);
      lossy = document.cues.some((cue) => cue.note || cue.startMs != null || cue.endMs != null);
      if (lossy) warnings.push("Markdown에는 메모와 시간 정보가 포함되지 않습니다.");
      break;
    case "fountain":
      text = serializeFountain(document);
      warnings.push("Fountain 출력은 페이지·컷을 섹션/주석으로 보존하지만 캔버스 좌표는 포함하지 않습니다.");
      lossy = true;
      break;
    case "fdx":
      text = serializeFdx(document);
      warnings.push(
        "FDX 출력은 공개 정식 스키마가 아닌 FinalDraft/Content/Paragraph/Text 안전 부분집합입니다."
      );
      warnings.push(
        "페이지·컷은 ToonSpectrum 전용 Scene Heading/Action marker로 보존하며 FDX 서식·좌표·제작 메타데이터는 포함하지 않습니다."
      );
      if (document.cues.some((cue) => !cue.speaker)) {
        warnings.push("화자가 없는 cue는 FDX Character 값 DIALOGUE로 출력했습니다.");
      }
      if (
        document.title
        || document.language
        || document.cues.some((cue) => cue.id || cue.startMs != null || cue.endMs != null)
      ) {
        warnings.push("FDX 안전 부분집합에는 제목·언어·cue ID·타임코드가 포함되지 않습니다.");
      }
      lossy = true;
      break;
    case "srt":
    case "vtt": {
      const timed = serializeTimedText(document, format === "vtt");
      text = timed.text;
      lossy = true;
      warnings.push("자막 출력에는 캔버스 페이지·컷 좌표가 포함되지 않습니다.");
      if (timed.generatedTimings) warnings.push("시간 정보가 없는 대사에는 3초 간격을 자동 배정했습니다.");
      break;
    }
  }
  assertFileBudget(text);
  const extension = format === "markdown" ? ".md" : (`.${format}` as const);
  const mimeType = format === "json"
    ? "application/json;charset=utf-8"
    : format === "fdx"
      ? "application/xml;charset=utf-8"
    : format === "csv"
      ? "text/csv;charset=utf-8"
      : format === "vtt"
        ? "text/vtt;charset=utf-8"
        : "text/plain;charset=utf-8";
  return { text, extension, mimeType, warnings, lossy };
}

/** Maps the existing page-ordered lettering view to the interchange cue model. */
export function studioDialogueItemsToInterchange(
  items: readonly DialogueBatchItem[],
  options: { title?: string; language?: string } = {}
): StudioDialogueInterchangeDocument {
  const panelCounters = new Map<number, number>();
  return normalizeDocument({
    ...options,
    cues: items.map((item) => {
      const page = item.pageIndex + 1;
      const panel = (panelCounters.get(page) ?? 0) + 1;
      panelCounters.set(page, panel);
      return {
        id: item.id,
        page,
        panel,
        text: item.text,
        note: item.locked ? "locked" : item.hidden ? "hidden" : undefined,
      };
    }),
  });
}

/**
 * Applies imported lettering to existing bubbles without creating, deleting or moving elements.
 * This is the safe translation round-trip path: exact exported IDs win, then page-local order,
 * then (only in auto/document-order modes) global reading order. One target can be consumed once.
 */
export function applyStudioDialogueInterchangeToPages(
  pages: readonly DialoguePageLike[],
  input: StudioDialogueInterchangeDocument,
  mode: StudioDialogueImportMatchMode = "auto"
): StudioDialogueImportApplyResult {
  const document = normalizeDocument(input);
  const items = collectDialogueItems(pages);
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const byPage = new Map<number, DialogueBatchItem[]>();
  for (const item of items) {
    const list = byPage.get(item.pageIndex + 1);
    if (list) list.push(item);
    else byPage.set(item.pageIndex + 1, [item]);
  }
  const consumed = new Set<string>();
  const replacementById = new Map<string, string>();
  let matched = 0;
  let locked = 0;
  let missing = 0;
  let droppedMetadata = 0;

  document.cues.forEach((cue, cueIndex) => {
    let target: DialogueBatchItem | undefined;
    if ((mode === "auto" || mode === "id") && cue.id) target = byId.get(cue.id);
    if (!target && (mode === "auto" || mode === "page-order") && cue.panel != null) {
      target = byPage.get(cue.page)?.[cue.panel - 1];
    }
    if (!target && (mode === "auto" || mode === "document-order")) target = items[cueIndex];
    if (!target || consumed.has(target.id)) {
      missing += 1;
      return;
    }
    consumed.add(target.id);
    matched += 1;
    if (target.locked) {
      locked += 1;
      return;
    }
    if (cue.speaker || cue.note || cue.startMs != null || cue.endMs != null) droppedMetadata += 1;
    if (target.text !== cue.text) replacementById.set(target.id, cue.text);
  });

  if (replacementById.size === 0) {
    return { pages, matched, changed: 0, locked, missing, droppedMetadata };
  }
  let changed = 0;
  const next = pages.map((page) => {
    let pageChanged = false;
    const elements = page.elements.map((element) => {
      const text = replacementById.get(element.id);
      if (text == null || !isDialogueElement(element) || element.text === text) return element;
      pageChanged = true;
      changed += 1;
      return { ...element, text };
    });
    return pageChanged ? { ...page, elements } : page;
  });
  return { pages: next, matched, changed, locked, missing, droppedMetadata };
}
