import { StudioVrmPoserDialog } from "./StudioVrmPoserDialog";
import { useStudioVrmPoserController } from "./useStudioVrmPoserController";

import type { StudioVrmPoserProps } from "./StudioVrmPoserTypes";
import type { StudioVrmPoserInsertResult } from "../scene-3d/studio-3d-insert-contract";

export type { StudioVrmPoserInsertResult } from "../scene-3d/studio-3d-insert-contract";

export type {
  CaptureState,
  CustomPose,
  LibraryStatus,
  LoadStatus,
  OrbitLike,
  PendingStudioVrmPersistentIkCommand,
  StudioVrmBroadcastCameraLease,
  StudioVrmIkTransaction,
  StudioVrmPoserProps,
  StudioVrmTexturePaintSettingsUpdate,
  TexturePaintPersistenceStatus,
  ViewportApi,
  VrmCreativePersistenceStatus,
} from "./StudioVrmPoserTypes";

export function StudioVrmPoser(props: StudioVrmPoserProps) {
  const { open } = props;
  const h = useStudioVrmPoserController(props);
  if (!open) return null;
  return <StudioVrmPoserDialog h={h} />;
}
