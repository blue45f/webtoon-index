import { parsePromoProject, promoSrt } from "./promo-model";

import type { PromoProject } from "./promo-model";

/** Pin every Remotion package to the same version. The web app installs none of these. */
export const PROMO_REMOTION_VERSION = "4.0.487";
export interface PromoRenderSources { model: string; canvas: string }
function extractMedia(src: string): { bytes: Uint8Array; extension: string } {
  const separator = src.indexOf(",");
  const mime = src.slice(5, src.indexOf(";"));
  const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/webm": "webm" };
  const extension = extensions[mime];
  if (!extension) throw new Error("지원하지 않는 미디어 형식이에요.");
  const binary = atob(src.slice(separator + 1));
  return { bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)), extension };
}
export function promoRemotionFiles(input: PromoProject, sources: PromoRenderSources): Record<string, string | Uint8Array> {
  const project = parsePromoProject(input);
  if (!project.panels.length) throw new Error("내보낼 컷이 없어요.");
  const files: Record<string, string | Uint8Array> = {};
  const panels = project.panels.map((panel, index) => {
    const media = extractMedia(panel.src);
    const path = `panel-${index + 1}.${media.extension}`;
    files[`public/${path}`] = media.bytes;
    return { ...panel, src: path };
  });
  let audio: PromoProject["audio"] = null;
  if (project.audio) {
    const media = extractMedia(project.audio.src);
    const path = `bgm.${media.extension}`;
    files[`public/${path}`] = media.bytes;
    audio = { src: path, volume: project.audio.volume };
  }
  files["project.json"] = JSON.stringify({ ...project, panels, audio }, null, 2);
  files["captions.srt"] = promoSrt(project);
  files["src/promo-model.ts"] = sources.model;
  files["src/promo-canvas.ts"] = sources.canvas;
  files["package.json"] = JSON.stringify({
    name: "toonstudio-promo-render", private: true, version: "1.0.0",
    scripts: { studio: "remotion studio src/index.ts", render: "remotion render src/index.ts WebtoonPromo out/promo.mp4 --codec=h264 --crf=18 --pixel-format=yuv420p" },
    dependencies: { "@remotion/cli": PROMO_REMOTION_VERSION, remotion: PROMO_REMOTION_VERSION, react: "19.2.0", "react-dom": "19.2.0" },
  }, null, 2);
  files["src/index.ts"] = 'import {registerRoot} from "remotion";\nimport {Root} from "./Root";\nregisterRoot(Root);\n';
  files["src/Root.tsx"] = `import React from "react";
import {Composition, staticFile} from "remotion";
import raw from "../project.json";
import {Promo} from "./Promo";
import {PROMO_FPS, promoFrameCount, promoSize, type PromoProject} from "./promo-model";
const input = raw as PromoProject;
const project = {...input, panels: input.panels.map(p => ({...p, src: staticFile(p.src)})), audio: input.audio ? {...input.audio, src: staticFile(input.audio.src)} : null};
const size = promoSize(project.ratio);
export const Root = () => <Composition id="WebtoonPromo" component={Promo} defaultProps={{project}} fps={PROMO_FPS} durationInFrames={promoFrameCount(project)} width={size.width} height={size.height} />;
`;
  files["src/Promo.tsx"] = `import React, {useEffect, useLayoutEffect, useRef, useState} from "react";
import {AbsoluteFill, Html5Audio, cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig} from "remotion";
import {drawPromoFrame, loadPromoImages, type PromoImages} from "./promo-canvas";
import {promoAudioGain, type PromoProject} from "./promo-model";
export const Promo = ({project}: {project: PromoProject}) => {
  const frame = useCurrentFrame();
  const {width, height, durationInFrames} = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<PromoImages | null>(null);
  const [handle] = useState(() => delayRender("Load webtoon panels"));
  useEffect(() => {
    const controller = new AbortController();
    loadPromoImages(project, controller.signal).then(loaded => {
      if (controller.signal.aborted) return;
      setImages(loaded);
    }).catch(error => {if (!controller.signal.aborted) cancelRender(error);});
    return () => controller.abort();
  }, [project]);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !images) return;
    drawPromoFrame(ctx, project, images, frame, width, height);
    continueRender(handle);
  }, [project, images, frame, width, height, handle]);
  return <AbsoluteFill><canvas ref={canvas} width={width} height={height} />{project.audio ? <Html5Audio src={project.audio.src} loop loopVolumeCurveBehavior="extend" volume={f => promoAudioGain(f, durationInFrames, project.audio!.volume)} /> : null}</AbsoluteFill>;
};
`;
  files["README.md"] = `# ToonStudio webtoon promo render kit

This is a real Remotion composition, not an MP4 file. Node.js 22+ and internet access for the initial dependency/browser installation are required.

1. Extract this ZIP into a new directory.
2. Run npm install.
3. Run npm run studio to preview, or npm run render to create out/promo.mp4 (H.264, 1080 short-side pixels, 30 fps).

The assets are local and the renderer does not call an AI service. The same frame renderer and timeline are used in ToonStudio's browser preview. A local system font with Korean coverage must be installed (for example Noto Sans CJK); line breaks can differ across operating systems.

This is motion-comic animation of supplied still images (camera moves, fades, captions), not generated character acting, lip sync, voice cloning or newly generated video frames. The ending card is included in the selected total duration. BGM is looped with a one-second fade at each end.

Review the official Remotion license terms for your organization and use case before rendering or hosting a rendering service: https://www.remotion.dev/docs/license
No license purchase, cloud resource provisioning, external AI request, or payment is performed by exporting this ZIP. Rights to supplied artwork and audio remain the user's responsibility.

AI-assisted scene plans are editable suggestions based on the supplied text descriptions; the AI has not seen the images. This package contains original media: share it only with intended collaborators.
`;
  return files;
}
