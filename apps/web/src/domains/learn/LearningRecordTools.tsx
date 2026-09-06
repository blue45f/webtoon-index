import { useEffect, useId, useRef, useState } from "react";

import { hasLearningActivity, MAX_LEARNING_BACKUP_BYTES, readLearningBackup, summarizeLearningProgress, writeLearningBackup, type BackupPreview } from "./learning-backup";
import { LESSONS, TERMS } from "./learning-content";

import type { LearningStore } from "./use-learning-progress";

const TERM_IDS = TERMS.map((term) => term.id);

export function LearningRecordTools({ store }: { store: LearningStore }) {
  const id = useId();
  const [preview, setPreview] = useState<{ fileName: string; result: BackupPreview } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRevision, setConfirmRevision] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const readGeneration = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; readGeneration.current += 1; };
  }, []);
  const summary = summarizeLearningProgress(store.progress);
  const incoming = preview ? summarizeLearningProgress(preview.result.data) : null;
  const preserved = preview ? Object.keys(preview.result.data.lessons).filter((lessonId) => hasLearningActivity(store.progress.lessons[lessonId])).length : 0;

  function exportBackup() {
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const now = new Date().toISOString();
      const raw = writeLearningBackup(store.progress, LESSONS, TERM_IDS, now);
      url = URL.createObjectURL(new Blob([raw], { type: "application/json;charset=utf-8" }));
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `toonstudio-learning-${now.slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      setMessage("백업 파일을 준비했습니다. 브라우저의 다운로드 목록을 확인하세요. 개인 메모가 포함되므로 안전하게 보관하세요.");
    } catch {
      setMessage("백업 파일을 만들지 못했습니다. 실습 메모를 직접 복사해 보관하세요. 기존 기록은 변경하지 않았습니다.");
    } finally {
      anchor?.remove();
      if (url) {
        const objectUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }
  async function inspectBackup(file: File | undefined) {
    const generation = ++readGeneration.current;
    setPreview(null);
    setMessage("");
    if (!file) { setBusy(false); return; }
    if (file.size > MAX_LEARNING_BACKUP_BYTES) {
      setBusy(false);
      setMessage("백업 파일은 512 KiB 이하여야 합니다. 기존 기록은 변경하지 않았습니다.");
      return;
    }
    setBusy(true);
    try {
      const raw = await file.text();
      if (!active.current || generation !== readGeneration.current) return;
      const result = readLearningBackup(raw, LESSONS, TERM_IDS);
      setPreview({ fileName: file.name, result });
      setMessage("파일을 확인했습니다. 아직 기록에 적용하지 않았습니다. 아래 내용을 확인한 후 복원하세요.");
    } catch (error) {
      if (active.current && generation === readGeneration.current) {
        setMessage(error instanceof Error ? error.message : "백업 파일을 읽지 못했습니다.");
      }
    } finally {
      if (active.current && generation === readGeneration.current) setBusy(false);
    }
  }
  function cancelImport() {
    readGeneration.current += 1;
    setBusy(false);
    setPreview(null);
    setMessage("복원을 취소했습니다. 기존 기록은 변경하지 않았습니다.");
    if (fileInput.current) fileInput.current.value = "";
  }
  function restoreBackup() {
    if (!preview) return;
    const saved = store.restore(preview.result.data);
    setPreview(null);
    if (fileInput.current) fileInput.current.value = "";
    setMessage(saved
      ? "기존 학습 기록은 유지하고 새 강좌 기록과 북마크를 복원했습니다."
      : "복원 내용을 이 화면에 반영했지만 기기에 저장하지 못했습니다. 화면의 저장 경고를 확인하고 백업을 보관하세요.");
  }

  return (
    <section className="learn-record-tools" aria-labelledby={`${id}-heading`}>
      <div className="learn-section-heading">
        <div><p className="learn-eyebrow">YOUR LEARNING, YOUR COPY</p><h2 id={`${id}-heading`}>내 학습 기록 보관</h2></div>
        <span className="learn-tag">{store.dirty ? "기기 저장 필요" : "현재 브라우저 기록"}</span>
      </div>
      <p className="learn-small">완료 {summary.completedLessons}개 · 메모 {summary.notes}개 · 저장한 용어 {summary.bookmarks}개</p>
      <p>다른 기기로 옮기거나 브라우저 데이터를 지우기 전에 백업하세요. 메모가 포함된 JSON 파일이며 서버로 전송하지 않습니다.</p>
      <div className="learn-actions">
        <button type="button" onClick={exportBackup}>학습 기록 백업</button>
        {store.dirty && !store.conflict && <button type="button" onClick={() => { const saved = store.retrySave(); setMessage(saved ? "기기에 다시 저장했습니다." : "저장하지 못했습니다. 경고를 확인하고 백업 파일을 보관하세요."); }}>기기에 다시 저장</button>}
      </div>
      <details className="learn-backup-details">
        <summary>백업 파일에서 복원</summary>
        <p className="learn-small">기존에 학습한 강좌는 그대로 두고 비어 있는 강좌 기록과 북마크만 추가합니다. 같은 강좌의 메모를 자동으로 합치거나 덮어쓰지 않습니다.</p>
        <label className="learn-file-label" htmlFor={`${id}-file`}>학습 백업 파일 선택 (.json, 최대 512 KiB)</label>
        <input ref={fileInput} id={`${id}-file`} type="file" accept=".json,application/json" onChange={(event) => { void inspectBackup(event.currentTarget.files?.[0]); }} />
        {busy && <p role="status">백업 내용을 확인하고 있습니다.</p>}
        {preview && incoming && (
          <section className="learn-backup-preview" aria-labelledby={`${id}-preview`}>
            <h3 id={`${id}-preview`}>복원 전 확인</h3>
            <p>{preview.fileName}</p>
            <dl><div><dt>완료 강좌</dt><dd>{incoming.completedLessons}개</dd></div><div><dt>메모가 있는 강좌</dt><dd>{incoming.notes}개</dd></div><div><dt>북마크</dt><dd>{incoming.bookmarks}개</dd></div><div><dt>기존 기록을 유지할 강좌</dt><dd>{preserved}개</dd></div></dl>
            {!!preview.result.ignoredEntries && <p className="learn-small">현재 목록에 없는 항목 {preview.result.ignoredEntries}개는 복원하지 않습니다.</p>}
            {!!preview.result.correctedCompletions && <p className="learn-small">체크리스트·정답 조건을 충족하지 못한 완료 표시 {preview.result.correctedCompletions}개를 해제했습니다.</p>}
            <button type="button" onClick={restoreBackup}>기존 기록 유지하고 복원</button>
          </section>
        )}
        {(busy || preview) && <button type="button" onClick={cancelImport}>복원 취소</button>}
      </details>
      {store.conflict && (
        <div className="learn-caution">
          <h3>다른 탭의 기록과 충돌했습니다</h3>
          <p>동시에 편집한 기록을 자동 병합하지 않습니다. 먼저 이 화면의 기록과 다른 탭의 기록을 각각 백업하세요.</p>
          {confirmRevision === null ? <button type="button" onClick={() => setConfirmRevision(store.revision)}>이 화면 기록으로 저장…</button> : (
            <div role="group" aria-label="충돌 기록 저장 확인">
              <p>다른 탭이 저장한 학습 기록을 이 화면의 기록으로 대체합니다. 백업을 보관했는지 확인하세요.</p>
              <div className="learn-actions"><button type="button" onClick={() => { const saved = store.confirmCurrentRecord(confirmRevision); setConfirmRevision(null); setMessage(saved ? "확인한 이 화면의 기록을 기기에 저장했습니다." : "그동안 기록이 바뀌었거나 저장하지 못했습니다. 내용을 다시 확인하세요."); }}>확인한 기록으로 저장</button><button type="button" onClick={() => setConfirmRevision(null)}>기록 저장 취소</button></div>
            </div>
          )}
        </div>
      )}
      {message && <p className="learn-caption" role="status">{message}</p>}
    </section>
  );
}