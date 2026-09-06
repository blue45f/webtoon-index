import { Suspense, useEffect, useState } from "react";

import { subscribeStudioAiEpisodeProductionOpenRequest } from "./studio-ai-episode-production-intent";
import { studioAiEpisodeProductionModalLoader } from "./studio-ai-episode-production-loader";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const StudioAiEpisodeProductionModal = lazyRetry(
  studioAiEpisodeProductionModalLoader.load,
  "StudioAiEpisodeProductionModal",
);

/** Own only the optional dialog lifetime, never the host's menu or image-tool state. */
export function StudioAiEpisodeProductionGateway({
  onApplyPrompt,
}: {
  readonly onApplyPrompt: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Subscribe also consumes pre-mount requests, and stays intact through StrictMode's replay.
  useEffect(() => subscribeStudioAiEpisodeProductionOpenRequest(() => setOpen(true)), []);
  const applyPrompt = (prompt: string) => {
    onApplyPrompt(prompt);
    setOpen(false);
  };
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <StudioAiEpisodeProductionModal open onClose={() => setOpen(false)} onApplyPrompt={applyPrompt} />
    </Suspense>
  );
}
