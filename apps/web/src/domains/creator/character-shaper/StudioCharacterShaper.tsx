/**
 * Character Shaper — the mounted surface (`/studio/character`).
 *
 * It builds the existing poser runtime (`useStudioVrmPoserController`) and the Shaper binding in
 * the *same commit* as the dialog: the shell installs its key layer on mount and reads
 * `binding.busyReason` on its first render, so a Suspense boundary between controller and dialog
 * would leave the workshop keyboard-dead for a frame. The lazy boundary therefore lives outside
 * this component (`StudioThreeDPreviewPanelStack`), exactly as it does for `StudioVrmPoser`.
 *
 * 고급 편집 swaps the whole dialog for the legacy builder over the same host — no second scene, no
 * reload — and portals a "셰이퍼로 돌아가기" button *into* the legacy dialog element so the poser's
 * own Tab trap keeps it reachable.
 */

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";
import { StudioVrmPoserDialog } from "../vrm/StudioVrmPoserDialog";
import { useStudioVrmPoserController } from "../vrm/useStudioVrmPoserController";

import { StudioCharacterShaperDialog } from "./StudioCharacterShaperDialog";
import { useCharacterShaperBinding } from "./useCharacterShaperBinding";

import type { StudioVrmPoserProps } from "../vrm/StudioVrmPoserTypes";
import type { RefObject } from "react";

import { cn } from "@/shared/lib/utils";

export type { StudioVrmPoserProps } from "../vrm/StudioVrmPoserTypes";

const RETURN_BUTTON_CLASS = cn(
  "absolute bottom-3 left-3 z-[60] inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-accent/55 bg-panel/95 px-3 text-[0.75rem] font-semibold text-accent shadow-lg backdrop-blur",
  "transition-colors hover:bg-accent-soft motion-reduce:transition-none",
  STUDIO_FOCUS_RING,
);

export function StudioCharacterShaper(props: StudioVrmPoserProps) {
  const { open } = props;
  const h = useStudioVrmPoserController(props);
  const binding = useCharacterShaperBinding(h);
  const [advanced, setAdvanced] = useState(false);
  const [advancedRoot, setAdvancedRoot] = useState<HTMLElement | null>(null);
  const dialogRef = h.dialogRef as RefObject<HTMLElement | null> | undefined;

  useEffect(() => {
    if (!open) setAdvanced(false);
  }, [open]);

  // The legacy dialog owns the element; read it after its commit so the return button can be
  // portaled inside the poser's focus trap.
  useEffect(() => {
    if (!advanced) {
      setAdvancedRoot(null);
      return;
    }
    setAdvancedRoot(dialogRef?.current ?? null);
  }, [advanced, dialogRef]);

  if (!open) return null;

  if (advanced) {
    return (
      <>
        <StudioVrmPoserDialog h={h} />
        {advancedRoot
          ? createPortal(
              <button
                type="button"
                data-character-shaper-return="true"
                onClick={() => setAdvanced(false)}
                className={RETURN_BUTTON_CLASS}
              >
                <ArrowLeft size={15} aria-hidden />
                셰이퍼로 돌아가기
              </button>,
              advancedRoot,
            )
          : null}
      </>
    );
  }

  return <StudioCharacterShaperDialog h={h} binding={binding} onOpenAdvanced={() => setAdvanced(true)} />;
}
