/**
 * SurveyDesk 네이티브 통합 — 인앱 피드백 설문.
 * ──────────────────────────────────────────────────────────────────────────
 * 공식 SDK(@heejun/deskcloud)의 `createSurveyClient`(pk_ 브라우저 클라이언트)로 운영팀이
 * 게시한 활성 설문을 불러오고(getActive) 응답을 제출한다(submit). 화면은 이 앱의 디자인
 * 토큰(canvas/panel/card/line/fg/accent)과 컴포넌트(Button)로 직접 렌더 — 외부 위젯 CSS·
 * 번들 없음. 별점/NPS/선택지/자유입력을 모두 네이티브 컨트롤로 렌더한다.
 *
 * 역할 구분: 앱의 /feedback Q&A 게시판(InquiryForm 포함)은 1차(first-party) CORE 기능으로
 * 그대로 둔다. 이 설문은 운영팀이 게시하는 짧은 만족도/NPS 설문으로 어느 페이지에서나
 * 비침습적으로 수집하는 **추가(additive)** 채널이다.
 *
 * env-gate: VITE_SURVEYDESK_URL 미설정 시 마운트되지 않는다.
 */
import { createSurveyClient, DeskError, type Survey, type SurveyAnswerValue, type SurveyQuestion } from "@heejun/deskcloud";
import { Check, MessageSquarePlus, Star, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { surveyConfig } from "./config";

import { Button } from "@/shared/components/ui/button";
import { useApp } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";

const APP_ID = "toonspectrum";
const NPS_MIN = 0;
const NPS_MAX = 10;
const TEXT_MAX = { short: 280, long: 4000 } as const;

type Phase = "idle" | "loading" | "ready" | "submitting" | "success" | "load-error" | "no-survey";

const FOCUSABLE =
  'a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

function isEmpty(v: SurveyAnswerValue | undefined): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** 제출 전 1차 검증(서버가 2차로 재검증) — 필수 항목 누락만 막는다. */
function findMissing(questions: SurveyQuestion[], answers: Record<string, SurveyAnswerValue | undefined>): string[] {
  return questions.filter((q) => q.required && isEmpty(answers[q.id])).map((q) => q.id);
}

export function NativeFeedback() {
  const config = useMemo(() => surveyConfig(), []);
  const client = useMemo(() => (config ? createSurveyClient(config) : null), [config]);
  const userId = useApp((s) => s.userId);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue | undefined>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  const titleId = useId();
  const introId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    if (!client) return;
    setPhase("loading");
    setFormError(null);
    client
      .getActive(APP_ID)
      .then((s) => {
        setSurvey(s);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        setPhase(e instanceof DeskError && e.status === 404 ? "no-survey" : "load-error");
      });
  }, [client]);

  const openDialog = useCallback(() => {
    setOpen(true);
    if (phase === "idle" || phase === "load-error") load();
  }, [phase, load]);

  const closeDialog = useCallback(() => {
    setOpen(false);
    if (phase === "success") {
      setAnswers({});
      setMissing(new Set());
      setPhase(survey ? "ready" : "idle");
    }
    launcherRef.current?.focus();
  }, [phase, survey]);

  // 포커스 트랩 + Esc — 다이얼로그가 열린 동안만.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeDialog();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, closeDialog]);

  // 다이얼로그 진입 시 첫 포커서블로 포커스 이동(a11y).
  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 20);
    return () => window.clearTimeout(t);
  }, [open, phase]);

  const setAnswer = useCallback((qid: string, v: SurveyAnswerValue | undefined) => {
    setAnswers((p) => ({ ...p, [qid]: v }));
    setMissing((p) => {
      if (!p.has(qid)) return p;
      const next = new Set(p);
      next.delete(qid);
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    if (!survey || !client) return;
    const missingIds = findMissing(survey.questions, answers);
    if (missingIds.length > 0) {
      setMissing(new Set(missingIds));
      setFormError("필수 항목을 입력해 주세요.");
      window.setTimeout(() => {
        dialogRef.current?.querySelector<HTMLElement>("[data-survey-error]")?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 0);
      return;
    }
    const cleaned: Record<string, SurveyAnswerValue> = {};
    for (const [k, v] of Object.entries(answers)) if (v !== undefined && !isEmpty(v)) cleaned[k] = v;
    setPhase("submitting");
    setFormError(null);
    client
      .submit(APP_ID, {
        answers: cleaned,
        respondent: userId ? { userId } : undefined,
        meta: {
          pageUrl: typeof location !== "undefined" ? location.href : undefined,
          referrer: typeof document !== "undefined" && document.referrer ? document.referrer : undefined,
        },
      })
      .then(() => setPhase("success"))
      .catch((e: unknown) => {
        setPhase("ready");
        setFormError(e instanceof Error ? e.message : "제출에 실패했어요. 잠시 후 다시 시도해 주세요.");
      });
  }, [survey, client, answers, userId]);

  if (!client || phase === "no-survey") return null;

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          aria-haspopup="dialog"
          onClick={openDialog}
          className="fixed right-4 top-20 z-[88] inline-flex items-center gap-2 rounded-full border border-line bg-card/95 px-3.5 py-2 text-sm font-medium text-fg-2 shadow-lg backdrop-blur transition-[color,border-color,transform] duration-150 ease-out-expo hover:-translate-y-0.5 hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <MessageSquarePlus size={15} aria-hidden="true" />
          피드백
        </button>
      )}

      {open && (
        <div
          role="presentation"
          className="fixed inset-0 z-[95] flex items-end justify-end bg-canvas/70 p-4 backdrop-blur-sm motion-safe:animate-[fade-up_0.16s_var(--ease-out-expo)_both] sm:items-start sm:pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={survey ? titleId : undefined}
            aria-describedby={survey?.intro ? introId : undefined}
            aria-label={survey ? undefined : "피드백"}
            className="flex max-h-[min(640px,calc(100vh-2rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-panel text-fg shadow-2xl motion-safe:animate-[fade-up_0.2s_var(--ease-out-expo)_both]"
          >
            {phase === "loading" && (
              <div className="px-5 py-10 text-center" aria-busy="true">
                <div className="mx-auto h-24 w-full max-w-[260px] space-y-2.5">
                  <span className="skeleton block h-4 w-2/3" />
                  <span className="skeleton block h-10 w-full" />
                  <span className="skeleton block h-4 w-1/2" />
                </div>
                <p className="mt-4 text-sm text-fg-3">설문을 불러오는 중…</p>
              </div>
            )}

            {phase === "load-error" && (
              <div className="px-5 py-10 text-center">
                <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-bad/15 text-bad">
                  <TriangleAlert size={24} aria-hidden="true" />
                </span>
                <h2 className="text-base font-bold text-fg">설문을 불러오지 못했어요</h2>
                <p className="mx-auto mt-2 max-w-[34ch] text-pretty text-sm leading-relaxed text-fg-2">
                  네트워크 상태를 확인하고 다시 시도해 주세요.
                </p>
                <div className="mt-5 flex justify-center gap-2.5">
                  <Button variant="ghost" size="sm" onClick={closeDialog}>
                    닫기
                  </Button>
                  <Button size="sm" onClick={load}>
                    다시 시도
                  </Button>
                </div>
              </div>
            )}

            {phase === "success" && (
              <div className="px-5 py-10 text-center" role="status">
                <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-good/15 text-good">
                  <Check size={24} aria-hidden="true" />
                </span>
                <h2 className="text-base font-bold text-fg">소중한 의견 감사합니다</h2>
                <p className="mx-auto mt-2 max-w-[34ch] text-pretty text-sm leading-relaxed text-fg-2">
                  보내 주신 피드백은 서비스 개선에 활용할게요.
                </p>
                <div className="mt-5">
                  <Button size="sm" onClick={closeDialog}>
                    닫기
                  </Button>
                </div>
              </div>
            )}

            {(phase === "ready" || phase === "submitting") && survey && (
              <SurveyForm
                survey={survey}
                answers={answers}
                missing={missing}
                formError={formError}
                submitting={phase === "submitting"}
                titleId={titleId}
                introId={introId}
                onAnswer={setAnswer}
                onClose={closeDialog}
                onSubmit={submit}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function SurveyForm(props: {
  survey: Survey;
  answers: Record<string, SurveyAnswerValue | undefined>;
  missing: Set<string>;
  formError: string | null;
  submitting: boolean;
  titleId: string;
  introId: string;
  onAnswer: (qid: string, v: SurveyAnswerValue | undefined) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { survey, answers, missing, formError, submitting, titleId, introId, onAnswer, onClose, onSubmit } = props;
  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-pretty text-base font-bold tracking-tight text-fg">
            {survey.title}
          </h2>
          {survey.intro && (
            <p id={introId} className="mt-1.5 text-sm leading-relaxed text-fg-2">
              {survey.intro}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <form
        noValidate
        className="flex-1 overflow-y-auto px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {formError && (
          <p data-survey-error className="mb-4 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad" role="alert">
            {formError}
          </p>
        )}
        {survey.questions.map((q) => (
          <QuestionField key={q.id} question={q} value={answers[q.id]} invalid={missing.has(q.id)} onChange={(v) => onAnswer(q.id, v)} />
        ))}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>

      <footer className="flex items-center gap-2.5 border-t border-line px-5 py-3.5">
        <span className="text-xs text-fg-3">의견은 익명으로 처리돼요</span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button size="sm" disabled={submitting} onClick={onSubmit}>
          {submitting ? "제출 중…" : "제출"}
        </Button>
      </footer>
    </>
  );
}

function QuestionField({
  question,
  value,
  invalid,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyAnswerValue | undefined;
  invalid: boolean;
  onChange: (v: SurveyAnswerValue | undefined) => void;
}) {
  const labelId = useId();
  const errorId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="mb-6 last:mb-1">
      <span id={labelId} className="mb-2.5 block text-sm font-semibold text-fg">
        {question.label}
        {question.required && (
          <span className="ml-1 text-bad" aria-hidden="true">
            *
          </span>
        )}
      </span>
      <QuestionBody question={question} value={value} labelId={labelId} describedBy={invalid ? errorId : undefined} onChange={onChange} />
      {invalid && (
        <p id={errorId} data-survey-error className="mt-2 text-xs text-bad" role="alert">
          필수 항목입니다
        </p>
      )}
    </div>
  );
}

function QuestionBody({
  question,
  value,
  labelId,
  describedBy,
  onChange,
}: {
  question: SurveyQuestion;
  value: SurveyAnswerValue | undefined;
  labelId: string;
  describedBy: string | undefined;
  onChange: (v: SurveyAnswerValue | undefined) => void;
}) {
  switch (question.type) {
    case "rating": {
      // 앱의 별점 룩(lucide Star + accent 토큰)을 따른 인터랙티브 컨트롤.
      // 표시 전용 <Stars> 대신 키보드/클릭 입력을 받는 네이티브 라디오그룹으로 렌더한다.
      const current = typeof value === "number" ? value : 0;
      return (
        <StarRating
          value={current}
          label={question.label}
          describedBy={describedBy}
          onChange={(v) => onChange(v > 0 ? v : undefined)}
        />
      );
    }
    case "nps": {
      const current = typeof value === "number" ? value : null;
      const scale = Array.from({ length: NPS_MAX - NPS_MIN + 1 }, (_, i) => NPS_MIN + i);
      return (
        <div>
          <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="grid grid-cols-11 gap-1.5">
            {scale.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={current === n}
                aria-label={`${n}점`}
                onClick={() => onChange(current === n ? undefined : n)}
                className={cn(
                  "rounded-lg border py-2 text-sm font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80",
                  current === n ? "border-accent bg-accent text-on-accent" : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-fg-3" aria-hidden="true">
            <span>전혀 아니다</span>
            <span>매우 그렇다</span>
          </div>
        </div>
      );
    }
    case "single_choice": {
      const current = typeof value === "string" ? value : null;
      const name = labelId;
      return (
        <div role="radiogroup" aria-describedby={describedBy} className="flex flex-col gap-2">
          {(question.options ?? []).map((opt) => {
            const checked = current === opt.value;
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  checked ? "border-accent bg-accent-soft text-fg" : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={opt.value}
                  checked={checked}
                  onChange={() => onChange(opt.value)}
                  className="size-4 shrink-0 accent-[oklch(0.72_0.185_42)]"
                />
                <span className="flex-1">{opt.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case "multi_choice": {
      const selected = Array.isArray(value) ? value : [];
      const toggle = (v: string) => {
        const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
        onChange(next.length > 0 ? next : undefined);
      };
      return (
        <div role="group" aria-describedby={describedBy} className="flex flex-col gap-2">
          {(question.options ?? []).map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  checked ? "border-accent bg-accent-soft text-fg" : "border-line bg-card text-fg-2 hover:border-line-strong hover:text-fg",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                  className="size-4 shrink-0 accent-[oklch(0.72_0.185_42)]"
                />
                <span className="flex-1">{opt.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case "text": {
      const variant = question.variant ?? "short";
      const max = TEXT_MAX[variant];
      const text = typeof value === "string" ? value : "";
      const set = (v: string) => onChange(v.length > 0 ? v : undefined);
      if (variant === "long") {
        return (
          <div>
            <textarea
              value={text}
              maxLength={max}
              aria-describedby={describedBy}
              placeholder="자유롭게 적어 주세요"
              onChange={(e) => set(e.target.value)}
              className="min-h-[88px] w-full resize-y rounded-lg border border-line bg-card px-3 py-2.5 text-sm leading-relaxed text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/40"
            />
            <div className="mt-1 text-right text-xs text-fg-3" aria-hidden="true">
              {text.length}/{max}
            </div>
          </div>
        );
      }
      return (
        <input
          type="text"
          value={text}
          maxLength={max}
          aria-describedby={describedBy}
          placeholder="한 줄로 적어 주세요"
          onChange={(e) => set(e.target.value)}
          className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-fg-3 hover:border-line-strong focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      );
    }
    default:
      return null;
  }
}

const RATING_MAX = 5;

/**
 * 인터랙티브 별점(1~5). 앱의 별점 룩(lucide Star + accent 토큰)을 따르되 표시 전용
 * <Stars> 와 달리 클릭/키보드 입력을 받는다. 라디오그룹 시맨틱으로 화살표 키 이동·
 * 같은 별 재클릭 시 해제를 지원한다.
 */
function StarRating({
  value,
  label,
  describedBy,
  onChange,
}: {
  value: number;
  label: string;
  describedBy: string | undefined;
  onChange: (v: number) => void;
}) {
  const stars = Array.from({ length: RATING_MAX }, (_, i) => i + 1);
  const onKey = (e: React.KeyboardEvent, n: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(RATING_MAX, n + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(1, n - 1));
    }
  };
  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} className="inline-flex items-center gap-1.5">
      {stars.map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n}점`}
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            onClick={() => onChange(value === n ? 0 : n)}
            onKeyDown={(e) => onKey(e, n)}
            className="rounded p-0.5 transition-[transform,filter] duration-150 ease-out hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            <Star
              size={28}
              strokeWidth={1.55}
              className={cn(
                filled ? "fill-accent text-accent drop-shadow-[0_0_5px_oklch(0.72_0.185_42/0.34)]" : "text-[oklch(0.48_0.018_68)]",
              )}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
