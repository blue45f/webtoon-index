import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { clearReferenceDraft, persistReferenceDraft, readReferenceDrafts } from "./reference-drafts";
import { REFERENCE_NOTICE_KEYS } from "./reference-i18n";
import { sameReferenceNote } from "./reference-storage";

import type { ReferenceNotice } from "./reference-i18n";
import type { ReferenceNote } from "./reference-storage";
import type { ReferenceItem } from "@/shared/lib/kmas-reference";

import { useT } from "@/shared/lib/i18n";

export type CommitReference = (item: ReferenceItem, text: string, expected: ReferenceNote | null) => Promise<ReferenceNote | null>;

export function ReferenceNoteEditor({ item, note, onCommit, onDirty, onDraftChange, saving }: {
  item: ReferenceItem; note?: ReferenceNote; onCommit: CommitReference; onDirty: (dirty: boolean) => void;
  onDraftChange: () => void; saving: boolean;
}) {
  const t = useT();
  const [recovery] = useState(() => readReferenceDrafts());
  const recovered = recovery.drafts.find((entry) => entry.item.id === item.id);
  const [draft, setDraft] = useState(recovered?.note ?? note?.note ?? "");
  const [baseline, setBaseline] = useState<ReferenceNote | null>(recovered ? recovered.baseline : note ?? null);
  const [draftNotice, setDraftNotice] = useState<ReferenceNotice | null>(
    recovery.unavailable ? "draftUnavailable" : recovered ? "draftRecovered" : null,
  );
  const dirty = draft !== (baseline?.note ?? "");
  const changedElsewhere = !sameReferenceNote(baseline, note ?? null);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const remember = (text: string) => {
    setDraft(text);
    const result = text === (baseline?.note ?? "") ? clearReferenceDraft(item.id)
      : persistReferenceDraft({ item, note: text, baseline, updatedAt: new Date().toISOString() });
    setDraftNotice(result.ok ? text === (baseline?.note ?? "") ? null : "draftRetained" : "draftUnavailable");
    onDraftChange();
  };
  const save = async () => {
    const submitted = draft;
    const stored = await onCommit(item, submitted, baseline);
    if (stored) {
      setBaseline(stored);
      const result = clearReferenceDraft(item.id, submitted);
      setDraftNotice(result.ok ? null : "draftCleanupFailed");
      onDraftChange();
    }
  };
  const reloadLatest = () => {
    if (dirty && !window.confirm(t("ref.replaceDraftConfirm"))) return;
    const result = clearReferenceDraft(item.id);
    setDraft(note?.note ?? ""); setBaseline(note ?? null);
    setDraftNotice(result.ok ? null : "draftCleanupFailed"); onDraftChange();
  };
  return <section className="ref-note-editor"><label htmlFor="ref-personal-note">{t("ref.noteTitle")}</label>
    <textarea id="ref-personal-note" value={draft} disabled={saving} maxLength={4000} rows={5}
      onChange={(event) => remember(event.target.value)} placeholder={t("ref.notePlaceholder")} aria-describedby="ref-note-help" />
    <p className="ref-small" id="ref-note-help">{t("ref.noteHelp")}</p>
    {draftNotice && <p className="ref-small" role="status">{t(REFERENCE_NOTICE_KEYS[draftNotice])}</p>}
    {changedElsewhere && <div className="ref-notice" role="alert"><p>{t("ref.noteChangedElsewhere")}</p>
      <p className="ref-note-preview">{note?.note || t("ref.noNote")}</p>
      <button type="button" className="ref-button" disabled={saving} onClick={reloadLatest}>{t("ref.reloadLatest")}</button>
    </div>}
    <div className="ref-actions"><button type="button" className="ref-button ref-primary" disabled={saving || (Boolean(baseline) && !dirty)}
      onClick={() => { void save(); }}><Check size={16} />{t(saving ? "ref.saving" : "ref.noteSave")}</button>
      <span className="ref-small">{draft.length.toLocaleString()} / 4,000</span></div>
  </section>;
}
