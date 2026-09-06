import { ChevronDown, ChevronUp, MessageSquare, ShieldCheck, ThumbsUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { FeedbackThread } from "./FeedbackThread";

import type { FeedbackEntry, FeedbackProgress } from "@toonspectrum/core/feedback";

import { useApp } from "@/shared/lib/store";
import {
  FEEDBACK_AREA_LABELS, FEEDBACK_KIND_LABELS, FEEDBACK_PROGRESS, FEEDBACK_PROGRESS_LABELS, feedbackTimeLabel,
} from "@toonspectrum/core/feedback";
import { isFeedbackEntry, isFeedbackVote } from "@toonspectrum/core/feedback-response";
import { api, getApiErrorMessage } from "@/src/infrastructure/api";

function ProgressEditor({ post, readOnly, onUpdated }: { post: FeedbackEntry; readOnly: boolean; onUpdated: (patch: Partial<FeedbackEntry>) => void }) {
  const id = useId();
  const [progress, setProgress] = useState<FeedbackProgress>(post.progress);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => setProgress(post.progress), [post.progress]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (readOnly || busy.current || progress === post.progress) return;
    if (note.trim().length < 2) { setError("사용자에게 공개할 처리 안내를 입력해 주세요."); return; }
    const viewerId = useApp.getState().userId;
    busy.current = true; setSaving(true); setError("");
    try {
      const entry = await api.post<unknown>(`/feedback/posts/${encodeURIComponent(post.id)}/progress`, {
        progress, expectedProgress: post.progress, note,
      }, { timeout: 30_000, referrerPolicy: "no-referrer" });
      if (useApp.getState().userId !== viewerId) return;
      if (!isFeedbackEntry(entry) || entry.id !== post.id) throw new Error("처리 상태 저장 결과를 확인하지 못했어요. 목록을 새로고침해 주세요.");
      onUpdated({ progress: entry.progress, status: entry.status, answeredAt: entry.answeredAt, replyCount: entry.replyCount });
      setNote("");
    } catch (cause) { setError(await getApiErrorMessage(cause, "처리 상태를 변경하지 못했어요.")); }
    finally { busy.current = false; setSaving(false); }
  };
  return <details className="fb-management">
    <summary><ShieldCheck size={16} aria-hidden="true" /> 운영자 처리 상태 관리</summary>
    <form onSubmit={save} className="fb-form" aria-busy={saving}>
      <label htmlFor={`${id}-progress`}>변경할 처리 상태</label><select id={`${id}-progress`} value={progress} onChange={(event) => setProgress(event.target.value as FeedbackProgress)} disabled={saving}>{FEEDBACK_PROGRESS.map((value) => <option key={value} value={value}>{FEEDBACK_PROGRESS_LABELS[value]}</option>)}</select>
      <label htmlFor={`${id}-note`}>공개 처리 안내</label><textarea id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} disabled={saving} placeholder="검토 결과, 반영 범위 또는 보류 이유를 알려주세요." />
      <p className="fb-caption">상태와 안내는 공개 운영자 댓글로 함께 기록됩니다. 답변만으로 ‘반영 완료’가 되지는 않습니다.</p>
      <button type="submit" disabled={saving || readOnly || progress === post.progress || note.trim().length < 2} className="fb-button">{saving ? "저장 중…" : "처리 상태 저장"}</button>
      {error && <p className="fb-error" role="alert">{error}</p>}
    </form>
  </details>;
}
interface Props {
  post: FeedbackEntry;
  expanded: boolean;
  onToggle: () => void;
  userId: string | null;
  canManage: boolean;
  readOnly?: boolean;
  onUpdated: (patch: Partial<FeedbackEntry>) => void;
  onTag: (tag: string) => void;
}
export function FeedbackPostCard({ post, expanded, onToggle, userId, canManage, readOnly = false, onUpdated, onTag }: Props) {
  const [voting, setVoting] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const detailId = useId();
  const vote = async () => {
    if (!userId || readOnly || busy.current) return;
    const voted = !post.viewerVoted;
    busy.current = true; setVoting(true); setError("");
    try {
      const result = await api.post<unknown>(`/feedback/posts/${encodeURIComponent(post.id)}/vote`, { voted }, { timeout: 20_000, referrerPolicy: "no-referrer" });
      if (!isFeedbackVote(result) || result.voted !== voted) throw new Error("공감 결과를 확인하지 못했어요. 목록을 새로고침해 주세요.");
      if (useApp.getState().userId === userId) onUpdated({ viewerVoted: result.voted, voteCount: result.voteCount });
    } catch (cause) { setError(await getApiErrorMessage(cause, "공감을 반영하지 못했어요.")); }
    finally { busy.current = false; setVoting(false); }
  };
  return <li className="fb-post" data-expanded={expanded || undefined}>
    <article>
      <div className="fb-post-top">
        <span className="fb-kind" data-kind={post.category}>{FEEDBACK_KIND_LABELS[post.category]}</span>
        <span className="fb-progress" data-progress={post.progress}>{FEEDBACK_PROGRESS_LABELS[post.progress]}</span>
        <time dateTime={post.createdAt}>{feedbackTimeLabel(post.createdAt)}</time>
      </div>
      <h3><button type="button" className="fb-post-title" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}><span>{post.title}</span>{expanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}</button></h3>
      {!expanded && <p className="fb-post-excerpt">{post.text}</p>}
      <div className="fb-post-bottom">
        <div className="fb-meta"><span>{post.author.name}</span><span className="fb-comment-count"><MessageSquare size={13} aria-hidden="true" />댓글 {post.replyCount}</span>{post.status === "answered" && <span className="fb-official"><ShieldCheck size={13} aria-hidden="true" />운영자 답변</span>}</div>
        <button type="button" className="fb-vote" onClick={vote} aria-pressed={post.viewerVoted} aria-label={`${post.title} 공감 ${post.voteCount}개${post.viewerVoted ? " 취소" : ""}`} disabled={!userId || voting || readOnly} title={!userId ? "로그인 후 공감할 수 있어요" : undefined}><ThumbsUp size={15} aria-hidden="true" /><span>{voting ? "…" : post.voteCount}</span><span>공감</span></button>
      </div>
      {!!post.tags?.length && <div className="fb-tags">{post.tags.map((tag) => <button key={tag} type="button" onClick={() => onTag(tag)}>#{tag}</button>)}</div>}
      {error && <p className="fb-error" role="alert">{error}</p>}
      <div id={detailId} hidden={!expanded}>
        {expanded && <>
          <p className="fb-post-body">{post.text}</p>
          {post.metadata?.area && <p className="fb-caption">관련 기능: {FEEDBACK_AREA_LABELS[post.metadata.area]}</p>}
          <dl className="fb-reproduction-detail">{([['steps', '재현 순서'], ['expected', '기대했던 동작'], ['actual', '실제로 발생한 동작']] as const).map(([key, label]) => post.metadata?.[key] ? <div key={key}><dt>{label}</dt><dd>{post.metadata[key]}</dd></div> : null)}</dl>
          {canManage && <ProgressEditor post={post} readOnly={readOnly} onUpdated={onUpdated} />}
          <FeedbackThread key={`${post.id}:${userId ?? "guest"}`} postId={post.id} userId={userId} readOnly={readOnly} revision={post.replyCount} onAdded={(reply) => onUpdated({ replyCount: post.replyCount + 1, ...(reply.isOfficial ? { status: "answered", answeredAt: reply.createdAt } : {}) })} />
        </>}
      </div>
    </article>
  </li>;
}
