import { PROMO_FPS, promoFrameCount, promoMotionAt, promoTimeline } from "./promo-model";

import type { PromoProject } from "./promo-model";

export type PromoImages = ReadonlyMap<string, HTMLImageElement>;
const PALETTES = {
  cinematic: ["#0b1120", "#182b47", "#94b8ff"], romance: ["#251320", "#582b42", "#ffb3d1"],
  action: ["#16121a", "#43251c", "#ffc16f"], mystery: ["#0d1820", "#193c45", "#9be0df"],
} as const;

function lines(ctx: CanvasRenderingContext2D, value: string, width: number, maxLines: number): string[] {
  const result: string[] = [];
  let line = "";
  const characters = Array.from(value.replace(/[\r\n]+/gu, " "));
  for (let i = 0; i < characters.length; i += 1) {
    const character = characters[i] ?? "";
    if (line && ctx.measureText(line + character).width > width) {
      result.push(line);
      line = "";
      if (result.length === maxLines) {
        let last = result[maxLines - 1] ?? "";
        while (last && ctx.measureText(`${last}…`).width > width) last = Array.from(last).slice(0, -1).join("");
        result[maxLines - 1] = `${last}…`;
        return result;
      }
    }
    line += character;
  }
  if (line) result.push(line);
  return result;
}
function drawText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, fontSize: number, maxLines: number): void {
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines(ctx, value, width, maxLines).forEach((line, i) => ctx.fillText(line, x, y + i * fontSize * 1.4));
}
/** No randomness, timers, fonts from the network, or platform-specific drawing dependencies. */
export function drawPromoFrame(ctx: CanvasRenderingContext2D, project: PromoProject, images: PromoImages, inputFrame: number, width: number, height: number): void {
  const frame = Math.max(0, Math.min(promoFrameCount(project) - 1, Math.floor(inputFrame)));
  const palette = PALETTES[project.style];
  const unit = Math.min(width, height);
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, palette[0]);
  background.addColorStop(1, palette[1]);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const scene = promoTimeline(project).find((item) => frame >= item.from && frame < item.from + item.duration);
  if (scene) {
    const image = images.get(scene.panel.id);
    const local = frame - scene.from;
    if (image) {
      const motion = promoMotionAt(scene.panel.motion, local / Math.max(1, scene.duration - 1));
      const fit = scene.panel.fit === "cover" ? Math.max(width / image.naturalWidth, height / image.naturalHeight) : Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const iw = image.naturalWidth * fit * motion.scale;
      const ih = image.naturalHeight * fit * motion.scale;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (local + 1) / 8, (scene.duration - local) / 8);
      ctx.drawImage(image, (width - iw) / 2 + width * motion.x, (height - ih) / 2 + height * motion.y, iw, ih);
      ctx.restore();
    }
    const shade = ctx.createLinearGradient(0, height * 0.55, 0, height);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, height * 0.55, width, height * 0.45);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, width, unit * 0.14);
    ctx.fillStyle = "#ffffff";
    drawText(ctx, project.title, width / 2, unit * 0.065, width * 0.84, unit * 0.037, 1);
    drawText(ctx, scene.panel.caption, width / 2, height * 0.77, width * 0.8, unit * 0.051, 3);
    ctx.fillStyle = palette[2];
    ctx.fillRect(width * 0.1, height * 0.94, width * 0.8 * (frame + 1) / promoFrameCount(project), Math.max(2, unit * 0.004));
  } else {
    const endingFrame = frame - (promoFrameCount(project) - 2 * PROMO_FPS);
    ctx.globalAlpha = project.panels.length ? Math.max(0, Math.min(1, (endingFrame + 1) / 12)) : 1;
    ctx.fillStyle = palette[2];
    drawText(ctx, "WEBTOON PREMIERE", width / 2, height * 0.3, width * 0.8, unit * 0.025, 1);
    ctx.fillStyle = "#ffffff";
    drawText(ctx, project.title || "당신의 이야기가 움직이는 순간", width / 2, height * 0.41, width * 0.82, unit * 0.075, 3);
    ctx.fillStyle = palette[2];
    drawText(ctx, project.panels.length ? project.cta : "웹툰 컷을 추가해 홍보영상을 만들어보세요", width / 2, height * 0.73, width * 0.8, unit * 0.041, 2);
  }
  ctx.restore();
}
export async function loadPromoImages(project: Pick<PromoProject, "panels">, signal?: AbortSignal): Promise<Map<string, HTMLImageElement>> {
  const images = new Map<string, HTMLImageElement>();
  let pixels = 0;
  // Decode sequentially: an imported project must not inflate twelve huge rasters at once.
  for (const panel of project.panels) {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const clean = () => { signal?.removeEventListener("abort", abort); image.onload = null; image.onerror = null; };
      const abort = () => { clean(); image.src = ""; reject(new DOMException("취소했어요.", "AbortError")); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener("abort", abort, { once: true });
      image.onload = () => {
        clean();
        pixels += image.naturalWidth * image.naturalHeight;
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000 || pixels > 52_000_000) {
          image.src = "";
          reject(new Error("이미지 크기가 허용 범위를 벗어났어요. 컷을 작게 나누어 주세요.")); return;
        }
        resolve(image);
      };
      image.onerror = () => { clean(); reject(new Error("컷 이미지를 읽을 수 없어요. 다른 이미지로 교체해 주세요.")); };
      image.src = panel.src;
    });
    images.set(panel.id, image);
  }
  return images;
}
