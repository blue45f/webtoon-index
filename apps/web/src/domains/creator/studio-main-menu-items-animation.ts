/**
 * §15.3 Animation — the group that shipped a full timeline and rendered nothing.
 *
 * Animation was one of the two §15.3 groups the regroup left declared-but-empty,
 * on the reading that we ship no animation command. We do: the multi-layer
 * keyframe timeline (`StudioAnimTimelinePanel`), per-element frame/cel animation
 * with GIF·APNG·WebM export (`StudioFrameAnimationPanel`) and onion skinning are
 * all implemented. Their doors were the mobile-only tool belt, the below-the-fold
 * rail, and a checkbox nested two panels deep — which is why the audit read the
 * group as absent.
 *
 * Rows §15.3 asks for that the product genuinely lacks (Rig/Puppet as an
 * animation rig, State Machine, Audio tracks, Motion Capture as a menu command,
 * OTIO/sequence export) stay recorded as gaps in
 * `studio-main-menu-group-spec.ts` rather than closed with a dead row.
 */

import { Film, Layers2, SlidersHorizontal } from "lucide-react";

import type { StudioMainMenuItemContext } from "./studio-main-menu-contract";
import type { StudioMainMenuItem } from "./studio-main-menu-model";

export function buildStudioAnimationMenuItems({
  state,
  ui,
}: StudioMainMenuItemContext): StudioMainMenuItem[] {
  return [
    {
      id: "timeline",
      commandId: "animation.timeline",
      label: state.animationTimelineOpen ? "타임라인 닫기" : "타임라인 열기",
      icon: SlidersHorizontal,
      checked: state.animationTimelineOpen,
      selectionRole: "checkbox",
      disabled: state.masterEditMode,
      unavailableReason: state.masterEditMode
        ? "마스터 편집을 끝낸 뒤 타임라인을 여세요."
        : undefined,
      onSelect: () => {
        ui.toggleAnimationTimeline();
      },
    },
    {
      id: "frame-anim",
      commandId: "animation.frame-cel",
      label: "프레임 애니메이션…",
      icon: Film,
      onSelect: () => {
        ui.openFrameAnimation();
      },
    },
    {
      id: "onion-skin",
      commandId: "animation.onion-skin",
      label: "어니언 스킨",
      icon: Layers2,
      checked: state.onionSkinEnabled,
      selectionRole: "checkbox",
      onSelect: () => {
        ui.toggleOnionSkin();
      },
    },
  ];
}
