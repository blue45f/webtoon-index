import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  FileArchive,
  FileCheck2,
  FileImage,
  FileJson2,
  FileText,
  ImageIcon,
  Layers3,
  LoaderCircle,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  getStudioPublishPlatformPreset,
  normalizeStudioPublishPackageSettings,
  STUDIO_PUBLISH_PACKAGE_LIMITS,
  STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT,
  STUDIO_PUBLISH_THUMBNAIL_SLOTS,
  type StudioPublishArtifactPlan,
  type StudioPublishArtifactRole,
  type StudioPublishArtifactState,
  type StudioPublishPackageAiUsage,
  type StudioPublishPackageDestination,
  type StudioPublishPackageFormat,
  type StudioPublishPackageImageMimeType,
  type StudioPublishPackageIssue,
  type StudioPublishPackageManifest,
  type StudioPublishPackagePlan,
  type StudioPublishPackageSettings,
  type StudioPublishThumbnailSlot,
} from "./studio-publish-package";
import {
  STUDIO_REVIEW_PDF_PROFILE_IDS,
  STUDIO_REVIEW_PDF_PROFILES,
  type StudioReviewPdfProfileId,
} from "./studio-review-pdf-profile";

export interface StudioPublishPackagePanelProps {
  open: boolean;
  onClose: () => void;
  settings: StudioPublishPackageSettings;
  onSettingsChange: (settings: StudioPublishPackageSettings) => void;
  plan: StudioPublishPackagePlan;
  creditsText?: string;
  onCreditsTextChange?: (value: string) => void;
  /** Downloads the privacy-safe public projection. It can be useful even when validation fails. */
  onDownloadManifest?: (manifest: StudioPublishPackageManifest) => void;
  /** Starts the caller's local render/package pipeline. This panel never uploads to a platform. */
  onBeginExport?: (plan: StudioPublishPackagePlan) => void;
  exportBusy?: boolean;
  exportProgress?: { done: number; total: number } | null;
  exportStatus?: { tone: "info" | "good" | "bad"; text: string } | null;
}

type PanelTab = "settings" | "validation" | "artifacts";
type OutputFormat = Exclude<StudioPublishPackageFormat, "gif">;

interface TabMeta {
  label: string;
  description: string;
}

const TABS: readonly PanelTab[] = ["settings", "validation", "artifacts"];

const TAB_META: Record<PanelTab, TabMeta> = {
  settings: { label: "패키지 설정", description: "목적지, 파일 형식과 고지 범위" },
  validation: { label: "검증 결과", description: "차단 오류와 사람이 확인할 항목" },
  artifacts: { label: "파일 계획", description: "렌더·보조 파일과 공개 manifest" },
};

const DESTINATION_LABELS: Record<StudioPublishPackageDestination, string> = {
  generic: "범용 이미지 패키지",
  webtoon: "WEBTOON CANVAS",
  tapas: "Tapas",
};

const FORMAT_LABELS: Record<OutputFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
};

const FORMAT_MIME: Record<OutputFormat, StudioPublishPackageImageMimeType> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const THUMBNAIL_LABELS: Record<StudioPublishThumbnailSlot, string> = {
  episode: "회차 썸네일",
  "series-square": "시리즈 정방형",
  "series-vertical": "시리즈 세로형",
  "series-cover": "시리즈 커버",
  "series-banner": "시리즈 배너",
};

const AI_USAGE_META: Record<StudioPublishPackageAiUsage, { label: string; description: string }> = {
  none: {
    label: "사용 안 함",
    description: "게시물 제작에 AI 보조·생성 결과를 사용하지 않았습니다.",
  },
  assisted: {
    label: "AI 보조",
    description: "기획·교정·참고 등 일부 과정에 사용하고 사람이 최종 결정했습니다.",
  },
  generated: {
    label: "AI 생성 포함",
    description: "게시 이미지나 텍스트에 생성 결과가 직접 포함됩니다.",
  },
};

const ARTIFACT_ROLE_LABELS: Record<StudioPublishArtifactRole, string> = {
  "episode-image": "회차 이미지",
  thumbnail: "썸네일",
  "review-pdf": "검수 PDF",
  credits: "출처·라이선스",
  "ai-disclosure": "AI 사용 고지",
  "validation-report": "검증 보고서",
  manifest: "공개 manifest",
};

const ARTIFACT_STATE_META: Record<
  StudioPublishArtifactState,
  { label: string; className: string }
> = {
  ready: {
    label: "메타데이터 확인",
    className: "border-good/35 bg-good/10 text-good",
  },
  "metadata-incomplete": {
    label: "메타데이터 미완료",
    className: "border-warn/35 bg-warn/10 text-warn",
  },
  "needs-source": {
    label: "원본 필요",
    className: "border-warn/35 bg-warn/10 text-warn",
  },
  planned: {
    label: "내보낼 때 생성",
    className: "border-cool/35 bg-cool/10 text-cool",
  },
};

const FIELD_CLASS =
  "min-h-11 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-55";
const BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";
const PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-4 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-fg-3";
const ICON_BUTTON_CLASS =
  "grid size-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:border-line-strong hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const VISIBLE_ISSUE_LIMIT = 200;
const VISIBLE_ARTIFACT_LIMIT = 250;

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.offsetParent !== null
  );
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return "용량 미확인";
  if (value < 1_000) return `${value.toLocaleString("ko-KR")} B`;
  if (value < 1_000_000) return `${(value / 1_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} KB`;
  if (value < 1_000_000_000) {
    return `${(value / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} MB`;
  }
  return `${(value / 1_000_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 })} GB`;
}

function formatDimension(width: number | undefined, height: number | undefined): string {
  return width !== undefined && height !== undefined
    ? `${width.toLocaleString("ko-KR")} × ${height.toLocaleString("ko-KR")}px`
    : "크기 미확인";
}

function formatPolicyDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value.replaceAll("-", ".") : value;
}

function policyLinkLabel(url: string, index: number): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./u, "");
    return `${host} 공식 문서 ${index + 1}`;
  } catch {
    return `공식 정책 문서 ${index + 1}`;
  }
}

function artifactIcon(role: StudioPublishArtifactRole): ReactNode {
  switch (role) {
    case "episode-image":
    case "thumbnail":
      return <FileImage size={16} aria-hidden />;
    case "review-pdf":
    case "credits":
      return <FileText size={16} aria-hidden />;
    case "ai-disclosure":
    case "validation-report":
    case "manifest":
      return <FileJson2 size={16} aria-hidden />;
  }
}

function StatusBadge({ state }: { state: StudioPublishArtifactState }) {
  const meta = ARTIFACT_STATE_META[state];
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2 text-[0.65rem] font-semibold ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

function SettingToggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-raised/45 ${
        disabled ? "cursor-not-allowed opacity-55" : ""
      }`}
    >
      <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer size-6 appearance-none rounded-md border border-line-strong bg-card outline-none transition-colors checked:border-accent checked:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <Check
          size={15}
          strokeWidth={3}
          aria-hidden
          className="pointer-events-none absolute text-on-accent opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-fg">{label}</span>
        <span className="mt-0.5 block max-w-[70ch] text-[0.7rem] leading-relaxed text-fg-3">
          {description}
        </span>
      </span>
    </label>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <dt className="text-[0.68rem] text-fg-3">{label}</dt>
      <dd className="mt-1 text-sm font-bold tabular-nums text-fg">{value}</dd>
      {detail && <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">{detail}</p>}
    </div>
  );
}

function IssueLedger({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: readonly StudioPublishPackageIssue[];
  tone: "error" | "warning";
}) {
  const isError = tone === "error";
  const Icon = isError ? XCircle : AlertTriangle;
  return (
    <section aria-labelledby={`publish-package-${tone}-title`}>
      <div className="flex items-center justify-between gap-3">
        <h3
          id={`publish-package-${tone}-title`}
          className="flex items-center gap-2 text-sm font-bold text-fg"
        >
          <Icon size={16} className={isError ? "text-bad" : "text-warn"} aria-hidden />
          {title}
        </h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-bold tabular-nums ${
            isError
              ? "border-bad/35 bg-bad/10 text-bad"
              : "border-warn/35 bg-warn/10 text-warn"
          }`}
        >
          {issues.length.toLocaleString("ko-KR")}
        </span>
      </div>
      {issues.length === 0 ? (
        <div className="mt-3 flex min-h-20 items-center gap-3 rounded-xl border border-dashed border-line px-4 text-xs text-fg-3">
          <CheckCircle2 size={17} className="shrink-0 text-good" aria-hidden />
          {isError ? "내보내기를 막는 오류가 없습니다." : "추가로 확인할 경고가 없습니다."}
        </div>
      ) : (
        <>
          <ol className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25">
            {issues.slice(0, VISIBLE_ISSUE_LIMIT).map((issue, index) => (
              <li key={`${issue.code}:${issue.path ?? "root"}:${index}`} className="px-3 py-3 sm:px-4">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
                      isError ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn"
                    }`}
                  >
                    <Icon size={14} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-relaxed text-fg">{issue.message}</p>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[0.62rem] text-fg-3">
                      <span>{issue.code}</span>
                      {issue.path && <span className="break-all">{issue.path}</span>}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {issues.length > VISIBLE_ISSUE_LIMIT && (
            <p className="mt-2 text-right text-[0.65rem] text-fg-3">
              화면 성능을 위해 처음 {VISIBLE_ISSUE_LIMIT.toLocaleString("ko-KR")}건만 표시합니다. 화면에서 생략한 항목도 현재 검증 계획 데이터에는 유지됩니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ArtifactRow({ artifact }: { artifact: StudioPublishArtifactPlan }) {
  return (
    <li className="px-3 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised text-fg-2">
          {artifactIcon(artifact.role)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 break-all text-xs font-semibold text-fg">{artifact.fileName}</p>
            <StatusBadge state={artifact.state} />
          </div>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
            {ARTIFACT_ROLE_LABELS[artifact.role]}
            {artifact.slot ? ` · ${THUMBNAIL_LABELS[artifact.slot]}` : ""}
            {artifact.mimeType ? ` · ${artifact.mimeType}` : ""}
          </p>
          <p className="mt-0.5 text-[0.68rem] tabular-nums text-fg-2">
            {formatDimension(artifact.width, artifact.height)} · {formatBytes(artifact.byteSize)}
            {artifact.sha256 ? " · SHA-256 포함" : ""}
          </p>
        </div>
      </div>
    </li>
  );
}

export function StudioPublishPackagePanel({
  open,
  onClose,
  settings,
  onSettingsChange,
  plan,
  creditsText = "",
  onCreditsTextChange,
  onDownloadManifest,
  onBeginExport,
  exportBusy = false,
  exportProgress = null,
  exportStatus = null,
}: StudioPublishPackagePanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("settings");
  const disclosureId = useId();
  const creditsId = useId();
  const destinationId = useId();
  const reviewPdfProfileId = useId();
  const aiUsageIdPrefix = useId();
  const preset = plan.preset;
  const supportedFormats = (Object.keys(FORMAT_LABELS) as OutputFormat[]).filter((format) =>
    preset.episode.allowedMimeTypes.includes(FORMAT_MIME[format])
  );
  const thumbnailArtifactCount = plan.artifacts.filter(
    (artifact) => artifact.role === "thumbnail"
  ).length;
  const resampleCount = plan.issues.filter(
    (issue) => issue.code === "CANVAS_RESAMPLE_REQUIRED"
  ).length;
  const hasCanvasMetadataMissing = plan.issues.some(
    (issue) => issue.code === "CANVAS_METADATA_MISSING"
  );
  const hasCanvasError = plan.errors.some((issue) => issue.code.startsWith("CANVAS_"));
  const artifactStateCounts = plan.artifacts.reduce<Record<StudioPublishArtifactState, number>>(
    (counts, artifact) => ({ ...counts, [artifact.state]: counts[artifact.state] + 1 }),
    { ready: 0, "metadata-incomplete": 0, "needs-source": 0, planned: 0 }
  );
  const selectedThumbnailSlots = new Set(settings.requestedThumbnailSlots);
  const activeTabIndex = TABS.indexOf(activeTab);

  useEffect(() => {
    if (!open || typeof globalThis.document === "undefined") return;
    const body = globalThis.document.body;
    const previousOverflow = body.style.overflow;
    const previousFocus = globalThis.document.activeElement as HTMLElement | null;
    body.style.overflow = "hidden";
    const frame = globalThis.requestAnimationFrame(() => dialogRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof globalThis.document === "undefined") return null;

  const emitSettings = (next: StudioPublishPackageSettings) => {
    onSettingsChange(normalizeStudioPublishPackageSettings(next));
  };

  const updateSettings = (patch: Partial<StudioPublishPackageSettings>) => {
    emitSettings({ ...settings, ...patch });
  };

  const changeDestination = (destination: StudioPublishPackageDestination) => {
    const nextPreset = getStudioPublishPlatformPreset(destination);
    const nextSlots = new Set(
      settings.requestedThumbnailSlots.filter((slot) =>
        nextPreset.thumbnails.some((thumbnail) => thumbnail.slot === slot)
      )
    );
    for (const thumbnail of nextPreset.thumbnails) {
      if (thumbnail.required) nextSlots.add(thumbnail.slot);
    }
    const outputFormat = nextPreset.episode.allowedMimeTypes.includes(
      FORMAT_MIME[settings.outputFormat]
    )
      ? settings.outputFormat
      : "png";
    emitSettings({
      ...settings,
      destination,
      outputFormat,
      requestedThumbnailSlots: STUDIO_PUBLISH_THUMBNAIL_SLOTS.filter((slot) => nextSlots.has(slot)),
      policyReviewConfirmed: false,
      thumbnailSafetyConfirmed: false,
    });
  };

  const toggleThumbnail = (slot: StudioPublishThumbnailSlot, selected: boolean) => {
    const next = new Set(settings.requestedThumbnailSlots);
    if (selected) next.add(slot);
    else next.delete(slot);
    updateSettings({
      requestedThumbnailSlots: STUDIO_PUBLISH_THUMBNAIL_SLOTS.filter((candidate) =>
        next.has(candidate)
      ),
      thumbnailSafetyConfirmed: false,
    });
  };

  const selectTab = (tab: PanelTab) => setActiveTab(tab);

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (activeTabIndex + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (activeTabIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    const tab = TABS[nextIndex];
    if (!tab) return;
    selectTab(tab);
    globalThis.document.getElementById(`publish-package-tab-${tab}`)?.focus();
  };

  const sourceCanvasStatus = hasCanvasError
    ? "오류 확인 필요"
    : hasCanvasMetadataMissing
      ? "메타데이터 없음"
      : "메타데이터 확인";
  const targetWidth = preset.episode.targetWidth
    ? `${preset.episode.targetWidth.toLocaleString("ko-KR")}px 폭`
    : "원본 폭 유지";
  const maxHeight =
    preset.episode.maxHeightByMimeType?.[FORMAT_MIME[settings.outputFormat]] ??
    preset.episode.maxHeight;

  const modal = (
    <div className="fixed inset-0 z-[90] h-[100dvh] bg-[oklch(0.08_0.01_70/0.9)] text-fg sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-publish-package-title"
        aria-describedby="studio-publish-package-description"
        tabIndex={-1}
        className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden border-line bg-panel shadow-2xl outline-none sm:rounded-2xl sm:border"
      >
        <header
          className="shrink-0 border-b border-line bg-panel px-3 pb-3 sm:px-5"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <PackageCheck size={19} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="studio-publish-package-title" className="text-base font-bold tracking-tight text-fg">
                  Publish Package
                </h2>
                <span
                  className={`inline-flex min-h-6 items-center rounded-full border px-2 text-[0.65rem] font-bold ${
                    plan.canExport
                      ? "border-good/35 bg-good/10 text-good"
                      : "border-bad/35 bg-bad/10 text-bad"
                  }`}
                >
                  {plan.canExport ? "내보내기 가능" : `오류 ${plan.errors.length}`}
                </span>
              </div>
              <p
                id="studio-publish-package-description"
                className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-fg-3"
              >
                게시처 규격에 맞춘 로컬 파일 묶음을 계획합니다. 플랫폼 계정에 로그인하거나 직접 업로드하지 않습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Publish Package 닫기"
              className={ICON_BUTTON_CLASS}
            >
              <X size={17} aria-hidden />
            </button>
          </div>

          <div
            role="status"
            aria-live="polite"
            className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[0.7rem] leading-relaxed ${
              plan.canExport
                ? "border-good/30 bg-good/10 text-good"
                : "border-bad/30 bg-bad/10 text-bad"
            }`}
          >
            {plan.canExport ? (
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />
            ) : (
              <CircleAlert size={15} className="mt-0.5 shrink-0" aria-hidden />
            )}
            <span>
              {plan.canExport
                ? `차단 오류 없음 · 경고 ${plan.warnings.length.toLocaleString("ko-KR")}건은 내보내기 전에 확인하세요.`
                : `차단 오류 ${plan.errors.length.toLocaleString("ko-KR")}건을 해결해야 실제 파일 생성을 시작할 수 있습니다.`}
            </span>
          </div>
        </header>

        <nav
          aria-label="Publish Package 단계"
          className="grid shrink-0 grid-cols-3 border-b border-line bg-card/35"
        >
          {TABS.map((tab) => {
            const meta = TAB_META[tab];
            const active = activeTab === tab;
            const count =
              tab === "validation"
                ? plan.issues.length
                : tab === "artifacts"
                  ? plan.artifacts.length
                  : undefined;
            return (
              <button
                key={tab}
                id={`publish-package-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`publish-package-panel-${tab}`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(tab)}
                onKeyDown={onTabKeyDown}
                className={`relative min-h-12 min-w-0 px-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:px-4 ${
                  active ? "bg-raised/70 text-fg" : "text-fg-3 hover:bg-raised/35 hover:text-fg-2"
                }`}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span className="truncate">{meta.label}</span>
                  {count !== undefined && (
                    <span className="rounded-full bg-card px-1.5 py-0.5 text-[0.62rem] tabular-nums text-fg-2">
                      {count}
                    </span>
                  )}
                </span>
                {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />}
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {activeTab === "settings" && (
            <div
              id="publish-package-panel-settings"
              role="tabpanel"
              aria-labelledby="publish-package-tab-settings"
              className="mx-auto max-w-4xl px-3 py-4 sm:px-5 sm:py-5"
            >
              <div className="flex items-start gap-3 rounded-xl border border-cool/30 bg-cool/10 px-3 py-3 text-xs leading-relaxed text-cool sm:px-4">
                <ShieldCheck size={17} className="mt-0.5 shrink-0" aria-hidden />
                <p>
                  <strong className="font-bold">정책 기준일 {formatPolicyDate(STUDIO_PUBLISH_PACKAGE_POLICY_SNAPSHOT)}</strong>
                  <span className="text-fg-2"> · 아래 규격은 고정된 벤치마크이며 게시처 정책이 바뀔 수 있습니다. 업로드 직전에 공식 원문을 다시 확인하세요.</span>
                </p>
              </div>

              <section aria-labelledby="publish-destination-title" className="mt-5">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="publish-destination-title" className="text-sm font-bold text-fg">
                      목적지와 이미지 형식
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-3">파일 규격 검증과 이름 규칙에만 사용합니다.</p>
                  </div>
                  <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.65rem] text-fg-3">
                    {preset.revision}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label htmlFor={destinationId} className="text-xs font-semibold text-fg-2">
                    게시 목적지
                    <select
                      id={destinationId}
                      value={settings.destination}
                      onChange={(event) =>
                        changeDestination(event.target.value as StudioPublishPackageDestination)
                      }
                      className={`${FIELD_CLASS} mt-1.5`}
                    >
                      {(Object.keys(DESTINATION_LABELS) as StudioPublishPackageDestination[]).map(
                        (destination) => (
                          <option key={destination} value={destination}>
                            {DESTINATION_LABELS[destination]}
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  <fieldset>
                    <legend className="text-xs font-semibold text-fg-2">회차 이미지 형식</legend>
                    <div className="mt-1.5 grid min-h-11 grid-cols-3 overflow-hidden rounded-lg border border-line bg-card">
                      {(Object.keys(FORMAT_LABELS) as OutputFormat[]).map((format) => {
                        const supported = supportedFormats.includes(format);
                        const active = settings.outputFormat === format;
                        return (
                          <button
                            key={format}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            disabled={!supported}
                            onClick={() => updateSettings({ outputFormat: format })}
                            className={`min-h-11 border-r border-line px-2 text-xs font-semibold transition-colors last:border-r-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-fg-3/45 ${
                              active ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-raised hover:text-fg"
                            }`}
                          >
                            {FORMAT_LABELS[format]}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                </div>
                <p className="mt-2 text-[0.68rem] leading-relaxed text-fg-3">{preset.note}</p>
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="publish-thumbnail-title">
                <div>
                  <h3 id="publish-thumbnail-title" className="text-sm font-bold text-fg">
                    썸네일 산출물
                  </h3>
                  <p className="mt-0.5 text-xs text-fg-3">
                    필수 규격은 해제할 수 없으며, 선택한 슬롯은 원본이 없으면 파일 계획에 ‘원본 필요’로 표시됩니다.
                  </p>
                </div>
                {preset.thumbnails.length === 0 ? (
                  <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-5 text-xs text-fg-3">
                    이 목적지에는 별도 썸네일 규격이 없습니다.
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25">
                    {preset.thumbnails.map((thumbnail) => {
                      const selected = thumbnail.required || selectedThumbnailSlots.has(thumbnail.slot);
                      return (
                        <SettingToggle
                          key={thumbnail.slot}
                          checked={selected}
                          disabled={thumbnail.required}
                          onChange={(checked) => toggleThumbnail(thumbnail.slot, checked)}
                          label={`${thumbnail.label}${thumbnail.required ? " · 필수" : ""}`}
                          description={`${thumbnail.width.toLocaleString("ko-KR")} × ${thumbnail.height.toLocaleString("ko-KR")}px · ${thumbnail.allowedMimeTypes.join(", ")}${
                            thumbnail.maxBytesExclusive
                              ? ` · ${formatBytes(thumbnail.maxBytesExclusive)} 미만`
                              : ""
                          }`}
                        />
                      );
                    })}
                  </div>
                )}
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="publish-extras-title">
                <h3 id="publish-extras-title" className="text-sm font-bold text-fg">
                  검수·출처 파일
                </h3>
                <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25">
                  <SettingToggle
                    checked={settings.includeReviewPdf}
                    onChange={(includeReviewPdf) => updateSettings({ includeReviewPdf })}
                    label="내부 검수 PDF 포함"
                    description="공개 게시 이미지와 분리된 내부 회람용 review.pdf를 패키지에 계획합니다."
                  />
                  {settings.includeReviewPdf ? (
                    <div className="px-3 py-3">
                      <label htmlFor={reviewPdfProfileId} className="block text-xs font-semibold text-fg-2">
                        검수 PDF 구성
                        <select
                          id={reviewPdfProfileId}
                          value={settings.reviewPdfProfile}
                          onChange={(event) =>
                            updateSettings({
                              reviewPdfProfile: event.currentTarget.value as StudioReviewPdfProfileId,
                            })
                          }
                          className={`${FIELD_CLASS} mt-1.5`}
                        >
                          {STUDIO_REVIEW_PDF_PROFILE_IDS.map((profileId) => (
                            <option key={profileId} value={profileId}>
                              {STUDIO_REVIEW_PDF_PROFILES[profileId].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="mt-1.5 text-[0.7rem] leading-relaxed text-fg-3">
                        {STUDIO_REVIEW_PDF_PROFILES[settings.reviewPdfProfile].description}
                      </p>
                      <p className="mt-2 flex min-h-11 items-center gap-2 rounded-lg border border-warn/35 bg-warn/10 px-3 text-[0.68rem] leading-relaxed text-warn">
                        <ShieldCheck size={15} className="shrink-0" aria-hidden />
                        내부 전용: 담당자·검토 메모·갱신 시각은 선택한 review.pdf에만 그리며 공개 manifest에는 기록하지 않습니다.
                      </p>
                    </div>
                  ) : null}
                  <SettingToggle
                    checked={settings.includeCredits}
                    onChange={(includeCredits) => updateSettings({ includeCredits })}
                    label="출처·라이선스 파일 포함"
                    description="소재 출처와 라이선스를 credits.txt로 함께 전달합니다. 내용이 비어 있으면 경고합니다."
                  />
                </div>
                {settings.includeCredits && onCreditsTextChange ? (
                  <label htmlFor={creditsId} className="mt-3 block text-xs font-semibold text-fg-2">
                    출처·라이선스 내용
                    <textarea
                      id={creditsId}
                      value={creditsText}
                      onChange={(event) =>
                        onCreditsTextChange(
                          event.currentTarget.value.slice(0, STUDIO_PUBLISH_PACKAGE_LIMITS.maxCreditsCodeUnits)
                        )
                      }
                      maxLength={STUDIO_PUBLISH_PACKAGE_LIMITS.maxCreditsCodeUnits}
                      rows={5}
                      placeholder={"예: 배경 사진 — 작가명 / 원문 URL / 라이선스\n폰트 — 이름 / 라이선스 / 배포처"}
                      className={`${FIELD_CLASS} mt-1.5 min-h-32 resize-y font-mono text-[0.72rem] leading-relaxed`}
                    />
                    <span className="mt-1 flex justify-between gap-3 text-[0.65rem] font-normal text-fg-3">
                      <span>캔버스에 삽입한 Unsplash 출처는 자동 제안되며 직접 보완할 수 있습니다.</span>
                      <span className="shrink-0 tabular-nums">
                        {creditsText.length.toLocaleString("ko-KR")}/{STUDIO_PUBLISH_PACKAGE_LIMITS.maxCreditsCodeUnits.toLocaleString("ko-KR")}
                      </span>
                    </span>
                  </label>
                ) : null}
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="publish-ai-title">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cool/10 text-cool">
                    <Sparkles size={17} aria-hidden />
                  </span>
                  <div>
                    <h3 id="publish-ai-title" className="text-sm font-bold text-fg">AI 사용 공개</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
                      사용 여부는 자동 추정하지 않습니다. 창작자가 실제 제작 과정을 기준으로 직접 선택합니다.
                    </p>
                  </div>
                </div>
                <fieldset className="mt-3">
                  <legend className="sr-only">AI 사용 범위</legend>
                  <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25">
                    {(["none", "assisted", "generated"] as const).map((usage) => {
                      const meta = AI_USAGE_META[usage];
                      return (
                        <label
                          key={usage}
                          htmlFor={`${aiUsageIdPrefix}-${usage}`}
                          aria-label={meta.label}
                          className="flex min-h-14 cursor-pointer items-start gap-3 px-3 py-3 transition-colors hover:bg-raised/45"
                        >
                          <input
                            id={`${aiUsageIdPrefix}-${usage}`}
                            type="radio"
                            name="publish-package-ai-usage"
                            value={usage}
                            checked={settings.aiUsage === usage}
                            onChange={() => updateSettings({ aiUsage: usage })}
                            className="mt-0.5 size-5 shrink-0 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          />
                          <span>
                            <span className="block text-xs font-semibold text-fg">{meta.label}</span>
                            <span className="mt-0.5 block text-[0.7rem] leading-relaxed text-fg-3">
                              {meta.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {settings.aiUsage !== "none" && (
                  <label htmlFor={disclosureId} className="mt-3 block text-xs font-semibold text-fg-2">
                    공개 고지 문구 <span className="text-bad">필수</span>
                    <textarea
                      id={disclosureId}
                      value={settings.aiDisclosure}
                      onChange={(event) => updateSettings({ aiDisclosure: event.target.value })}
                      maxLength={STUDIO_PUBLISH_PACKAGE_LIMITS.maxDisclosureCodeUnits}
                      rows={4}
                      placeholder="예: 배경 아이디어 탐색에 AI를 보조적으로 사용했으며, 최종 구성과 작화는 작가가 직접 완성했습니다."
                      className={`${FIELD_CLASS} mt-1.5 min-h-28 resize-y leading-relaxed`}
                      aria-invalid={plan.errors.some((issue) => issue.code === "AI_DISCLOSURE_REQUIRED")}
                    />
                    <span className="mt-1 flex justify-between gap-3 text-[0.65rem] font-normal text-fg-3">
                      <span>독자가 이해할 수 있게 사용 범위와 최종 결정 주체를 적으세요.</span>
                      <span className="shrink-0 tabular-nums">
                        {settings.aiDisclosure.length}/{STUDIO_PUBLISH_PACKAGE_LIMITS.maxDisclosureCodeUnits}
                      </span>
                    </span>
                  </label>
                )}

                {preset.aiPolicy === "generated-prohibited" && settings.aiUsage === "generated" && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-bad/35 bg-bad/10 px-3 py-2 text-[0.7rem] leading-relaxed text-bad">
                    <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
                    현재 벤치마크한 {preset.label} 정책에서는 AI 생성 콘텐츠 게시가 금지됩니다. 공식 원문을 직접 확인하세요.
                  </div>
                )}
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="publish-policy-title">
                <h3 id="publish-policy-title" className="text-sm font-bold text-fg">사람이 확인할 정책</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
                  ToonSpectrum은 제3자 정책의 최신성이나 최종 게시 승인을 대신 보증하지 않습니다.
                </p>
                <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25">
                  {preset.requiresCurrentPolicyReview && (
                    <SettingToggle
                      checked={settings.policyReviewConfirmed}
                      onChange={(policyReviewConfirmed) => updateSettings({ policyReviewConfirmed })}
                      label={`${preset.label} 최신 정책을 직접 확인했습니다`}
                      description={`기준 스냅샷 ${formatPolicyDate(preset.policySnapshotDate)} 이후 변경 여부와 계정별 조건을 공식 원문에서 검토했습니다.`}
                    />
                  )}
                  {thumbnailArtifactCount > 0 && (
                    <SettingToggle
                      checked={settings.thumbnailSafetyConfirmed}
                      onChange={(thumbnailSafetyConfirmed) => updateSettings({ thumbnailSafetyConfirmed })}
                      label="썸네일 안전 영역과 공개 적합성을 확인했습니다"
                      description="전 연령 노출 적합성, 글자 잘림, 얼굴·로고 크롭과 작은 화면 가독성을 사람이 직접 확인했습니다."
                    />
                  )}
                  {!preset.requiresCurrentPolicyReview && thumbnailArtifactCount === 0 && (
                    <p className="px-3 py-4 text-xs text-fg-3">이 범용 프로필에는 필수 정책 확인 항목이 없습니다.</p>
                  )}
                </div>
                {preset.policySourceUrls.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {preset.policySourceUrls.map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={BUTTON_CLASS}
                      >
                        <ExternalLink size={14} aria-hidden />
                        {policyLinkLabel(url, index)}
                      </a>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === "validation" && (
            <div
              id="publish-package-panel-validation"
              role="tabpanel"
              aria-labelledby="publish-package-tab-validation"
              className="mx-auto max-w-4xl space-y-6 px-3 py-4 sm:px-5 sm:py-5"
            >
              <section aria-labelledby="publish-validation-summary-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="publish-validation-summary-title" className="text-sm font-bold text-fg">
                      검증 요약
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-3">
                      알려진 메타데이터만 검증합니다. 렌더 후 최종 픽셀 크기와 파일 용량을 다시 검사해야 합니다.
                    </p>
                  </div>
                  <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.65rem] text-fg-3">
                    {preset.label} · {formatPolicyDate(preset.policySnapshotDate)}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25 sm:grid-cols-4">
                  <Metric label="차단 오류" value={`${plan.errors.length}건`} detail="0건이어야 내보내기 가능" />
                  <Metric label="검토 경고" value={`${plan.warnings.length}건`} detail="사람 확인 또는 렌더 후 재검사" />
                  <Metric label="계획 파일" value={`${plan.artifacts.length}개`} detail="이미지와 보조 파일 합계" />
                  <Metric label="알려진 회차 용량" value={formatBytes(plan.manifest.totals.knownEpisodeBytes)} />
                </dl>
              </section>

              <IssueLedger title="내보내기를 막는 오류" issues={plan.errors} tone="error" />
              <IssueLedger title="내보내기 전 확인할 경고" issues={plan.warnings} tone="warning" />

              <div className="flex items-start gap-3 rounded-xl border border-line bg-card/25 px-3 py-3 text-[0.7rem] leading-relaxed text-fg-3 sm:px-4">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-cool" aria-hidden />
                <p>
                  이 검증은 파일 구조 계획이며 플랫폼 심사, 저작권 확인, 콘텐츠 등급 판정 또는 게시 성공을 보장하지 않습니다.
                  실제 업로드는 각 플랫폼의 공식 게시 화면에서 작가가 직접 수행합니다.
                </p>
              </div>
            </div>
          )}

          {activeTab === "artifacts" && (
            <div
              id="publish-package-panel-artifacts"
              role="tabpanel"
              aria-labelledby="publish-package-tab-artifacts"
              className="mx-auto max-w-4xl px-3 py-4 sm:px-5 sm:py-5"
            >
              <section aria-labelledby="publish-render-plan-title">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Layers3 size={17} aria-hidden />
                  </span>
                  <div>
                    <h3 id="publish-render-plan-title" className="text-sm font-bold text-fg">
                      원본 → 리샘플 → 분할 계획
                    </h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
                      이 화면은 현재 계획의 요약입니다. 실제 픽셀 렌더와 분할은 내보내기 콜백이 수행해야 합니다.
                    </p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25 sm:grid-cols-4">
                  <Metric label="원본 캔버스" value={sourceCanvasStatus} detail="현재 계획에서는 검증 상태만 표시" />
                  <Metric
                    label="리샘플"
                    value={resampleCount > 0 ? `${resampleCount}개 경고` : "추가 경고 없음"}
                    detail={targetWidth}
                  />
                  <Metric
                    label="분할 산출물"
                    value={`${plan.manifest.totals.episodeImageCount}장`}
                    detail={maxHeight ? `출력 높이 최대 ${maxHeight.toLocaleString("ko-KR")}px` : "공식 공통 높이 상한 미설정"}
                  />
                  <Metric
                    label="썸네일"
                    value={`${plan.manifest.totals.thumbnailCount}개`}
                    detail={`${settings.requestedThumbnailSlots.length}개 슬롯 요청`}
                  />
                </dl>
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="publish-artifact-title">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="publish-artifact-title" className="text-sm font-bold text-fg">산출물 manifest</h3>
                    <p className="mt-0.5 text-xs text-fg-3">
                      파일명은 경로 문자를 제거한 휴대 가능한 이름으로 계획됩니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[0.62rem] tabular-nums text-fg-3">
                    <span className="rounded-full border border-line bg-card px-2 py-1">확인 {artifactStateCounts.ready}</span>
                    <span className="rounded-full border border-line bg-card px-2 py-1">
                      미완료 {artifactStateCounts["metadata-incomplete"]}
                    </span>
                    <span className="rounded-full border border-line bg-card px-2 py-1">
                      원본 필요 {artifactStateCounts["needs-source"]}
                    </span>
                    <span className="rounded-full border border-line bg-card px-2 py-1">생성 예정 {artifactStateCounts.planned}</span>
                  </div>
                </div>

                {plan.artifacts.length === 0 ? (
                  <div className="mt-3 flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-line px-4 text-center">
                    <FileArchive size={20} className="text-fg-3" aria-hidden />
                    <p className="mt-2 text-xs font-semibold text-fg-2">계획된 파일이 없습니다.</p>
                    <p className="mt-1 text-[0.68rem] text-fg-3">회차 이미지 원본과 설정을 확인하세요.</p>
                  </div>
                ) : (
                  <ol className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25">
                    {plan.artifacts.slice(0, VISIBLE_ARTIFACT_LIMIT).map((artifact, index) => (
                      <ArtifactRow key={`${artifact.role}:${artifact.fileName}:${index}`} artifact={artifact} />
                    ))}
                  </ol>
                )}
                {plan.artifacts.length > VISIBLE_ARTIFACT_LIMIT && (
                  <p className="mt-2 text-right text-[0.65rem] text-fg-3">
                    화면 성능을 위해 처음 {VISIBLE_ARTIFACT_LIMIT.toLocaleString("ko-KR")}개만 표시합니다. 전체 {plan.artifacts.length.toLocaleString("ko-KR")}개 파일은 manifest에 유지됩니다.
                  </p>
                )}
              </section>

              <div className="my-5 border-t border-line" />

              <section aria-labelledby="publish-manifest-privacy-title">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-good/10 text-good">
                    <FileCheck2 size={17} aria-hidden />
                  </span>
                  <div>
                    <h3 id="publish-manifest-privacy-title" className="text-sm font-bold text-fg">
                      공개 manifest 경계
                    </h3>
                    <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-fg-3">
                      다운로드되는 manifest에는 파일 역할·공개 파일명·규격·체크섬·검증 결과만 포함합니다. 내부 source ID,
                      로컬 경로, API 키, 원문 프롬프트와 공급자 요청 ID는 포함하지 않습니다.
                    </p>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-xl border border-line bg-card/25 sm:grid-cols-4">
                  <Metric label="스키마" value={plan.manifest.schema} />
                  <Metric label="버전" value={`v${plan.manifest.version}`} />
                  <Metric label="AI 사용" value={AI_USAGE_META[plan.manifest.ai.usage].label} />
                  <Metric label="검증 상태" value={plan.manifest.validation.canExport ? "통과" : "오류 있음"} />
                </dl>
              </section>
            </div>
          )}
        </div>

        <footer
          className="shrink-0 border-t border-line bg-card/55 px-3 pt-2.5 sm:px-5"
          style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
        >
          {exportStatus ? (
            <p
              role="status"
              aria-live="polite"
              className={`mb-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                exportStatus.tone === "good"
                  ? "border-good/35 bg-good/10 text-good"
                  : exportStatus.tone === "bad"
                    ? "border-bad/35 bg-bad/10 text-bad"
                    : "border-cool/35 bg-cool/10 text-cool"
              }`}
            >
              {exportStatus.text}
              {exportBusy && exportProgress
                ? ` (${exportProgress.done.toLocaleString("ko-KR")}/${exportProgress.total.toLocaleString("ko-KR")})`
                : ""}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex max-w-[55ch] items-start gap-2 text-[0.65rem] leading-relaxed text-fg-3">
              <ImageIcon size={14} className="mt-0.5 shrink-0" aria-hidden />
              로컬 파일 생성 계획만 제공합니다. 외부 플랫폼 전송·예약 게시·계정 연동은 수행하지 않습니다.
            </p>
            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:flex sm:shrink-0">
              {onDownloadManifest && (
                <button
                  type="button"
                  onClick={() => onDownloadManifest(plan.manifest)}
                  className={BUTTON_CLASS}
                >
                  <Download size={15} aria-hidden /> manifest
                </button>
              )}
              {onBeginExport && (
                <button
                  type="button"
                  onClick={() => onBeginExport(plan)}
                  disabled={!plan.canExport || exportBusy}
                  aria-describedby={!plan.canExport ? "publish-package-export-blocked" : undefined}
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {exportBusy ? (
                    <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : (
                    <FileArchive size={15} aria-hidden />
                  )}
                  {exportBusy ? "패키지 생성 중…" : "패키지 내보내기"}
                </button>
              )}
            </div>
          </div>
          {!plan.canExport && onBeginExport && (
            <p id="publish-package-export-blocked" className="mt-1 text-right text-[0.65rem] text-bad">
              차단 오류 {plan.errors.length.toLocaleString("ko-KR")}건을 해결하면 실제 파일 생성을 시작할 수 있습니다.
            </p>
          )}
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, globalThis.document.body);
}
