import { Download, FileText, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { LocalMusicTrack } from "./studio-music-client";

import { MUSIC_MOODS, musicFilename } from "@toonspectrum/core/studio-music";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  let started = false;
  let link: HTMLAnchorElement | undefined;
  try {
    link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); started = true;
  } finally {
    link?.remove();
    // A failed click also releases its resource. Successful WebKit downloads need a delay.
    if (started) window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    else URL.revokeObjectURL(url);
  }
}
const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 text-xs hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
export function MusicTrackCard({ track, saved, busy, pending, onDelete, onSave, onReuse }: {
  track: LocalMusicTrack; saved: boolean; busy: boolean; pending: boolean;
  onDelete: () => Promise<void>; onSave: () => Promise<void>; onReuse: () => void;
}) {
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [action, setAction] = useState<"save" | "delete" | null>(null);
  const actionLock = useRef(false);
  const [error, setError] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    let objectUrl = "";
    try { objectUrl = URL.createObjectURL(track.audio); setUrl(objectUrl); }
    catch { setError("미리듣기 주소를 만들지 못했습니다. 기기 저장 상태를 확인해 주세요."); }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [track.audio]);
  const b = track.metadata.brief;
  const disabled = busy || pending || action !== null;
  const downloadAudio = () => { try { download(track.audio, musicFilename(b.title)); } catch { setError("음원을 다운로드하지 못했습니다."); } };
  const downloadMetadata = () => {
    try { download(new Blob([JSON.stringify(track.metadata, null, 2)], { type: "application/json" }), musicFilename(b.title).replace(/\.mp3$/, ".json")); }
    catch { setError("제작 정보를 다운로드하지 못했습니다."); }
  };
  const run = async (kind: "save" | "delete") => {
    if (actionLock.current || disabled) return;
    actionLock.current = true; setAction(kind); setError("");
    try {
      if (kind === "save") await onSave();
      else { await onDelete(); setConfirming(false); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "보관함 작업을 완료하지 못했습니다. MP3를 먼저 다운로드해 주세요.");
    } finally { actionLock.current = false; setAction(null); }
  };
  return (
    <article className="space-y-3 rounded-2xl border border-line bg-card p-4" aria-label={`${b.title} 음원`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="break-words font-semibold">{b.title}</h3><p className="mt-1 text-xs text-fg-3">{MUSIC_MOODS.find((m) => m.id === b.mood)?.label} · 요청 {b.seconds}초{duration === null ? "" : ` / 실제 ${duration.toFixed(1)}초`} · {b.vocals ? "보컬" : "연주곡"}</p></div>
        <span className="shrink-0 rounded-full bg-panel px-2 py-1 text-xs text-fg-2">{pending ? "저장소 처리 중" : saved ? "기기에 저장됨" : "저장 확인 필요"}</span>
      </div>
      <p className="line-clamp-2 text-sm text-fg-2">{b.scene}</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Music-only playback; requested lyrics are provided below, not claimed as a transcript. */}
      {url && <audio aria-label={`${b.title} 미리듣기`} className="w-full" src={url} controls preload="metadata" loop={repeat} onLoadedMetadata={(event) => { const seconds = event.currentTarget.duration; setDuration(Number.isFinite(seconds) && seconds > 0 ? seconds : null); }} onError={() => setError("브라우저에서 재생하지 못했습니다. MP3를 다운로드해 확인해 주세요.")} onPlay={(event) => { const current = event.currentTarget; document.querySelectorAll<HTMLAudioElement>("audio[data-toon-music]").forEach((audio) => { if (audio !== current) audio.pause(); }); }} data-toon-music />}
      {b.vocals && <details className="text-sm"><summary className="cursor-pointer">요청한 가사 보기</summary><p className="mt-2 whitespace-pre-wrap text-fg-2">{b.lyrics}</p><p className="mt-2 text-xs text-fg-3">생성 음원의 실제 가창과 다를 수 있습니다.</p></details>}
      <label className="flex min-h-8 items-center gap-2 text-xs text-fg-2"><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} />반복 재생</label>
      {!saved && <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs leading-relaxed"><p>아래 버튼은 같은 음원을 기기에 다시 저장합니다. 음악을 재생성하거나 외부 AI를 다시 호출하지 않습니다. 화면을 닫기 전에 MP3를 다운로드해 주세요.</p><button type="button" className={`${actionClass} mt-2`} onClick={() => void run("save")} disabled={disabled}><Save size={14} aria-hidden />{action === "save" ? "기기에 저장 중…" : "기기에 다시 저장"}</button></div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={actionClass} onClick={downloadAudio}><Download size={14} aria-hidden />MP3 저장</button>
        <button type="button" className={actionClass} onClick={downloadMetadata}><FileText size={14} aria-hidden />제작 정보</button>
        <button type="button" className={actionClass} onClick={onReuse} disabled={disabled}><RotateCcw size={14} aria-hidden />설정 다시 사용</button>
        <button type="button" className={actionClass} onClick={() => setConfirming(true)} disabled={disabled}><Trash2 size={14} aria-hidden />삭제</button>
      </div>
      {confirming && <div className="rounded-lg border border-line p-3 text-sm"><p>이 기기의 음원을 삭제할까요? 필요한 MP3를 먼저 다운로드해 주세요.</p><div className="mt-2 flex gap-2"><button type="button" className={actionClass} disabled={disabled} onClick={() => void run("delete")}>삭제 확인</button><button type="button" className={actionClass} onClick={() => setConfirming(false)} disabled={disabled}>유지</button></div></div>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <p className="text-xs leading-relaxed text-fg-3">Eleven Music · {new Date(track.metadata.createdAt).toLocaleDateString("ko-KR")} · AI 생성 음원. 상용 이용은 공급자 요금제와 이용 조건을 확인해 주세요.</p>
    </article>
  );
}
