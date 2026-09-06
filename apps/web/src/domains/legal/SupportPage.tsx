import { CheckCircle2, Inbox, MessageSquarePlus, RefreshCw, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Container } from "@/shared/components/section";
import {
  INQUIRY_BODY_MAX,
  INQUIRY_CATEGORIES,
  INQUIRY_CATEGORY_HINTS,
  INQUIRY_CATEGORY_LABELS,
  INQUIRY_NAME_MAX,
  INQUIRY_STATUS_LABELS,
  INQUIRY_TITLE_MAX,
  listInquiries,
  submitInquiry,
  type Inquiry,
  type InquiryCategory,
  type InquiryStatus,
} from "@/shared/lib/inquiry-api";
import { useDocumentTitle } from "@/src/hooks/use-document-title";

// 문의(Inquiry) 게시판 (/support) — desk-platform 공개 API 연동.
// 카테고리 선택 → 제목/내용(+선택 이름/이메일) → 허니팟 → 제출(POST). 하단에 공개 게시판(GET).
// 전화·이메일로 문의 남기는 수단은 제거하고 모든 문의를 이 게시판으로 통합한다.

const inputClass =
  "mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/40";

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 상태 뱃지 톤 — 진행도에 따라 토큰 색을 매핑(이 레포 토큰: accent/good/warn/line).
const statusTone: Record<InquiryStatus, string> = {
  new: "border-accent/40 bg-accent-soft text-accent",
  in_progress: "border-warn/40 bg-warn/10 text-warn",
  resolved: "border-good/40 bg-good/10 text-good",
  closed: "border-line bg-raised/60 text-fg-3",
};

function StatusBadge({ status }: { status: InquiryStatus }) {
  const label = INQUIRY_STATUS_LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[0.72rem] font-semibold leading-none ${statusTone[status] ?? statusTone.closed}`}
    >
      {label}
    </span>
  );
}

// ISO 날짜를 짧은 상대 표기로. 1주 이상은 YYYY.MM.DD 절대 표기로 폴백.
function shortRelativeDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.floor((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return then.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function InquiryCard({ inquiry }: { inquiry: Inquiry }) {
  return (
    <article className="rounded-2xl border border-line bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-md border border-line bg-raised/50 px-2 py-0.5 text-[0.72rem] font-semibold text-fg-2">
          {INQUIRY_CATEGORY_LABELS[inquiry.category] ?? inquiry.category}
        </span>
        <StatusBadge status={inquiry.status} />
        <span className="ml-auto text-xs text-fg-3">{shortRelativeDate(inquiry.createdAt)}</span>
      </div>
      <h3 className="mt-2.5 text-sm font-semibold text-fg">{inquiry.title}</h3>
      <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-fg-2">{inquiry.body}</p>
      <p className="mt-2.5 text-xs text-fg-3">{inquiry.authorName?.trim() || "익명"}</p>
    </article>
  );
}

type BoardState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; items: Inquiry[] };

function InquiryBoard({ reloadKey }: { reloadKey: number }) {
  const [state, setState] = useState<BoardState>({ phase: "loading" });
  const [tick, setTick] = useState(0);

  // 목록 조회. reloadKey(새 문의 등록) 또는 tick(수동 새로고침)이 바뀌면 다시 불러온다.
  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: "loading" });
    listInquiries(20, 0)
      .then((list) => {
        if (controller.signal.aborted) return;
        setState({ phase: "ready", items: list.items });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          message: cause instanceof Error ? cause.message : "문의 목록을 불러오지 못했어요.",
        });
      });
    return () => controller.abort();
  }, [reloadKey, tick]);

  const loading = state.phase === "loading";

  return (
    <section className="space-y-4" aria-labelledby="support-board-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="support-board-heading" className="inline-flex items-center gap-1.5 text-lg font-bold text-fg">
          <Inbox size={16} className="text-accent" aria-hidden /> 최근 문의
        </h2>
        <button
          type="button"
          onClick={() => setTick((value) => value + 1)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : undefined} aria-hidden />
          새로고침
        </button>
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {state.phase === "loading" ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((key) => (
              <li key={key} className="skeleton h-32 rounded-2xl" />
            ))}
          </ul>
        ) : state.phase === "error" ? (
          <div className="rounded-2xl border border-bad/40 bg-bad/10 p-5">
            <p className="text-sm font-semibold text-bad">{state.message}</p>
            <button
              type="button"
              onClick={() => setTick((value) => value + 1)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-bad/40 bg-bad/10 px-3 py-1.5 text-xs font-semibold text-bad transition-colors hover:bg-bad/20"
            >
              <RefreshCw size={13} aria-hidden />
              다시 시도
            </button>
          </div>
        ) : state.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-card/40 p-10 text-center">
            <p className="text-sm font-semibold text-fg">아직 등록된 문의가 없어요.</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">
              첫 문의를 남겨 주세요. 등록된 문의는 이 게시판에 공개로 표시됩니다.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {state.items.map((inquiry) => (
              <li key={inquiry.id}>
                <InquiryCard inquiry={inquiry} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function SupportPage() {
  useDocumentTitle("문의");
  const fieldId = useId();
  const [category, setCategory] = useState<InquiryCategory>("usage");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [website, setWebsite] = useState(""); // 허니팟 — 사람은 채우지 않는다.
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [boardKey, setBoardKey] = useState(0); // 새 문의 등록 시 게시판 재조회 트리거.
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 라우트 진입 시 페이지 제목으로 포커스를 옮긴다(스크린리더 컨텍스트 + 키보드 시작점).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const validate = (): string | null => {
    if (!title.trim()) return "제목을 입력해 주세요.";
    if (title.trim().length > INQUIRY_TITLE_MAX) return `제목은 ${INQUIRY_TITLE_MAX}자 이하로 입력해 주세요.`;
    if (!body.trim()) return "내용을 입력해 주세요.";
    if (body.trim().length > INQUIRY_BODY_MAX) return `내용은 ${INQUIRY_BODY_MAX}자 이하로 입력해 주세요.`;
    if (authorName.trim().length > INQUIRY_NAME_MAX) return `이름은 ${INQUIRY_NAME_MAX}자 이하로 입력해 주세요.`;
    if (contactEmail.trim() && !SIMPLE_EMAIL_RE.test(contactEmail.trim())) {
      return "올바른 이메일 형식을 입력해 주세요.";
    }
    return null;
  };

  const resetForm = () => {
    setTitle("");
    setBody("");
    setAuthorName("");
    setContactEmail("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitted(false);

    // 허니팟이 채워졌으면 봇으로 간주하고 조용히 성공 처리한다(서버도 202 무음).
    if (website.trim()) {
      setSubmitted(true);
      resetForm();
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      await submitInquiry({
        category,
        title: title.trim(),
        body: body.trim(),
        authorName: authorName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
      });
      setSubmitted(true);
      resetForm();
      setBoardKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문의 등록에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container size="prose" className="py-8 sm:py-12 lg:py-16">
      <div className="space-y-8">
        <header>
          <p className="eyebrow text-accent">SUPPORT · 문의</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-pretty text-[clamp(1.6rem,7vw,1.875rem)] font-bold leading-tight outline-none sm:text-4xl">
            무엇을 도와드릴까요?
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-fg-2">
            제휴·버그·의견·이용 문의를 남겨 주세요. 접수된 문의는 아래 게시판에 공개로 표시되며,
            운영팀이 확인 후 상태를 업데이트합니다. 전화·이메일 대신 이 게시판으로 문의를 통합했습니다.
          </p>
        </header>

        <section className="space-y-4">
          <div>
            <h2 className="inline-flex items-center gap-1.5 text-lg font-bold text-fg">
              <MessageSquarePlus size={16} className="text-accent" aria-hidden /> 문의 남기기
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-fg-2">
              카테고리를 고르고 제목과 내용을 작성하세요. 이름·이메일은 선택 사항입니다.
            </p>
          </div>

          {submitted ? (
            <div role="status" className="flex items-start gap-3 rounded-2xl border border-good/40 bg-good/10 p-5">
              <CheckCircle2 className="mt-0.5 shrink-0 text-good" size={22} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">문의가 접수됐어요.</p>
                <p className="mt-1 text-sm leading-relaxed text-fg-2">
                  아래 게시판에서 등록된 문의를 확인할 수 있어요. 운영팀이 확인 후 상태를 업데이트합니다.
                </p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
                >
                  <MessageSquarePlus size={13} aria-hidden />
                  문의 더 남기기
                </button>
              </div>
            </div>
          ) : (
            <form className="space-y-5 rounded-2xl border border-line bg-panel/40 p-5" onSubmit={handleSubmit} noValidate aria-label="문의 폼">
              <fieldset>
                <legend className="text-xs font-semibold text-fg-3">카테고리</legend>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {INQUIRY_CATEGORIES.map((value) => {
                    const selected = value === category;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        title={INQUIRY_CATEGORY_HINTS[value]}
                        onClick={() => setCategory(value)}
                        className={
                          selected
                            ? "rounded-full border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent"
                            : "rounded-full border border-line bg-card px-3 py-1.5 text-xs font-semibold text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
                        }
                      >
                        {INQUIRY_CATEGORY_LABELS[value]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-fg-3">{INQUIRY_CATEGORY_HINTS[category]}</p>
              </fieldset>

              <div>
                <label htmlFor={`${fieldId}-title`} className="block">
                  <span className="flex items-center justify-between text-xs font-semibold text-fg-3">
                    제목
                    <span className="font-normal text-fg-3">
                      {title.length}/{INQUIRY_TITLE_MAX}
                    </span>
                  </span>
                  <input
                    id={`${fieldId}-title`}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={INQUIRY_TITLE_MAX}
                    required
                    placeholder="문의 제목을 한 줄로 적어 주세요"
                    className={inputClass}
                  />
                </label>
              </div>

              <div>
                <label htmlFor={`${fieldId}-body`} className="block">
                  <span className="flex items-center justify-between text-xs font-semibold text-fg-3">
                    내용
                    <span className="font-normal text-fg-3">
                      {body.length}/{INQUIRY_BODY_MAX}
                    </span>
                  </span>
                  <textarea
                    id={`${fieldId}-body`}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={INQUIRY_BODY_MAX}
                    required
                    rows={6}
                    placeholder="문의 내용을 자세히 적어 주세요. 버그 신고라면 재현 방법과 환경을 함께 알려 주시면 빠르게 확인할 수 있어요."
                    className={`${inputClass} resize-y leading-relaxed`}
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label htmlFor={`${fieldId}-name`} className="block">
                  <span className="text-xs font-semibold text-fg-3">
                    이름 <span className="font-normal text-fg-3/80">(선택)</span>
                  </span>
                  <input
                    id={`${fieldId}-name`}
                    value={authorName}
                    onChange={(event) => setAuthorName(event.target.value)}
                    maxLength={INQUIRY_NAME_MAX}
                    autoComplete="name"
                    placeholder="게시판에 표시될 이름"
                    className={inputClass}
                  />
                </label>
                <label htmlFor={`${fieldId}-email`} className="block">
                  <span className="text-xs font-semibold text-fg-3">
                    이메일 <span className="font-normal text-fg-3/80">(선택)</span>
                  </span>
                  <input
                    id={`${fieldId}-email`}
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="답변 받을 이메일 (비공개)"
                    className={inputClass}
                  />
                </label>
              </div>

              {/* 허니팟: 스크린리더·일반 사용자에게 숨김. 봇이 채우면 무음 처리. */}
              <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
                <label htmlFor={`${fieldId}-website`}>웹사이트 (비워 두세요)</label>
                <input
                  id={`${fieldId}-website`}
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>

              {/* 검증·등록 에러는 aria-live로 announce. */}
              <p role="alert" aria-live="assertive" className="min-h-0">
                {error ? (
                  <span className="block rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs font-semibold text-bad">
                    {error}
                  </span>
                ) : null}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Send size={14} aria-hidden />
                  {submitting ? "접수 중…" : "문의 접수"}
                </button>
                <span className="text-xs text-fg-3">이메일은 비공개로 운영팀만 확인해요.</span>
              </div>
            </form>
          )}
        </section>

        <InquiryBoard reloadKey={boardKey} />
      </div>
    </Container>
  );
}
