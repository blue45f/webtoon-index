/**
 * Inspector density, measured on the rendered DOM.
 *
 * `studio-inspector-density.ts` is the declared budget (5~9 default controls). The
 * 2026-09-02 UX audit showed the declaration drifting from the screen: the table said
 * X·Y·W·H·회전 were folded while the panel drew all of them at the top, and it counted a
 * five-tab strip as one control. A hand-kept table cannot catch that; only counting what
 * is actually interactive on screen can. This module is that count.
 *
 * ## Contract
 *
 * Inspector controls carry two attributes:
 *
 * ```html
 * data-inspector-priority="essential | contextual | advanced | chrome"
 * data-inspector-control-id="selection.opacity"
 * ```
 *
 * - `essential` — visible with no disclosure for the current state; capped at the V5 §15
 *   budget (`STUDIO_INSPECTOR_DEFAULT_BUDGET.max`).
 * - `contextual` — visible because of the selected type / active tool; counted, not capped.
 * - `advanced` — must live inside a disclosure; visible only while its section is open.
 * - `chrome` — navigation (tabs, search triggers, disclosure headers). Counted separately
 *   so navigation cost is reported, never mistaken for a property.
 *
 * Anything interactive with no priority is reported as `unclassified` so a new control
 * cannot slip past the budget by simply not declaring itself.
 *
 * Pure DOM helpers — no React. Used by the jsdom contract test and safe to call from a
 * browser verifier (`scripts/verify-studio-inspector-walkthrough.mts`).
 */

import { STUDIO_INSPECTOR_DEFAULT_BUDGET } from "./studio-inspector-density";

export type StudioInspectorControlPriority =
  | "essential"
  | "contextual"
  | "advanced"
  | "chrome";

export const STUDIO_INSPECTOR_CONTROL_PRIORITIES: readonly StudioInspectorControlPriority[] =
  Object.freeze(["essential", "contextual", "advanced", "chrome"]);

/** Interactive elements the audit counts. Disabled controls still count — they are still seen. */
export const STUDIO_INSPECTOR_INTERACTIVE_SELECTOR = [
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "[role=tab]",
  "[role=radio]",
  "[role=checkbox]",
  "[role=switch]",
  "[role=slider]",
  "[role=menuitem]",
  "[role=option]",
  "[contenteditable=true]",
].join(",");

export interface StudioInspectorDensityCount {
  readonly essential: number;
  readonly contextual: number;
  readonly advanced: number;
  readonly chrome: number;
  readonly unclassified: number;
  /** essential + contextual + advanced — what a person has to read as "properties". */
  readonly properties: number;
  readonly total: number;
}

export type StudioInspectorDensityViolationKind =
  | "essential-over-budget"
  | "duplicate-control-id"
  | "advanced-visible-outside-disclosure"
  | "disabled-without-reason"
  | "unclassified-control";

export interface StudioInspectorDensityViolation {
  readonly kind: StudioInspectorDensityViolationKind;
  readonly detail: string;
}

export interface StudioInspectorDensityAudit {
  readonly count: StudioInspectorDensityCount;
  readonly violations: readonly StudioInspectorDensityViolation[];
}

export interface StudioInspectorDensityAuditOptions {
  /** Defaults to `STUDIO_INSPECTOR_DEFAULT_BUDGET.max` (9). */
  readonly essentialBudget?: number;
  /** Report interactive elements that declare no priority. Defaults to `true`. */
  readonly reportUnclassified?: boolean;
}

/**
 * Is the element visible in the sense the audit cares about — not inside `hidden`, not
 * `aria-hidden`? jsdom has no layout, so this reads structure rather than boxes. Every
 * inspector disclosure (`StudioInspectorSection`, the geometry grid) hides its body with
 * the `hidden` attribute, which is why that attribute — not the section's open flag — is
 * the signal: a folded section may still show an essential row outside its body.
 * A browser caller may pre-filter with `getBoundingClientRect` too.
 */
export function isStudioInspectorControlVisible(element: Element): boolean {
  let node: Element | null = element;
  while (node) {
    if (node instanceof HTMLElement && node.hidden) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    node = node.parentElement;
  }
  return true;
}

function priorityOf(element: Element): StudioInspectorControlPriority | null {
  const raw = element.getAttribute("data-inspector-priority");
  return (STUDIO_INSPECTOR_CONTROL_PRIORITIES as readonly string[]).includes(raw ?? "")
    ? (raw as StudioInspectorControlPriority)
    : null;
}

function describe(element: Element): string {
  const id = element.getAttribute("data-inspector-control-id");
  const label =
    element.getAttribute("aria-label")
    ?? element.getAttribute("title")
    ?? element.textContent?.trim().slice(0, 40)
    ?? "";
  return `${element.tagName.toLowerCase()}${id ? `#${id}` : ""}${label ? ` "${label}"` : ""}`;
}

/** Every visible interactive element under `root`, with the priority it declares. */
export function collectStudioInspectorControls(
  root: ParentNode,
): readonly { element: Element; priority: StudioInspectorControlPriority | null }[] {
  return [...root.querySelectorAll(STUDIO_INSPECTOR_INTERACTIVE_SELECTOR)]
    .filter((element) => isStudioInspectorControlVisible(element))
    .map((element) => ({ element, priority: priorityOf(element) }));
}

export function countStudioInspectorControls(root: ParentNode): StudioInspectorDensityCount {
  const count = { essential: 0, contextual: 0, advanced: 0, chrome: 0, unclassified: 0 };
  for (const { priority } of collectStudioInspectorControls(root)) {
    if (priority === null) count.unclassified += 1;
    else count[priority] += 1;
  }
  const properties = count.essential + count.contextual + count.advanced;
  return {
    ...count,
    properties,
    total: properties + count.chrome + count.unclassified,
  };
}

/**
 * Runs the audit rules the UX audit asked CI to enforce (§5.4): essential over budget,
 * the same canonical control exposed twice, an advanced control visible outside a closed
 * disclosure, a disabled control that does not say why, and controls that never declared
 * a priority.
 */
export function auditStudioInspectorDensity(
  root: ParentNode,
  options: StudioInspectorDensityAuditOptions = {},
): StudioInspectorDensityAudit {
  const essentialBudget = options.essentialBudget ?? STUDIO_INSPECTOR_DEFAULT_BUDGET.max;
  const reportUnclassified = options.reportUnclassified ?? true;
  const controls = collectStudioInspectorControls(root);
  const count = countStudioInspectorControls(root);
  const violations: StudioInspectorDensityViolation[] = [];

  if (count.essential > essentialBudget) {
    violations.push({
      kind: "essential-over-budget",
      detail: `essential ${count.essential} > ${essentialBudget}`,
    });
  }

  const seenIds = new Map<string, Element>();
  for (const { element, priority } of controls) {
    const controlId = element.getAttribute("data-inspector-control-id");
    if (controlId) {
      const previous = seenIds.get(controlId);
      if (previous && previous !== element) {
        violations.push({
          kind: "duplicate-control-id",
          detail: `${controlId} exposed twice (${describe(previous)}, ${describe(element)})`,
        });
      } else {
        seenIds.set(controlId, element);
      }
    }

    if (priority === "advanced") {
      const section = element.closest("[data-inspector-section-open]");
      if (!section) {
        violations.push({
          kind: "advanced-visible-outside-disclosure",
          detail: `${describe(element)} is advanced but not inside a disclosure`,
        });
      }
    }

    const disabled =
      (element instanceof HTMLButtonElement
        || element instanceof HTMLInputElement
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement)
      && element.disabled;
    if (disabled) {
      const explained =
        Boolean(element.getAttribute("title"))
        || Boolean(element.getAttribute("aria-describedby"))
        || Boolean(element.closest("[title]"));
      if (!explained) {
        violations.push({
          kind: "disabled-without-reason",
          detail: `${describe(element)} is disabled with no title/aria-describedby`,
        });
      }
    }

    if (priority === null && reportUnclassified) {
      violations.push({
        kind: "unclassified-control",
        detail: `${describe(element)} declares no data-inspector-priority`,
      });
    }
  }

  return { count, violations };
}
