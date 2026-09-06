import { STUDIO_BG3D_CONTROL_BUTTON, studioBg3dClassNames } from "./studio-bg3d-editor-ui";
import { STUDIO_BG3D_ENGINE_PREFERENCE_LABELS, STUDIO_BG3D_ENGINE_PREFERENCES } from "./studio-bg3d-engine-selection";

import type { StudioBg3dEnginePreference } from "./studio-bg3d-engine-selection";

/** The blocked viewport offers the same explicit choices as the engine panel; never auto-switch. */
export function StudioBg3dEngineRecoveryActions({
  preference,
  onPreferenceChange,
}: {
  readonly preference: StudioBg3dEnginePreference;
  readonly onPreferenceChange: (preference: StudioBg3dEnginePreference) => void;
}) {
  return (
    <div role="group" aria-label="사용할 3D 엔진 직접 선택" className="mt-3 flex max-w-full flex-wrap justify-center gap-2">
      {STUDIO_BG3D_ENGINE_PREFERENCES.map((engine) => (
        <button
          key={engine}
          type="button"
          data-testid={`studio-bg3d-recovery-${engine}`}
          className={studioBg3dClassNames(STUDIO_BG3D_CONTROL_BUTTON, "min-h-11 border-line bg-panel px-4 text-fg hover:border-accent/60 hover:bg-raised")}
          onClick={() => onPreferenceChange(engine)}
        >
          {STUDIO_BG3D_ENGINE_PREFERENCE_LABELS[engine]}
          {engine === preference ? " 다시 시도" : " 직접 선택"}
        </button>
      ))}
    </div>
  );
}
