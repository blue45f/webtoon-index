import { ArrowUpFromLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MAX_REFERENCE_BACKUP_BYTES, parseReferenceBackup, previewReferenceImport } from "./reference-storage";

import type { ReferenceMutationResult, ReferenceNote } from "./reference-storage";

import { useT } from "@/shared/lib/i18n";


export function ReferenceImport({ current, busy, unavailable, onImport }: {
  current: ReferenceNote[]; busy: boolean; unavailable: boolean;
  onImport: (notes: ReferenceNote[]) => Promise<ReferenceMutationResult>;
}) {
  const t = useT();
  const sequence = useRef(0);
  const previewRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [document, setDocument] = useState<{ notes: ReferenceNote[]; filename: string } | null>(null);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => { if (document) previewRef.current?.focus(); }, [document]);
  const readFile = async (file: File) => {
    const request = ++sequence.current;
    setReading(true); setFailed(false); setDocument(null);
    try {
      if (file.size > MAX_REFERENCE_BACKUP_BYTES) throw new Error("backup too large");
      const notes = parseReferenceBackup(await file.text());
      if (sequence.current === request) setDocument({ notes, filename: file.name.slice(0, 200) });
    } catch {
      if (sequence.current === request) setFailed(true);
    } finally {
      if (sequence.current === request) setReading(false);
    }
  };
  const cancel = () => { sequence.current++; setDocument(null); setReading(false); setFailed(false); fileInputRef.current?.focus(); };
  const confirm = async () => {
    if (!document || busy || unavailable) return;
    const request = sequence.current;
    const result = await onImport(document.notes);
    if (sequence.current === request && result.ok) { setDocument(null); fileInputRef.current?.focus(); }
  };
  const preview = document ? previewReferenceImport(current, document.notes) : null;
  return <div className="ref-import">
    <label htmlFor="ref-backup-file" className="ref-button ref-import-label"><ArrowUpFromLine size={17} aria-hidden="true" />{t("ref.importBackup")}
      <input id="ref-backup-file" ref={fileInputRef} type="file" accept="application/json,.json" disabled={busy || reading || unavailable}
        aria-label={t("ref.importBackup")} onChange={(event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (file) void readFile(file);
        }} />
    </label>
    {reading && <p className="ref-small" role="status">{t("ref.readingBackup")}</p>}
    {failed && <p className="ref-notice" role="alert">{t("ref.invalidBackup")}</p>}
    {document && preview && <section ref={previewRef} tabIndex={-1} className="ref-import-preview" aria-labelledby="ref-import-title">
      <h3 id="ref-import-title">{t("ref.importPreview")}</h3><p className="ref-small">{document.filename}</p>
      <dl className="ref-import-counts">
        <div><dt>{t("ref.importNew")}</dt><dd>{preview.additions.length}</dd></div>
        <div><dt>{t("ref.importKept")}</dt><dd>{preview.duplicates}</dd></div>
        <div><dt>{t("ref.importDifferent")}</dt><dd>{preview.differentNotes}</dd></div>
        <div><dt>{t("ref.importTotal")}</dt><dd>{preview.resultingCount} / 100</dd></div>
      </dl>
      <p className="ref-small">{t("ref.importPreviewHelp")}</p>
      {!preview.withinLimit && <p className="ref-notice" role="alert">{t("ref.limit")}</p>}
      {preview.additions.length === 0 && <p className="ref-small" role="status">{t("ref.importNoNew")}</p>}
      {preview.additions.length > 0 && <ul className="ref-import-titles">{preview.additions.map(({ item }) => <li key={item.id}>{item.title}</li>)}</ul>}
      <div className="ref-actions">
        <button type="button" className="ref-button ref-primary" disabled={busy || unavailable || !preview.withinLimit || preview.additions.length === 0}
          onClick={() => { void confirm(); }}>{t(busy ? "ref.saving" : "ref.importConfirm")}</button>
        <button type="button" className="ref-button" disabled={busy} onClick={cancel}>{t("ref.cancel")}</button>
      </div>
    </section>}
  </div>;
}
