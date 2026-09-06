/**
 * §15.3 Help 표면 계약 — "실제 값을 보여 준다"를 고정한다.
 *
 * 이 그룹이 감사에서 심각 미흡을 받은 이유는 기능이 없어서가 아니라 **알 수 없어서**
 * 였다. 그러니 여기서 지키는 것은 모양이 아니라 정직성이다: 측정하지 않은 값은
 * 측정했다고 표시되지 않고, 도움말 문서가 없으면 없다고 말하고, 사전과 라이선스
 * 표는 손으로 적은 목록이 아니라 실제 카탈로그·정책에서 나온다.
 */

import { describe, expect, it } from "vitest";

import {
  buildStudioToolHelp,
  resolveStudioActiveToolCommandId,
} from "./studio-current-tool-help";
import {
  buildStudioDiagnosticsReport,
  formatStudioDiagnosticsBytes,
  formatStudioDiagnosticsText,
} from "./studio-device-diagnostics";
import {
  clearStudioErrorJournal,
  installStudioErrorJournal,
  readStudioErrorJournal,
  recordStudioError,
  STUDIO_ERROR_JOURNAL_LIMIT,
} from "./studio-error-journal";
import {
  openStudioHelpCenter,
  requestStudioCommandSearch,
  STUDIO_HELP_CENTER_SECTIONS,
  subscribeStudioCommandSearchRequests,
  subscribeStudioHelpCenter,
} from "./studio-help-center-channel";
import {
  scanStudioRecoveryStorage,
  STUDIO_AUTOSAVE_KEY_PREFIX,
  studioRecoveryActions,
} from "./studio-recovery-guide";
import {
  filterStudioTerminologyRows,
  studioTerminologyRows,
  studioTerminologyVendorCounts,
} from "./studio-terminology-dictionary";
import {
  loadStudioGeneratedNotice,
  parseStudioGeneratedNoticeSummary,
  studioEngineLicenseTable,
  studioGeneratedNoticeUrl,
} from "./studio-third-party-notices";

import type { StudioDiagnosticsInput } from "./studio-device-diagnostics";
import type { StudioHelpCenterRequest } from "./studio-help-center-channel";
import type { StudioReliabilityStatusSnapshot } from "./studio-reliability-status-store";

const CLEAN_RELIABILITY: StudioReliabilityStatusSnapshot = {
  gpu: null,
  save: null,
  storage: null,
  safeMode: {
    active: false,
    reasons: [],
    enteredAt: null,
    quality: { gpuLanesDisabled: false, livingInkSuspended: false },
    manuallyDismissed: false,
  },
};

const NOTHING_MEASURED: StudioDiagnosticsInput = {
  collectedAt: 1_700_000_000_000,
  browser: null,
  capability: null,
  gpuFabric: null,
  adapter: null,
  sqlite: null,
  storage: null,
  reliability: CLEAN_RELIABILITY,
  renderBackend: null,
  appVersion: "test",
  secureContext: null,
};

/* ------------------------------------------------------------ 현재 도구 */

describe("현재 도구 도움말", () => {
  it("무장된 보조 도구가 기억된 기본 도구를 이긴다", () => {
    const base = { tool: "draw", drawMode: "pen" } as const;
    expect(resolveStudioActiveToolCommandId(base)).toBe("tool.pen");
    expect(
      resolveStudioActiveToolCommandId({ ...base, smudgeArmed: true }),
    ).toBe("tool.smudge");
    expect(
      resolveStudioActiveToolCommandId({
        ...base,
        smudgeArmed: true,
        liquifyArmed: true,
      }),
      "리퀴파이가 문지르기보다 늦게 무장되는 보조 소유자다",
    ).toBe("tool.liquify");
    expect(
      resolveStudioActiveToolCommandId({ ...base, quickMaskArmed: true }),
    ).toBe("select.quick-mask");
    expect(
      resolveStudioActiveToolCommandId({ tool: "hand", drawMode: "pen" }),
    ).toBe("tool.hand");
    expect(
      resolveStudioActiveToolCommandId({
        tool: "draw",
        drawMode: "pen",
        quickShapeActive: true,
      }),
    ).toBe("tool.smart-shape");
    expect(
      resolveStudioActiveToolCommandId({
        ...base,
        pixelSelectionTool: "ellipse",
      }),
    ).toBe("tool.marquee-ellipse");
  });

  it("카탈로그에 대응 명령이 없는 도구는 지어내지 않고 null 을 낸다", () => {
    expect(
      resolveStudioActiveToolCommandId({
        tool: "draw",
        drawMode: "pen",
        pixelSelectionTool: "brush",
      }),
    ).toBeNull();
  });

  it("산문 도움말이 없다는 사실을 감추지 않는다", () => {
    const help = buildStudioToolHelp("tool.pen");
    expect(help).not.toBeNull();
    expect(help?.authoredHelp, "HelpGraph 가 출하되기 전에는 언제나 false").toBe(false);
    expect(help?.helpNodeId).toMatch(/^help\//u);
  });

  it("카탈로그에 실재하는 값만 싣는다 — 라벨·단축키·타사 별칭", () => {
    const help = buildStudioToolHelp("tool.fill");
    expect(help?.label).toBe("채우기");
    expect(help?.shortcut).toBe("G");
    expect(
      help?.aliases.some((alias) => alias.term === "Paint Bucket"),
      "감사 8개 질의 중 하나가 이 표기로 들어온다",
    ).toBe(true);
    expect(help?.related.length).toBeGreaterThan(0);
    expect(help?.related.every((item) => item.id !== "tool.fill")).toBe(true);
  });

  it("모르는 명령 id 에는 빈 껍데기를 만들지 않는다", () => {
    expect(buildStudioToolHelp("tool.does-not-exist")).toBeNull();
  });
});

/* ---------------------------------------------------------------- 진단 */

describe("기기 · 브라우저 진단", () => {
  it("프로브를 돌리지 않았으면 단 하나도 실측으로 표시하지 않는다", () => {
    const report = buildStudioDiagnosticsReport(NOTHING_MEASURED);
    const measured = report.groups
      .flatMap((group) => group.fields)
      .filter((entry) => entry.measured)
      .map((entry) => entry.id);
    // 앱 모드·신뢰성 채널은 프로브 없이도 실측이다. 기기 능력은 하나도 아니다.
    expect(measured).not.toContain("gpu.webgpu");
    expect(measured).not.toContain("gpu.max-texture");
    expect(measured).not.toContain("storage.usage");
    expect(measured).not.toContain("gpu.render-backend");
    expect(report.unmeasuredCount).toBeGreaterThan(0);
  });

  it("미측정 항목은 값 대신 이유를 적는다", () => {
    const report = buildStudioDiagnosticsReport(NOTHING_MEASURED);
    const backend = report.groups
      .flatMap((group) => group.fields)
      .find((entry) => entry.id === "gpu.render-backend");
    expect(backend?.measured).toBe(false);
    expect(backend?.value).toContain("보고가 없었습니다");
    expect(formatStudioDiagnosticsText(report)).toContain("(미측정)");
  });

  it("실측한 백엔드는 그대로 싣는다", () => {
    const report = buildStudioDiagnosticsReport({
      ...NOTHING_MEASURED,
      renderBackend: "webgpu",
    });
    const backend = report.groups
      .flatMap((group) => group.fields)
      .find((entry) => entry.id === "gpu.render-backend");
    expect(backend).toEqual({
      id: "gpu.render-backend",
      label: "현재 래스터 백엔드",
      value: "webgpu",
      measured: true,
    });
  });

  it("바이트 표기는 알 수 없는 값을 0으로 만들지 않는다", () => {
    expect(formatStudioDiagnosticsBytes(null)).toBeNull();
    expect(formatStudioDiagnosticsBytes(Number.NaN)).toBeNull();
    expect(formatStudioDiagnosticsBytes(512)).toBe("512 B");
    expect(formatStudioDiagnosticsBytes(1024 * 1024 * 3)).toBe("3.0 MB");
  });
});

/* ---------------------------------------------------------------- 복구 */

function fakeStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => entries[key] ?? null,
  };
}

describe("복구 가이드", () => {
  const autosaveKey = `${STUDIO_AUTOSAVE_KEY_PREFIX}:guest:work%3Aabc`;
  const payload = JSON.stringify({
    version: 2,
    savedAt: "2026-08-08T01:02:03.000Z",
    pagesList: [{ id: "p1", elements: [{ type: "draw" }] }],
  });

  it("브라우저에 실제로 남아 있는 임시저장을 센다", () => {
    const scan = scanStudioRecoveryStorage(
      fakeStorage({ [autosaveKey]: payload, unrelated: "x" }),
    );
    expect(scan.storageUnavailable).toBe(false);
    expect(scan.autosaves).toHaveLength(1);
    expect(scan.autosaves[0]?.savedAt).toBe("2026-08-08T01:02:03.000Z");
    expect(scan.autosaves[0]?.pageCount).toBe(1);
    expect(scan.checkpointKeys[0]).toContain("toonspectrum-studio-checkpoints:v12");
  });

  it("저장소를 못 읽는 것과 0건을 구분한다", () => {
    expect(scanStudioRecoveryStorage(null).storageUnavailable).toBe(true);
    expect(scanStudioRecoveryStorage(fakeStorage({})).storageUnavailable).toBe(false);
  });

  it("조치는 지금 도달 가능한 것만 낸다", () => {
    const scan = scanStudioRecoveryStorage(fakeStorage({ [autosaveKey]: payload }));
    const actions = studioRecoveryActions({
      scan,
      reliability: CLEAN_RELIABILITY,
      checkpointCount: 0,
    });
    const ids = actions.map((action) => action.id);
    expect(ids).toContain("restore-autosave");
    expect(ids).toContain("export-now");
    // 체크포인트가 0건이면 체크포인트 조치를 만들지 않는다.
    expect(ids).not.toContain("open-checkpoints");
    // 저장소 압박 신호가 없으면 회수 버튼도 없다.
    expect(ids).not.toContain("reclaim-storage");
  });

  it("저장소 압박이면 회수와 내보내기를 긴급으로 올린다", () => {
    const actions = studioRecoveryActions({
      scan: scanStudioRecoveryStorage(fakeStorage({})),
      reliability: {
        ...CLEAN_RELIABILITY,
        storage: {
          channel: "storage",
          level: "failed",
          title: "저장 공간이 부족합니다",
          at: 1,
        },
      },
      checkpointCount: 0,
    });
    expect(actions.find((action) => action.id === "reclaim-storage")?.urgent).toBe(true);
    expect(actions.find((action) => action.id === "export-now")?.urgent).toBe(true);
  });
});

/* ------------------------------------------------------------- 용어 사전 */

describe("CSP · Photoshop 용어 사전", () => {
  it("카탈로그 별칭에서 파생된다 — 손으로 적은 목록이 아니다", () => {
    const rows = studioTerminologyRows();
    expect(rows.length).toBeGreaterThan(400);
    const counts = studioTerminologyVendorCounts();
    expect(counts.csp).toBeGreaterThan(0);
    expect(counts.photoshop).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.ourLabel.length).toBeGreaterThan(0);
      expect(row.location.length).toBeGreaterThan(0);
    }
  });

  it("감사가 센 8개 질의의 대표 표기를 사전에서 찾을 수 있다", () => {
    for (const term of ["Paint Bucket", "스포이트", "Inherit Alpha", "QuickShape"]) {
      expect(filterStudioTerminologyRows(term).length, term).toBeGreaterThan(0);
    }
  });

  it("벤더로 좁힐 수 있다", () => {
    const only = filterStudioTerminologyRows("", "photoshop");
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((row) => row.vendor === "photoshop")).toBe(true);
  });
});

/* ------------------------------------------------------------- 라이선스 */

describe("라이선스 · 서드파티 고지", () => {
  it("생성 고지 경로는 postbuild 산출물 경로와 같다", () => {
    expect(studioGeneratedNoticeUrl("/")).toBe(
      "/legal/THIRD_PARTY_NOTICES.generated.md",
    );
    expect(studioGeneratedNoticeUrl("/base")).toBe(
      "/base/legal/THIRD_PARTY_NOTICES.generated.md",
    );
  });

  it("고지가 없는 빌드에서는 없다고 말한다 — 요약을 지어내지 않는다", async () => {
    const result = await loadStudioGeneratedNotice({
      fetchImpl: (async () =>
        new Response("nope", { status: 404 })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("absent");
    if (result.status === "absent") {
      expect(result.reason).toContain("postbuild");
    }
  });

  it("고지 머리말의 실제 수치를 파싱한다", async () => {
    const text = [
      "# ToonSpectrum generated third-party notices",
      "",
      "- Application: `toonspectrum@0.1.0`",
      "- Production inventory entries: 580",
      "- Distinct collected license texts: 328",
      "",
      "## Resolved production inventory",
      "- 이 줄은 요약이 아니다",
    ].join("\n");
    expect(parseStudioGeneratedNoticeSummary(text)).toEqual([
      { label: "Application", value: "toonspectrum@0.1.0" },
      { label: "Production inventory entries", value: "580" },
      { label: "Distinct collected license texts", value: "328" },
    ]);

    const loaded = await loadStudioGeneratedNotice({
      fetchImpl: (async () => new Response(text, { status: 200 })) as unknown as typeof fetch,
    });
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded") {
      expect(loaded.summary).toHaveLength(3);
      expect(loaded.text).toBe(text);
    }
  });

  it("엔진 게이트 판정은 실제 정책이 내린 것이다", () => {
    const table = studioEngineLicenseTable();
    expect(table.rows).toHaveLength(28);
    for (const row of table.rows) {
      expect(["bundle", "isolated", "rejected"]).toContain(row.gate);
      if (row.gate === "rejected") expect(row.reason).not.toBeNull();
    }
    // LGPL 계열은 번들이 아니라 격리여야 한다 — 표가 아니라 정책이 정한다.
    const lgpl = table.rows.filter((row) => row.license.includes("LGPL"));
    expect(lgpl.length).toBeGreaterThan(0);
    expect(lgpl.every((row) => row.gate !== "bundle")).toBe(true);
  });
});

/* ---------------------------------------------------------------- 채널 */

describe("도움말 진입 채널", () => {
  it("구독자가 없으면 삼키지 않고 false 를 낸다", () => {
    expect(openStudioHelpCenter({ section: "diagnostics" })).toBe(false);
    expect(requestStudioCommandSearch()).toBe(false);
  });

  it("요청을 그대로 전달하고 해제할 수 있다", () => {
    const seen: StudioHelpCenterRequest[] = [];
    const unsubscribe = subscribeStudioHelpCenter((request) => seen.push(request));
    expect(
      openStudioHelpCenter({ section: "current-tool", toolCommandId: "tool.pen" }),
    ).toBe(true);
    unsubscribe();
    openStudioHelpCenter({ section: "recovery" });
    expect(seen).toEqual([{ section: "current-tool", toolCommandId: "tool.pen" }]);
  });

  it("Command Search 요청도 같은 방식으로 흐른다", () => {
    let opened = 0;
    const unsubscribe = subscribeStudioCommandSearchRequests(() => {
      opened += 1;
    });
    expect(requestStudioCommandSearch()).toBe(true);
    unsubscribe();
    requestStudioCommandSearch();
    expect(opened).toBe(1);
  });

  it("구역 목록은 도움말 센터가 실제로 그리는 여섯 개다", () => {
    expect([...STUDIO_HELP_CENTER_SECTIONS]).toEqual([
      "current-tool",
      "terminology",
      "diagnostics",
      "recovery",
      "license",
      "bug-report",
    ]);
  });
});

/* ------------------------------------------------------------ 오류 저널 */

describe("세션 오류 저널", () => {
  it("기록 시점에 이미 마스킹된 채로 들어간다", () => {
    clearStudioErrorJournal();
    recordStudioError(
      new Error("cannot open /Users/hjunkim/원고.psd for artist@example.com"),
      "window-error",
      1_700_000_000_000,
    );
    const [entry] = readStudioErrorJournal();
    expect(entry?.name).toBe("Error");
    expect(entry?.message).not.toContain("원고.psd");
    expect(entry?.message).not.toContain("artist@example.com");
    clearStudioErrorJournal();
  });

  it("링 버퍼 상한을 넘지 않는다", () => {
    clearStudioErrorJournal();
    for (let index = 0; index < STUDIO_ERROR_JOURNAL_LIMIT + 12; index += 1) {
      recordStudioError(`오류 ${index}`, "reported", index);
    }
    const entries = readStudioErrorJournal();
    expect(entries).toHaveLength(STUDIO_ERROR_JOURNAL_LIMIT);
    expect(entries.at(-1)?.message).toBe(
      `오류 ${STUDIO_ERROR_JOURNAL_LIMIT + 11}`,
    );
    clearStudioErrorJournal();
  });

  it("전역 리스너는 한 번만 설치되고 해제된다", () => {
    const handlers = new Map<string, (event: Event) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: Event) => void) => {
        handlers.set(type, listener);
      },
      removeEventListener: (type: string) => {
        handlers.delete(type);
      },
    };
    const detach = installStudioErrorJournal(target);
    // window "error" · "unhandledrejection" 에 더해, React 에러 바운더리가 잡아 삼킨 예외를
    // 받는 toonspectrum:render-failure 까지 세 채널이다. 바운더리가 잡은 예외는 window "error"
    // 로 오지 않으므로 이 채널이 없으면 무너진 패널이 저널에도 버그 리포트에도 남지 않는다.
    expect(handlers.size).toBe(3);
    expect(installStudioErrorJournal(target), "두 번째 설치는 기존 해제자를 준다").toBe(
      detach,
    );
    expect(handlers.size).toBe(3);
    detach();
    expect(handlers.size).toBe(0);
  });
});
