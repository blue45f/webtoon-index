import type { StudioFeatureTutorial } from "./studio-feature-tutorials";

type TutorialCopyStep = {
  readonly title: string;
  readonly body: string;
  readonly tip?: string;
};

type TutorialCopy = {
  readonly title: string;
  readonly summary: string;
  readonly tryLabel?: string;
  readonly steps: readonly TutorialCopyStep[];
};

/**
 * English safety copy for tutorials added ahead of the generated locale packs.
 * Other locales still use their translated keys when present; this only prevents
 * a Korean/English mixed dialog when a newly shipped key is missing.
 */
const ENGLISH_TUTORIAL_COPY: Readonly<Record<string, TutorialCopy>> = {
  eraser: {
    title: "Erase with a visible cursor",
    summary: "Match the eraser size to the area, remove only what you need, and undo one stroke at a time.",
    steps: [
      {
        title: "Choose Eraser",
        body: "Choose Eraser on the left rail or press E. The canvas cursor shows the current eraser size.",
        tip: "Press B to switch back to the pen with the default shortcut.",
      },
      {
        title: "Match the size",
        body: "Use [ and ] or the drawing options to make the cursor slightly wider than the line you want to remove.",
      },
      {
        title: "Erase in short strokes",
        body: "Short strokes reduce mistakes. Each stroke can be undone separately with Undo.",
      },
    ],
  },
  fill: {
    title: "Fill a closed area",
    summary: "Use the paint bucket to find an enclosed region, then tune gap closing and tolerance.",
    steps: [
      {
        title: "Choose Fill",
        body: "Choose Fill on the left rail or press G. If the page contains only vector strokes or shapes, Studio preserves them and prepares an editable image copy automatically.",
      },
      {
        title: "Tap inside the boundary",
        body: "Pick a color and tap inside the enclosed line. Use Gap Close for small breaks and Tolerance for similar colors.",
      },
      {
        title: "Check the selection and result",
        body: "An active pixel selection limits the fill to that area. Undo and adjust the values if the result is not what you expected.",
      },
    ],
  },
  smudge: {
    title: "Push and blend color (Smudge)",
    summary: "Push existing paint in the drag direction to soften an edge without adding a new color.",
    steps: [
      {
        title: "Prepare the target",
        body: "Select an image or choose Push and Blend on the left rail. Vector-only pages are preserved while Studio prepares an editable image copy.",
        tip: "The same tool turns on automatically after the copy is ready.",
      },
      {
        title: "Push along the color edge",
        body: "Set the brush size and strength, then drag in the direction you want the existing color to move. No new color is added.",
      },
      {
        title: "Release and inspect",
        body: "Releasing the pointer commits one stroke. If the blend is too strong, undo that stroke and try again.",
      },
    ],
  },
  liquify: {
    title: "Push and reshape (Liquify)",
    summary: "Push, twist, pinch, or expand image contours with a brush.",
    steps: [
      {
        title: "Prepare the target",
        body: "Select an image or choose Push and Reshape on the tool rail. Vector-only pages are preserved while Studio prepares an editable image copy.",
        tip: "Liquify turns on automatically after the copy is ready.",
      },
      {
        title: "Choose a reshape mode",
        body: "Choose Push, Twirl, Pinch, or Bloat and begin with a low strength.",
      },
      {
        title: "Use short drags inside the contour",
        body: "Each release commits one stroke. Undo immediately if the shape moves too far.",
      },
    ],
  },
  filters: {
    title: "Apply filters to strokes and images",
    summary: "Create an editable copy even from drawn strokes, then apply color, blur, sharpness, and texture effects.",
    steps: [
      {
        title: "Choose what to affect",
        body: "Select an image or open the top Filter menu. Vector-only pages are preserved while Studio prepares an editable image copy.",
      },
      {
        title: "Tune the effect in preview",
        body: "Choose a color, blur, sharpness, or texture effect and start gently. An active pixel selection limits the effect to that region.",
      },
      {
        title: "Check the order and apply",
        body: "Reorder effects in the smart filter stack to compare results. You can still undo after applying.",
      },
    ],
  },
  "comment-collaboration": {
    title: "Review together with pinned comments",
    summary: "Pin feedback to an exact canvas position and manage replies, mentions, and resolution state.",
    steps: [
      {
        title: "Place a comment pin",
        body: "Choose Comment Pin on the left rail, then tap the exact canvas location you want to discuss.",
        tip: "Press Escape while placing a pin to cancel without changing the artwork.",
      },
      {
        title: "Keep it short and specific",
        body: "Describe what should change and why, then mention the teammate who needs it. Continue replies on the same pin to preserve scene context.",
      },
      {
        title: "Review online and resolve",
        body: "Teammates connected to the same shared document can review the pin and its replies. Resolve finished discussions and reopen them when needed.",
      },
    ],
  },
  "canvas-view": {
    title: "Pan, zoom, and lock the canvas scale",
    summary: "Move only the view, zoom around the pointer, or lock the scale to avoid accidental changes.",
    steps: [
      {
        title: "Pan without moving artwork",
        body: "Hold Space and drag, or use the Hand tool. On touch screens, use two fingers to pan the canvas.",
      },
      {
        title: "Zoom around the pointer",
        body: "In wheel-zoom mode, the scale changes around the pointer. Use the Wheel Action control to switch between zooming and canvas scrolling.",
      },
      {
        title: "Lock the scale you want",
        body: "Scale Lock prevents accidental wheel or pinch zoom. Turn the same control off when you want to change scale again.",
      },
    ],
  },
  "select-move-group": {
    title: "Select, move, multi-select, and group",
    summary: "Select objects like a slide editor, then move, transform, or lock several as one group.",
    steps: [
      {
        title: "Select an object",
        body: "Choose the Select tool and tap an object. Drag on empty canvas to box-select several objects at once.",
      },
      {
        title: "Add objects and group",
        body: "Shift-click more objects or use multi-selection in the Layers panel, then group the selected items.",
      },
      {
        title: "Move and lock as one",
        body: "Drag the group bounds to move or transform all members. Lock the group after arranging it, and unlock it when you need to edit again.",
      },
    ],
  },
  "asset-drop": {
    title: "Drop an asset exactly where you want it",
    summary: "Place bubbles, shapes, and image assets directly at a canvas position or inside a panel.",
    steps: [
      {
        title: "Drag from the library",
        body: "Press and drag a card or thumbnail from Templates & Assets. A normal click still adds it quickly to the current view.",
      },
      {
        title: "Check the canvas position",
        body: "Move the placement preview into the panel or open space you want, then release. Press Escape to cancel before dropping.",
      },
      {
        title: "Refine size and alignment",
        body: "Resize from the selection bounds and align with guides or arrow keys. Save frequent items to Favorites or My Assets.",
      },
    ],
  },
  "save-recovery": {
    title: "Save, recover, and make a safe backup",
    summary: "Check autosave state, use shared revisions, and download a backup to prevent lost work.",
    steps: [
      {
        title: "Check autosave state",
        body: "Studio updates local drafts and recovery points while you work. Wait for the top save status to finish before closing the tab.",
      },
      {
        title: "Use shared save for team work",
        body: "Check the latest revision before saving a shared document. A conflicting temporary copy is preserved instead of silently replacing the source.",
      },
      {
        title: "Back up important milestones",
        body: "Before changing devices or workflows, download JSON or an asset archive. You can restore manually even when automatic recovery is unavailable.",
      },
    ],
  },
  "character-shaper": {
    title: "Character Shaper",
    summary: "Pick face, hair and clothing from preset cards, then export a transparent PNG or a layered PSD.",
    tryLabel: "Open Shaper",
    steps: [
      {
        title: "Pick a model, then pick cards",
        body: "Load a VRM, then walk the slot rail and click cards for face shape, eyes, hair and tops. One click applies immediately and becomes one undo step.",
        tip: "Entries the model cannot honour stay visible with the reason written on the card.",
      },
      {
        title: "Pose from a photo or the webcam",
        body: "Drop a reference image for recipe suggestions, or use a photo or the webcam to move the pose onto the model. You choose which body regions to keep.",
      },
      {
        title: "Paint, then export",
        body: "Turn on surface drawing to paint on the model, then add a transparent PNG to the page or export a PSD whose layers are already separated.",
        tip: "The PSD carries flat, shadow, highlight and line groups. Layers that could not be produced are listed with their reason.",
      },
    ],
  },
};

export function studioTutorialSourceCopy(
  tutorial: StudioFeatureTutorial,
  preferKoreanSource: boolean,
): StudioFeatureTutorial {
  if (preferKoreanSource) return tutorial;
  const english = ENGLISH_TUTORIAL_COPY[tutorial.id];
  if (!english) return tutorial;
  return {
    ...tutorial,
    title: english.title,
    summary: english.summary,
    ...(english.tryLabel ? { tryLabel: english.tryLabel } : {}),
    steps: tutorial.steps.map((step, index) => ({
      ...step,
      ...(english.steps[index] ?? {}),
    })),
  };
}
