/**
 * 도움말 센터 — §15.3 Help 의 다섯 표면을 한 창에 담는다.
 *
 * 이 창의 유일한 규율: **화면의 모든 숫자는 방금 잰 값이다.** 프로브를 돌리지
 * 않았거나 브라우저가 값을 숨겼으면 "확인 못 함"이라고 쓴다. 비싼 프로브
 * (4MB 대 WebGPU 어댑터 모듈)는 사용자가 누르기 전에는 돌지 않는다.
 */

import {
  Bug,
  Command,
  Copy,
  Download,
  HelpCircle,
  LifeBuoy,
  RefreshCw,
  Scale,
  Stethoscope,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { checkBrowserCompatibility, getBrowserInfo } from "../../compat/browser-check";

import { getStudioGpuFabricCapabilities } from "./render/studio-gpu-fabric";
import {
  buildStudioBugReportPackage,
  formatStudioBugReportJson,
  formatStudioBugReportMarkdown,
  STUDIO_BUG_REPORT_EXCLUDED,
  STUDIO_BUG_REPORT_INCLUDED,
} from "./studio-bug-report-package";
import { classifyStudioCapabilityTier } from "./studio-capability-tier";
import { buildStudioToolHelp } from "./studio-current-tool-help";
import {
  buildStudioDiagnosticsReport,
  formatStudioDiagnosticsText,
} from "./studio-device-diagnostics";
import { readStudioErrorJournal } from "./studio-error-journal";
import { STUDIO_HELP_CENTER_SECTIONS } from "./studio-help-center-channel";
import { studioRecoveryActions, scanStudioRecoveryStorage } from "./studio-recovery-guide";
import { getStudioRenderBackend } from "./studio-render-backend-beacon";
import { reclaimStudioStorage } from "./studio-storage-recovery-runtime";
import {
  filterStudioTerminologyRows,
  STUDIO_TERMINOLOGY_VENDOR_LABELS,
  studioTerminologyRows,
  studioTerminologyVendorCounts,
} from "./studio-terminology-dictionary";
import {
  loadStudioGeneratedNotice,
  studioEngineLicenseTable,
} from "./studio-third-party-notices";
import { copyStudioText } from "./studio-workbench-clipboard";
import { STUDIO_Z_CLASS } from "./studio-z-index";
import { useStudioReliabilityStatus } from "./use-studio-reliability-status";

import type { StudioBugReportPackage } from "./studio-bug-report-package";
import type {
  StudioDiagnosticsAdapterInput,
  StudioDiagnosticsInput,
  StudioDiagnosticsReport,
} from "./studio-device-diagnostics";
import type { StudioHelpCenterSection } from "./studio-help-center-channel";
import type { StudioRecoveryScan } from "./studio-recovery-guide";
import type { StudioGeneratedNoticeResult } from "./studio-third-party-notices";

export interface StudioHelpCenterDialogProps {
  readonly open: boolean;
  readonly section: StudioHelpCenterSection;
  readonly toolCommandId: string | null;
  readonly onSectionChange: (section: StudioHelpCenterSection) => void;
  readonly onClose: () => void;
}

const SECTION_META: Readonly<
  Record<StudioHelpCenterSection, { label: string; icon: typeof HelpCircle }>
> = {
  "current-tool": { label: "현재 도구", icon: HelpCircle },
  terminology: { label: "용어 사전", icon: Command },
  diagnostics: { label: "기기 진단", icon: Stethoscope },
  recovery: { label: "복구 가이드", icon: LifeBuoy },
  license: { label: "라이선스 고지", icon: Scale },
  "bug-report": { label: "버그 리포트", icon: Bug },
};

const PANEL_TITLE: Readonly<Record<StudioHelpCenterSection, string>> = {
  "current-tool": "현재 도구 도움말",
  terminology: "CSP · Photoshop 용어 사전",
  diagnostics: "기기 · 브라우저 진단",
  recovery: "복구 가이드",
  license: "라이선스 · 서드파티 고지",
  "bug-report": "버그 리포트 패키지",
};

function Callout({ tone, children }: { tone: "info" | "warn"; children: ReactNode }) {
  return (
    <p
      className={
        tone === "warn"
          ? "rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-fg"
          : "rounded-lg border border-line bg-card px-3 py-2 text-xs leading-relaxed text-fg-3"
      }
    >
      {children}
    </p>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1.5 mt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-fg-3 first:mt-0">
      {children}
    </h3>
  );
}

/* --------------------------------------------------------- diagnostics */

interface DiagnosticsState {
  readonly report: StudioDiagnosticsReport | null;
  readonly running: boolean;
}

function useStudioDiagnostics(active: boolean) {
  const reliability = useStudioReliabilityStatus();
  const [adapter, setAdapter] = useState<StudioDiagnosticsAdapterInput | null>(null);
  const [adapterBusy, setAdapterBusy] = useState(false);
  const [state, setState] = useState<DiagnosticsState>({ report: null, running: false });
  const [nonce, setNonce] = useState(0);
  const reliabilityRef = useRef(reliability);
  reliabilityRef.current = reliability;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState((current) => ({ ...current, running: true }));
    const collect = async () => {
      const [{ probeStudioCapabilitySnapshot, studioCapabilityProbeInputFromGlobals }] =
        await Promise.all([import("./studio-capability-probe")]);
      const [snapshot, sqlite, storage] = await Promise.all([
        probeStudioCapabilitySnapshot(studioCapabilityProbeInputFromGlobals()).catch(
          () => null,
        ),
        import("./studio-local-database-runtime")
          .then((module) => module.probeStudioLocalDatabaseRuntime())
          .catch(() => null),
        import("./studio-opfs-asset-store")
          .then((module) =>
            module.estimateStudioOpfsQuota(
              typeof navigator !== "undefined" && navigator.storage?.estimate
                ? { estimate: () => navigator.storage.estimate() }
                : null,
            ),
          )
          .catch(() => null),
      ]);
      if (cancelled) return;
      const browserInfo = getBrowserInfo();
      const compatibility = checkBrowserCompatibility();
      const input: StudioDiagnosticsInput = {
        collectedAt: Date.now(),
        browser: {
          name: browserInfo.name,
          version: browserInfo.version,
          os: browserInfo.os,
          isSupported: compatibility.isSupported,
          isLegacy: compatibility.isLegacy,
          missingFeatures: compatibility.missingFeatures,
        },
        capability: snapshot ? classifyStudioCapabilityTier(snapshot) : null,
        gpuFabric: getStudioGpuFabricCapabilities(),
        adapter: adapterRef.current,
        sqlite,
        storage,
        reliability: reliabilityRef.current,
        renderBackend: getStudioRenderBackend(),
        appVersion: import.meta.env.MODE,
        secureContext:
          typeof globalThis.isSecureContext === "boolean"
            ? globalThis.isSecureContext
            : null,
      };
      setState({ report: buildStudioDiagnosticsReport(input), running: false });
    };
    void collect().catch(() => {
      if (!cancelled) setState({ report: null, running: false });
    });
    return () => {
      cancelled = true;
    };
  }, [active, nonce]);

  const probeAdapter = useCallback(() => {
    setAdapterBusy(true);
    void import("@toonspectrum/studio-engine-vello")
      .then((module) => module.probeWebGpu())
      .then((result) => {
        setAdapter(
          result.supported
            ? {
                supported: true,
                name: result.adapter.name,
                backend: result.adapter.backend,
                deviceType: result.adapter.deviceType,
                driver: result.adapter.driver,
                driverInfo: result.adapter.driverInfo,
              }
            : { supported: false, reason: result.reason },
        );
      })
      .catch((cause: unknown) => {
        setAdapter({
          supported: false,
          reason: cause instanceof Error ? cause.message : "어댑터 프로브 실패",
        });
      })
      .finally(() => {
        setAdapterBusy(false);
        setNonce((value) => value + 1);
      });
  }, []);

  return {
    ...state,
    adapterBusy,
    probeAdapter,
    refresh: () => setNonce((value) => value + 1),
  };
}

/* ------------------------------------------------------------- sections */

function CurrentToolPanel({ toolCommandId }: { toolCommandId: string | null }) {
  const help = useMemo(
    () => (toolCommandId ? buildStudioToolHelp(toolCommandId) : null),
    [toolCommandId],
  );

  if (!help) {
    return (
      <Callout tone="warn">
        지금 어떤 도구가 캔버스를 쥐고 있는지 확인하지 못했습니다. 도구를 한 번
        누른 뒤 다시 열어 주세요.
      </Callout>
    );
  }

  return (
    <div className="space-y-3 text-sm text-fg">
      <div className="rounded-xl border border-line bg-card p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-base font-semibold">{help.label}</span>
          {help.labelEn ? (
            <span className="text-xs text-fg-3">{help.labelEn}</span>
          ) : null}
          {help.shortcut ? (
            <kbd className="rounded border border-line bg-panel px-1.5 py-px text-[0.7rem] text-fg-3">
              {help.shortcut}
            </kbd>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg-3">
          {help.description ?? "카탈로그에 이 도구의 한 줄 설명이 아직 없습니다."}
        </p>
      </div>

      <Callout tone="warn">
        이 도구의 <b>산문 도움말 문서는 아직 없습니다</b>(도움말 노드{" "}
        <code className="text-[0.7rem]">{help.helpNodeId}</code> 는 비어 있습니다).
        대신 카탈로그가 실제로 들고 있는 이름·단축키·별칭과, 통합 검색이 이 이름으로
        찾아 주는 항목을 보여 드립니다.
      </Callout>

      {help.aliases.length > 0 ? (
        <>
          <SectionHeading>다른 프로그램에서 부르던 이름</SectionHeading>
          <ul className="flex flex-wrap gap-1.5">
            {help.aliases.map((alias) => (
              <li
                key={`${alias.vendor}:${alias.term}`}
                className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.7rem] text-fg-3"
              >
                <span className="font-medium text-fg">{alias.term}</span>
                {" · "}
                {STUDIO_TERMINOLOGY_VENDOR_LABELS[alias.vendor] ?? alias.vendor}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <SectionHeading>관련 명령 · 속성 · 패널</SectionHeading>
      {help.related.length === 0 ? (
        <p className="text-xs text-fg-3">검색 색인이 찾은 관련 항목이 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {help.related.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-2.5 py-1.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs text-fg">{item.label}</span>
                <span className="block truncate text-[0.66rem] text-fg-3">
                  {item.location}
                </span>
              </span>
              {item.shortcut ? (
                <kbd className="shrink-0 rounded border border-line bg-panel px-1.5 py-px text-[0.66rem] text-fg-3">
                  {item.shortcut}
                </kbd>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {help.tutorialIds.length > 0 ? (
        <p className="text-xs text-fg-3">
          관련 튜토리얼: {help.tutorialIds.join(", ")} — 도움말 ▸ 사용법 · 기능
          튜토리얼에서 열 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}

function TerminologyPanel() {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => studioTerminologyVendorCounts(), []);
  const total = useMemo(() => studioTerminologyRows().length, []);
  const rows = useMemo(() => filterStudioTerminologyRows(query), [query]);
  const shown = rows.slice(0, 200);

  return (
    <div className="space-y-3 text-sm text-fg">
      <Callout tone="info">
        카탈로그가 들고 있는 타사 용어 별칭 <b>{total}건</b>입니다. 같은 색인을 F1
        통합 검색도 씁니다 — 여기서는 훑어보고, 검색창에서는 찾습니다.
      </Callout>
      <label className="block">
        <span className="sr-only">용어 검색</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="예: Paint Bucket, 스포이트, Inherit Alpha"
          className="min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none placeholder:text-fg-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
      </label>
      <p className="text-[0.7rem] text-fg-3">
        {Object.entries(counts)
          .map(
            ([vendor, count]) =>
              `${STUDIO_TERMINOLOGY_VENDOR_LABELS[vendor] ?? vendor} ${count}`,
          )
          .join(" · ")}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-fg-3">맞는 용어를 찾지 못했습니다.</p>
      ) : (
        <>
          <ul className="space-y-1">
            {shown.map((row) => (
              <li
                key={`${row.vendor}:${row.term}:${row.ourId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-2.5 py-1.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs text-fg">
                    {row.term}
                    <span className="text-fg-3">
                      {" → "}
                      {row.ourLabel}
                    </span>
                  </span>
                  <span className="block truncate text-[0.66rem] text-fg-3">
                    {STUDIO_TERMINOLOGY_VENDOR_LABELS[row.vendor] ?? row.vendor} ·{" "}
                    {row.location}
                  </span>
                </span>
                {row.shortcut ? (
                  <kbd className="shrink-0 rounded border border-line bg-panel px-1.5 py-px text-[0.66rem] text-fg-3">
                    {row.shortcut}
                  </kbd>
                ) : null}
              </li>
            ))}
          </ul>
          {rows.length > shown.length ? (
            <p className="text-[0.7rem] text-fg-3">
              {rows.length}건 중 {shown.length}건을 표시했습니다. 검색어를 좁혀
              보세요.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function DiagnosticsReportView({ report }: { report: StudioDiagnosticsReport }) {
  return (
    <div className="space-y-3">
      {report.groups.map((group) => (
        <section key={group.id}>
          <SectionHeading>{group.label}</SectionHeading>
          <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
            {group.fields.map((entry) => (
              <div key={entry.id} className="flex gap-3 px-2.5 py-1.5">
                <dt className="w-36 shrink-0 text-[0.7rem] text-fg-3">{entry.label}</dt>
                <dd className="min-w-0 flex-1 text-xs text-fg">
                  <span className={entry.measured ? "" : "text-fg-3 italic"}>
                    {entry.value}
                  </span>
                  {entry.detail ? (
                    <span className="mt-0.5 block text-[0.66rem] text-fg-3">
                      {entry.detail}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function RecoveryPanel() {
  const reliability = useStudioReliabilityStatus();
  const [scan, setScan] = useState<StudioRecoveryScan | null>(null);
  const [checkpointCount, setCheckpointCount] = useState<number | null>(null);
  const [reclaiming, setReclaiming] = useState(false);

  useEffect(() => {
    const storage =
      typeof window === "undefined" ? null : (window.localStorage ?? null);
    const result = scanStudioRecoveryStorage(storage);
    setScan(result);
    let cancelled = false;
    void import("./studio-checkpoints")
      .then(async (module) => {
        const total = await module.countDurableStudioCheckpoints();
        if (!cancelled) setCheckpointCount(total);
      })
      .catch(() => {
        if (!cancelled) setCheckpointCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const actions = useMemo(
    () =>
      scan
        ? studioRecoveryActions({ scan, reliability, checkpointCount })
        : [],
    [checkpointCount, reliability, scan],
  );

  return (
    <div className="space-y-3 text-sm text-fg">
      <SectionHeading>지금 남아 있는 것</SectionHeading>
      {!scan ? (
        <p className="text-xs text-fg-3">브라우저 저장소를 읽는 중입니다…</p>
      ) : scan.storageUnavailable ? (
        <Callout tone="warn">
          브라우저 저장소를 읽지 못했습니다(사생활 보호 모드일 수 있습니다). 이
          상태에서는 임시저장이 남지 않으니 작업을 파일로 내보내 두세요.
        </Callout>
      ) : (
        <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
          <div className="flex gap-3 px-2.5 py-1.5">
            <dt className="w-36 shrink-0 text-[0.7rem] text-fg-3">임시저장</dt>
            <dd className="min-w-0 flex-1 text-xs text-fg">
              {scan.autosaves.length === 0
                ? "없음"
                : `${scan.autosaves.length}건`}
              {scan.autosaves.slice(0, 4).map((record) => (
                <span key={record.key} className="mt-0.5 block text-[0.66rem] text-fg-3">
                  {record.documentLabel} · 페이지 {record.pageCount}개 ·{" "}
                  {record.savedAt
                    ? new Date(record.savedAt).toLocaleString("ko-KR")
                    : "시각 미상"}
                  {record.hasContent ? "" : " · 내용 없음"}
                </span>
              ))}
            </dd>
          </div>
          <div className="flex gap-3 px-2.5 py-1.5">
            <dt className="w-36 shrink-0 text-[0.7rem] text-fg-3">체크포인트</dt>
            <dd className="min-w-0 flex-1 text-xs text-fg">
              {checkpointCount === null
                ? "확인 못 함"
                : `${checkpointCount}건 (문서당 최대 10개 보관)`}
            </dd>
          </div>
          <div className="flex gap-3 px-2.5 py-1.5">
            <dt className="w-36 shrink-0 text-[0.7rem] text-fg-3">저장 권위</dt>
            <dd className="min-w-0 flex-1 text-xs text-fg">
              {reliability.save === null
                ? "최근 저장 실패·강등 보고 없음"
                : `${reliability.save.level} · ${reliability.save.title}`}
              {reliability.save?.detail ? (
                <span className="mt-0.5 block text-[0.66rem] text-fg-3">
                  {reliability.save.detail}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex gap-3 px-2.5 py-1.5">
            <dt className="w-36 shrink-0 text-[0.7rem] text-fg-3">안전 모드</dt>
            <dd className="min-w-0 flex-1 text-xs text-fg">
              {reliability.safeMode.active ? "켜짐" : "꺼짐"}
            </dd>
          </div>
        </dl>
      )}

      <SectionHeading>지금 할 수 있는 조치</SectionHeading>
      <ul className="space-y-2">
        {actions.map((action) => (
          <li
            key={action.id}
            className={
              action.urgent
                ? "rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
                : "rounded-lg border border-line bg-card px-3 py-2"
            }
          >
            <p className="text-xs font-semibold text-fg">{action.title}</p>
            <p className="mt-0.5 text-[0.7rem] leading-relaxed text-fg-3">
              {action.body}
            </p>
            {action.id === "reclaim-storage" ? (
              <button
                type="button"
                disabled={reclaiming}
                onClick={() => {
                  setReclaiming(true);
                  void reclaimStudioStorage().finally(() => setReclaiming(false));
                }}
                className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
              >
                <RefreshCw size={13} aria-hidden />
                {reclaiming ? "회수하는 중…" : "지금 공간 회수"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <Callout tone="info">
        복구 센터(파일 ▸ 복구 센터)는 아직 없습니다. 위 조치는 모두 지금 화면에서
        도달할 수 있는 것만 적었습니다.
      </Callout>
    </div>
  );
}

function LicensePanel() {
  const [notice, setNotice] = useState<StudioGeneratedNoticeResult | null>(null);
  const table = useMemo(() => studioEngineLicenseTable(), []);

  useEffect(() => {
    let cancelled = false;
    void loadStudioGeneratedNotice({
      baseUrl: import.meta.env.BASE_URL,
    }).then((result) => {
      if (!cancelled) setNotice(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-3 text-sm text-fg">
      <SectionHeading>생성 서드파티 고지</SectionHeading>
      {notice === null ? (
        <p className="text-xs text-fg-3">고지 파일을 확인하는 중입니다…</p>
      ) : notice.status === "absent" ? (
        <Callout tone="warn">
          <code className="text-[0.7rem]">{notice.url}</code> 를 불러오지
          못했습니다 — {notice.reason}
        </Callout>
      ) : (
        <>
          <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
            {notice.summary.map((row) => (
              <div key={row.label} className="flex gap-3 px-2.5 py-1.5">
                <dt className="w-48 shrink-0 text-[0.7rem] text-fg-3">{row.label}</dt>
                <dd className="min-w-0 flex-1 break-all text-xs text-fg">{row.value}</dd>
              </div>
            ))}
          </dl>
          <details className="rounded-lg border border-line bg-card">
            <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-fg">
              전체 고지 원문 보기 ({notice.text.length.toLocaleString("ko-KR")}자)
            </summary>
            <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words border-t border-line px-2.5 py-2 text-[0.66rem] leading-relaxed text-fg-3">
              {notice.text}
            </pre>
          </details>
          <a
            href={notice.url}
            download
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Download size={13} aria-hidden />
            고지 파일 내려받기
          </a>
        </>
      )}

      <SectionHeading>엔진 후보 라이선스 게이트</SectionHeading>
      <Callout tone="info">
        {table.rows.length}개 후보의 SPDX 표기를 실제{" "}
        <code className="text-[0.7rem]">evaluateLicenseGate()</code> 정책에 넣어
        지금 계산한 판정입니다. 번들 허용 {table.bundleAllowed.length}종 · 격리
        허용 {table.isolatedAllowed.length}종.
      </Callout>
      <ul className="space-y-1">
        {table.rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-2.5 py-1.5"
          >
            <span className="min-w-0">
              <span className="block truncate text-xs text-fg">
                {row.id} · {row.name}
              </span>
              <span className="block truncate text-[0.66rem] text-fg-3">
                {row.area} · {row.license}
              </span>
            </span>
            <span
              className={
                row.gate === "bundle"
                  ? "shrink-0 rounded-full border border-line bg-panel px-2 py-0.5 text-[0.66rem] text-fg-3"
                  : "shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[0.66rem] text-fg"
              }
            >
              {row.gate === "bundle"
                ? "번들 가능"
                : row.gate === "isolated"
                  ? "격리 필요"
                  : "거부"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BugReportPanel({
  report,
  running,
}: {
  report: StudioDiagnosticsReport | null;
  running: boolean;
}) {
  const [copied, setCopied] = useState<"markdown" | "json" | null>(null);
  const packaged: StudioBugReportPackage | null = useMemo(() => {
    if (!report) return null;
    return buildStudioBugReportPackage({
      diagnostics: report,
      errors: readStudioErrorJournal(),
      appVersion: import.meta.env.MODE,
      href: typeof window === "undefined" ? null : window.location.href,
      locale: typeof navigator === "undefined" ? null : navigator.language,
    });
  }, [report]);

  const copy = useCallback(
    (kind: "markdown" | "json") => {
      if (!packaged) return;
      const text =
        kind === "markdown"
          ? formatStudioBugReportMarkdown(packaged)
          : formatStudioBugReportJson(packaged);
      void navigator.clipboard
        ?.writeText(text)
        .then(() => setCopied(kind))
        .catch(() => setCopied(null));
    },
    [packaged],
  );

  const download = useCallback(() => {
    if (!packaged) return;
    const blob = new Blob([formatStudioBugReportMarkdown(packaged)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `toonstudio-bug-report-${packaged.createdAt.replace(/[:.]/gu, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [packaged]);

  return (
    <div className="space-y-3 text-sm text-fg">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-card p-3">
          <p className="text-xs font-semibold text-fg">담기는 것</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[0.7rem] leading-relaxed text-fg-3">
            {STUDIO_BUG_REPORT_INCLUDED.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-card p-3">
          <p className="text-xs font-semibold text-fg">담기지 않는 것</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[0.7rem] leading-relaxed text-fg-3">
            {STUDIO_BUG_REPORT_EXCLUDED.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
      </div>

      {running || !packaged ? (
        <p className="text-xs text-fg-3">진단을 측정하는 중입니다…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copy("markdown")}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Copy size={13} aria-hidden />
              마크다운 복사
            </button>
            <button
              type="button"
              onClick={() => copy("json")}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Copy size={13} aria-hidden />
              JSON 복사
            </button>
            <button
              type="button"
              onClick={download}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Download size={13} aria-hidden />
              파일로 저장
            </button>
            <span role="status" aria-live="polite" className="self-center text-[0.7rem] text-fg-3">
              {copied === null
                ? `오류 ${packaged.errors.length}건 · 진단 ${packaged.diagnostics.measuredCount}항목 실측`
                : "클립보드에 복사했습니다."}
            </span>
          </div>
          <details className="rounded-lg border border-line bg-card">
            <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-fg">
              보낼 내용 미리 보기
            </summary>
            <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words border-t border-line px-2.5 py-2 text-[0.66rem] leading-relaxed text-fg-3">
              {formatStudioBugReportMarkdown(packaged)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- dialog */

export function StudioHelpCenterDialog({
  open,
  section,
  toolCommandId,
  onSectionChange,
  onClose,
}: StudioHelpCenterDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const diagnosticsActive = section === "diagnostics" || section === "bug-report";
  const diagnostics = useStudioDiagnostics(open && diagnosticsActive);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useLayoutEffect(() => {
    if (!open) return;
    dialogRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${STUDIO_Z_CLASS.help} flex items-center justify-center bg-black/45 px-4 py-[6vh] backdrop-blur-sm`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="studio-help-center"
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl outline-none"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
            도움말 · {PANEL_TITLE[section]}
          </h2>
          {diagnosticsActive ? (
            <button
              type="button"
              onClick={diagnostics.refresh}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-xs text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <RefreshCw size={13} aria-hidden />
              다시 측정
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            title="닫기 (Esc)"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={16} aria-hidden />
            <span className="sr-only">도움말 닫기</span>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label="도움말 구역"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-44 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r"
          >
            {STUDIO_HELP_CENTER_SECTIONS.map((id) => {
              const meta = SECTION_META[id];
              const Icon = meta.icon;
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={id === section ? "page" : undefined}
                  onClick={() => onSectionChange(id)}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    id === section
                      ? "bg-raised text-fg"
                      : "text-fg-3 hover:bg-raised hover:text-fg"
                  }`}
                >
                  <Icon size={14} aria-hidden className="shrink-0" />
                  <span className="whitespace-nowrap">{meta.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {section === "current-tool" ? (
              <CurrentToolPanel toolCommandId={toolCommandId} />
            ) : section === "terminology" ? (
              <TerminologyPanel />
            ) : section === "recovery" ? (
              <RecoveryPanel />
            ) : section === "license" ? (
              <LicensePanel />
            ) : section === "bug-report" ? (
              <BugReportPanel report={diagnostics.report} running={diagnostics.running} />
            ) : (
              <div className="space-y-3 text-sm text-fg">
                {diagnostics.report === null ? (
                  <p className="text-xs text-fg-3">
                    {diagnostics.running
                      ? "기기 능력을 측정하는 중입니다…"
                      : "측정 결과를 만들지 못했습니다. ‘다시 측정’을 눌러 주세요."}
                  </p>
                ) : (
                  <>
                    <Callout tone="info">
                      {new Date(diagnostics.report.collectedAt).toLocaleString("ko-KR")}{" "}
                      기준 실측 {diagnostics.report.measuredCount}항목 · 확인 못 한
                      항목 {diagnostics.report.unmeasuredCount}개. 확인 못 한 항목은
                      추정하지 않고 그대로 둡니다.
                    </Callout>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={diagnostics.adapterBusy}
                        onClick={diagnostics.probeAdapter}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
                      >
                        <Stethoscope size={13} aria-hidden />
                        {diagnostics.adapterBusy
                          ? "어댑터 조회 중…"
                          : "GPU 어댑터 신원 조회(약 4MB 내려받음)"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const text = formatStudioDiagnosticsText(
                            diagnostics.report as StudioDiagnosticsReport,
                          );
                          // 같은 파일 697행이 이미 .catch 를 단 형태로 쓴다. 여기만 빠져 있어
                          // 인앱 WebView 의 NotAllowedError 가 unhandled rejection 으로 샜다.
                          void copyStudioText(text);
                        }}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-xs text-fg transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <Copy size={13} aria-hidden />
                        진단 복사
                      </button>
                    </div>
                    <DiagnosticsReportView report={diagnostics.report} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
