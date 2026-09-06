import { describe, expect, it } from "vitest";

import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";

const page = readStudioCuttoonEditorSource();

describe("Studio causal velocity-pressure integration", () => {
  it("advances one dedicated pressure state from authoritative pointer coordinates", () => {
    expect(page).toContain(
      "const drawingVelocityPressureRef = useRef<StudioVelocityPressureState | null>(null)"
    );
    expect(page).toContain("const velocityPressure = advanceStudioBrushVelocityPressure(");
    expect(page).toContain("x: pointerSample.clientX");
    expect(page).toContain("y: pointerSample.clientY");
    expect(page).toContain("timeMs: sampleTimeStamp");
    expect(page).toContain("drawingVelocityPressureRef.current = velocityPressure.state");
    expect(page).toContain(": velocityPressure.pressure");
  });

  it("does not let disposable browser predictions advance authoritative width state", () => {
    expect(page).toContain(
      "const authoritativeVelocityPressure = drawingVelocityPressureRef.current"
    );
    expect(page).toContain(
      "drawingVelocityPressureRef.current = authoritativeVelocityPressure"
    );
  });

  it("uses the same family-aware pressure adapter for replace-only raw pen previews", () => {
    expect(page).toContain(
      "const previewPressure = advanceStudioBrushVelocityPressure("
    );
    expect(page).toContain(
      "drawingVelocityPressureRef.current,\n          {\n            x: pointerEvent.clientX"
    );
    expect(page).not.toContain("const previewPressure = resolveBrushPressureSample({");
  });

  it("initializes and releases the state at the same pointer-session boundary", () => {
    expect(page).toContain(
      "drawingVelocityPressureRef.current = initializeStudioBrushVelocityPressure("
    );
    expect(page).toContain("drawingVelocityPressureRef.current = null;");
  });
});
