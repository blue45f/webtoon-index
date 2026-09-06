import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson2,
  FileSpreadsheet,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
  XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER,
  STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS,
  serializeStudioAssetRightsManifestCsv,
  serializeStudioAssetRightsManifestJson,
  type StudioAssetRightsAttestationInput,
  type StudioAssetRightsDiagnostic,
  type StudioAssetRightsManifestAsset,
  type StudioAssetRightsManifestResult,
  type StudioAssetRightsPermission,
} from "./studio-asset-rights-manifest";

export interface StudioAssetRightsManifestPanelProps {
  readonly result: StudioAssetRightsManifestResult;
  readonly reviewer: string;
  readonly onReviewerChange: (reviewer: string) => void;
  /**
   * The host rebuilds `result` with this attestation. The panel stores no account identifier and
   * never sends the review over the network.
   */
  readonly onAttestationChange?: (
    attestation: StudioAssetRightsAttestationInput
  ) => void;
  /** The host owns the local file-save gesture. The panel only creates a bounded payload. */
  readonly onExportJson?: (payload: string) => void | Promise<void>;
  readonly onExportCsv?: (payload: string) => void | Promise<void>;
  readonly onClose?: () => void;
  readonly disabled?: boolean;
}

type ExportKind = "json" | "csv";

const VISIBLE_DIAGNOSTIC_LIMIT = 100;
const VISIBLE_ASSET_LIMIT = 100;
const VISIBLE_USAGE_LIMIT = 12;
const CONTROL_CLASS =
  "min-h-11 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY_CONTROL_CLASS =
  "min-h-11 rounded-xl border border-accent bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-fg-3";
const FIELD_CLASS =
  "min-h-11 w-full rounded-xl border border-line bg-card px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

const PERMISSION_META: Record<
  StudioAssetRightsPermission,
  { label: string; className: string }
> = {
  allowed: {
    label: "허용",
    className: "border-good/35 bg-good/10 text-good",
  },
  prohibited: {
    label: "금지",
    className: "border-bad/35 bg-bad/10 text-bad",
  },
  unknown: {
    label: "미확인",
    className: "border-warn/35 bg-warn/10 text-warn",
  },
};

const DIAGNOSTIC_CATEGORY_LABELS: Record<
  StudioAssetRightsDiagnostic["category"],
  string
> = {
  missing: "누락",
  expired: "만료",
  incompatible: "충돌",
  unknown: "미확인",
  duplicate: "중복",
  attestation: "검토",
};

function PermissionBadge({
  label,
  value,
}: {
  readonly label: string;
  readonly value: StudioAssetRightsPermission;
}) {
  const meta = PERMISSION_META[value];
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-[0.65rem] font-semibold ${meta.className}`}
      title={`${label}: ${meta.label}`}
    >
      <span className="text-current/70">{label}</span>
      {meta.label}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "neutral" | "bad" | "warn";
}) {
  const valueClass =
    tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <div className="min-w-0 rounded-xl border border-line bg-card/70 px-3 py-2.5">
      <p className="text-[0.65rem] font-semibold text-fg-3">{label}</p>
      <p className={`mt-0.5 text-lg font-black tabular-nums ${valueClass}`}>
        {value.toLocaleString("ko-KR")}
      </p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-line bg-card/40 px-5 py-6 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-xl bg-good/10 text-good">
          {icon}
        </span>
        <p className="mt-2 text-sm font-bold text-fg">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-3">{description}</p>
      </div>
    </div>
  );
}

function DiagnosticRow({
  diagnostic,
}: {
  readonly diagnostic: StudioAssetRightsDiagnostic;
}) {
  const error = diagnostic.severity === "error";
  const location = [
    diagnostic.pageId ? `페이지 ${diagnostic.pageId}` : null,
    diagnostic.elementId ? `요소 ${diagnostic.elementId}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <li
      className={`rounded-xl border px-3 py-2.5 [content-visibility:auto] ${
        error
          ? "border-bad/25 bg-bad/5"
          : "border-warn/25 bg-warn/5"
      }`}
      data-testid={`asset-rights-diagnostic-${diagnostic.code}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {error
          ? <XCircle className="mt-0.5 shrink-0 text-bad" size={15} aria-hidden />
          : <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={15} aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[0.62rem] font-bold ${
                error ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn"
              }`}
            >
              {DIAGNOSTIC_CATEGORY_LABELS[diagnostic.category]}
            </span>
            <code className="break-all text-[0.62rem] text-fg-3">
              {diagnostic.code}
            </code>
          </div>
          <p className="mt-1 text-xs font-medium leading-relaxed text-fg-2">
            {diagnostic.message}
          </p>
          {diagnostic.assetId || location ? (
            <p className="mt-1 truncate text-[0.65rem] text-fg-3">
              {[diagnostic.assetId, location].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AssetRow({ asset }: { readonly asset: StudioAssetRightsManifestAsset }) {
  const visibleUsages = asset.usages.slice(0, VISIBLE_USAGE_LIMIT);
  return (
    <li
      className="rounded-2xl border border-line bg-card/70 p-3 [content-visibility:auto]"
      data-testid={`asset-rights-asset-${asset.assetId}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-fg">{asset.assetId}</p>
          <p className="mt-0.5 truncate font-mono text-[0.62rem] text-fg-3">
            {asset.assetVersion ?? "버전 미확인"}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-panel px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
          {asset.usages.length.toLocaleString("ko-KR")}곳
        </span>
      </div>

      <dl className="mt-2.5 grid gap-1.5 text-[0.68rem] sm:grid-cols-2">
        <div className="min-w-0 rounded-lg bg-panel/60 px-2.5 py-2">
          <dt className="font-semibold text-fg-3">출처</dt>
          <dd className="mt-0.5 truncate font-medium text-fg-2">
            {asset.source.kind} · {asset.source.id ?? "식별자 미확인"}
          </dd>
        </div>
        <div className="min-w-0 rounded-lg bg-panel/60 px-2.5 py-2">
          <dt className="font-semibold text-fg-3">사용권</dt>
          <dd className="mt-0.5 truncate font-medium text-fg-2">
            {asset.license.label || asset.license.id}
          </dd>
        </div>
      </dl>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <PermissionBadge label="상업" value={asset.commercialUse} />
        <PermissionBadge label="AI 학습" value={asset.aiTraining} />
        <PermissionBadge label="재배포" value={asset.redistribution} />
      </div>

      <details className="group mt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-[0.68rem] font-semibold text-fg-3 hover:bg-raised [&::-webkit-details-marker]:hidden">
          <MapPin size={14} aria-hidden />
          페이지·요소 사용 위치
          <span className="ml-auto text-[0.62rem] group-open:hidden">펼치기</span>
          <span className="ml-auto hidden text-[0.62rem] group-open:inline">접기</span>
        </summary>
        <ul className="flex flex-wrap gap-1.5 px-2 pb-2">
          {visibleUsages.map((usage, index) => (
            <li
              key={`${usage.pageId ?? "work"}:${usage.elementId ?? "page"}:${index}`}
              className="rounded-lg border border-line bg-panel px-2 py-1 text-[0.62rem] text-fg-3"
            >
              {usage.pageId ? `페이지 ${usage.pageId}` : "작품 전체"}
              {usage.elementId ? ` · ${usage.elementId}` : ""}
            </li>
          ))}
          {asset.usages.length > visibleUsages.length ? (
            <li className="rounded-lg bg-raised px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
              +{asset.usages.length - visibleUsages.length}곳
            </li>
          ) : null}
        </ul>
      </details>
    </li>
  );
}

export function StudioAssetRightsManifestPanel({
  result,
  reviewer,
  onReviewerChange,
  onAttestationChange,
  onExportJson,
  onExportCsv,
  onClose,
  disabled = false,
}: StudioAssetRightsManifestPanelProps) {
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const reviewerReady =
    reviewer.trim().length > 0
    && Array.from(reviewer).length <= STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.reviewerCodePoints;
  const visibleDiagnostics = result.diagnostics.slice(0, VISIBLE_DIAGNOSTIC_LIMIT);
  const visibleAssets = result.assets.slice(0, VISIBLE_ASSET_LIMIT);
  const ready = result.readyForPublishPreflight;

  const review = (status: "confirmed" | "rejected") => {
    if (!reviewerReady || disabled || !onAttestationChange) return;
    onAttestationChange({
      status,
      reviewedAt: new Date().toISOString(),
      reviewer: reviewer.trim(),
    });
  };

  const exportManifest = async (kind: ExportKind) => {
    const callback = kind === "json" ? onExportJson : onExportCsv;
    if (!callback || disabled || exporting) return;
    setExporting(kind);
    setExportStatus(null);
    try {
      const payload = kind === "json"
        ? await serializeStudioAssetRightsManifestJson(result.manifest)
        : serializeStudioAssetRightsManifestCsv(result.manifest);
      await callback(payload);
      setExportStatus(`${kind.toUpperCase()} 권리 명세를 로컬 파일로 전달했습니다.`);
    } catch (error) {
      setExportStatus(
        error instanceof Error
          ? error.message
          : "권리 명세 파일을 만들지 못했습니다."
      );
    } finally {
      setExporting(null);
    }
  };

  return (
    <section
      aria-label="에셋 사용권 및 납품 감사"
      className="flex max-h-[min(82vh,58rem)] min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl"
      data-testid="studio-asset-rights-manifest-panel"
    >
      <header className="shrink-0 border-b border-line bg-card/70 px-3 py-3 sm:px-4">
        <div className="flex items-start gap-3">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
              ready ? "bg-good/10 text-good" : "bg-bad/10 text-bad"
            }`}
          >
            {ready
              ? <ShieldCheck size={21} aria-hidden />
              : <ShieldAlert size={21} aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-black text-fg">에셋 권리·납품 감사</h2>
              <span
                className={`rounded-full border px-2 py-1 text-[0.65rem] font-bold ${
                  ready
                    ? "border-good/35 bg-good/10 text-good"
                    : "border-bad/35 bg-bad/10 text-bad"
                }`}
                data-testid="asset-rights-readiness"
              >
                {ready ? "사전점검 연결 가능" : "게시 전 확인 필요"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              작품에 사용한 에셋 버전·출처·사용권과 페이지별 사용 위치를 한 번에
              점검합니다.
            </p>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="에셋 권리·납품 감사 닫기"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-panel text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <X size={17} aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryMetric label="고유 에셋" value={result.manifest.summary.assetCount} />
          <SummaryMetric label="사용 위치" value={result.manifest.summary.placementCount} />
          <SummaryMetric
            label="차단 오류"
            value={result.manifest.summary.errorCount}
            tone={result.manifest.summary.errorCount > 0 ? "bad" : "neutral"}
          />
          <SummaryMetric
            label="주의"
            value={result.manifest.summary.warningCount}
            tone={result.manifest.summary.warningCount > 0 ? "warn" : "neutral"}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section aria-labelledby="asset-rights-diagnostics-heading">
            <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
              <h3
                id="asset-rights-diagnostics-heading"
                className="text-xs font-black text-fg"
              >
                확인할 항목
              </h3>
              <span className="text-[0.65rem] font-semibold text-fg-3">
                {result.diagnostics.length.toLocaleString("ko-KR")}개
              </span>
            </div>
            {visibleDiagnostics.length > 0 ? (
              <ul className="space-y-2">
                {visibleDiagnostics.map((diagnostic) => (
                  <DiagnosticRow
                    key={[
                      diagnostic.code,
                      diagnostic.assetId,
                      diagnostic.pageId,
                      diagnostic.elementId,
                    ].join(":")}
                    diagnostic={diagnostic}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<CheckCircle2 size={18} aria-hidden />}
                title="자동 점검을 통과했습니다"
                description="사람이 원문 사용권을 확인하고 검토 상태를 확정하면 됩니다."
              />
            )}
            {result.diagnostics.length > visibleDiagnostics.length ? (
              <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-[0.68rem] text-fg-3">
                화면 성능을 위해 {visibleDiagnostics.length.toLocaleString("ko-KR")}개만
                표시합니다. 전체 내용은 JSON 또는 CSV 명세에서 확인할 수 있습니다.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="asset-rights-assets-heading">
            <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
              <h3 id="asset-rights-assets-heading" className="text-xs font-black text-fg">
                에셋 사용 대장
              </h3>
              <span className="text-[0.65rem] font-semibold text-fg-3">
                {result.assets.length.toLocaleString("ko-KR")}종
              </span>
            </div>
            {visibleAssets.length > 0 ? (
              <ul className="space-y-2">
                {visibleAssets.map((asset) => (
                  <AssetRow
                    key={`${asset.assetId}:${asset.assetVersion ?? "unknown"}`}
                    asset={asset}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<ShieldCheck size={18} aria-hidden />}
                title="기록된 외부 에셋이 없습니다"
                description="작품 에셋 사용 투영을 연결하면 버전과 페이지 위치가 여기에 나타납니다."
              />
            )}
            {result.assets.length > visibleAssets.length ? (
              <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-[0.68rem] text-fg-3">
                화면에는 처음 {visibleAssets.length.toLocaleString("ko-KR")}종만 표시합니다.
                전체 대장은 내보내기 파일에 포함됩니다.
              </p>
            ) : null}
          </section>
        </div>

        <section
          aria-labelledby="asset-rights-attestation-heading"
          className="mt-3 rounded-2xl border border-line bg-card/70 p-3"
        >
          <div className="flex items-start gap-2">
            <UserCheck className="mt-0.5 shrink-0 text-accent" size={17} aria-hidden />
            <div className="min-w-0">
              <h3 id="asset-rights-attestation-heading" className="text-xs font-black text-fg">
                사람 검토
              </h3>
              <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                이메일·계정 ID 대신 이 파일에서만 사용할 표시 이름을 입력하세요.
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="min-w-0">
              <span className="sr-only">검토자 표시 이름</span>
              <input
                aria-label="검토자 표시 이름"
                autoComplete="off"
                className={FIELD_CLASS}
                disabled={disabled}
                maxLength={STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.reviewerCodePoints}
                onChange={(event) => onReviewerChange(event.currentTarget.value)}
                placeholder="예: 납품 검수자"
                spellCheck={false}
                type="text"
                value={reviewer}
              />
            </label>
            <button
              type="button"
              className={PRIMARY_CONTROL_CLASS}
              disabled={!reviewerReady || disabled || !onAttestationChange}
              onClick={() => review("confirmed")}
            >
              <ShieldCheck size={15} aria-hidden />
              확인 완료
            </button>
            <button
              type="button"
              className={CONTROL_CLASS}
              disabled={!reviewerReady || disabled || !onAttestationChange}
              onClick={() => review("rejected")}
            >
              <XCircle size={15} aria-hidden />
              반려
            </button>
          </div>
          <p className="mt-2 text-[0.65rem] text-fg-3" aria-live="polite">
            현재 상태: {result.manifest.attestation.status === "confirmed"
              ? `확인됨 · ${result.manifest.attestation.reviewer ?? ""}`
              : result.manifest.attestation.status === "rejected"
                ? `반려됨 · ${result.manifest.attestation.reviewer ?? ""}`
                : "검토 전"}
          </p>
        </section>

        <section
          aria-labelledby="asset-rights-export-heading"
          className="mt-3 rounded-2xl border border-line bg-card/70 p-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 id="asset-rights-export-heading" className="text-xs font-black text-fg">
                로컬 납품 기록
              </h3>
              <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                JSON은 SHA-256 무결성 검증용, CSV는 스프레드시트 검수용입니다.
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2">
              <button
                type="button"
                className={CONTROL_CLASS}
                disabled={disabled || exporting !== null || !onExportJson}
                onClick={() => void exportManifest("json")}
              >
                <FileJson2 size={15} aria-hidden />
                {exporting === "json" ? "생성 중" : "JSON"}
                <Download size={13} aria-hidden />
              </button>
              <button
                type="button"
                className={CONTROL_CLASS}
                disabled={disabled || exporting !== null || !onExportCsv}
                onClick={() => void exportManifest("csv")}
              >
                <FileSpreadsheet size={15} aria-hidden />
                {exporting === "csv" ? "생성 중" : "CSV"}
                <Download size={13} aria-hidden />
              </button>
            </div>
          </div>
          <p
            className="mt-2 min-h-4 text-[0.65rem] text-fg-3"
            aria-live="polite"
            data-testid="asset-rights-export-status"
          >
            {exportStatus}
          </p>
        </section>

        <aside className="mt-3 flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/5 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={15} aria-hidden />
          <p className="text-[0.68rem] leading-relaxed text-fg-3">
            <strong className="font-bold text-fg-2">로컬 전용 · 법률 고지:</strong>{" "}
            {STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER}
          </p>
        </aside>
      </div>
    </section>
  );
}
