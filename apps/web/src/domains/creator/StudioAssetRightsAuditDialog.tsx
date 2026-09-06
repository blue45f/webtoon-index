import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  buildStudioAssetRightsManifest,
  type StudioAssetRightsAttestationInput,
} from "./studio-asset-rights-manifest";
import {
  projectStudioAssetRightsUsages,
  type StudioAssetRightsProjectionPage,
} from "./studio-asset-rights-projection";
import { StudioAssetRightsManifestPanel } from "./StudioAssetRightsManifestPanel";

export interface StudioAssetRightsAuditDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly workId?: string | null;
  readonly pages: readonly StudioAssetRightsProjectionPage[];
}

function downloadLocalManifest(payload: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([payload], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StudioAssetRightsAuditDialog({
  open,
  onClose,
  workId,
  pages,
}: StudioAssetRightsAuditDialogProps) {
  const [reviewer, setReviewer] = useState("");
  const [attestation, setAttestation] =
    useState<StudioAssetRightsAttestationInput | null>(null);
  const [openedAt] = useState(() => Date.now());
  const usages = open ? projectStudioAssetRightsUsages(pages) : [];
  const result = buildStudioAssetRightsManifest({
    workId: workId?.trim() || `local:${pages[0]?.id ?? "untitled"}`,
    usages,
    attestation,
    now: openedAt,
  });

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="에셋 권리·납품 감사"
      className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto overscroll-contain bg-[oklch(0.08_0.01_70/0.82)] p-2 backdrop-blur-sm sm:p-4"
    >
      <div className="w-full max-w-6xl">
        <StudioAssetRightsManifestPanel
          result={result}
          reviewer={reviewer}
          onReviewerChange={setReviewer}
          onAttestationChange={setAttestation}
          onExportJson={(payload) =>
            downloadLocalManifest(
              payload,
              "toonspectrum-asset-rights-v1.json",
              "application/json"
            )
          }
          onExportCsv={(payload) =>
            downloadLocalManifest(
              payload,
              "toonspectrum-asset-rights-v1.csv",
              "text/csv;charset=utf-8"
            )
          }
          onClose={onClose}
        />
      </div>
    </div>,
    document.body
  );
}
