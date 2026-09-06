import { STUDIO_FILTER_CATALOG } from "./filter/studio-filter-catalog";
import {
  normalizeStudioToolHintStableId,
  studioToolHint,
  type StudioToolHintSpec,
} from "./studio-tool-hints";

import type { StudioToolHintPreviewKind } from "./studio-tool-hint-preview-kind";

const STUDIO_ACTION_PREVIEW_BY_ID: Readonly<Record<string, StudioToolHintPreviewKind>> = {
  select: "select",
  transform: "transform",
  crop: "crop",
  pen: "ink",
  "pixel-pencil": "pixel-ink",
  eraser: "erase",
  fill: "fill",
  "advanced-fill": "fill",
  eyedropper: "sample",
  "smart-shape": "smart-shape",
  // Direct rail shapes use the bounding-box drawing coach. The legacy
  // shape-specific kinds demonstrate smart correction and are intentionally
  // not used for these stable action identities.
  "shape-rect": "shape",
  "shape-ellipse": "shape",
  perspective: "perspective",
  shape: "shape",
  text: "text",
  bubble: "bubble",
  comment: "comment",
  image: "image",
  reference: "reference",
  "frame-anim": "frame-sequence",
  "frame-capture": "frame-capture",
  "frame-playback": "frame-playback",
  "frame-reorder": "frame-reorder",
  "frame-reorder-previous": "frame-reorder",
  "frame-reorder-next": "frame-reorder",
  "frame-duplicate": "frame-duplicate",
  "frame-delete": "frame-delete",
  filter: "filter",
  liquify: "liquify",
  blend: "smudge",
  smudge: "smudge",
  lasso: "lasso",
  "poly-lasso": "polygon-lasso",
  "pixel-select": "lasso",
  "marquee-rect": "marquee-rect",
  "marquee-circle": "marquee-ellipse",
  rect: "marquee-rect",
  ellipse: "marquee-ellipse",
  "lasso-fill": "lasso-fill",
  "brush-settings": "draw-settings",
  "brush-size": "brush-size",
  "stroke-width": "brush-size",
  opacity: "opacity",
  "stroke-opacity": "opacity",
  "layer-opacity": "opacity",
  stabilizer: "stabilizer",
  smoothing: "stabilizer",
  "stroke-stabilizer": "stabilizer",
  pressure: "pressure",
  "pen-pressure": "pressure",
  symmetry: "symmetry",
  "mirror-drawing": "symmetry",
  "zoom-view": "zoom-view",
  zoom: "zoom-view",
  "zoom-fit": "zoom-view",
  "fit-width": "zoom-view",
  "rotate-view": "rotate-view",
  "flip-view": "flip-view",
  hand: "pan",
  pan: "pan",
  history: "history",
  undo: "undo",
  redo: "redo",
  layer: "layer",
  layers: "layer",
  "add-layer": "layer",
  "duplicate-layer": "layer-duplicate",
  "show-layer": "layer-visibility",
  "hide-layer": "layer-visibility",
  "lock-layer": "layer-lock",
  "unlock-layer": "layer-lock",
  "merge-layer": "layer-merge",
  timeline: "timeline",
  "animation-timeline": "timeline",
  playback: "timeline",
  play: "timeline",
  pause: "timeline",
  keyframe: "keyframe",
  "add-keyframe": "keyframe",
  "move-keyframe": "keyframe",
  "remove-keyframe": "keyframe",
  "onion-skin": "onion-skin",
  timelapse: "timelapse",
  "timelapse-record": "timelapse",
  "motion-fx": "motion-fx",
  "motion-export": "video-export",
  "video-export": "video-export",
  audio: "audio",
  bgm: "audio",
  sfx: "audio",
  "object-3d": "object-3d",
  "transform-3d": "object-3d",
  "translate-3d": "object-translate",
  "rotate-3d": "object-rotate",
  "scale-3d": "object-scale",
  "pose-3d": "pose-3d",
  "hand-pose": "pose-3d",
  "body-pose": "pose-3d",
  "camera-3d": "camera-3d",
  "zoom-camera": "camera-zoom",
  "orbit-camera": "camera-orbit",
  "reset-camera": "camera-reset",
  "quad-view": "quad-view",
  "lighting-3d": "lighting-3d",
  "light-direction": "lighting-3d",
  "light-intensity": "lighting-3d",
  assets: "assets",
  asset: "assets",
  export: "export",
  download: "export",
  project: "project",
  fullscreen: "fullscreen",
  immersive: "fullscreen",
  settings: "settings",
  save: "save",
  draft: "save",
  publish: "publish",
  ai: "ai-assist",
};

const STUDIO_FILTER_ENGINE_IDS = new Set(
  STUDIO_FILTER_CATALOG.map((entry) => normalizeStudioToolHintStableId(entry.engine))
);

function stableIdCandidates(value: string): readonly string[] {
  const normalized = normalizeStudioToolHintStableId(value);
  const leaf = normalized.split(/[:/]/u).at(-1) ?? normalized;
  return leaf === normalized ? [normalized] : [normalized, leaf];
}

function semanticTokens(value: string): ReadonlySet<string> {
  return new Set(
    value
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .split(/[^a-z0-9가-힣]+/u)
      .filter(Boolean)
  );
}

function tokensIncludeAny(tokens: ReadonlySet<string>, values: readonly string[]): boolean {
  return values.some((value) => tokens.has(value));
}

function previewFromIdentityTokens(tokens: ReadonlySet<string>): StudioToolHintPreviewKind | null {
  if (tokensIncludeAny(tokens, ["지우개", "지우기", "eraser", "erase"])) return "erase";
  if (tokensIncludeAny(tokens, ["스포이드", "색추출", "eyedropper", "sample"])) return "sample";
  if (tokensIncludeAny(tokens, ["자르기", "crop"])) return "crop";
  if (tokensIncludeAny(tokens, ["변형", "transform"])) return "transform";
  if (tokensIncludeAny(tokens, ["댓글", "코멘트", "comment"])) return "comment";
  if (tokensIncludeAny(tokens, ["투시도", "소실점", "perspective"])) return "perspective";
  if (tokensIncludeAny(tokens, ["참고", "레퍼런스", "reference"])) return "reference";
  if (tokensIncludeAny(tokens, ["리퀴파이", "액체화", "liquify"])) return "liquify";
  if (tokensIncludeAny(tokens, ["스머지", "혼합", "smudge", "blend"])) return "smudge";
  if (tokensIncludeAny(tokens, ["핸드", "이동보기", "hand", "pan"])) return "pan";
  if (tokensIncludeAny(tokens, ["반전", "뒤집기", "flip"])) return "flip-view";
  if (tokensIncludeAny(tokens, ["회전", "rotate"])) return "rotate-view";
  if (tokensIncludeAny(tokens, ["설정", "settings"])) return "settings";
  if (tokensIncludeAny(tokens, ["저장", "임시저장", "save", "draft"])) return "save";
  if (tokensIncludeAny(tokens, ["게시", "발행", "publish"])) return "publish";
  if (tokensIncludeAny(tokens, ["내보내기", "다운로드", "export", "download"])) return "export";
  if (tokensIncludeAny(tokens, ["에셋", "소재", "assets", "asset"])) return "assets";
  if (tokensIncludeAny(tokens, ["전체화면", "몰입", "fullscreen", "immersive"])) return "fullscreen";
  if (tokensIncludeAny(tokens, ["프로젝트", "project"])) return "project";
  if (tokensIncludeAny(tokens, ["ai", "인공지능"])) return "ai-assist";
  if (tokensIncludeAny(tokens, ["올가미", "라쏘", "lasso"])) return "lasso";
  if (tokensIncludeAny(tokens, ["채우기", "채움", "fill", "bucket"])) return "fill";
  if (tokensIncludeAny(tokens, ["불투명도", "opacity"])) return "opacity";
  if (tokensIncludeAny(tokens, ["필압", "pressure"])) return "pressure";
  if (tokensIncludeAny(tokens, ["보정", "안정화", "stabilizer", "smoothing"])) return "stabilizer";
  if (tokensIncludeAny(tokens, ["대칭", "symmetry", "mirror"])) return "symmetry";
  if (tokensIncludeAny(tokens, ["굵기", "brushsize"])) return "brush-size";
  if (tokensIncludeAny(tokens, ["다시실행", "redo"])) return "redo";
  if (tokensIncludeAny(tokens, ["되돌리기", "실행취소", "undo"])) return "undo";
  if (tokensIncludeAny(tokens, ["작업내역", "history"])) return "history";
  if (tokensIncludeAny(tokens, ["레이어", "layer", "layers"])) return "layer";
  if (tokensIncludeAny(tokens, ["키프레임", "keyframe"])) return "keyframe";
  if (tokensIncludeAny(tokens, ["타임라인", "재생", "timeline", "playback"])) return "timeline";
  if (tokensIncludeAny(tokens, ["어니언스킨", "onionskin"])) return "onion-skin";
  if (tokensIncludeAny(tokens, ["타임랩스", "timelapse"])) return "timelapse";
  if (tokensIncludeAny(tokens, ["영상", "video"])) return "video-export";
  if (tokensIncludeAny(tokens, ["오디오", "음악", "bgm", "sfx", "audio"])) return "audio";
  if (tokensIncludeAny(tokens, ["포즈", "관절", "pose", "joint"])) return "pose-3d";
  if (tokensIncludeAny(tokens, ["조명", "광원", "lighting", "light"])) return "lighting-3d";
  if (tokensIncludeAny(tokens, ["카메라", "시점", "camera", "orbit"])) return "camera-3d";
  if (tokensIncludeAny(tokens, ["3d", "오브젝트", "gizmo", "transform3d"])) return "object-3d";
  if (tokensIncludeAny(tokens, ["확대", "축소", "줌", "zoom"])) return "zoom-view";
  if (tokensIncludeAny(tokens, ["펜", "연필", "브러시", "pen", "pencil", "brush", "ink"])) return "ink";
  if (tokensIncludeAny(tokens, ["말풍선", "대사", "bubble"])) return "bubble";
  if (tokensIncludeAny(tokens, ["텍스트", "글자", "자막", "text"])) return "text";
  if (tokensIncludeAny(tokens, ["이미지", "사진", "프레임", "애니메이션", "image", "photo", "frame"])) return "image";
  if (tokensIncludeAny(tokens, ["도형", "사각형", "타원", "원근", "그리드", "shape", "rect", "ellipse", "grid"])) return "shape";
  if (tokensIncludeAny(tokens, ["필터", "블러", "왜곡", "리퀴파이", "혼합", "filter", "blur", "liquify", "blend"])) return "filter";
  return null;
}

/** Resolve a meaningful visual only after the rich coach has been requested. */
export function studioToolHintPreview(
  hint: Pick<StudioToolHintSpec, "id" | "title" | "description" | "preview">
): StudioToolHintPreviewKind {
  if (hint.preview) return hint.preview;
  const ids = stableIdCandidates(hint.id);

  // Stable engine/action identities are authoritative. This avoids incidental
  // substring collisions such as `sharpen` → pen or `invert` → view/shape.
  if (ids.some((id) => STUDIO_FILTER_ENGINE_IDS.has(id))) return "filter";
  for (const id of ids) {
    const actionPreview = STUDIO_ACTION_PREVIEW_BY_ID[id];
    if (actionPreview) return actionPreview;
    const registeredPreview = studioToolHint(id)?.preview;
    if (registeredPreview) return registeredPreview;
  }

  // Unknown integrations receive a deliberately conservative exact-token
  // fallback. Help prose never overrides the tool's semantic identity.
  return previewFromIdentityTokens(semanticTokens(`${hint.id} ${hint.title}`)) ?? "select";
}
