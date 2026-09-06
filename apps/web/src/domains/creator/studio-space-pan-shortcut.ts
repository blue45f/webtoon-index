const STUDIO_SPACE_PAN_INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='searchbox']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='switch']",
  "[role='tab']",
  "[role='textbox']",
  "[role='tree']",
  "[role='treeitem']",
].join(",");

/**
 * Space pans the canvas only from canvas/background focus. Native controls must keep their
 * browser activation behavior; preventing Space on a focused button makes it look keyboard-dead.
 */
export function shouldStartStudioSpacePan(input: {
  readonly code: string;
  readonly editing: boolean;
  readonly isSpacePressed: boolean;
  readonly target: EventTarget | null;
}): boolean {
  if (input.code !== "Space" || input.editing || input.isSpacePressed) return false;
  const candidate = input.target as { closest?: (selector: string) => Element | null } | null;
  return !candidate?.closest?.(STUDIO_SPACE_PAN_INTERACTIVE_SELECTOR);
}
