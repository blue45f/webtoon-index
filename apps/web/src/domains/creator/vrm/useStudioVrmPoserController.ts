/**
 * Studio VRM poser controller — wires extracted state/runtime slices.
 */
import { useStudioVrmPoserBroadcast } from "./useStudioVrmPoserBroadcast";
import { useStudioVrmPoserIk } from "./useStudioVrmPoserIk";
import { useStudioVrmPoserInstall } from "./useStudioVrmPoserInstall";
import { useStudioVrmPoserPoseEdit } from "./useStudioVrmPoserPoseEdit";
import { useStudioVrmPoserPoseLibrary } from "./useStudioVrmPoserPoseLibrary";
import { useStudioVrmPoserRuntimeA } from "./useStudioVrmPoserRuntimeA";
import { useStudioVrmPoserRuntimeB } from "./useStudioVrmPoserRuntimeB";
import { useStudioVrmPoserRuntimeC } from "./useStudioVrmPoserRuntimeC";
import { useStudioVrmPoserRuntimeD } from "./useStudioVrmPoserRuntimeD";
import { useStudioVrmPoserRuntimeE } from "./useStudioVrmPoserRuntimeE";
import { useStudioVrmPoserShare } from "./useStudioVrmPoserShare";
import { useStudioVrmPoserState } from "./useStudioVrmPoserState";

import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type { StudioVrmPoserProps } from "./StudioVrmPoserTypes";

export function useStudioVrmPoserController(props: StudioVrmPoserProps): StudioVrmPoserHost {
  const h = useStudioVrmPoserState(props);
  const impl: Record<string, (...args: any[]) => any> = {};
  h.__impl = impl;
  h.commitFullStateRestore = (...args: any[]) => impl.commitFullStateRestore(...args);
  h.applyProportionRigState = (...args: any[]) => impl.applyProportionRigState(...args);
  h.rememberCharacterSelection = (...args: any[]) => impl.rememberCharacterSelection(...args);
  h.clearCurrentVrm = (...args: any[]) => impl.clearCurrentVrm(...args);
  h.installVrm = (...args: any[]) => impl.installVrm(...args);
  useStudioVrmPoserRuntimeA(h);
  useStudioVrmPoserIk(h);
  useStudioVrmPoserRuntimeB(h);
  useStudioVrmPoserBroadcast(h);
  useStudioVrmPoserRuntimeC(h);
  useStudioVrmPoserPoseLibrary(h);
  useStudioVrmPoserShare(h);
  useStudioVrmPoserRuntimeD(h);
  useStudioVrmPoserInstall(h);
  useStudioVrmPoserPoseEdit(h);
  useStudioVrmPoserRuntimeE(h);
  return h;
}
