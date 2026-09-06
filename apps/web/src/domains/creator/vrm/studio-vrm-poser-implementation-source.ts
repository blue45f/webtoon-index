import { readFileSync } from "node:fs";

/** Extracted StudioVrmPoser implementation files used by source-scan tests. */
export const STUDIO_VRM_POSER_IMPLEMENTATION_FILES = [
  "./StudioVrmPoserTypes.ts",
  "./StudioVrmViewportHelpers.tsx",
  "./StudioVrmViewportUtils.ts",
  "./StudioVrmActor.tsx",
  "./StudioVrmPoserHost.ts",
  "./useStudioVrmPoserController.ts",
  "./useStudioVrmPoserState.ts",
  "./useStudioVrmPoserRuntimeA.ts",
  "./useStudioVrmPoserIk.ts",
  "./useStudioVrmPoserRuntimeB.ts",
  "./useStudioVrmPoserBroadcast.ts",
  "./useStudioVrmPoserRuntimeC.ts",
  "./useStudioVrmPoserPoseLibrary.ts",
  "./useStudioVrmPoserShare.ts",
  "./useStudioVrmPoserRuntimeD.ts",
  "./useStudioVrmPoserInstall.ts",
  "./useStudioVrmPoserPoseEdit.ts",
  "./useStudioVrmPoserRuntimeE.ts",
  "./StudioVrmPoser.tsx",
  "./StudioVrmPoserDialog.tsx",
  "./StudioVrmPoserViewport.tsx",
  "./StudioVrmPoserPanelBodyA.tsx",
  "./StudioVrmPoserPanelBodyB.tsx",
  "./StudioVrmPoserPanelBodyC.tsx",
  "./StudioVrmPoserPanelBodyD.tsx",
] as const;

export function readStudioVrmPoserImplementationSource(baseUrl: string | URL = import.meta.url): string {
  return STUDIO_VRM_POSER_IMPLEMENTATION_FILES.map((file) =>
    readFileSync(new URL(file, baseUrl), "utf8"),
  ).join("\n");
}
