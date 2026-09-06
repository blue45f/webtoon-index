/**
 * §15.3 Help ▸ License/Attribution — 앱 안에서 실제 고지를 본다.
 *
 * 두 갈래로 답한다.
 *
 * 1. **생성 고지**(`scripts/generate-third-party-notices.mjs` 산출물). 빌드의
 *    `postbuild` 가 `dist/legal/THIRD_PARTY_NOTICES.generated.md` 로 내보낸다.
 *    런타임에 그 경로를 그대로 가져온다. 개발 서버나 `postbuild` 를 건너뛴 빌드에는
 *    **없다** — 그때는 없다고 말한다. 요약을 지어내지 않는다.
 * 2. **엔진 라이선스 게이트**. E01–E28 후보 매니페스트는 앱에 같이 묶여 있으므로
 *    언제나 실측이다. 각 항목의 SPDX 표기를 실제 `evaluateLicenseGate()` 에 넣어
 *    번들 가능/격리 필요/거부 판정을 그 자리에서 계산한다 — 표를 손으로 적지 않는다.
 */

import {
  DEFAULT_LICENSE_POLICY,
  evaluateLicenseGate,
  loadCandidateManifest,
} from "@toonspectrum/studio-engine-registry";

/** `package.json` 의 `postbuild` 가 쓰는 경로와 같아야 한다. */
export const STUDIO_GENERATED_NOTICE_PATH = "legal/THIRD_PARTY_NOTICES.generated.md";

/** 생성 고지는 수백 KB 다. 통째로 메모리에 올리되 폭주는 막는다. */
export const STUDIO_NOTICE_MAX_CHARACTERS = 4_000_000;

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function studioGeneratedNoticeUrl(baseUrl = "/"): string {
  return `${normalizedBaseUrl(baseUrl)}${STUDIO_GENERATED_NOTICE_PATH}`;
}

export interface StudioNoticeSummaryRow {
  readonly label: string;
  readonly value: string;
}

export type StudioGeneratedNoticeResult =
  | {
      readonly status: "loaded";
      readonly url: string;
      readonly text: string;
      readonly summary: readonly StudioNoticeSummaryRow[];
    }
  | {
      readonly status: "absent";
      readonly url: string;
      /** 왜 없는지. 개발 서버에서는 postbuild 가 돌지 않는다는 사실이 답이다. */
      readonly reason: string;
    };

/**
 * 생성 고지 머리말의 `- 라벨: 값` 줄을 그대로 읽는다. 스크립트가 그 형식으로
 * 쓰기 때문에 파싱이지 추정이 아니다.
 */
export function parseStudioGeneratedNoticeSummary(
  text: string,
): readonly StudioNoticeSummaryRow[] {
  const rows: StudioNoticeSummaryRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("- ")) {
      if (line.startsWith("## ")) break;
      continue;
    }
    const separator = line.indexOf(": ");
    if (separator < 0) continue;
    const label = line.slice(2, separator).trim();
    const value = line
      .slice(separator + 2)
      .trim()
      .replace(/^`|`$/gu, "");
    if (label.length === 0 || value.length === 0) continue;
    rows.push({ label, value });
  }
  return rows;
}

export interface StudioNoticeLoadOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
}

export async function loadStudioGeneratedNotice(
  options: StudioNoticeLoadOptions = {},
): Promise<StudioGeneratedNoticeResult> {
  const url = studioGeneratedNoticeUrl(options.baseUrl ?? "/");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { status: "absent", url, reason: "이 환경에는 fetch 가 없습니다." };
  }
  try {
    const response = await fetchImpl(url, {
      cache: "force-cache",
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      return {
        status: "absent",
        url,
        reason: `${response.status} — 이 빌드에는 생성 고지가 포함되지 않았습니다. \`pnpm build\` 의 postbuild 단계가 만듭니다.`,
      };
    }
    const text = await response.text();
    if (text.length === 0 || text.length > STUDIO_NOTICE_MAX_CHARACTERS) {
      return {
        status: "absent",
        url,
        reason: "생성 고지 파일을 읽었지만 내용이 비었거나 너무 큽니다.",
      };
    }
    return {
      status: "loaded",
      url,
      text,
      summary: parseStudioGeneratedNoticeSummary(text),
    };
  } catch {
    return {
      status: "absent",
      url,
      reason:
        "생성 고지를 불러오지 못했습니다. 개발 서버에는 빌드 산출물이 없어 정상입니다.",
    };
  }
}

/* --------------------------------------------------- engine license gate */

export type StudioEngineLicenseGate = "bundle" | "isolated" | "rejected";

export interface StudioEngineLicenseRow {
  readonly id: string;
  readonly name: string;
  readonly area: string;
  readonly license: string;
  readonly gate: StudioEngineLicenseGate;
  readonly reason: string | null;
  readonly url: string;
}

export interface StudioEngineLicenseTable {
  readonly generatedFrom: string;
  readonly rows: readonly StudioEngineLicenseRow[];
  readonly bundleAllowed: readonly string[];
  readonly isolatedAllowed: readonly string[];
}

let cachedTable: StudioEngineLicenseTable | null = null;

/**
 * 매니페스트의 라이선스 표기를 실제 게이트에 통과시킨 결과. 표시용 문자열이 아니라
 * 런타임 정책이 내리는 그 판정이다.
 */
export function studioEngineLicenseTable(): StudioEngineLicenseTable {
  if (cachedTable) return cachedTable;
  const manifest = loadCandidateManifest();
  const rows = manifest.entries.map((entry): StudioEngineLicenseRow => {
    const verdict = evaluateLicenseGate(entry.license);
    return {
      id: entry.id,
      name: entry.name,
      area: entry.area,
      license: entry.license,
      gate: verdict.mode,
      reason: verdict.mode === "rejected" ? verdict.reason : null,
      url: entry.url,
    };
  });
  cachedTable = {
    generatedFrom: manifest.generatedFrom,
    rows,
    bundleAllowed: DEFAULT_LICENSE_POLICY.bundleAllowed,
    isolatedAllowed: DEFAULT_LICENSE_POLICY.isolatedAllowed,
  };
  return cachedTable;
}
