// Studio Palette Library — 이름 붙은 색상 팔레트를 저장·관리하고 GIMP .gpl 텍스트 형식으로
// 가져오기/내보내기 한다. 이미지에서 색을 뽑는 studio-color-palette.ts(추출)와는 완전히
// 독립적인 기능 — 여긴 "사용자가 이미 가진 팔레트를 이름 붙여 보관"하는 쪽이다.
//
// 저장소(localStorage 호환 인터페이스)를 주입받아 순수하게 동작한다(studio-clips.ts와 동일 패턴).

import { normalizeHexColor } from "./studio-color-utils";

// ── GPL 포맷 코덱 ────────────────────────────────────────────────────────

export interface GplColor {
  hex: string; // 정규화된 소문자 #rrggbb
  name?: string; // 원본 줄의 색상 이름(있을 때만) — 이 앱은 팔레트당 하나의 이름만 쓰므로 CRUD 계층에서 버려진다.
}

export interface ParsedGplPalette {
  name: string; // "Name:" 헤더 값(없으면 "")
  columns?: number; // "Columns:" 헤더 값(있으면) — 이 앱은 사용하지 않지만 파싱 결과에는 남긴다.
  colors: GplColor[];
  skippedLines: number; // 색으로 해석하지 못해 건너뛴 줄 수
}

const GPL_MAGIC = "GIMP Palette";
const NAME_LINE_RE = /^Name:\s*(.*)$/i;
const COLUMNS_LINE_RE = /^Columns:\s*(\d+)\s*$/i;
const COLOR_LINE_RE = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/;

function toHexByte(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * GIMP 팔레트(.gpl) 텍스트를 파싱한다.
 * 형식: 첫 줄이 정확히 "GIMP Palette"(필수), 이후 "Name:"/"Columns:" 헤더(선택),
 * "#"로 시작하는 주석·빈 줄(무시), "R G B [이름]" 색상 줄(공백 구분 정수 3개 + 선택적 이름).
 * 첫 줄이 매직 헤더가 아니거나, 유효한 색이 하나도 없으면 Error를 던진다(한국어 메시지).
 */
export function parseGplPalette(text: string): ParsedGplPalette {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("빈 파일이에요. .gpl 팔레트 파일을 선택해주세요.");
  }
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (i >= lines.length || lines[i]!.trim() !== GPL_MAGIC) {
    throw new Error("GIMP 팔레트(.gpl) 파일이 아니에요.");
  }
  i++; // 매직 헤더 소비(본문 처리 대상 아님)

  let name = "";
  let columns: number | undefined;
  const colors: GplColor[] = [];
  let skippedLines = 0;

  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "" || line.startsWith("#")) continue;

    const nameMatch = NAME_LINE_RE.exec(line);
    if (nameMatch) {
      name = (nameMatch[1] ?? "").trim();
      continue;
    }
    const columnsMatch = COLUMNS_LINE_RE.exec(line);
    if (columnsMatch) {
      columns = Number(columnsMatch[1]);
      continue;
    }

    const colorMatch = COLOR_LINE_RE.exec(line);
    if (!colorMatch) {
      skippedLines++;
      continue;
    }
    const r = Number(colorMatch[1]);
    const g = Number(colorMatch[2]);
    const b = Number(colorMatch[3]);
    if (r > 255 || g > 255 || b > 255) {
      skippedLines++;
      continue;
    }
    const rawName = (colorMatch[4] ?? "").trim();
    colors.push({ hex: `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`, ...(rawName ? { name: rawName } : {}) });
  }

  if (colors.length === 0) {
    throw new Error("팔레트에서 읽을 수 있는 색이 하나도 없어요.");
  }
  return { name, columns, colors, skippedLines };
}

/** StudioNamedPalette → .gpl 텍스트. 콜론 없이 정확한 매직 헤더 + Name: + "#" 구분선 + 색상 줄들. */
export function writeGplPalette(palette: { name: string; colors: string[] }): string {
  const lines: string[] = [GPL_MAGIC, `Name: ${palette.name.trim() || DEFAULT_PALETTE_NAME}`, "#"];
  const pad = (n: number) => String(n).padStart(3, " ");
  for (const hex of palette.colors) {
    const norm = normalizeHexColor(hex);
    if (!norm) continue; // 방어적: 저장된 값은 항상 유효해야 하지만, 손상된 데이터를 조용히 건너뛴다.
    const r = parseInt(norm.slice(1, 3), 16);
    const g = parseInt(norm.slice(3, 5), 16);
    const b = parseInt(norm.slice(5, 7), 16);
    lines.push(`${pad(r)} ${pad(g)} ${pad(b)}\t${norm.slice(1).toUpperCase()}`);
  }
  return lines.join("\n") + "\n";
}

/** 내보내기 파일명 — 이름의 파일시스템 금지 문자만 제거, 한글은 그대로 유지. */
export function paletteFileName(palette: { name: string }): string {
  // eslint-disable-next-line no-control-regex -- intentionally strips filesystem-illegal control chars (0x00-0x1f) from the filename
  const safe = palette.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
  return `${safe || "palette"}.gpl`;
}

// ── 저장소 CRUD (studio-clips.ts와 동일한 패턴) ─────────────────────────

export interface StudioNamedPalette {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  colors: string[]; // 정규화된 소문자 #rrggbb. GPL 가져오기는 원본 순서·중복을 그대로 보존, 수동 생성은 중복 제거.
}

export interface PaletteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PALETTE_LIBRARY_KEY = "toonspectrum-studio-palette-library";
export const MAX_PALETTES = 40; // studio-clips.ts의 MAX_CLIPS와 동일한 상한 정책을 따른다.
export const MAX_COLORS_PER_PALETTE = 1000; // localStorage 용량 보호용 — 대형 브랜드 스와치북까지 여유 있게 수용.
export const DEFAULT_PALETTE_NAME = "이름 없는 팔레트";
export const MAX_PALETTE_NAME_LENGTH = 160;
export const MAX_PALETTE_ID_LENGTH = 160;
export const MAX_PALETTE_LIBRARY_SERIALIZED_BYTES = 2 * 1024 * 1024;
export const STUDIO_PALETTE_LIBRARY_SCHEMA = "toonspectrum.studio.named-palettes";

export type StudioPaletteLibraryErrorCode =
  | "corrupt-data"
  | "invalid-palette"
  | "library-too-large";

export class StudioPaletteLibraryError extends Error {
  readonly code: StudioPaletteLibraryErrorCode;

  constructor(code: StudioPaletteLibraryErrorCode, message: string) {
    super(message);
    this.name = "StudioPaletteLibraryError";
    this.code = code;
  }
}

function isStudioNamedPalette(v: unknown): v is StudioNamedPalette {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number" &&
    Array.isArray(o.colors) &&
    o.colors.every((c) => typeof c === "string")
  );
}

function exactPaletteRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed = new Set(["id", "name", "createdAt", "updatedAt", "colors"]);
  return Object.keys(record).every((key) => allowed.has(key))
    && Object.keys(record).length === allowed.size
    ? record
    : null;
}

function canonicalPalette(value: unknown): StudioNamedPalette | null {
  const record = exactPaletteRecord(value);
  if (!record || !isStudioNamedPalette(record)) return null;
  if (
    record.id.trim() !== record.id
    || record.id.length === 0
    || record.id.length > MAX_PALETTE_ID_LENGTH
    || record.name.trim() !== record.name
    || record.name.length === 0
    || record.name.length > MAX_PALETTE_NAME_LENGTH
    || !Number.isSafeInteger(record.createdAt)
    || record.createdAt < 0
    || !Number.isSafeInteger(record.updatedAt)
    || record.updatedAt < record.createdAt
    || record.colors.length === 0
    || record.colors.length > MAX_COLORS_PER_PALETTE
    || record.colors.some((color) => !/^#[0-9a-f]{6}$/u.test(color))
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    colors: [...record.colors],
  };
}

function canonicalPaletteLibrary(values: readonly unknown[]): StudioNamedPalette[] {
  if (values.length > MAX_PALETTES) {
    throw new StudioPaletteLibraryError(
      "library-too-large",
      `팔레트 라이브러리는 ${MAX_PALETTES}개를 넘을 수 없습니다.`,
    );
  }
  const ids = new Set<string>();
  return values.map((value) => {
    const palette = canonicalPalette(value);
    if (!palette || ids.has(palette.id)) {
      throw new StudioPaletteLibraryError(
        "invalid-palette",
        "팔레트 라이브러리에 손상되거나 중복된 항목이 있습니다.",
      );
    }
    ids.add(palette.id);
    return palette;
  });
}

function paletteLibraryEnvelope(items: readonly StudioNamedPalette[]) {
  return {
    schema: STUDIO_PALETTE_LIBRARY_SCHEMA,
    version: 1 as const,
    items,
  };
}

export function serializeStudioPaletteLibrary(
  values: readonly StudioNamedPalette[],
): string {
  const serialized = JSON.stringify(paletteLibraryEnvelope(canonicalPaletteLibrary(values)));
  if (new TextEncoder().encode(serialized).byteLength > MAX_PALETTE_LIBRARY_SERIALIZED_BYTES) {
    throw new StudioPaletteLibraryError(
      "library-too-large",
      "팔레트 라이브러리가 SQLite 저장 상한을 넘었습니다.",
    );
  }
  return serialized;
}

export function parseCanonicalStudioPaletteLibrary(raw: string): StudioNamedPalette[] {
  if (
    typeof raw !== "string"
    || new TextEncoder().encode(raw).byteLength > MAX_PALETTE_LIBRARY_SERIALIZED_BYTES
  ) {
    throw new StudioPaletteLibraryError(
      "library-too-large",
      "팔레트 라이브러리 저장값이 허용 크기를 넘었습니다.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StudioPaletteLibraryError("corrupt-data", "팔레트 라이브러리 JSON이 손상되었습니다.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StudioPaletteLibraryError("corrupt-data", "팔레트 라이브러리 envelope가 올바르지 않습니다.");
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).sort().join(",") !== "items,schema,version"
    || envelope.schema !== STUDIO_PALETTE_LIBRARY_SCHEMA
    || envelope.version !== 1
    || !Array.isArray(envelope.items)
  ) {
    throw new StudioPaletteLibraryError("corrupt-data", "팔레트 라이브러리 계약이 올바르지 않습니다.");
  }
  const items = canonicalPaletteLibrary(envelope.items);
  if (serializeStudioPaletteLibrary(items) !== raw) {
    throw new StudioPaletteLibraryError("corrupt-data", "팔레트 라이브러리가 canonical 형식이 아닙니다.");
  }
  return items;
}

export function upsertPaletteInMemory(
  values: readonly StudioNamedPalette[],
  palette: StudioNamedPalette,
): StudioNamedPalette[] {
  const current = canonicalPaletteLibrary(values);
  const canonical = canonicalPalette(palette);
  if (!canonical) {
    throw new StudioPaletteLibraryError("invalid-palette", "유효하지 않은 팔레트입니다.");
  }
  const exists = current.some((item) => item.id === canonical.id);
  if (!exists && current.length >= MAX_PALETTES) {
    throw new StudioPaletteLibraryError(
      "library-too-large",
      `팔레트 라이브러리는 ${MAX_PALETTES}개를 넘을 수 없습니다. 기존 항목을 먼저 삭제해 주세요.`,
    );
  }
  return [canonical, ...current.filter((item) => item.id !== canonical.id)];
}

export function renamePaletteInMemory(
  values: readonly StudioNamedPalette[],
  id: string,
  name: string,
  now: number = Date.now(),
): StudioNamedPalette[] {
  const current = canonicalPaletteLibrary(values);
  const trimmed = name.trim();
  if (!trimmed) return current;
  if (trimmed.length > MAX_PALETTE_NAME_LENGTH || !Number.isSafeInteger(now) || now < 0) {
    throw new StudioPaletteLibraryError("invalid-palette", "팔레트 이름 또는 수정 시각이 올바르지 않습니다.");
  }
  return current.map((palette) => palette.id === id
    ? { ...palette, name: trimmed, updatedAt: Math.max(palette.createdAt, now) }
    : palette);
}

export function deletePaletteInMemory(
  values: readonly StudioNamedPalette[],
  id: string,
): StudioNamedPalette[] {
  return canonicalPaletteLibrary(values).filter((palette) => palette.id !== id);
}

/**
 * Legacy/test/import seam. V12 product boot must use studio-palette-sqlite-repository and must not
 * call this helper automatically. 저장소 부재·파싱 실패 시 [].
 */
export function listPalettes(storage: PaletteStorage | null | undefined): StudioNamedPalette[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PALETTE_LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStudioNamedPalette);
  } catch {
    return [];
  }
}

function persist(storage: PaletteStorage | null | undefined, palettes: StudioNamedPalette[]): void {
  if (!storage) return;
  try {
    storage.setItem(PALETTE_LIBRARY_KEY, JSON.stringify(palettes));
  } catch {
    // 저장 실패(쿼터 초과·시크릿 모드 등) — 무시. 클립·최근색과 동일한 정책.
  }
}

/** Legacy sync seam only. V12 product code uses the queued SQLite repository. */
export function savePalette(storage: PaletteStorage | null | undefined, palette: StudioNamedPalette): StudioNamedPalette[] {
  const next = [palette, ...listPalettes(storage).filter((p) => p.id !== palette.id)].slice(0, MAX_PALETTES);
  persist(storage, next);
  return next;
}

/** 이름 변경(목록 순서는 유지 — 저장과 달리 맨 앞으로 옮기지 않는다). 빈 이름은 무시(원본 목록 그대로 반환). */
export function renamePalette(storage: PaletteStorage | null | undefined, id: string, name: string): StudioNamedPalette[] {
  const trimmed = name.trim();
  const current = listPalettes(storage);
  if (!trimmed) return current;
  const next = current.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p));
  persist(storage, next);
  return next;
}

/** 삭제. 새 목록 반환. */
export function deletePalette(storage: PaletteStorage | null | undefined, id: string): StudioNamedPalette[] {
  const next = listPalettes(storage).filter((p) => p.id !== id);
  persist(storage, next);
  return next;
}

/**
 * 수동 생성(직접 입력한 헥스 목록으로). 유효하지 않은 색은 버리고, 중복은 제거(첫 등장 순서 유지).
 * 유효한 색이 하나도 없으면 Error(한국어 메시지).
 */
export function createPalette(name: string, colors: string[]): StudioNamedPalette {
  const validated: string[] = [];
  for (const raw of colors) {
    const norm = normalizeHexColor(raw);
    if (norm && !validated.includes(norm)) validated.push(norm);
  }
  if (validated.length === 0) {
    throw new Error("유효한 색이 하나도 없어요. #rrggbb 형식의 색을 입력해주세요.");
  }
  if (validated.length > MAX_COLORS_PER_PALETTE) {
    throw new StudioPaletteLibraryError(
      "library-too-large",
      `팔레트 하나에는 최대 ${MAX_COLORS_PER_PALETTE}색만 저장할 수 있습니다.`,
    );
  }
  const normalizedName = name.trim() || DEFAULT_PALETTE_NAME;
  if (normalizedName.length > MAX_PALETTE_NAME_LENGTH) {
    throw new StudioPaletteLibraryError(
      "invalid-palette",
      `팔레트 이름은 ${MAX_PALETTE_NAME_LENGTH}자를 넘을 수 없습니다.`,
    );
  }
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
    colors: validated,
  };
}

/**
 * .gpl 텍스트 → StudioNamedPalette. parseGplPalette를 감싸 앱 모델로 변환한다.
 * GPL 원본의 색 순서·중복은 그대로 보존한다(파일에 대한 신뢰도 우선 — createPalette와 의도적으로 다름).
 * MAX_COLORS_PER_PALETTE 초과분은 앞에서부터 잘라내고 truncated=true로 알린다.
 */
export function importPaletteFromGpl(
  text: string,
  fallbackName?: string
): { palette: StudioNamedPalette; skippedLines: number; truncated: boolean } {
  const parsed = parseGplPalette(text); // 실패 시 그대로 throw(호출부가 잡는다)
  const truncated = parsed.colors.length > MAX_COLORS_PER_PALETTE;
  const colors = parsed.colors.slice(0, MAX_COLORS_PER_PALETTE).map((c) => c.hex);
  const now = Date.now();
  return {
    palette: {
      id: crypto.randomUUID(),
      name: parsed.name.trim() || fallbackName?.trim() || DEFAULT_PALETTE_NAME,
      createdAt: now,
      updatedAt: now,
      colors,
    },
    skippedLines: parsed.skippedLines,
    truncated,
  };
}
