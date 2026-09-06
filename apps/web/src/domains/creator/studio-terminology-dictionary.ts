/**
 * §15.3 Help ▸ CSP/Photoshop terminology search — 용어 사전 표면.
 *
 * Wave D 의 통합 검색은 "그 이름으로 검색하면 우리 기능이 나온다"를 만들었다.
 * 이 모듈은 그 반대 방향, **훑어보기**를 만든다 — CSP 에서 쓰던 이름들이 우리
 * 쪽에서 무엇이 됐는지 목록으로 보는 것. 이사 온 첫날에는 무엇을 검색해야 할지도
 * 모르기 때문에 검색만으로는 부족하다.
 *
 * 사전은 카탈로그 별칭에서 **파생**된다. 여기에 손으로 적는 항목은 없다.
 */

import { studioSearchIndex } from "./studio-command-search";

import type { TerminologyVendor } from "@toonspectrum/studio-command-registry";

export interface StudioTerminologyRow {
  readonly vendor: TerminologyVendor;
  readonly term: string;
  /** 별칭이 그 벤더의 어떤 UI 언어에서 온 표기인지. 카탈로그가 밝히지 않으면 null. */
  readonly locale: string | null;
  readonly ourLabel: string;
  readonly ourId: string;
  readonly location: string;
  readonly shortcut?: string;
  readonly note?: string;
}

export const STUDIO_TERMINOLOGY_VENDOR_LABELS: Readonly<
  Record<string, string>
> = Object.freeze({
  csp: "CLIP STUDIO PAINT",
  photoshop: "Photoshop",
  krita: "Krita",
  procreate: "Procreate",
  toonstudio: "이전 우리 이름",
});

let cachedRows: readonly StudioTerminologyRow[] | null = null;

export function studioTerminologyRows(): readonly StudioTerminologyRow[] {
  if (cachedRows) return cachedRows;
  const rows: StudioTerminologyRow[] = [];
  for (const entry of studioSearchIndex().entries) {
    for (const alias of entry.aliases) {
      rows.push({
        vendor: alias.vendor,
        term: alias.term,
        locale: alias.locale ?? null,
        ourLabel: entry.label,
        ourId: entry.id,
        location: entry.location,
        ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
        ...(alias.note === undefined ? {} : { note: alias.note }),
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.vendor.localeCompare(b.vendor) ||
      a.term.localeCompare(b.term, "ko") ||
      a.ourLabel.localeCompare(b.ourLabel, "ko"),
  );
  cachedRows = rows;
  return rows;
}

export function studioTerminologyVendorCounts(): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const row of studioTerminologyRows()) {
    counts[row.vendor] = (counts[row.vendor] ?? 0) + 1;
  }
  return counts;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ko").replace(/\s+/gu, "");
}

/** 벤더 필터 + 부분 문자열. 사전은 훑어보는 표라 검색 랭킹을 쓰지 않는다. */
export function filterStudioTerminologyRows(
  query: string,
  vendor: TerminologyVendor | "all" = "all",
  rows: readonly StudioTerminologyRow[] = studioTerminologyRows(),
): readonly StudioTerminologyRow[] {
  const needle = normalize(query);
  return rows.filter((row) => {
    if (vendor !== "all" && row.vendor !== vendor) return false;
    if (needle.length === 0) return true;
    return (
      normalize(row.term).includes(needle) ||
      normalize(row.ourLabel).includes(needle) ||
      normalize(row.ourId).includes(needle)
    );
  });
}
