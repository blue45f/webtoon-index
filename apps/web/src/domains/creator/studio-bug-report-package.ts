/**
 * §15.3 Help ▸ Bug Report Package — 사용자가 복사·저장해서 보낼 수 있는 묶음.
 *
 * 정책은 **화이트리스트**다. 리포트는 "무엇을 빼는가"가 아니라 "무엇만 넣는가"로
 * 정의된다. 아래 `StudioBugReportPackage` 의 필드가 전부이고, 문서 내용·레이어
 * 이름·대사·파일명·작품 id·사용자 id·URL 경로는 **표현할 자리가 없다**. 자유
 * 텍스트로 들어오는 두 곳(신뢰성 신호 문구, 오류 메시지)은 마스킹 문을 통과한다.
 *
 * `STUDIO_BUG_REPORT_INCLUDED` / `..._EXCLUDED` 는 UI 가 그대로 읽어 사용자에게
 * 보여 준다 — 무엇이 나가는지 모른 채 누르게 두지 않는다.
 */

import {
  formatStudioDiagnosticsText,
  type StudioDiagnosticsReport,
} from "./studio-device-diagnostics";
import {
  redactStudioDiagnosticText,
  redactStudioLocation,
} from "./studio-diagnostic-redaction";

import type { StudioErrorJournalEntry } from "./studio-error-journal";

export const STUDIO_BUG_REPORT_SCHEMA = "toonspectrum.studio.bug-report/v1" as const;

/** UI 가 그대로 보여 주는 "담기는 것". */
export const STUDIO_BUG_REPORT_INCLUDED: readonly string[] = Object.freeze([
  "브라우저 이름·버전·운영체제와 앱 빌드 번호",
  "WebGPU 지원 여부·어댑터 한계·능력 티어 같은 기기 진단 실측치",
  "저장소 사용량과 OPFS·SQLite 사용 가능 여부",
  "저장·GPU·저장소 신뢰성 신호와 안전 모드 상태",
  "이 세션에서 발생한 오류의 종류와 메시지(최대 20건, 마스킹 후)",
  "접속한 사이트 주소의 도메인",
]);

/** UI 가 그대로 보여 주는 "담기지 않는 것". */
export const STUDIO_BUG_REPORT_EXCLUDED: readonly string[] = Object.freeze([
  "그림·레이어·대사 등 원고 내용 일체",
  "레이어 이름·파일 이름·작품 제목",
  "계정 정보, 사용자 id, 작품 id, 공유 링크",
  "주소의 경로·질의 문자열(도메인만 남깁니다)",
  "이메일 주소, 접근 토큰, 파일 경로 — 오류 메시지에 섞여 있어도 가립니다",
  "쿠키·로컬 저장소 값",
]);

export interface StudioBugReportError {
  readonly at: string;
  readonly source: StudioErrorJournalEntry["source"];
  readonly name: string;
  readonly message: string;
}

export interface StudioBugReportPackage {
  readonly schema: typeof STUDIO_BUG_REPORT_SCHEMA;
  readonly createdAt: string;
  readonly appVersion: string;
  /** 도메인만. 경로·질의는 구조적으로 담기지 않는다. */
  readonly origin: string | null;
  readonly locale: string | null;
  readonly diagnostics: StudioDiagnosticsReport;
  readonly errors: readonly StudioBugReportError[];
  readonly included: readonly string[];
  readonly excluded: readonly string[];
}

export interface StudioBugReportInput {
  readonly diagnostics: StudioDiagnosticsReport;
  readonly errors: readonly StudioErrorJournalEntry[];
  readonly appVersion: string;
  readonly href?: string | null;
  readonly locale?: string | null;
  readonly createdAt?: number;
}

function redactReport(report: StudioDiagnosticsReport): StudioDiagnosticsReport {
  return {
    ...report,
    groups: report.groups.map((group) => ({
      ...group,
      fields: group.fields.map((entry) => ({
        ...entry,
        value: redactStudioDiagnosticText(entry.value),
        ...(entry.detail === undefined
          ? {}
          : { detail: redactStudioDiagnosticText(entry.detail) }),
      })),
    })),
  };
}

export function buildStudioBugReportPackage(
  input: StudioBugReportInput,
): StudioBugReportPackage {
  const createdAt = input.createdAt ?? Date.now();
  return {
    schema: STUDIO_BUG_REPORT_SCHEMA,
    createdAt: new Date(createdAt).toISOString(),
    appVersion: redactStudioDiagnosticText(input.appVersion),
    origin: redactStudioLocation(input.href),
    // 로케일 태그는 "ko-KR" 같은 고정 어휘라 자유 텍스트가 아니지만, 같은 문을
    // 통과시키는 편이 예외를 하나 만드는 것보다 안전하다.
    locale: input.locale ? redactStudioDiagnosticText(input.locale) : null,
    diagnostics: redactReport(input.diagnostics),
    errors: input.errors.map((entry) => ({
      at: new Date(entry.at).toISOString(),
      source: entry.source,
      name: redactStudioDiagnosticText(entry.name),
      message: redactStudioDiagnosticText(entry.message),
    })),
    included: STUDIO_BUG_REPORT_INCLUDED,
    excluded: STUDIO_BUG_REPORT_EXCLUDED,
  };
}

/** 이슈 트래커에 그대로 붙여 넣을 수 있는 마크다운. */
export function formatStudioBugReportMarkdown(
  packaged: StudioBugReportPackage,
): string {
  const lines: string[] = [
    "# ToonStudio 버그 리포트",
    "",
    `- 스키마: \`${packaged.schema}\``,
    `- 생성 시각: ${packaged.createdAt}`,
    `- 앱 빌드: ${packaged.appVersion}`,
    `- 도메인: ${packaged.origin ?? "확인 못 함"}`,
    `- 로케일: ${packaged.locale ?? "확인 못 함"}`,
    "",
    "## 기기 · 브라우저 진단",
    "",
    formatStudioDiagnosticsText(packaged.diagnostics),
    "",
    "## 이 세션의 오류",
    "",
  ];
  if (packaged.errors.length === 0) {
    lines.push("- 기록된 오류 없음");
  } else {
    for (const error of packaged.errors) {
      lines.push(`- ${error.at} · ${error.source} · ${error.name}: ${error.message}`);
    }
  }
  lines.push(
    "",
    "## 이 리포트에 담기지 않은 것",
    "",
    ...packaged.excluded.map((row) => `- ${row}`),
  );
  return lines.join("\n");
}

export function formatStudioBugReportJson(
  packaged: StudioBugReportPackage,
): string {
  return JSON.stringify(packaged, null, 2);
}
