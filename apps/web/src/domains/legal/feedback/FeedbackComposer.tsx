import { ArrowUpRight, Globe2, Send } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { FeedbackEntry, FeedbackKind } from "@toonspectrum/core/feedback";

import { useApp } from "@/shared/lib/store";
import {
  FEEDBACK_AREAS, FEEDBACK_AREA_LABELS, FEEDBACK_KINDS, FEEDBACK_KIND_LABELS, validateFeedbackInput,
} from "@toonspectrum/core/feedback";
import { isFeedbackEntry } from "@toonspectrum/core/feedback-response";
import { api, getApiErrorMessage } from "@/src/infrastructure/api";

interface Props {
  kind: FeedbackKind;
  onKindChange: (kind: FeedbackKind) => void;
  userId: string | null;
  hydrated: boolean;
  apiReady: boolean;
  onCreated: (entry: FeedbackEntry) => void;
  onSearch: (query: string) => void;
}
export function FeedbackComposer({ kind, onKindChange, userId, hydrated, apiReady, onCreated, onSearch }: Props) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [area, setArea] = useState("studio");
  const [tags, setTags] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const errorElement = useRef<HTMLParagraphElement | null>(null);
  const showError = (message: string) => {
    setError(message);
    window.requestAnimationFrame(() => errorElement.current?.focus());
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userId || !apiReady || busy.current) return;
    const parsed = validateFeedbackInput({
      category: kind, title, text, tags: tags.split(/[,\n]/),
      metadata: { area, ...(kind === "bug" ? { steps, expected, actual } : {}) },
    });
    if (!parsed.value) { showError(parsed.error ?? "입력 내용을 확인해 주세요."); return; }
    if (!publicConfirmed) { showError("제보 내용의 공개 여부를 확인해 주세요."); return; }
    busy.current = true;
    setSending(true);
    setError("");
    try {
      const entry = await api.post<unknown>("/feedback/posts", parsed.value, { timeout: 30_000, referrerPolicy: "no-referrer" });
      if (useApp.getState().userId !== userId) return;
      if (!isFeedbackEntry(entry) || entry.category !== parsed.value.category) {
        throw new Error("등록 결과를 확인하지 못했어요. 중복 제보를 피하려면 내 제보 목록을 먼저 확인해 주세요. 입력 내용은 유지됩니다.");
      }
      setTitle(""); setText(""); setTags(""); setSteps(""); setExpected(""); setActual(""); setPublicConfirmed(false);
      onCreated(entry);
    } catch (cause) {
      showError(await getApiErrorMessage(cause, "제보가 등록되지 않았어요. 입력 내용은 그대로 보관하고 있습니다."));
    } finally { busy.current = false; setSending(false); }
  };

  if (!hydrated) return <p className="fb-notice" role="status">로그인 상태를 확인하고 있어요.</p>;
  if (!userId) return (
    <div className="fb-guest">
      <Globe2 size={26} aria-hidden="true" />
      <h3>읽기는 누구나,<br />참여는 로그인 후에</h3>
      <p>상단의 로그인 버튼으로 로그인하면 제보, 공감, 댓글에 참여할 수 있어요.</p>
      <a href="/support" className="fb-button">로그인 없이 공개 문의 <ArrowUpRight size={16} aria-hidden="true" /></a>
      <p className="fb-caption">기존 공개 문의 게시판으로 이동합니다. 개인정보와 미공개 작품은 남기지 마세요.</p>
    </div>
  );
  return (
    <form className="fb-form" onSubmit={submit} aria-label="공개 제보 작성" noValidate aria-busy={sending}>
      <p className="fb-notice"><Globe2 size={16} aria-hidden="true" /> 제목·내용·재현 정보는 모두 공개됩니다.</p>
      {!apiReady && <p className="fb-notice" role="status">입력 내용은 유지됩니다. 작성은 계속할 수 있고, 목록 연결이 확인되면 등록할 수 있어요.</p>}
      <fieldset disabled={sending}>
        <div className="fb-form-pair">
          <div><label htmlFor={`${id}-kind`}>제보 유형</label><select id={`${id}-kind`} value={kind} onChange={(event) => onKindChange(event.target.value as FeedbackKind)}>{FEEDBACK_KINDS.map((key) => <option key={key} value={key}>{FEEDBACK_KIND_LABELS[key]}</option>)}</select></div>
          <div><label htmlFor={`${id}-area`}>관련 기능</label><select id={`${id}-area`} value={area} onChange={(event) => setArea(event.target.value)}>{FEEDBACK_AREAS.map((key) => <option key={key} value={key}>{FEEDBACK_AREA_LABELS[key]}</option>)}</select></div>
        </div>
        <label htmlFor={`${id}-title`}>제목 <span>필수</span></label>
        <input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder={kind === "bug" ? "예: 필터 적용 후 브러시가 멈춰요" : "어떤 기능이 있으면 좋을까요?"} required minLength={2} />
        <button className="fb-text-button" type="button" disabled={title.trim().length < 2} onClick={() => onSearch(title.trim())}>제목으로 기존 제보 찾아보기 <ArrowUpRight size={13} aria-hidden="true" /></button>
        <label htmlFor={`${id}-text`}>{kind === "bug" ? "어떤 문제가 있었나요?" : "의견과 요청 내용"} <span>필수</span></label>
        <textarea id={`${id}-text`} value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} minLength={5} rows={5} placeholder={kind === "bug" ? "문제가 생긴 상황과 작업에 미친 영향을 알려주세요." : "원하는 동작과 이 기능이 필요한 상황을 알려주세요."} required aria-describedby={`${id}-privacy ${id}-length`} />
        <p id={`${id}-length`} className="fb-counter">{text.length.toLocaleString()} / 2,000</p>
        {kind === "bug" && <details className="fb-reproduction" open>
          <summary>재현 정보를 더하면 확인이 빨라져요</summary>
          <label htmlFor={`${id}-steps`}>재현 순서 <span>선택</span></label><textarea id={`${id}-steps`} value={steps} onChange={(event) => setSteps(event.target.value)} maxLength={1200} rows={3} placeholder="1. 스튜디오 열기 → 2. 필터 적용 → 3. 브러시 사용" />
          <label htmlFor={`${id}-expected`}>기대했던 동작 <span>선택</span></label><textarea id={`${id}-expected`} value={expected} onChange={(event) => setExpected(event.target.value)} maxLength={1200} rows={2} />
          <label htmlFor={`${id}-actual`}>실제로 발생한 동작 <span>선택</span></label><textarea id={`${id}-actual`} value={actual} onChange={(event) => setActual(event.target.value)} maxLength={1200} rows={2} />
        </details>}
        <label htmlFor={`${id}-tags`}>태그 <span>선택 · 최대 5개</span></label><input id={`${id}-tags`} value={tags} onChange={(event) => setTags(event.target.value)} maxLength={104} placeholder="브러시, 모바일 (쉼표로 구분)" />
        <p id={`${id}-privacy`} className="fb-caption">비밀번호, 이메일, 연락처, 결제 정보, 미공개 작품은 입력하지 마세요. 브라우저 정보나 현재 URL은 자동 수집하지 않습니다.</p>
        <div className="fb-consent"><input id={`${id}-public`} type="checkbox" checked={publicConfirmed} onChange={(event) => setPublicConfirmed(event.target.checked)} /><label htmlFor={`${id}-public`}>제보 내용이 공개되는 것을 확인했습니다.</label></div>
      </fieldset>
      {error && <p className="fb-error" role="alert" tabIndex={-1} ref={errorElement}>{error}</p>}
      <button type="submit" disabled={sending || !apiReady} className="fb-button fb-primary fb-full"><Send size={16} aria-hidden="true" />{sending ? "등록 중…" : "공개 제보 등록"}</button>
      <p className="fb-caption">공감 수는 참고 자료이며, 반영 여부나 일정을 보장하지 않습니다.</p>
    </form>
  );
}
