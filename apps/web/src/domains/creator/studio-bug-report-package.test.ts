/**
 * 버그 리포트 개인정보 계약.
 *
 * 이 파일이 지키는 약속은 하나다 — **리포트는 사용자의 원고나 신원을 밖으로
 * 내보내지 않는다.** 화이트리스트 구조(필드가 고정)와 마스킹 문(자유 텍스트가
 * 통과)을 둘 다 고정한다. 새 필드를 추가하려면 여기 목록도 같이 바꿔야 하므로,
 * 개인정보가 조용히 늘어날 수 없다.
 */

import { describe, expect, it } from "vitest";

import {
  buildStudioBugReportPackage,
  formatStudioBugReportJson,
  formatStudioBugReportMarkdown,
  STUDIO_BUG_REPORT_EXCLUDED,
  STUDIO_BUG_REPORT_INCLUDED,
  STUDIO_BUG_REPORT_SCHEMA,
} from "./studio-bug-report-package";
import { buildStudioDiagnosticsReport } from "./studio-device-diagnostics";
import {
  redactStudioDiagnosticText,
  redactStudioLocation,
} from "./studio-diagnostic-redaction";

import type { StudioDiagnosticsInput } from "./studio-device-diagnostics";
import type { StudioErrorJournalEntry } from "./studio-error-journal";
import type { StudioReliabilityStatusSnapshot } from "./studio-reliability-status-store";

/** 개인정보가 섞인 최악의 입력. 하나라도 산출물에 남으면 계약 위반이다. */
const LEAKY = {
  email: "artist@example.com",
  workId: "work-9f3a7c21",
  layerName: "주인공 얼굴 클로즈업",
  filePath: "/Users/hjunkim/Desktop/원고-3화.psd",
  token: "sk_live_51ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg",
  href: "https://toonspectrum.app/studio/work-9f3a7c21?share=secret-token&user=artist",
} as const;

function reliability(detail: string): StudioReliabilityStatusSnapshot {
  return {
    gpu: null,
    save: {
      channel: "save",
      level: "failed",
      title: "임시저장에 실패했습니다",
      detail,
      at: 1_700_000_000_000,
    },
    storage: null,
    safeMode: {
      active: false,
      reasons: [],
      enteredAt: null,
      quality: { gpuLanesDisabled: false, livingInkSuspended: false },
      manuallyDismissed: false,
    },
  };
}

function diagnosticsInput(detail: string): StudioDiagnosticsInput {
  return {
    collectedAt: 1_700_000_000_000,
    browser: {
      name: "Chrome",
      version: "141",
      os: "macOS",
      isSupported: true,
      isLegacy: false,
      missingFeatures: [],
    },
    capability: null,
    gpuFabric: null,
    adapter: null,
    sqlite: null,
    storage: null,
    reliability: reliability(detail),
    renderBackend: "webgpu",
    appVersion: "production",
    secureContext: true,
  };
}

const ERRORS: readonly StudioErrorJournalEntry[] = [
  {
    at: 1_700_000_000_500,
    source: "window-error",
    name: "TypeError",
    message: `Failed to load ${LEAKY.filePath} for ${LEAKY.email}`,
  },
];

describe("버그 리포트 마스킹 문", () => {
  it("이메일·URL·파일 경로·데이터 URI·긴 토큰을 지운다", () => {
    for (const secret of [
      LEAKY.email,
      LEAKY.filePath,
      LEAKY.token,
      LEAKY.dataUri,
      "https://toonspectrum.app/studio/work-1",
    ]) {
      const redacted = redactStudioDiagnosticText(`앞 ${secret} 뒤`);
      expect(redacted, secret).not.toContain(secret);
      expect(redacted).toContain("[가림]");
    }
  });

  it("평범한 한국어 오류 문구는 그대로 둔다", () => {
    expect(redactStudioDiagnosticText("저장 공간이 부족합니다")).toBe(
      "저장 공간이 부족합니다",
    );
  });

  it("주소는 도메인만 남긴다", () => {
    expect(redactStudioLocation(LEAKY.href)).toBe("https://toonspectrum.app");
    expect(redactStudioLocation("not a url")).toBeNull();
    expect(redactStudioLocation(null)).toBeNull();
  });

  it("아주 긴 문자열은 잘라 낸다", () => {
    const long = "가".repeat(1000);
    expect(redactStudioDiagnosticText(long).length).toBeLessThanOrEqual(241);
  });
});

describe("버그 리포트 패키지 — 개인정보 계약", () => {
  const packaged = buildStudioBugReportPackage({
    diagnostics: buildStudioDiagnosticsReport(
      diagnosticsInput(`${LEAKY.filePath} 를 열 수 없습니다 (${LEAKY.email})`),
    ),
    errors: ERRORS,
    appVersion: "production",
    href: LEAKY.href,
    locale: "ko-KR",
  });

  it("최상위 필드는 선언된 화이트리스트가 전부다", () => {
    expect(Object.keys(packaged).sort()).toEqual(
      [
        "appVersion",
        "createdAt",
        "diagnostics",
        "errors",
        "excluded",
        "included",
        "locale",
        "origin",
        "schema",
      ].sort(),
    );
    expect(packaged.schema).toBe(STUDIO_BUG_REPORT_SCHEMA);
  });

  it("직렬화 산출물 어디에도 개인정보 조각이 남지 않는다", () => {
    const surfaces = [
      formatStudioBugReportMarkdown(packaged),
      formatStudioBugReportJson(packaged),
    ];
    for (const surface of surfaces) {
      for (const secret of [
        LEAKY.email,
        LEAKY.filePath,
        LEAKY.token,
        LEAKY.dataUri,
        LEAKY.workId,
      ]) {
        expect(surface, secret).not.toContain(secret);
      }
      // 원고에서 온 자유 텍스트는 애초에 담을 자리가 없다.
      expect(surface).not.toContain(LEAKY.layerName);
      // 주소는 경로·질의 없이 도메인만.
      expect(surface).not.toContain("share=secret-token");
      expect(surface).toContain("https://toonspectrum.app");
    }
  });

  it("담기는 것 · 담기지 않는 것 목록을 스스로 들고 다닌다", () => {
    expect(packaged.included).toEqual(STUDIO_BUG_REPORT_INCLUDED);
    expect(packaged.excluded).toEqual(STUDIO_BUG_REPORT_EXCLUDED);
    expect(STUDIO_BUG_REPORT_INCLUDED.length).toBeGreaterThan(0);
    expect(STUDIO_BUG_REPORT_EXCLUDED.length).toBeGreaterThan(0);
    expect(formatStudioBugReportMarkdown(packaged)).toContain(
      "이 리포트에 담기지 않은 것",
    );
  });

  it("실측한 진단은 그대로 싣는다 — 마스킹이 값을 통째로 지우지 않는다", () => {
    const markdown = formatStudioBugReportMarkdown(packaged);
    expect(markdown).toContain("Chrome 141");
    expect(markdown).toContain("webgpu");
    expect(packaged.diagnostics.measuredCount).toBeGreaterThan(0);
  });

  it("오류가 없으면 없다고 적는다", () => {
    const empty = buildStudioBugReportPackage({
      diagnostics: buildStudioDiagnosticsReport(diagnosticsInput("정상")),
      errors: [],
      appVersion: "production",
      href: null,
      locale: null,
      createdAt: 1_700_000_000_000,
    });
    expect(empty.origin).toBeNull();
    expect(formatStudioBugReportMarkdown(empty)).toContain("기록된 오류 없음");
  });
});
