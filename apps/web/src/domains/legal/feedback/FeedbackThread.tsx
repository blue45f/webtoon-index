import { ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { FeedbackComment } from "@toonspectrum/core/feedback";

import { useApp } from "@/shared/lib/store";
import { feedbackTimeLabel } from "@toonspectrum/core/feedback";
import { assertFeedbackComments, isFeedbackComment } from "@toonspectrum/core/feedback-response";
import { api, getApiErrorMessage } from "@/src/infrastructure/api";

function Reply({ reply, depth = 0 }: { reply: FeedbackComment; depth?: number }) {
  return <li className="fb-reply" data-official={reply.isOfficial || undefined}>
    <div className="fb-meta"><strong>{reply.author.name}</strong>{reply.isOfficial && <span className="fb-official"><ShieldCheck size={13} aria-hidden="true" />운영자</span>}<time dateTime={reply.createdAt}>{feedbackTimeLabel(reply.createdAt)}</time></div>
    <p>{reply.text}</p>
    {!!reply.children?.length && depth < 4 && <ul className="fb-nested-replies">{reply.children.map((child) => <Reply key={child.id} reply={child} depth={depth + 1} />)}</ul>}
  </li>;
}
interface Props {
  postId: string;
  userId: string | null;
  revision: number;
  readOnly?: boolean;
  onAdded: (reply: FeedbackComment) => void;
}
export function FeedbackThread({ postId, userId, revision, readOnly = false, onAdded }: Props) {
  const id = useId();
  const [replies, setReplies] = useState<FeedbackComment[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [tick, setTick] = useState(0);
  const [success, setSuccess] = useState("");
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError("");
    api.get<unknown>(`/feedback/posts/${encodeURIComponent(postId)}/replies`, { signal: controller.signal, timeout: 20_000, referrerPolicy: "no-referrer" })
      .then((rows) => {
        if (controller.signal.aborted) return;
        assertFeedbackComments(rows, postId);
        setReplies(rows);
      })
      .catch(async (cause: unknown) => {
        const message = await getApiErrorMessage(cause, "댓글을 불러오지 못했어요.");
        if (!controller.signal.aborted) setLoadError(message);
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [postId, revision, tick]);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userId || readOnly || busy.current || !text.trim()) return;
    busy.current = true; setSending(true); setSendError(""); setSuccess("");
    try {
      const reply = await api.post<unknown>(`/feedback/posts/${encodeURIComponent(postId)}/replies`, { text }, { timeout: 30_000, referrerPolicy: "no-referrer" });
      if (useApp.getState().userId !== userId) return;
      if (!isFeedbackComment(reply, postId)) throw new Error("댓글 등록 결과를 확인하지 못했어요. 중복 등록을 피하려면 댓글 목록을 먼저 확인해 주세요.");
      setText(""); setSuccess("댓글이 등록되었습니다."); onAdded(reply);
    } catch (cause) { setSendError(await getApiErrorMessage(cause, "댓글을 보내지 못했어요. 입력 내용은 유지됩니다.")); }
    finally { busy.current = false; setSending(false); }
  };
  return <section className="fb-thread" aria-label="댓글과 운영자 답변">
    <h4>함께 나누는 의견</h4>
    {loading ? <p role="status" className="fb-caption">댓글을 불러오고 있어요.</p> : loadError ? <div className="fb-error" role="alert"><p>{loadError}</p><button className="fb-text-button" type="button" onClick={() => setTick((value) => value + 1)}>댓글 다시 불러오기</button></div> : replies.length ? <ul className="fb-replies">{replies.map((reply) => <Reply key={reply.id} reply={reply} />)}</ul> : <p className="fb-caption">아직 댓글이 없어요. 같은 경험이나 도움이 되는 정보를 남겨주세요.</p>}
    {userId ? <form onSubmit={send} className="fb-form fb-reply-form" aria-busy={sending}>
      <label htmlFor={`${id}-reply`}>공개 댓글</label>
      <textarea id={`${id}-reply`} value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={1500} disabled={sending} placeholder="같은 증상, 추가 정보, 해결 방법을 공유해 주세요." />
      {readOnly && <p className="fb-caption">입력 내용은 유지됩니다. 목록을 다시 확인한 뒤 등록해 주세요.</p>}
      <div className="fb-row"><span className="fb-caption">개인정보는 남기지 마세요.</span><button type="submit" className="fb-button" disabled={sending || readOnly || !text.trim()}>{sending ? "등록 중…" : "댓글 등록"}</button></div>
      {sendError && <p className="fb-error" role="alert">{sendError}</p>}<p className="fb-success" role="status">{success}</p>
    </form> : <p className="fb-notice">로그인하면 댓글을 남길 수 있어요.</p>}
  </section>;
}
