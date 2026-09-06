import { AlertTriangle, CheckCircle2, Download, ShieldCheck, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type {
  StudioPublishComplianceChecklist,
  StudioPublishComplianceResult,
  StudioPublishContentFlags,
} from "./studio-publish-compliance";
import type {
  StudioPublishAiUsage,
  StudioPublishPreflightResult,
  StudioPublishProfile,
} from "./studio-publish-preflight";

const PROFILE_LABELS: Record<StudioPublishProfile, string> = {
  generic: "일반 / ToonSpectrum",
  webtoon: "WEBTOON CANVAS",
  tapas: "Tapas",
};

export interface StudioPublishPreflightPanelProps {
  open: boolean;
  onClose: () => void;
  profile: StudioPublishProfile;
  onProfileChange: (profile: StudioPublishProfile) => void;
  aiUsage: StudioPublishAiUsage;
  onAiUsageChange: (usage: StudioPublishAiUsage) => void;
  disclosure: string;
  onDisclosureChange: (value: string) => void;
  compliance: StudioPublishComplianceChecklist;
  onComplianceChange: (value: StudioPublishComplianceChecklist) => void;
  complianceResult: StudioPublishComplianceResult;
  result: StudioPublishPreflightResult;
  onDownloadReport: () => void;
}

const CONTENT_FLAG_LABELS: Record<keyof StudioPublishContentFlags, string> = {
  sexualContent: "성적 표현",
  violence: "폭력 표현",
  strongLanguage: "강한 언어",
};

function triStateValue(value: boolean | null): string {
  return value === null ? "" : value ? "yes" : "no";
}

function readTriState(value: string): boolean | null {
  return value === "yes" ? true : value === "no" ? false : null;
}

export function StudioPublishPreflightPanel({
  open,
  onClose,
  profile,
  onProfileChange,
  aiUsage,
  onAiUsageChange,
  disclosure,
  onDisclosureChange,
  compliance,
  onComplianceChange,
  complianceResult,
  result,
  onDownloadReport,
}: StudioPublishPreflightPanelProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const ready = result.canPublish && complianceResult.readyForDestinationReview;
  const errorCount = result.errors.length + complianceResult.errors.length;
  const warningCount = result.warnings.length + complianceResult.warnings.length;
  const issues = [
    ...result.issues.map((issue) => ({ ...issue, source: "구조" as const })),
    ...complianceResult.issues.map((issue) => ({ ...issue, source: "자가 점검" as const })),
  ];

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publish Pack 사전검사"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <ShieldCheck size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight text-fg">Publish Pack 사전검사</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
              목적지 정책·이미지 구조·AI 사용 고지를 게시 전에 확인합니다. 외부 플랫폼으로 자동 전송하지는 않아요.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Publish Pack 사전검사 닫기"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
          >
            <X size={15} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-fg-2">
              게시 목적지
              <select
                value={profile}
                onChange={(event) => onProfileChange(event.target.value as StudioPublishProfile)}
                className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              >
                {Object.entries(PROFILE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-fg-2">
              AI 사용 유형
              <select
                value={aiUsage}
                onChange={(event) => onAiUsageChange(event.target.value as StudioPublishAiUsage)}
                className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="none">사용하지 않음</option>
                <option value="assisted">보조 사용 · 번역/아이디어/수정</option>
                <option value="generated">생성 이미지 포함</option>
              </select>
            </label>
          </div>

          <label className="mt-3 block text-xs font-semibold text-fg-2">
            AI 사용 고지
            <textarea
              value={disclosure}
              onChange={(event) => onDisclosureChange(event.target.value.slice(0, 1_000))}
              rows={3}
              placeholder="예: 일부 배경 이미지를 생성형 AI로 제작했고 작가가 직접 편집·검수했습니다."
              disabled={aiUsage === "none"}
              className="mt-1.5 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent disabled:opacity-50"
            />
          </label>

          <section className="mt-4 rounded-xl border border-line bg-card/40 p-3" aria-labelledby="publish-compliance-title">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 id="publish-compliance-title" className="text-sm font-bold text-fg">
                  권리·등급 자체 점검
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
                  작품 내용과 사용 소재를 직접 확인한 결과를 Publish Pack에 함께 보관합니다.
                </p>
              </div>
              <span className="rounded-full border border-line bg-panel px-2 py-1 text-[0.65rem] font-semibold text-fg-3">
                체크리스트 v{compliance.version}
              </span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-fg-2">
                예상 독자 등급
                <select
                  value={compliance.audienceRating ?? ""}
                  onChange={(event) =>
                    onComplianceChange({
                      ...compliance,
                      audienceRating:
                        event.target.value === "all" ||
                        event.target.value === "teen" ||
                        event.target.value === "mature"
                          ? event.target.value
                          : null,
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                >
                  <option value="">선택해 주세요</option>
                  <option value="all">전체 이용가 예상</option>
                  <option value="teen">청소년 이용가 예상</option>
                  <option value="mature">성인 이용가 예상</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-fg-2">
                제3자 콘텐츠 사용
                <select
                  value={triStateValue(compliance.thirdParty.used)}
                  onChange={(event) => {
                    const used = readTriState(event.target.value);
                    onComplianceChange({
                      ...compliance,
                      thirdParty: {
                        used,
                        licensesConfirmed: used === true ? compliance.thirdParty.licensesConfirmed : false,
                        attributionNotes: used === true ? compliance.thirdParty.attributionNotes : "",
                      },
                    });
                  }}
                  className="mt-1.5 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                >
                  <option value="">선택해 주세요</option>
                  <option value="no">사용하지 않음</option>
                  <option value="yes">폰트·사진·소재 등을 사용함</option>
                </select>
              </label>
            </div>

            <fieldset className="mt-3">
              <legend className="text-xs font-semibold text-fg-2">민감 표현 포함 여부</legend>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {(Object.keys(CONTENT_FLAG_LABELS) as Array<keyof StudioPublishContentFlags>).map((flag) => (
                  <label key={flag} className="text-[0.7rem] font-semibold text-fg-3">
                    {CONTENT_FLAG_LABELS[flag]}
                    <select
                      value={triStateValue(compliance.contentFlags[flag])}
                      onChange={(event) =>
                        onComplianceChange({
                          ...compliance,
                          contentFlags: {
                            ...compliance.contentFlags,
                            [flag]: readTriState(event.target.value),
                          },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-xs text-fg outline-none focus:border-accent"
                    >
                      <option value="">미확인</option>
                      <option value="no">없음</option>
                      <option value="yes">있음</option>
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-fg-2">
                <input
                  type="checkbox"
                  checked={compliance.ownershipRightsConfirmed}
                  onChange={(event) =>
                    onComplianceChange({ ...compliance, ownershipRightsConfirmed: event.target.checked })
                  }
                  className="mt-0.5 accent-accent"
                />
                원본을 소유하거나 게시할 권한이 있습니다.
              </label>
              <label className="flex min-h-11 items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-fg-2">
                <input
                  type="checkbox"
                  checked={compliance.referenceRightsConfirmed}
                  onChange={(event) =>
                    onComplianceChange({ ...compliance, referenceRightsConfirmed: event.target.checked })
                  }
                  className="mt-0.5 accent-accent"
                />
                참고 자료와 원본에 필요한 이용 권리를 확인했습니다.
              </label>
              {compliance.thirdParty.used === true ? (
                <label className="flex min-h-11 items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-fg-2 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={compliance.thirdParty.licensesConfirmed}
                    onChange={(event) =>
                      onComplianceChange({
                        ...compliance,
                        thirdParty: { ...compliance.thirdParty, licensesConfirmed: event.target.checked },
                      })
                    }
                    className="mt-0.5 accent-accent"
                  />
                  사용한 제3자 콘텐츠의 게시·상업 이용 범위와 라이선스를 확인했습니다.
                </label>
              ) : null}
              {aiUsage !== "none" ? (
                <label className="flex min-h-11 items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-fg-2">
                  <input
                    type="checkbox"
                    checked={compliance.aiDisclosureConfirmed}
                    onChange={(event) =>
                      onComplianceChange({ ...compliance, aiDisclosureConfirmed: event.target.checked })
                    }
                    className="mt-0.5 accent-accent"
                  />
                  선택한 게시처에 필요한 AI 사용 고지를 확인했습니다.
                </label>
              ) : null}
              <label className="flex min-h-11 items-start gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-fg-2">
                <input
                  type="checkbox"
                  checked={compliance.policyReviewConfirmed}
                  onChange={(event) =>
                    onComplianceChange({ ...compliance, policyReviewConfirmed: event.target.checked })
                  }
                  className="mt-0.5 accent-accent"
                />
                선택한 게시처의 최신 콘텐츠·권리·AI 정책을 직접 검토했습니다.
              </label>
            </div>

            {compliance.thirdParty.used === true ? (
              <label className="mt-3 block text-xs font-semibold text-fg-2">
                제3자 콘텐츠 출처·라이선스 메모
                <textarea
                  value={compliance.thirdParty.attributionNotes}
                  onChange={(event) =>
                    onComplianceChange({
                      ...compliance,
                      thirdParty: {
                        ...compliance.thirdParty,
                        attributionNotes: event.target.value.slice(0, 4_000),
                      },
                    })
                  }
                  rows={3}
                  placeholder="소재명, 저작자/출처, 라이선스, 표시 문구 등을 기록하세요."
                  className="mt-1.5 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent"
                />
              </label>
            ) : null}

            <p className="mt-3 rounded-lg border border-warning/25 bg-warning-soft/15 px-3 py-2 text-[0.68rem] leading-relaxed text-fg-3">
              {complianceResult.disclaimer}
            </p>
          </section>

          <div
            className={`mt-4 flex items-start gap-3 rounded-xl border p-3 ${
              ready ? "border-good/35 bg-good/10" : "border-bad/35 bg-bad/10"
            }`}
            role="status"
          >
            {ready ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good" aria-hidden />
            ) : (
              <XCircle size={18} className="mt-0.5 shrink-0 text-bad" aria-hidden />
            )}
            <div>
              <p className="text-sm font-bold text-fg">
                {ready ? "게시 전 필수 점검을 통과했어요" : `차단 항목 ${errorCount}개를 확인하세요`}
              </p>
              <p className="mt-0.5 text-xs text-fg-3">
                오류 {errorCount}개 · 경고 {warningCount}개 · 목적지 {PROFILE_LABELS[profile]}
              </p>
            </div>
          </div>

          {issues.length === 0 ? (
            <p className="mt-4 rounded-xl border border-line bg-card/50 px-3 py-4 text-center text-xs text-fg-3">
              발견된 문제가 없습니다. 실제 업로드 직전에는 목적지의 최신 공지와 규격도 다시 확인하세요.
            </p>
          ) : (
            <ol className="mt-4 space-y-2" aria-label="게시 사전검사 결과">
              {issues.map((item, index) => (
                <li
                  key={`${item.source}:${item.code}:${item.path ?? "root"}:${index}`}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${
                    item.severity === "error"
                      ? "border-bad/30 bg-bad/10 text-bad"
                      : "border-warning/30 bg-warning-soft/20 text-warning"
                  }`}
                >
                  {item.severity === "error" ? (
                    <XCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="mr-1 rounded border border-current/20 px-1 py-0.5 text-[0.6rem] font-bold opacity-75">
                      {item.source}
                    </span>
                    <span className="font-semibold">{item.message}</span>
                    {item.path && <span className="mt-0.5 block font-mono text-[0.65rem] opacity-70">{item.path}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <p className="mr-auto text-[0.68rem] leading-relaxed text-fg-3">
            플랫폼 한도는 바뀔 수 있어 보고서에 고정 수치로 단정하지 않습니다.
          </p>
          <button
            type="button"
            onClick={onDownloadReport}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised"
          >
            <Download size={13} aria-hidden /> 검사 보고서 JSON
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 items-center rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover"
          >
            확인
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
