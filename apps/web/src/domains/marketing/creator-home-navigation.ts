/** Existing fragment IDs stay public; never interpret a URL fragment as a selector. */
export const CREATOR_HOME_SECTIONS = [
  { id: "creator-process-title", headingId: "creator-process-title", ko: "만드는 과정", en: "The workflow" },
  { id: "creator-toolkit-title", headingId: "creator-toolkit-title", ko: "창작 도구", en: "Creative tools" },
  { id: "creator-film", headingId: "creator-film-title", ko: "소개 영상", en: "Brand film" },
  { id: "creator-faq-title", headingId: "creator-faq-title", ko: "자주 묻는 질문", en: "Questions" },
] as const;

export function creatorSectionFromHash(hash: string) {
  if (!hash.startsWith("#") || hash.length > 128) return undefined;
  try {
    const id = decodeURIComponent(hash.slice(1));
    return CREATOR_HOME_SECTIONS.find((section) => section.id === id);
  } catch {
    return undefined;
  }
}

export function creatorWorkflowIndex(key: string, current: number, count: number): number | null {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const index = Number.isInteger(current) && current >= 0 && current < count ? current : 0;
  switch (key) {
    case "ArrowRight": return (index + 1) % count;
    case "ArrowLeft": return (index + count - 1) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

export type CreatorJumpActivation = {
  button: number;
  defaultPrevented: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export function isPlainCreatorJump(event: CreatorJumpActivation): boolean {
  return event.button === 0 && !event.defaultPrevented &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

type CreatorSectionTarget = Pick<HTMLElement, "focus" | "scrollIntoView">;
type FindCreatorTarget = (id: string) => CreatorSectionTarget | null;

export function focusCreatorSection(hash: string, findTarget: FindCreatorTarget, scroll = false): boolean {
  const section = creatorSectionFromHash(hash);
  if (!section) return false;
  const target = findTarget(section.headingId);
  if (!target) return false;
  if (scroll) target.scrollIntoView({ block: "start", behavior: "instant" });
  target.focus({ preventScroll: true });
  return true;
}

export type CreatorNavigationHost = {
  getHash: () => string;
  findTarget: FindCreatorTarget;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  subscribe: (callback: () => void) => () => void;
};

/**
 * A lazy route may mount after the browser's initial fragment scroll. Resolve its
 * known heading after mount and on native hash/back/forward navigation. Do not
 * write history, play media, or leave a delayed focus change after unmount.
 */
export function bindCreatorSectionNavigation(host: CreatorNavigationHost): () => void {
  let frame: number | undefined;
  let revision = 0;
  let disposed = false;
  const schedule = () => {
    if (disposed) return;
    const request = ++revision;
    if (frame !== undefined) host.cancelFrame(frame);
    frame = undefined;
    const hash = host.getHash();
    if (!creatorSectionFromHash(hash)) return;
    frame = host.requestFrame(() => {
      if (disposed || request !== revision || hash !== host.getHash()) return;
      frame = undefined;
      focusCreatorSection(hash, host.findTarget, true);
    });
  };
  const unsubscribe = host.subscribe(schedule);
  schedule();
  return () => {
    if (disposed) return;
    disposed = true;
    revision += 1;
    if (frame !== undefined) host.cancelFrame(frame);
    unsubscribe();
  };
}
