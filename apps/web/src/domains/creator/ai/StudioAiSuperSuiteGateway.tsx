import { Suspense, useEffect, useState } from "react";

import { compileStudioAiSuitePromptHandoff } from "./studio-ai-suite-handoff";
import { subscribeStudioAiSuperSuiteOpenRequest } from "./studio-ai-super-suite-intent";
import { studioAiSuperSuiteModalLoader } from "./studio-ai-super-suite-loader";

import { lazyRetry } from "@/shared/lib/lazy-retry";

const StudioAiSuperSuiteModal = lazyRetry(
  studioAiSuperSuiteModalLoader.load,
  "StudioAiSuperSuiteModal",
);

/** Own only the optional dialog lifetime, never the host's menu or image-tool state. */
export function StudioAiSuperSuiteGateway({ onApplyPrompt }: { readonly onApplyPrompt: (prompt: string) => void }) {
  const [open, setOpen] = useState(false);
  // Subscribe also consumes pre-mount requests. Unlike consuming in a state initializer,
  // effect delivery remains intact through StrictMode's render/effect replay.
  useEffect(() => subscribeStudioAiSuperSuiteOpenRequest(() => setOpen(true)), []);
  const applyPrompt = (prompt: string) => {
    onApplyPrompt(prompt);
    setOpen(false);
  };
  if (!open) return null;
  return (
    <Suspense fallback={
      <div className="fixed inset-0 z-[120] grid place-items-center bg-bg/80 p-4 backdrop-blur-sm" role="status">
        <div className="rounded-xl border border-line bg-panel px-4 py-3 text-sm font-semibold text-fg shadow-xl">
          AI 웹툰 레시피 도구를 여는 중…
          <button type="button" className="ml-3 min-h-11 rounded-lg border border-line px-3" onClick={() => setOpen(false)}>열기 취소</button>
        </div>
      </div>
    }>
      <StudioAiSuperSuiteModal
        open
        onClose={() => setOpen(false)}
        onApplyPrompt={applyPrompt}
        onApplyPromptRecipe={(handoff) => applyPrompt(compileStudioAiSuitePromptHandoff(handoff))}
      />
    </Suspense>
  );
}
