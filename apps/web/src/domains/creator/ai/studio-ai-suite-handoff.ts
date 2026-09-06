/**
 * Lossless handoff from the local style/prompt suite to a provider-agnostic image prompt.
 *
 * The current image adapter exposes one prompt field. Instead of silently dropping negative
 * constraints and rendering recommendations, compile them into a compact, explicit prompt that
 * every OpenAI-compatible image endpoint can receive. Native provider parameters can replace this
 * compatibility representation later without changing the UI contract.
 */
export const STUDIO_AI_SUITE_HANDOFF_VERSION = 1 as const;
export const STUDIO_AI_SUITE_COMPILED_PROMPT_MAX = 4_000;

export interface StudioAiSuitePromptHandoff {
  readonly version: typeof STUDIO_AI_SUITE_HANDOFF_VERSION;
  readonly positivePrompt: string;
  readonly negativePrompt: string;
  readonly denoiseStrength: number;
  readonly recommendedSettings: {
    readonly lineFactor: number;
    readonly contrast: number;
    readonly saturation: number;
  };
}

function normalizeText(value: string, max: number): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, max).trimEnd();
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function format(value: number): string {
  return finite(value, 1).toFixed(2).replace(/\.?0+$/u, "");
}

export function createStudioAiSuitePromptHandoff(
  input: Omit<StudioAiSuitePromptHandoff, "version">
): StudioAiSuitePromptHandoff {
  return {
    version: STUDIO_AI_SUITE_HANDOFF_VERSION,
    positivePrompt: normalizeText(input.positivePrompt, 2_800),
    negativePrompt: normalizeText(input.negativePrompt, 850),
    denoiseStrength: Math.min(1, Math.max(0, finite(input.denoiseStrength, 0.55))),
    recommendedSettings: {
      lineFactor: Math.min(3, Math.max(0.1, finite(input.recommendedSettings.lineFactor, 1))),
      contrast: Math.min(3, Math.max(0.1, finite(input.recommendedSettings.contrast, 1))),
      saturation: Math.min(3, Math.max(0, finite(input.recommendedSettings.saturation, 1))),
    },
  };
}

/**
 * Compiles a single-field compatibility prompt while preserving all controls.
 * Positive intent is kept first so truncation can never remove the scene itself.
 */
export function compileStudioAiSuitePromptHandoff(
  raw: StudioAiSuitePromptHandoff
): string {
  const handoff = createStudioAiSuitePromptHandoff(raw);
  const sections = [handoff.positivePrompt];

  if (handoff.negativePrompt) {
    sections.push(`Quality constraints — avoid: ${handoff.negativePrompt}`);
  }

  sections.push(
    [
      "Rendering guidance:",
      `denoise strength ${format(handoff.denoiseStrength)}`,
      `line weight ${format(handoff.recommendedSettings.lineFactor)}`,
      `contrast ${format(handoff.recommendedSettings.contrast)}`,
      `saturation ${format(handoff.recommendedSettings.saturation)}`,
      "preserve subject identity and panel composition",
    ].join(", ")
  );

  return sections
    .filter(Boolean)
    .join("\n\n")
    .slice(0, STUDIO_AI_SUITE_COMPILED_PROMPT_MAX)
    .trimEnd();
}
