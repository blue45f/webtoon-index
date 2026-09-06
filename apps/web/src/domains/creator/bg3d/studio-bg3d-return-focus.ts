/** Selects the still-mounted Studio launcher that should regain focus after the modal closes. */
export function resolveStudioBg3dReturnFocus(
  dialog: HTMLElement | null,
): HTMLElement | null {
  if (!dialog) return null;
  const ownerDocument = dialog.ownerDocument;
  const activeElement = ownerDocument.activeElement;
  if (
    activeElement && activeElement !== ownerDocument.body
    && !dialog.contains(activeElement)
    && typeof (activeElement as HTMLElement).focus === "function"
  ) {
    // Returning null lets the shared modal owner capture the exact still-mounted launcher.
    return null;
  }

  const candidates = [...ownerDocument.querySelectorAll<HTMLButtonElement>("button:not([disabled])")]
    .filter((button) => !dialog.contains(button) && button.getClientRects().length > 0);
  const normalizedText = (button: HTMLButtonElement) =>
    button.textContent?.replace(/\s+/gu, " ").trim() ?? "";
  return candidates.find((button) =>
    button.dataset.studioBg3dLauncher === "true"
    || button.title === "3D 배경 재편집"
    || normalizedText(button) === "3D 배경"
  ) ?? candidates.find((button) =>
    button.getAttribute("aria-haspopup") === "menu"
    && normalizedText(button).startsWith("배경")
  ) ?? null;
}
