/* Extracted session contract from StudioCuttoonEditor.
 * Matches the original closure bag from StudioPage/StudioCuttoonEditor. */

import type { StudioCuttoonEditorViewSessionCore } from "./StudioCuttoonEditorViewSessionCore";
import type { StudioCuttoonEditorViewSessionRest } from "./StudioCuttoonEditorViewSessionRest";

export type { StudioCuttoonEditorViewSessionCore } from "./StudioCuttoonEditorViewSessionCore";
export type { StudioCuttoonEditorViewSessionRest } from "./StudioCuttoonEditorViewSessionRest";

export type StudioCuttoonEditorViewSession =
  StudioCuttoonEditorViewSessionCore & StudioCuttoonEditorViewSessionRest;
