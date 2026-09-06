import { CheckCircle2, Send } from "lucide-react";
import { useId, useState } from "react";

import {
  INQUIRY_BODY_MAX,
  INQUIRY_TITLE_MAX,
  submitInquiry,
  type InquiryCategory as DeskInquiryCategory,
} from "@/shared/lib/inquiry-api";

// 인앱 문의 폼 — /contact·/feedback 공용. desk-platform 공개 문의 API로 클라이언트에서 직접 POST한다
// (POST /api/v1/apps/toonspectrum/inquiries — lib/inquiry-api.ts submitInquiry). /support 게시판과
// 동일한 백엔드를 쓰며, 등록된 문의는 그 게시판에 공개로 표시된다.
// website 필드는 허니팟: 사람에겐 보이지 않고, 채워지면 전송을 생략하고 성공처럼 응답한다(봇 무음 처리).

// 이 폼에서 노출하는 문의 유형. desk-platform 카테고리(partnership|bug|feedback|usage)에 매핑된다.
type FormCategory = "contact" | "partnership" | "bug" | "qa" | "question";

const FORM_CATEGORIES: {
  value: FormCategory;
  label: string;
  description: string;
}[] = [
  { value: "contact", label: "일반 문의", description: "서비스 이용, 계정, 데이터 표시 등 일반적인 문의" },
  { value: "partnership", label: "광고·제휴", description: "광고 집행, 플랫폼 연동, 콘텐츠 제휴, 비즈니스 제안" },
  { value: "bug", label: "버그 제보", description: "오류 화면, 재현 경로, 기대 동작" },
  { value: "qa", label: "데이터 검수", description: "랭킹·카탈로그 수치 오류, 잘못 연결된 작품 정보" },
  { value: "question", label: "기타 질문", description: "그 밖의 모든 질문" },
];

// 폼 카테고리 → desk-platform 카테고리 매핑. contact·qa·question은 일반 문의(usage)로 묶는다.
const CATEGORY_MAP: Record<FormCategory, DeskInquiryCategory> = {
  contact: "usage",
  partnership: "partnership",
  bug: "bug",
  qa: "usage",
  question: "usage",
};

const INQUIRY_TITLE_MIN = 2;
const INQUIRY_BODY_MIN = 10;
const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InquiryForm({ defaultCategory = "contact" }: { defaultCategory?: FormCategory }) {
  const formId = useId();
  const [category, setCategory] = useState<FormCategory>(defaultCategory);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState(""); // 허니팟
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedCategory = FORM_CATEGORIES.find((item) => item.value === category);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;

    // 허니팟이 채워졌으면 봇으로 간주하고 조용히 성공 처리한다(봇에게 신호를 주지 않음).
    if (website.trim()) {
      setDone(true);
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedBody = body.replace(/\r\n/g, "\n").trim();
    const trimmedContact = contact.trim();
    if (trimmedTitle.length < INQUIRY_TITLE_MIN) {
      setError(`제목은 ${INQUIRY_TITLE_MIN}자 이상 입력해 주세요.`);
      return;
    }
    if (trimmedTitle.length > INQUIRY_TITLE_MAX) {
      setError(`제목은 ${INQUIRY_TITLE_MAX}자 이하로 입력해 주세요.`);
      return;
    }
    if (trimmedBody.length < INQUIRY_BODY_MIN) {
      setError(`내용은 ${INQUIRY_BODY_MIN}자 이상 입력해 주세요.`);
      return;
    }
    if (trimmedBody.length > INQUIRY_BODY_MAX) {
      setError(`내용은 ${INQUIRY_BODY_MAX}자 이하로 입력해 주세요.`);
      return;
    }

    // The body is public: never append a phone number/contact to it.
    const isEmail = SIMPLE_EMAIL_RE.test(trimmedContact);
    if (trimmedContact && !isEmail) {
      setError("연락처에는 이메일만 입력해 주세요. 전화번호는 공개 본문에 첨부하지 않습니다.");
      return;
    }
    const payloadBody = trimmedBody;

    setSending(true);
    setError(null);
    try {
      await submitInquiry({
        category: CATEGORY_MAP[category],
        title: trimmedTitle,
        body: payloadBody,
        ...(isEmail ? { contactEmail: trimmedContact } : {}),
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "문의를 접수하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-good/40 bg-good/10 px-5 py-8 text-center" role="status">
        <CheckCircle2 className="mx-auto mb-2 text-good" size={24} />
        <p className="text-sm font-semibold text-fg">문의가 접수됐어요.</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-3">
          운영팀이 확인 후 처리합니다. 연락처를 남기셨다면 해당 연락처로 답변드려요.
        </p>
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setTitle("");
            setBody("");
            setContact("");
          }}
          className="mt-4 rounded-lg border border-line bg-card px-3 py-2 text-xs font-medium text-fg-2 transition-colors hover:text-fg"
        >
          새 문의 작성
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="인앱 문의 폼">
      <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-fg-2">제목과 내용은 공개됩니다. 비밀번호, 연락처, 결제 정보, 비공개 제안서는 본문에 입력하지 마세요.</p>
      <div>
        <label htmlFor={`${formId}-category`} className="mb-1 block text-xs text-fg-3">
          문의 유형
        </label>
        <select
          id={`${formId}-category`}
          value={category}
          onChange={(event) => setCategory(event.target.value as FormCategory)}
          className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/50"
        >
          {FORM_CATEGORIES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {selectedCategory && <p className="mt-1 text-[0.7rem] text-fg-3">{selectedCategory.description}</p>}
      </div>
      <div>
        <label htmlFor={`${formId}-title`} className="mb-1 block text-xs text-fg-3">
          제목
        </label>
        <input
          id={`${formId}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, INQUIRY_TITLE_MAX))}
          maxLength={INQUIRY_TITLE_MAX}
          placeholder="문의 제목"
          className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/50"
        />
      </div>
      <div>
        <label htmlFor={`${formId}-body`} className="mb-1 block text-xs text-fg-3">
          내용
        </label>
        <textarea
          id={`${formId}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, INQUIRY_BODY_MAX))}
          maxLength={INQUIRY_BODY_MAX}
          rows={5}
          placeholder="문의 내용을 자세히 적어주세요. (10자 이상)"
          className="w-full resize-none rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/50"
        />
        <p className="mt-1 text-right text-[0.68rem] text-fg-3">
          {body.length}/{INQUIRY_BODY_MAX}
        </p>
      </div>
      <div>
        <label htmlFor={`${formId}-contact`} className="mb-1 block text-xs text-fg-3">
          답변 받을 이메일 <span className="text-fg-3/70">(선택)</span>
        </label>
        <input
          id={`${formId}-contact`}
          value={contact}
          onChange={(event) => setContact(event.target.value.slice(0, 160))}
          maxLength={160}
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-fg outline-none focus:border-accent/50"
        />
      </div>
      {/* 허니팟 — 시각적으로 숨김. 자동입력 봇이 채우면 전송을 폐기한다. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={`${formId}-website`}>웹사이트 (비워 두세요)</label>
        <input
          id={`${formId}-website`}
          name="website"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      {error && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={sending || title.trim().length < 2 || body.trim().length < 10}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Send size={14} />
        {sending ? "접수 중..." : "문의 보내기"}
      </button>
      <p className="text-[0.68rem] leading-relaxed text-fg-3">
        접수된 문의는 운영팀이 확인하는 공개 문의 게시판으로 전달됩니다.
      </p>
    </form>
  );
}
