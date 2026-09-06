import { describe, expect, it } from "vitest";

import source from "./StudioToolHint.tsx?raw";

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  const nextFunction = source.indexOf("\n  function ", start + 1);
  expect(start, `${name} must remain present`).toBeGreaterThanOrEqual(0);
  return source.slice(start, nextFunction < 0 ? source.length : nextFunction);
}

describe("StudioToolHint focus takeover contract", () => {
  it("blocks the synthetic focus caused by activating the same pointer target", () => {
    const dismissPointerActivation = functionBody("dismissPointerActivation");
    const handleFocus = functionBody("handleFocus");

    expect(dismissPointerActivation).toContain("pointerDismissed.current = true;");
    expect(handleFocus).toMatch(/if \(pointerDismissed\.current \|\| preferences\.mode === "off"\) return;/u);
  });

  it("lets later keyboard or assistive focus clear global pointer suppression and reveal", () => {
    const handleFocus = functionBody("handleFocus");

    expect(handleFocus).not.toContain("suppressedPointerHintAt !== null");
    expect(handleFocus).toContain("clearPointerSuppression();");
    expect(handleFocus).toContain('reveal(richCoachEnabled, "focus");');
    expect(handleFocus.indexOf("clearPointerSuppression();")).toBeLessThan(
      handleFocus.indexOf('reveal(richCoachEnabled, "focus");')
    );
  });

  it("preserves an expanded rich coach when the pointer returns from hoverable content", () => {
    const reveal = functionBody("reveal");
    const scheduleShow = functionBody("scheduleShow");

    expect(scheduleShow).toContain("if (open) {");
    expect(scheduleShow).toContain('reveal(false, "hover");');
    expect(reveal).toContain("if (!richCoachEnabled) {");
    expect(reveal).toContain("if (expanded) return;");
    expect(reveal.indexOf("setExpanded(false);")).toBeLessThan(
      reveal.indexOf("if (expanded) return;")
    );
  });

  it("atomically transfers ownership and guards the next target from a stale hide timer", () => {
    const reveal = functionBody("reveal");
    const scheduleHide = functionBody("scheduleHide");

    expect(reveal).toContain("coordinator.claim(tipId)");
    expect(reveal).toContain("hideRenderedTooltipImmediately(previousHintId);");
    expect(scheduleHide).toContain("coordinator.release(tipId);");
    expect(source).toContain("coordinator.getActiveHintId() === tipId");
    expect(source).toContain("const dismissEpoch = useSyncExternalStore(");
  });

  it("keeps unavailable descendants inert without disabling their focus-only coach wrapper", () => {
    const handleClickCapture = functionBody("handleClickCapture");
    const disabledGuard = handleClickCapture.slice(handleClickCapture.indexOf("if (disabled)"));

    expect(disabledGuard).toContain("event.preventDefault();");
    expect(disabledGuard).toContain("event.stopPropagation();");
    expect(disabledGuard.indexOf("return;")).toBeLessThan(
      disabledGuard.indexOf("dismissPointerActivation(event);")
    );
    expect(source).toContain("tabIndex={disabled ? 0 : undefined}");
    expect(source).toContain('role={disabled ? "group" : undefined}');
    expect(source).toContain("aria-label={disabled ? childAccessibleLabel ?? hint.title : undefined}");
    expect(source).toContain("focus-visible:outline-accent");
    expect(source).toContain('"aria-disabled": true');
    expect(source).not.toContain('"aria-hidden": true');
    expect(source).toContain("tabIndex: -1");
    expect(source).toContain("const needsWrapperDescription = open && (disabled || !canDescribeChild);");
  });

  it("describes the actual focused descendant when a coach wraps a label or compound control", () => {
    const describeFocusedControl = functionBody("describeFocusedControl");
    const handleFocus = functionBody("handleFocus");
    const handleBlur = functionBody("handleBlur");

    expect(describeFocusedControl).toContain('target.getAttribute("aria-describedby")');
    expect(describeFocusedControl).toContain("descriptions.add(tipId);");
    expect(describeFocusedControl).toContain('target.setAttribute("aria-describedby"');
    expect(handleFocus).toContain("describeFocusedControl(event.target);");
    expect(handleBlur).toContain("clearFocusedDescription(event.target);");
    expect(source).toContain("if (open) return;");
    expect(source).toContain("removeAriaDescription(target, tipId);");
  });
});
