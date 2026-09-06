/**
 * Studio OPFS Migration — localStorage에 인라인으로 박혀 있던 대용량 자산(base64 data URL)을
 * OPFS 자산 저장소로 한 번만 옮기고, 원래 자리에는 참조(`opfs:sha256:…`)만 남긴다.
 *
 * ── 왜 "JSON 안의 data URL"을 일반적으로 훑는가 ───────────────────────────
 * 옮겨야 할 보관함들(글꼴 `dataUrl`, 프레임 틀 `src`, 브러시 팁 `tipDataUrl`, 참고 이미지)은
 * 필드 이름만 다를 뿐 전부 "JSON 레코드 안에 base64 data URL 문자열"이라는 같은 모양이다.
 * 그래서 보관함마다 어댑터를 쓰는 대신 JSON을 훑어 data URL을 외부화한다 —
 * **기존 모듈을 한 줄도 고치지 않고** 옮길 수 있는 유일한 방법이고, 이미 옮겨진 payload에는
 * data URL이 남아 있지 않으므로 멱등성이 구조적으로 성립한다.
 *
 * ── 중단 안전성(핵심 불변식) ─────────────────────────────────────────────
 * 어느 순간에 전원이 꺼져도 다음 중 하나가 **항상** 참이다.
 *   (A) localStorage[key]가 원본 인라인 payload를 그대로 갖고 있다, 또는
 *   (B) localStorage[key]가 참조 payload이고, 그 참조가 가리키는 blob이 **이미** OPFS에 있다.
 * 근거:
 *   1. blob을 전부 쓴 뒤에만 setItem(key, 참조본)을 호출한다. (B)의 전제가 먼저 성립한다.
 *   2. localStorage.setItem은 키 단위로 원자적이라 "반쯤 바뀐 문자열"이 생기지 않는다.
 *   3. OPFS write도 원자적이다(createWritable → close 시 교체). 반쯤 쓰인 blob이 없다.
 *   4. 마이그레이션은 원본을 **절대 지우지 않는다**. 지우는 주체는 sweep뿐이고, sweep은
 *      소유자 참조가 없고 유예 시간이 지난 blob만 건드린다.
 * 저널(journal)은 감사·진단용 기록일 뿐 정확성의 전제가 아니다. 저널을 통째로 지우고 다시
 * 돌려도 결과는 같다(테스트로 고정한다).
 */

import {
  canonicalizeStudioOpfsContentHash,
  type StudioOpfsAssetRef,
  type StudioOpfsAssetStore,
  type StudioOpfsContentHash,
} from "./studio-opfs-asset-store";
import { StudioOpfsError, type StudioOpfsLocalStorageLike } from "./studio-opfs-filesystem";

// ── 참조 표기 ────────────────────────────────────────────────────────────

export const STUDIO_OPFS_REF_PREFIX = "opfs:";

export function studioOpfsRefValue(hash: StudioOpfsContentHash, mime: string): string {
  // MIME을 함께 남긴다 — 복원할 때 data URL을 원래 형태로 되돌리려면 필요하고,
  // 저장소 색인이 손상돼도 이 문자열만으로 복원 형식을 알 수 있다.
  return `${STUDIO_OPFS_REF_PREFIX}${hash}#${mime}`;
}

export interface StudioOpfsParsedRef {
  hash: StudioOpfsContentHash;
  mime: string;
}

export function parseStudioOpfsRefValue(value: unknown): StudioOpfsParsedRef | null {
  if (typeof value !== "string" || !value.startsWith(STUDIO_OPFS_REF_PREFIX)) return null;
  const body = value.slice(STUDIO_OPFS_REF_PREFIX.length);
  const hashIndex = body.indexOf("#");
  const hash = canonicalizeStudioOpfsContentHash(hashIndex < 0 ? body : body.slice(0, hashIndex));
  if (!hash) return null;
  const mime = hashIndex < 0 ? "application/octet-stream" : body.slice(hashIndex + 1);
  return { hash, mime: mime || "application/octet-stream" };
}

// ── data URL 코덱 ────────────────────────────────────────────────────────

const DATA_URL_RE = /^data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)?;base64,([A-Za-z0-9+/]*={0,2})$/u;
const B64_CHUNK = 0x8000;

export interface StudioOpfsDecodedDataUrl {
  mime: string;
  bytes: Uint8Array;
}

/** `data:<mime>;base64,<payload>` → 바이트. 형식이 어긋나거나 디코딩이 실패하면 null. */
export function decodeStudioOpfsDataUrl(value: unknown): StudioOpfsDecodedDataUrl | null {
  if (typeof value !== "string") return null;
  const match = DATA_URL_RE.exec(value);
  if (!match) return null;
  const payload = match[2] ?? "";
  if (payload.length === 0 || payload.length % 4 !== 0) return null;
  let binary: string;
  try {
    binary = atob(payload);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1] ?? "application/octet-stream", bytes };
}

export function encodeStudioOpfsDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + B64_CHUNK));
  }
  return `data:${mime || "application/octet-stream"};base64,${btoa(binary)}`;
}

// ── JSON 훑기 ────────────────────────────────────────────────────────────

type JsonValue = unknown;

/** JSON 안의 모든 data URL 문자열을 찾아 (경로, 값)으로 돌려준다. 순회 깊이·개수를 제한한다. */
const MAX_WALK_DEPTH = 12;
const MAX_WALK_NODES = 200_000;

function walkJson(
  value: JsonValue,
  visit: (holder: Record<string, unknown> | unknown[], key: string | number, value: string) => void
): void {
  let nodes = 0;
  const recurse = (node: JsonValue, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || nodes > MAX_WALK_NODES) return;
    nodes += 1;
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        if (typeof child === "string") visit(node, index, child);
        else recurse(child, depth + 1);
      });
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const child = record[key];
        if (typeof child === "string") visit(record, key, child);
        else recurse(child, depth + 1);
      }
    }
  };
  recurse(value, 0);
}

// ── 마이그레이션 소스 ────────────────────────────────────────────────────

export interface StudioOpfsMigrationItem {
  bytes: Uint8Array;
  mime: string;
}

export interface StudioOpfsMigrationSource {
  /** 저널·소유자 이름. 보관함마다 유일해야 한다. */
  id: string;
  /** 대상 localStorage 키. */
  key: string;
  /** 원문에서 외부화할 자산을 뽑는다. 이미 옮겨진 payload면 빈 배열을 돌려야 한다. */
  extract(raw: string): StudioOpfsMigrationItem[];
  /** 원문의 data URL을 참조로 바꾼 새 문자열. 바꿀 게 없으면 null. */
  rewrite(raw: string, refs: ReadonlyMap<string, StudioOpfsAssetRef>): string | null;
}

export interface StudioOpfsJsonDataUrlSourceOptions {
  id: string;
  key: string;
  /** 이보다 작은 자산은 옮기지 않는다(왕복 비용이 이득보다 크다). 기본 4 KB. */
  minBytes?: number;
}

export const STUDIO_OPFS_MIN_EXTERNALIZE_BYTES = 4_096;

/**
 * "JSON 안의 base64 data URL"을 외부화하는 범용 소스. 글꼴(dataUrl)·프레임 틀(src)·
 * 브러시 팁(tipDataUrl)이 모두 이 한 팩토리로 처리된다.
 */
export function createStudioOpfsJsonDataUrlSource(
  options: StudioOpfsJsonDataUrlSourceOptions
): StudioOpfsMigrationSource {
  const minBytes = options.minBytes ?? STUDIO_OPFS_MIN_EXTERNALIZE_BYTES;

  function parse(raw: string): JsonValue | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  return {
    id: options.id,
    key: options.key,
    extract(raw) {
      const parsed = parse(raw);
      if (!parsed) return [];
      const items: StudioOpfsMigrationItem[] = [];
      const seen = new Set<string>();
      walkJson(parsed, (_holder, _key, value) => {
        if (seen.has(value)) return;
        const decoded = decodeStudioOpfsDataUrl(value);
        if (!decoded || decoded.bytes.byteLength < minBytes) return;
        seen.add(value);
        items.push(decoded);
      });
      return items;
    },
    rewrite(raw, refs) {
      const parsed = parse(raw);
      if (!parsed) return null;
      let changed = false;
      walkJson(parsed, (holder, key, value) => {
        const ref = refs.get(value);
        if (!ref) return;
        changed = true;
        const next = studioOpfsRefValue(ref.hash, ref.mime);
        if (Array.isArray(holder)) holder[key as number] = next;
        else holder[key as string] = next;
      });
      return changed ? JSON.stringify(parsed) : null;
    },
  };
}

// ── 저널 ────────────────────────────────────────────────────────────────

export const STUDIO_OPFS_MIGRATION_JOURNAL_KEY = "toonspectrum-studio-opfs-migration:v1";

export type StudioOpfsMigrationPhase = "copied" | "done";

export interface StudioOpfsMigrationJournalEntry {
  source: string;
  phase: StudioOpfsMigrationPhase;
  hashes: StudioOpfsContentHash[];
  updatedAt: number;
}

export type StudioOpfsMigrationJournal = Record<string, StudioOpfsMigrationJournalEntry>;

export function parseStudioOpfsMigrationJournal(raw: string | null): StudioOpfsMigrationJournal {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const journal: StudioOpfsMigrationJournal = {};
  for (const [source, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const phase = record.phase === "done" ? "done" : record.phase === "copied" ? "copied" : null;
    if (!phase) continue;
    const hashes: StudioOpfsContentHash[] = [];
    for (const candidate of Array.isArray(record.hashes) ? record.hashes : []) {
      const hash = canonicalizeStudioOpfsContentHash(candidate);
      if (hash) hashes.push(hash);
    }
    journal[source] = {
      source,
      phase,
      hashes,
      updatedAt:
        typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : 0,
    };
  }
  return journal;
}

// ── 실행 ────────────────────────────────────────────────────────────────

export type StudioOpfsMigrationStatus =
  | "migrated"
  | "already-migrated"
  | "nothing-to-migrate"
  | "source-missing"
  | "failed";

export interface StudioOpfsMigrationSourceReport {
  source: string;
  status: StudioOpfsMigrationStatus;
  /** 이번 실행에서 OPFS로 옮긴 자산 수(중복 제거로 새로 쓰지 않은 것 포함). */
  movedCount: number;
  /** 중복 제거로 실제 쓰기를 건너뛴 자산 수. */
  dedupedCount: number;
  /** localStorage에서 덜어낸 문자 수(대략적인 절감량). */
  freedChars: number;
  hashes: StudioOpfsContentHash[];
  message: string | null;
}

export interface StudioOpfsMigrationReport {
  sources: StudioOpfsMigrationSourceReport[];
  freedChars: number;
  movedCount: number;
  failed: boolean;
}

export interface StudioOpfsMigrationOptions {
  storage: StudioOpfsLocalStorageLike;
  store: StudioOpfsAssetStore;
  sources: readonly StudioOpfsMigrationSource[];
  now?: () => number;
}

/**
 * 소스별로 3단계(복사 → 참조 등록 → 커밋)를 돌린다. 각 단계는 그 자체로 멱등하고,
 * 어느 단계 사이에서 끊겨도 다음 실행이 같은 지점에서 이어붙인다.
 */
export async function migrateStudioAssetsToOpfs(
  options: StudioOpfsMigrationOptions
): Promise<StudioOpfsMigrationReport> {
  const { storage, store, sources } = options;
  const now = options.now ?? (() => Date.now());
  const journal = parseStudioOpfsMigrationJournal(readItem(storage, STUDIO_OPFS_MIGRATION_JOURNAL_KEY));
  const reports: StudioOpfsMigrationSourceReport[] = [];

  for (const source of sources) {
    reports.push(await migrateOne(source));
  }

  return {
    sources: reports,
    freedChars: reports.reduce((sum, report) => sum + report.freedChars, 0),
    movedCount: reports.reduce((sum, report) => sum + report.movedCount, 0),
    failed: reports.some((report) => report.status === "failed"),
  };

  async function migrateOne(
    source: StudioOpfsMigrationSource
  ): Promise<StudioOpfsMigrationSourceReport> {
    const base: StudioOpfsMigrationSourceReport = {
      source: source.id,
      status: "nothing-to-migrate",
      movedCount: 0,
      dedupedCount: 0,
      freedChars: 0,
      hashes: [],
      message: null,
    };

    const raw = readItem(storage, source.key);
    if (raw === null || raw.trim() === "") {
      return { ...base, status: "source-missing" };
    }

    let items: StudioOpfsMigrationItem[];
    try {
      items = source.extract(raw);
    } catch (error) {
      return { ...base, status: "failed", message: failureMessage(source.id, error) };
    }

    if (items.length === 0) {
      // 옮길 게 없다 = 이미 옮겼거나(참조만 남음) 애초에 인라인 자산이 없다.
      // 저널이 "copied"에서 끊겼더라도 여기서 done으로 닫아 다음 실행을 빠르게 만든다.
      const previous = journal[source.id];
      if (previous && previous.phase !== "done") {
        writeJournal({ ...previous, phase: "done", updatedAt: now() });
      }
      return {
        ...base,
        status: previous ? "already-migrated" : "nothing-to-migrate",
        hashes: previous?.hashes ?? [],
      };
    }

    // 1단계 — 복사. 내용주소라 같은 바이트를 몇 번 써도 파일은 하나이고 부작용이 없다.
    const refs = new Map<string, StudioOpfsAssetRef>();
    const hashes: StudioOpfsContentHash[] = [];
    let dedupedCount = 0;
    try {
      for (const item of items) {
        const result = await store.put(item.bytes, { mime: item.mime });
        refs.set(encodeStudioOpfsDataUrl(item.bytes, item.mime), result.ref);
        hashes.push(result.ref.hash);
        if (result.deduped) dedupedCount += 1;
      }
    } catch (error) {
      // 여기서 끊겨도 localStorage 원본은 손대지 않았다 — 불변식 (A).
      writeJournal({ source: source.id, phase: "copied", hashes, updatedAt: now() });
      return {
        ...base,
        status: "failed",
        movedCount: hashes.length,
        dedupedCount,
        hashes,
        message: failureMessage(source.id, error),
      };
    }
    writeJournal({ source: source.id, phase: "copied", hashes, updatedAt: now() });

    // 2단계 — 참조 등록. 커밋 전에 걸어 두어야 sweep이 신규 blob을 건드리지 않는다.
    try {
      await store.setOwnerRefs(source.id, hashes);
    } catch (error) {
      return {
        ...base,
        status: "failed",
        movedCount: hashes.length,
        dedupedCount,
        hashes,
        message: failureMessage(source.id, error),
      };
    }

    // 3단계 — 커밋. setItem은 키 단위 원자적이라 (A)와 (B) 사이에 중간 상태가 없다.
    let rewritten: string | null;
    try {
      rewritten = source.rewrite(raw, refs);
    } catch (error) {
      return {
        ...base,
        status: "failed",
        movedCount: hashes.length,
        dedupedCount,
        hashes,
        message: failureMessage(source.id, error),
      };
    }
    if (rewritten === null) {
      return { ...base, status: "nothing-to-migrate", hashes };
    }
    try {
      storage.setItem(source.key, rewritten);
    } catch (error) {
      // 커밋 실패 = 원본 유지. 자산은 이미 OPFS에 있으므로 다음 실행이 그대로 이어받는다.
      return {
        ...base,
        status: "failed",
        movedCount: hashes.length,
        dedupedCount,
        hashes,
        message: failureMessage(source.id, error),
      };
    }
    writeJournal({ source: source.id, phase: "done", hashes, updatedAt: now() });

    return {
      source: source.id,
      status: "migrated",
      movedCount: hashes.length,
      dedupedCount,
      freedChars: Math.max(0, raw.length - rewritten.length),
      hashes,
      message: null,
    };
  }

  function writeJournal(entry: StudioOpfsMigrationJournalEntry): void {
    journal[entry.source] = entry;
    try {
      storage.setItem(STUDIO_OPFS_MIGRATION_JOURNAL_KEY, JSON.stringify(journal));
    } catch {
      // 저널은 감사 기록일 뿐이라 실패해도 마이그레이션 정확성에 영향이 없다(§중단 안전성).
    }
  }
}

function readItem(storage: StudioOpfsLocalStorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function failureMessage(sourceId: string, error: unknown): string {
  if (error instanceof StudioOpfsError) return error.message;
  return `${sourceId} 보관함을 새 저장소로 옮기지 못했어요. 기존 데이터는 그대로 남아 있어요.`;
}

// ── 읽기 경로: 참조 → data URL 복원 ──────────────────────────────────────

/**
 * 참조가 섞인 JSON 문자열을 원래의 인라인 data URL 형태로 되돌린다. 소비 모듈
 * (parseCustomFonts 등)이 자기 형식 그대로 계속 동작하게 하는 최소 통합 지점이다.
 * 참조가 하나도 없으면 원문을 그대로 돌려준다(추가 비용 없음).
 */
export async function hydrateStudioOpfsRefs(
  raw: string,
  store: StudioOpfsAssetStore
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!parsed || typeof parsed !== "object") return raw;

  const targets: Array<{
    holder: Record<string, unknown> | unknown[];
    key: string | number;
    ref: StudioOpfsParsedRef;
  }> = [];
  walkJson(parsed, (holder, key, value) => {
    const ref = parseStudioOpfsRefValue(value);
    if (ref) targets.push({ holder, key, ref });
  });
  if (targets.length === 0) return raw;

  const cache = new Map<StudioOpfsContentHash, string | null>();
  for (const target of targets) {
    if (!cache.has(target.ref.hash)) {
      let dataUrl: string | null;
      try {
        const bytes = await store.get(target.ref.hash);
        dataUrl = bytes ? encodeStudioOpfsDataUrl(bytes, target.ref.mime) : null;
      } catch {
        // 손상·부재한 자산 하나가 나머지 목록을 못 쓰게 만들면 안 된다.
        dataUrl = null;
      }
      cache.set(target.ref.hash, dataUrl);
    }
    const resolved = cache.get(target.ref.hash) ?? null;
    if (resolved === null) continue;
    if (Array.isArray(target.holder)) target.holder[target.key as number] = resolved;
    else target.holder[target.key as string] = resolved;
  }
  return JSON.stringify(parsed);
}

/** 어떤 보관함 문자열이 참조하는 해시 전부. sweep 전에 소유자 참조를 다시 세울 때 쓴다. */
export function collectStudioOpfsRefs(raw: string): StudioOpfsContentHash[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const hashes = new Set<StudioOpfsContentHash>();
  walkJson(parsed, (_holder, _key, value) => {
    const ref = parseStudioOpfsRefValue(value);
    if (ref) hashes.add(ref.hash);
  });
  return [...hashes];
}
