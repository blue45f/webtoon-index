import {
  Edit,
  X,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { updateCustomPublishedResource } from "../models/market-custom-registry";
import { MARKET_LICENSES } from "../models/market-kind";

import type {
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";

interface MarketEditResourceModalProps {
  open: boolean;
  onClose: () => void;
  record: CreatorMarketplaceResourceRecord;
  onSaved: (updated: CreatorMarketplaceResourceRecord) => void;
}

export function MarketEditResourceModal({
  open,
  onClose,
  record,
  onSaved,
}: MarketEditResourceModalProps) {
  const [name, setName] = useState(record.name);
  const [description, setDescription] = useState(record.description ?? "");
  const [tagInput, setTagInput] = useState(record.tags.join(", "));
  const [license, setLicense] = useState<CreatorMarketplaceResourceLicense>(record.license);
  const [bumpVersion, setBumpVersion] = useState(false);
  const [newVersion, setNewVersion] = useState(() => {
    const parts = record.resourceVersion.split(".");
    if (parts.length === 3) {
      return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
    }
    return "1.0.1";
  });
  const [releaseNotes, setReleaseNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    const parsedTags = tagInput
      .split(",")
      .map((t) => t.trim().replace(/^#/u, ""))
      .filter((t) => t.length > 0)
      .slice(0, 8);

    const updates: Partial<CreatorMarketplaceResourceRecord> = {
      name: name.trim(),
      description: description.trim(),
      tags: parsedTags,
      license,
      ...(bumpVersion && newVersion.trim()
        ? {
            resourceVersion: newVersion.trim(),
          }
        : {}),
    };

    const updated = updateCustomPublishedResource(record.id, updates);
    setSubmitting(false);
    if (updated) {
      onSaved(updated);
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-edit-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="market-edit-title" className="text-base font-bold text-fg flex items-center gap-2">
            <Edit className="size-4 text-accent" />
            <span>에셋 정보 수정 및 새 버전 릴리즈</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-fg-3 hover:bg-raised hover:text-fg"
          >
            <X className="size-4" />
            <span className="sr-only">닫기</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[80vh] overflow-y-auto p-5 space-y-4">
          <div>
            <label htmlFor="edit-asset-name" className="block text-xs font-semibold text-fg">에셋명</label>
            <input
              id="edit-asset-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              className="mt-1 h-8 w-full rounded-lg border border-line bg-panel px-2.5 text-xs text-fg focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-asset-desc" className="block text-xs font-semibold text-fg">상세 설명</label>
            <textarea
              id="edit-asset-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              className="mt-1 w-full rounded-xl border border-line bg-panel p-2.5 text-xs leading-relaxed text-fg focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-asset-tags" className="block text-xs font-semibold text-fg">태그 (쉼표로 구분, 최대 8개)</label>
            <input
              id="edit-asset-tags"
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="선화, 펜터치, 3D, 웹툰, 로판"
              className="mt-1 h-8 w-full rounded-lg border border-line bg-panel px-2.5 text-xs text-fg focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="edit-asset-license" className="block text-xs font-semibold text-fg">사용권 라이선스</label>
            <select
              id="edit-asset-license"
              value={license}
              onChange={(e) => setLicense(e.target.value as CreatorMarketplaceResourceLicense)}
              className="mt-1 h-8 w-full rounded-lg border border-line bg-panel px-2 text-xs text-fg focus:border-accent focus:outline-none"
            >
              {MARKET_LICENSES.map((lic) => (
                <option key={lic.license} value={lic.license}>
                  {lic.label} ({lic.summary})
                </option>
              ))}
            </select>
          </div>

          {/* New Version Release Section */}
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-3.5 space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold text-fg cursor-pointer select-none">
              <input
                type="checkbox"
                checked={bumpVersion}
                onChange={(e) => setBumpVersion(e.target.checked)}
                className="rounded border-line text-accent focus:ring-accent"
              />
              <span>새 버전으로 판올림 릴리즈 (SemVer Update)</span>
            </label>

            {bumpVersion ? (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fg-3">현재 v{record.resourceVersion} →</span>
                  <input
                    type="text"
                    value={newVersion}
                    onChange={(e) => setNewVersion(e.target.value)}
                    placeholder="1.1.0"
                    aria-label="새 버전 번호"
                    className="h-8 w-28 rounded-lg border border-line bg-panel px-2 text-xs font-mono font-bold text-accent focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="edit-asset-release-notes" className="block text-[0.7rem] font-semibold text-fg">
                    릴리즈 노트 (업데이트 변경사항)
                  </label>
                  <textarea
                    id="edit-asset-release-notes"
                    rows={2}
                    value={releaseNotes}
                    onChange={(e) => setReleaseNotes(e.target.value)}
                    placeholder="예: 필압 보정 곡선 최적화 및 3D 뷰포트 은선 렌더링 성능 향상"
                    className="mt-1 w-full rounded-lg border border-line bg-panel p-2 text-xs text-fg focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={onClose}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className={buttonClass({
                variant: "solid",
                size: "md",
                className: "disabled:opacity-40",
              })}
            >
              수정 사항 저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
