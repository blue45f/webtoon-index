// 현지화 QA 리포트 — 대사 번역 패널 안에서 열리는 회차 단위 품질 보고서.
//
// 계산은 하나도 하지 않는다. `studio-localization-qa.runStudioLocalizationQa()`가 낸
// StudioLocalizationQaReport 를 받아 MQM 차원별로 그리기만 한다 — 점수 산술이 화면 안으로
// 새면 그 순간 "패널이 보여 주는 점수"와 "엔진이 내는 점수"가 갈라진다.
//
// 접근성 규약: 심각도는 색만으로 구분하지 않는다. 모든 칩이 한글 라벨(치명/중대/경미/참고)을
// 글자로 갖고 있고, 색 토큰(good/warn/bad/accent)은 그 라벨을 보조할 뿐이다.
import { AlertTriangle, ArrowRight, CheckCircle2, Info, ShieldAlert } from "lucide-react";

import { STUDIO_FOCUS_RING, STUDIO_TOUCH_TARGET, StudioEmptyState } from "./studio-panel-ui";

import type {
  StudioMqmError,
  StudioMqmSeverity,
} from "./lettering/studio-localization-mqm";
import type {
  StudioLocalizationQaReport as QaReport,
  StudioLocalizationQaCue,
} from "./lettering/studio-localization-qa";

import { cn } from "@/shared/lib/utils";

/** 심각도 → 한글 라벨 + 토큰 클래스. 라벨이 먼저고 색은 보조다. */
const SEVERITY_META: Readonly<
  Record<StudioMqmSeverity, { label: string; chip: string }>
> = {
  critical: { label: "치명", chip: "border-bad/35 bg-bad/10 text-bad" },
  major: { label: "중대", chip: "border-bad/35 bg-bad/10 text-bad" },
  minor: { label: "경미", chip: "border-warn/35 bg-warn/10 text-warn" },
  neutral: { label: "참고", chip: "border-line bg-card text-fg-3" },
};

const VERDICT_META = {
  pass: { label: "통과", chip: "border-good/35 bg-good/10 text-good", icon: CheckCircle2 },
  fail: { label: "미달", chip: "border-bad/35 bg-bad/10 text-bad", icon: ShieldAlert },
  unscorable: { label: "채점 불가", chip: "border-warn/35 bg-warn/10 text-warn", icon: Info },
} as const;

const FAIL_REASON_LABEL: Readonly<Record<string, string>> = {
  "critical-error": "치명 오류가 있으면 점수와 무관하게 미달입니다.",
  "below-threshold": "품질 점수가 합격선에 못 미칩니다.",
  "empty-denominator": "검사할 대사가 없어 점수를 낼 수 없습니다.",
};

function severityChip(severity: StudioMqmSeverity) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[0.58rem] font-bold leading-none",
        meta.chip
      )}
    >
      {meta.label}
    </span>
  );
}

export type StudioLocalizationQaDimensionSection = {
  readonly dimension: string;
  readonly label: string;
  readonly penalty: number;
  readonly errorCount: number;
  readonly errors: readonly StudioMqmError[];
};

export function StudioLocalizationQaReport({
  report,
  sections,
  cueIndex,
  stale,
  onRerun,
  onSelectCue,
  jumpLabel,
}: {
  report: QaReport;
  sections: readonly StudioLocalizationQaDimensionSection[];
  cueIndex: ReadonlyMap<string, StudioLocalizationQaCue>;
  /** 검사 이후 대사가 바뀌었는가 — 낡은 점수를 그대로 믿게 두지 않는다. */
  stale: boolean;
  onRerun: () => void;
  /** 발견에서 대사로 되짚기. 없으면 이동 버튼을 그리지 않는다. */
  onSelectCue?: (cueId: string) => void;
  jumpLabel: string;
}) {
  const { score } = report;
  const verdict = VERDICT_META[score.verdict];
  const VerdictIcon = verdict.icon;

  return (
    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
      {/* ── 점수 요약 ── */}
      <div className="rounded-xl border border-line bg-card/45 p-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="flex items-baseline gap-1.5">
            <span className="text-lg font-black tabular-nums tracking-tight text-fg">
              {score.qualityScore === null ? "—" : score.qualityScore}
            </span>
            <span className="text-[0.62rem] font-medium text-fg-4">
              / 100 · 합격선 {score.passThreshold}
            </span>
          </p>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-bold",
              verdict.chip
            )}
          >
            <VerdictIcon size={11} aria-hidden />
            {verdict.label}
          </span>
        </div>
        {score.failReason && (
          <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">
            {FAIL_REASON_LABEL[score.failReason] ?? score.failReason}
          </p>
        )}
        <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[0.62rem] text-fg-3">
          <div className="flex justify-between gap-1">
            <dt>검사한 대사</dt>
            <dd className="tabular-nums text-fg-2">{report.checkedCueCount}개</dd>
          </div>
          <div className="flex justify-between gap-1">
            <dt>넘침 판정</dt>
            <dd className="tabular-nums text-fg-2">{report.overflowCheckedCount}개</dd>
          </div>
          <div className="flex justify-between gap-1">
            <dt>사람 검토 필요</dt>
            <dd className="tabular-nums text-fg-2">{report.overflow.humanReviewCount}개</dd>
          </div>
          <div className="flex justify-between gap-1">
            <dt>실행한 문체 규칙</dt>
            <dd className="tabular-nums text-fg-2">{report.style.checkedRuleCount}개</dd>
          </div>
          <div className="flex justify-between gap-1">
            <dt>대비 판정</dt>
            <dd className="tabular-nums text-fg-2">{report.legibilityCheckedCueCount}개</dd>
          </div>
          <div className="flex justify-between gap-1">
            <dt>대비 미달</dt>
            <dd className="tabular-nums text-fg-2">{report.legibilityFailCueCount}개</dd>
          </div>
        </dl>
        {/*
          대비는 번역 품질이 아니라 읽힘의 문제라 위 점수에 들어가지 않는다. 그래서 미달이 있으면
          점수와 별개로 여기서 말해 준다 — 점수만 보고 "통과"로 읽지 않도록.
        */}
        {report.legibilityFailCueCount > 0 && (
          <p className="mt-1.5 rounded-lg border border-warn/35 bg-warn/10 px-1.5 py-1 text-[0.58rem] leading-relaxed text-warn">
            대사 {report.legibilityFailCueCount}개가 말풍선 바탕과의 명도 대비(WCAG)를 밑돕니다.
            글자색이나 말풍선 색을 조정하세요. 이 항목은 위 번역 품질 점수에는 포함되지 않습니다.
          </p>
        )}
        {report.legibilityCheckedCueCount === 0 && report.checkedCueCount > 0 && (
          <p className="mt-1.5 text-[0.58rem] leading-relaxed text-fg-4">
            명도 대비를 판정한 대사가 없습니다(반투명·그라데이션 채우기이거나 색을 읽지
            못했습니다). 대비 미달 0개를 "통과"로 읽지 마세요.
          </p>
        )}
        {/* 점수의 한계를 화면이 직접 말한다 — 임계값 99는 단어 분모로만 교정돼 있다. */}
        {!score.denominator.thresholdCalibrated && (
          <p className="mt-1.5 rounded-lg border border-line bg-panel px-1.5 py-1 text-[0.58rem] leading-relaxed text-fg-4">
            분모가 글자 수({score.denominator.count}자)입니다. 합격선 {score.passThreshold}은
            단어 분모 기준으로만 교정된 값이라, 여기서는 상대 비교용으로만 읽으세요.
          </p>
        )}
        {report.style.skippedUnitCount > 0 && (
          <p className="mt-1.5 text-[0.58rem] leading-relaxed text-fg-4">
            문체 규칙표는 영문 대사 전용입니다 — {report.style.skippedUnitCount}개 대사는 문체
            검사를 건너뛰었어요(넘침은 그대로 검사했습니다).
          </p>
        )}
      </div>

      {stale && (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-lg border border-warn/35 bg-warn/10 px-2 py-1.5 text-[0.62rem] leading-relaxed text-warn"
        >
          <AlertTriangle size={11} aria-hidden className="shrink-0" />
          검사 뒤 대사가 바뀌었어요. 다시 검사해 주세요.
        </p>
      )}

      <button
        type="button"
        onClick={onRerun}
        className={cn(
          "flex w-full items-center justify-center gap-1 rounded-lg border border-line bg-card py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised",
          STUDIO_FOCUS_RING,
          STUDIO_TOUCH_TARGET
        )}
      >
        다시 검사
      </button>

      {/* ── 차원별 발견 ── */}
      {sections.length === 0 ? (
        <StudioEmptyState
          icon={<CheckCircle2 size={20} aria-hidden />}
          title="지적할 곳이 없어요"
          description={`${report.checkedCueCount}개 대사에서 문체·넘침 문제를 찾지 못했습니다.`}
        />
      ) : (
        <div className="space-y-2.5">
          {sections.map((section) => (
            <section key={section.dimension} aria-label={`${section.label} 발견`}>
              <p className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-[0.66rem] font-bold text-fg">{section.label}</span>
                <span className="text-[0.58rem] tabular-nums text-fg-4">
                  {section.errorCount}건 · 감점 {section.penalty}
                </span>
              </p>
              <ul className="space-y-1.5">
                {section.errors.map((error) => {
                  const cue = error.cueId ? cueIndex.get(error.cueId) : undefined;
                  return (
                    <li key={error.id} className="rounded-lg border border-line bg-card/45 p-1.5">
                      <div className="flex items-start gap-1.5">
                        {severityChip(error.severity)}
                        <p className="min-w-0 flex-1 text-[0.64rem] leading-relaxed text-fg-2">
                          {error.note ?? section.label}
                        </p>
                      </div>
                      {cue && (
                        <p
                          className="mt-1 truncate text-[0.6rem] text-fg-4"
                          title={cue.text}
                        >
                          {cue.pageIndex + 1}페이지 · {cue.text}
                        </p>
                      )}
                      {cue && onSelectCue && (
                        <button
                          type="button"
                          onClick={() => onSelectCue(cue.id)}
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 rounded-lg border border-line bg-panel px-2 text-[0.6rem] font-semibold text-accent transition-colors hover:bg-raised",
                            STUDIO_FOCUS_RING,
                            STUDIO_TOUCH_TARGET
                          )}
                        >
                          <ArrowRight size={11} aria-hidden />
                          {jumpLabel}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
