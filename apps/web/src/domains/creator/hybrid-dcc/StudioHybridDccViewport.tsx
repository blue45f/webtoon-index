/** Keep the established viewport API while connecting bounded, reversible authoring tools. */
import { useRef } from "react";

import { StudioHybridDccMeshSelectionTools } from "./StudioHybridDccMeshSelectionTools";
import { StudioHybridDccPrecisionTools } from "./StudioHybridDccPrecisionTools";
import { StudioHybridDccTransformUtilities } from "./StudioHybridDccTransformUtilities";
import {
  StudioHybridDccViewport as StudioHybridDccViewportCore,
  type StudioHybridDccViewportProps,
} from "./StudioHybridDccViewportCore";

// eslint-disable-next-line react-refresh/only-export-components -- preserve the public viewport projection/test contracts
export * from "./StudioHybridDccViewportCore";

export function StudioHybridDccViewport(props: StudioHybridDccViewportProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scopeRef} className="min-w-0" data-studio-hybrid-dcc-selection-shell="true">
      <StudioHybridDccViewportCore {...props} />
      <StudioHybridDccMeshSelectionTools {...props} scopeRef={scopeRef} />
      <StudioHybridDccPrecisionTools {...props} />
      <StudioHybridDccTransformUtilities {...props} />
    </div>
  );
}
