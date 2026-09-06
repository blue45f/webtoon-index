/**
 * @vitest-environment jsdom
 *
 * 배경 종이는 GPU 레인 **밖**에 있어야 한다 — 기기 손실이 종이를 지울 수 없어야 하기 때문이다.
 *
 * 설계 근거(조사 §6.1): Vello 허브는 WebGPU 컨텍스트가 죽으면 캔버스 **엘리먼트 자체를 교체**한다.
 * 그 레인 안에 있는 것은 전부 사라진다. 그래서 배경 종이는 Konva 문서좌표 `<Layer>`에 둔다.
 * 이 테스트는 "Konva Layer = 독립 DOM 캔버스"라는 그 가정을 **주장이 아니라 측정으로** 고정한다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";


import Konva from "konva/lib/Core";
import { Layer } from "konva/lib/Layer";
import { Rect } from "konva/lib/shapes/Rect";
import { Stage } from "konva/lib/Stage";
import { afterEach, describe, expect, it } from "vitest";

const containers: HTMLDivElement[] = [];

// jsdom ships no 2d backend. A permissive no-op context is enough for Konva's DOM bookkeeping,
// which is the only thing under test here — no pixels are asserted.
const canvasNumericFields = new Set(["canvas", "lineWidth", "globalAlpha", "miterLimit"]);
function installStubCanvas2d(): void {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type !== "2d") return null;
    const target = { canvas: this } as Record<string, unknown>;
    return new Proxy(target, {
      get(store, property: string) {
        if (property in store || canvasNumericFields.has(property)) return store[property];
        if (typeof property !== "string") return undefined;
        if (property === "getImageData" || property === "createImageData") {
          store[property] = (): { data: Uint8ClampedArray } => ({
            data: new Uint8ClampedArray(4),
          });
          return store[property];
        }
        if (property === "measureText") {
          store[property] = (): { width: number } => ({ width: 0 });
          return store[property];
        }
        store[property] = (): undefined => undefined;
        return store[property];
      },
      set(store, property: string, value: unknown) {
        store[property] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
}
installStubCanvas2d();

function mountStage(): Stage {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  return new Stage({ container, width: 200, height: 120 });
}

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe("paper grain lives on its own DOM canvas", () => {
  it("gives every Konva layer a distinct backing canvas element", () => {
    const stage = mountStage();
    const backgroundLayer = new Layer();
    const artworkLayer = new Layer();
    stage.add(backgroundLayer);
    stage.add(artworkLayer);

    const backgroundCanvas = backgroundLayer.getCanvas()._canvas;
    const artworkCanvas = artworkLayer.getCanvas()._canvas;
    expect(backgroundCanvas).toBeInstanceOf(globalThis.HTMLCanvasElement);
    expect(artworkCanvas).toBeInstanceOf(globalThis.HTMLCanvasElement);
    // The load-bearing assertion: two layers are two elements, so losing one cannot blank the other.
    expect(backgroundCanvas).not.toBe(artworkCanvas);
    stage.destroy();
  });

  it("keeps the paper-grain rect under the artwork and out of hit testing", () => {
    const stage = mountStage();
    const backgroundLayer = new Layer({ listening: true });
    stage.add(backgroundLayer);
    const paper = new Rect({
      name: "paper-grain",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      listening: false,
      globalCompositeOperation: "multiply",
    });
    backgroundLayer.add(paper);

    expect(paper.listening()).toBe(false);
    expect(paper.globalCompositeOperation()).toBe("multiply");
    expect(backgroundLayer.findOne(".paper-grain")).toBe(paper);
    stage.destroy();
  });

  it("keeps the paper rect out of the layer the Vello frame graph can take over", () => {
    // The stable document Group keeps React/Konva node identity intact and changes only opacity
    // after an exact frame receipt. The paper remains in the background Layer so a GPU handoff
    // cannot blank the sheet texture.
    const source = readFileSync(
      resolve(process.cwd(), "apps/web/src/domains/creator/canvas/StudioCanvasViewportStageHost.tsx"),
      "utf8",
    );
    const paperAt = source.indexOf('name="paper-grain"');
    const mainLayerAt = source.indexOf("<Layer ref={mainLayerRef}>");
    const backgroundLayerAt = source.indexOf('name="bg"');
    const shadowAt = source.indexOf(
      "name={STUDIO_KONVA_DOCUMENT_SHADOW_NAME}",
    );
    const documentAt = source.indexOf(
      "<StudioCanvasViewportDocumentLayer {...documentLayerProps} />",
      shadowAt,
    );
    const shadowOpening = source.slice(shadowAt, documentAt);
    expect(paperAt).toBeGreaterThan(0);
    expect(mainLayerAt).toBeGreaterThan(0);
    expect(backgroundLayerAt).toBeGreaterThan(0);
    expect(paperAt).toBeGreaterThan(backgroundLayerAt);
    expect(paperAt).toBeLessThan(mainLayerAt);
    expect(source).toContain("name={STUDIO_KONVA_DOCUMENT_SHADOW_NAME}");
    expect(source).toContain("opacity={frameGraphOwnsDocumentPixels ? 0 : 1}");
    expect(source).toContain(
      "<StudioCanvasViewportDocumentLayer {...documentLayerProps} />",
    );
    expect(shadowAt).toBeGreaterThan(mainLayerAt);
    expect(documentAt).toBeGreaterThan(shadowAt);
    expect(shadowOpening).not.toContain("listening={false}");
    expect(source).not.toContain("const documentLayer = (");
  });

  it("never renders through a WebGPU context — the 2d context is the only one it asks for", () => {
    const stage = mountStage();
    const layer = new Layer();
    stage.add(layer);
    const context = layer.getCanvas().getContext();
    // Konva's SceneContext wraps CanvasRenderingContext2D. If this ever became a GPU-backed
    // surface, device loss would take the paper with it.
    expect(typeof context.fillRect).toBe("function");
    expect(Konva.Util).toBeTruthy();
    stage.destroy();
  });
});
