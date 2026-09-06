// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_PIXI_SCENE_CANVAS_MARKER,
  STUDIO_PIXI_SCENE_ROOT_LABEL,
  createStudioPixiSceneProvider,
  type StudioPixiRuntime,
} from "./studio-pixi-scene-provider";

interface FakeContainerOptions {
  readonly label?: string;
  readonly isRenderGroup?: boolean;
}

class FakePoint {
  x: number;
  y: number;
  readonly set = vi.fn((x: number, y: number) => {
    this.x = x;
    this.y = y;
  });

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
}

class FakeContainer {
  readonly children: FakeContainer[] = [];
  readonly position = new FakePoint();
  readonly scale = new FakePoint(1, 1);
  label = "";
  isRenderGroup = false;
  sortableChildren = false;
  eventMode = "none";
  zIndex = 0;
  visible = true;
  alpha = 1;
  rotation = 0;
  destroyed = false;

  constructor(options: FakeContainerOptions = {}) {
    this.label = options.label ?? "";
    this.isRenderGroup = options.isRenderGroup ?? false;
  }

  addChild<T extends FakeContainer>(...children: T[]): T {
    this.children.push(...children);
    return children[0];
  }

  removeChild<T extends FakeContainer>(...children: T[]): T {
    for (const child of children) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
    }
    return children[0];
  }

  sortChildren(): void {
    this.children.sort((left, right) => left.zIndex - right.zIndex);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGraphics extends FakeContainer {
  readonly commands: Array<readonly [string, ...unknown[]]> = [];
  hitArea: unknown = null;

  clear(): this {
    this.commands.push(["clear"]);
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.commands.push(["rect", x, y, width, height]);
    return this;
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
  ): this {
    this.commands.push(["ellipse", x, y, radiusX, radiusY]);
    return this;
  }

  poly(points: number[], close?: boolean): this {
    this.commands.push(["poly", points, close]);
    return this;
  }

  fill(style: unknown): this {
    this.commands.push(["fill", style]);
    return this;
  }

  stroke(style: unknown): this {
    this.commands.push(["stroke", style]);
    return this;
  }
}

class FakeRectangle {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
  ) {}

  contains(x: number, y: number): boolean {
    return (
      x >= this.x &&
      x <= this.x + this.width &&
      y >= this.y &&
      y <= this.y + this.height
    );
  }
}

class FakeEllipse {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly radiusX: number,
    readonly radiusY: number,
  ) {}

  contains(x: number, y: number): boolean {
    const normalX = (x - this.x) / this.radiusX;
    const normalY = (y - this.y) / this.radiusY;
    return normalX ** 2 + normalY ** 2 <= 1;
  }
}

class FakePolygon {
  readonly points: number[];

  constructor(points: number[]) {
    this.points = [...points];
  }

  contains(): boolean {
    return true;
  }
}

interface FakeRenderer {
  readonly type: number;
  readonly resize: ReturnType<typeof vi.fn>;
}

interface FakeApplicationInitOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly [key: string]: unknown;
}

class FakeApplication {
  readonly stage = new FakeContainer();
  readonly renderer: FakeRenderer;
  readonly render = vi.fn();
  readonly destroy = vi.fn(
    (rendererOptions?: { readonly removeView?: boolean } | boolean) => {
      if (
        rendererOptions === true ||
        (typeof rendererOptions === "object" &&
          rendererOptions?.removeView === true)
      ) {
        this.initOptions?.canvas?.remove();
      }
    },
  );
  initOptions: FakeApplicationInitOptions | null = null;

  constructor(
    rendererType: number,
    private readonly initFailure: Error | null,
  ) {
    this.renderer = {
      type: rendererType,
      resize: vi.fn(),
    };
  }

  async init(options: FakeApplicationInitOptions): Promise<void> {
    this.initOptions = options;
    if (this.initFailure) throw this.initFailure;
  }
}

function fakeRuntime(
  renderer: "webgpu" | "webgl" | "canvas" = "webgpu",
  initFailure: Error | null = null,
) {
  const RendererType = {
    WEBGL: 1,
    WEBGPU: 2,
    CANVAS: 4,
    BOTH: 3,
  } as const;
  const applications: FakeApplication[] = [];
  const rendererType =
    renderer === "webgpu"
      ? RendererType.WEBGPU
      : renderer === "webgl"
        ? RendererType.WEBGL
        : RendererType.CANVAS;

  class RuntimeApplication extends FakeApplication {
    constructor() {
      super(rendererType, initFailure);
      applications.push(this);
    }
  }

  return {
    applications,
    runtime: {
      Application: RuntimeApplication,
      Container: FakeContainer,
      Graphics: FakeGraphics,
      Rectangle: FakeRectangle,
      Ellipse: FakeEllipse,
      Polygon: FakePolygon,
      RendererType,
    } as unknown as StudioPixiRuntime,
  };
}

function graphicsChildren(application: FakeApplication): FakeGraphics[] {
  const root = application.stage.children[0];
  return root.children as FakeGraphics[];
}

describe("Studio Pixi scene provider", () => {
  it("owns a transparent canvas and covers init, DPR resize, render, and idempotent destroy", async () => {
    const fixture = fakeRuntime("webgpu");
    const provider = await createStudioPixiSceneProvider({
      renderer: "webgpu",
      width: 720,
      height: 1_280,
      dpr: 2,
      ownerDocument: document,
      loadRuntime: async () => fixture.runtime,
    });
    const application = fixture.applications[0];
    const root = application.stage.children[0];

    expect(application.initOptions).toMatchObject({
      canvas: provider.canvas,
      width: 720,
      height: 1_280,
      resolution: 2,
      autoDensity: true,
      backgroundAlpha: 0,
      autoStart: false,
      preference: ["webgpu"],
      powerPreference: "high-performance",
    });
    expect(provider.canvas.dataset.studioSceneOverlay).toBe(
      STUDIO_PIXI_SCENE_CANVAS_MARKER,
    );
    expect(provider.canvas.dataset.studioSceneInputAuthority).toBe("inactive");
    expect(provider.canvas.style.background).toBe("transparent");
    expect(provider.canvas.style.pointerEvents).toBe("none");
    expect(provider.canvas.style.width).toBe("720px");
    expect(provider.canvas.style.height).toBe("1280px");
    expect(root).toMatchObject({
      label: STUDIO_PIXI_SCENE_ROOT_LABEL,
      isRenderGroup: true,
      sortableChildren: true,
      eventMode: "passive",
    });
    expect(root.position.set).toHaveBeenCalledWith(0, 0);
    expect(root.scale.set).toHaveBeenCalledWith(1, 1);
    expect(root.rotation).toBe(0);
    expect(provider.receipt).toMatchObject({
      selectedRenderer: "webgpu",
      attemptedRenderer: "webgpu",
      activeRenderer: "webgpu",
      attemptCount: 1,
      failureIsolation: "fail-closed",
      surface: {
        ownership: "exclusive-dedicated-overlay",
        contextSharing: "forbidden",
      },
    });

    provider.resize({
      width: 900,
      height: 1_600,
      dpr: 2.5,
      documentTransform: {
        scaleX: -1.5,
        scaleY: 1.5,
        offsetX: 320,
        offsetY: 48,
        rotation: 90,
      },
    });
    expect(application.renderer.resize).toHaveBeenCalledWith(900, 1_600, 2.5);
    expect(provider.viewport).toEqual({
      width: 900,
      height: 1_600,
      dpr: 2.5,
      documentTransform: {
        scaleX: -1.5,
        scaleY: 1.5,
        offsetX: 320,
        offsetY: 48,
        rotation: 90,
      },
    });
    expect(root.position).toEqual(expect.objectContaining({ x: 320, y: 48 }));
    expect(root.scale).toEqual(expect.objectContaining({ x: -1.5, y: 1.5 }));
    expect(root.rotation).toBeCloseTo(Math.PI / 2);
    expect(provider.canvas.style.width).toBe("900px");
    expect(provider.canvas.style.height).toBe("1600px");

    provider.render();
    expect(application.render).toHaveBeenCalledTimes(1);

    document.body.append(provider.canvas);
    provider.destroy();
    provider.destroy();
    expect(application.destroy).toHaveBeenCalledTimes(1);
    expect(application.destroy).toHaveBeenCalledWith(
      { removeView: true },
      { children: true, texture: true, textureSource: true, context: true },
    );
    expect(provider.canvas.isConnected).toBe(false);
    expect(provider.destroyed).toBe(true);
    expect(() => provider.render()).toThrow(/destroyed/u);
  });

  it("upserts all selectable shapes with stable labels, custom hit areas, and deterministic tie ordering", async () => {
    const fixture = fakeRuntime("webgpu");
    const provider = await createStudioPixiSceneProvider({
      renderer: "webgpu",
      width: 500,
      height: 500,
      dpr: 1,
      ownerDocument: document,
      loadRuntime: async () => fixture.runtime,
    });
    const application = fixture.applications[0];

    const polygonIdentity = provider.upsertSelectableOverlay({
      documentId: "polygon",
      zIndex: 1,
      shape: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 20, y: 40 },
        ],
      },
    });
    const betaIdentity = provider.upsertSelectableOverlay({
      documentId: "beta",
      zIndex: 5,
      shape: {
        kind: "rect",
        bounds: { x: 10, y: 20, width: 30, height: 40 },
      },
    });
    const alphaIdentity = provider.upsertSelectableOverlay({
      documentId: "alpha",
      zIndex: 5,
      shape: {
        kind: "ellipse",
        bounds: { x: 15, y: 25, width: 50, height: 60 },
      },
    });

    const graphics = graphicsChildren(application);
    expect(graphics.map((entry) => entry.label)).toEqual([
      polygonIdentity.label,
      alphaIdentity.label,
      betaIdentity.label,
    ]);
    expect(graphics.map((entry) => entry.zIndex)).toEqual([0, 1, 2]);
    expect(graphics.every((entry) => entry.eventMode === "static")).toBe(true);
    expect(graphics[0].hitArea).toBeInstanceOf(FakePolygon);
    expect(graphics[1].hitArea).toBeInstanceOf(FakeEllipse);
    expect(graphics[2].hitArea).toBeInstanceOf(FakeRectangle);
    expect(provider.documentIdForLabel(alphaIdentity.label)).toBe("alpha");

    const alphaBeforeUpdate = graphics[1];
    const betaBeforeRemoval = graphics[2];
    provider.upsertSelectableOverlay({
      documentId: "alpha",
      zIndex: 7,
      selectable: false,
      shape: {
        kind: "ellipse",
        bounds: { x: 20, y: 30, width: 80, height: 90 },
      },
    });
    const graphicsAfterUpdate = graphicsChildren(application);
    expect(graphicsAfterUpdate).toHaveLength(3);
    expect(graphicsAfterUpdate.at(-1)).toBe(alphaBeforeUpdate);
    expect(alphaBeforeUpdate.eventMode).toBe("none");
    expect(
      alphaBeforeUpdate.commands.filter(([command]) => command === "clear"),
    ).toHaveLength(2);

    expect(provider.removeSelectableOverlay("beta")).toBe(true);
    expect(provider.removeSelectableOverlay("beta")).toBe(false);
    expect(provider.documentIdForLabel(betaIdentity.label)).toBeNull();
    expect(betaBeforeRemoval.destroyed).toBe(true);
  });

  it("returns a renderer-neutral topmost hit and excludes hidden or non-selectable overlays", async () => {
    const fixture = fakeRuntime("webgpu");
    const provider = await createStudioPixiSceneProvider({
      renderer: "webgpu",
      width: 200,
      height: 200,
      dpr: 1,
      ownerDocument: document,
      loadRuntime: async () => fixture.runtime,
    });
    const mutablePolygonPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ];

    provider.upsertSelectableOverlay({
      documentId: "rect",
      zIndex: 0,
      shape: {
        kind: "rect",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    });
    provider.upsertSelectableOverlay({
      documentId: "ellipse",
      zIndex: 1,
      shape: {
        kind: "ellipse",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    });
    provider.upsertSelectableOverlay({
      documentId: "polygon",
      zIndex: 2,
      shape: { kind: "polygon", points: mutablePolygonPoints },
    });
    mutablePolygonPoints[0].x = 10_000;

    expect(provider.hitTest({ x: 50, y: 40 })).toEqual({
      documentId: "polygon",
      label: expect.stringContaining("polygon"),
      zIndex: 2,
      shapeKind: "polygon",
      point: { x: 50, y: 40 },
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    });

    provider.upsertSelectableOverlay({
      documentId: "polygon",
      zIndex: 2,
      selectable: false,
      shape: { kind: "polygon", points: mutablePolygonPoints },
    });
    expect(provider.hitTest({ x: 50, y: 40 })?.documentId).toBe("ellipse");

    provider.upsertSelectableOverlay({
      documentId: "ellipse",
      zIndex: 1,
      visible: false,
      shape: {
        kind: "ellipse",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    });
    expect(provider.hitTest({ x: 50, y: 40 })?.documentId).toBe("rect");
    expect(provider.hitTest({ x: 180, y: 180 })).toBeNull();
    expect(provider.hitTest({ x: Number.NaN, y: 10 })).toBeNull();
  });

  it("runs an explicitly selected WebGL operation without treating it as a WebGPU fallback", async () => {
    const fixture = fakeRuntime("webgl");
    const provider = await createStudioPixiSceneProvider({
      renderer: "webgl",
      width: 100,
      height: 100,
      dpr: 1,
      ownerDocument: document,
      loadRuntime: async () => fixture.runtime,
    });

    expect(fixture.applications[0]!.initOptions!.preference).toEqual(["webgl"]);
    expect(provider.receipt).toEqual({
      providerId: "pixi",
      selectedRenderer: "webgl",
      attemptedRenderer: "webgl",
      activeRenderer: "webgl",
      attemptCount: 1,
      failureIsolation: "fail-closed",
      surface: {
        ownership: "exclusive-dedicated-overlay",
        contextSharing: "forbidden",
        background: "transparent",
      },
    });
  });

  it("rejects a renderer that differs from the selected operation instead of accepting substitution", async () => {
    const fixture = fakeRuntime("webgl");
    await expect(
      createStudioPixiSceneProvider({
        renderer: "webgpu",
        width: 100,
        height: 100,
        dpr: 1,
        ownerDocument: document,
        loadRuntime: async () => fixture.runtime,
      }),
    ).rejects.toThrow(/automatic renderer substitution is forbidden/u);
    expect(fixture.applications[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("fails closed before mutation for malformed input and rejects non-GPU renderers", async () => {
    const lazyLoader = vi.fn(async () => fakeRuntime("webgpu").runtime);
    await expect(
      createStudioPixiSceneProvider({
        renderer: "webgpu",
        width: 0,
        height: 100,
        dpr: 1,
        ownerDocument: document,
        loadRuntime: lazyLoader,
      }),
    ).rejects.toThrow(/finite positive/u);
    expect(lazyLoader).not.toHaveBeenCalled();

    const fixture = fakeRuntime("webgpu");
    const provider = await createStudioPixiSceneProvider({
      renderer: "webgpu",
      width: 100,
      height: 100,
      dpr: 1,
      ownerDocument: document,
      loadRuntime: async () => fixture.runtime,
    });
    expect(() =>
      provider.upsertSelectableOverlay({
        documentId: "invalid",
        zIndex: 0,
        shape: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      }),
    ).toThrow(/at least three/u);
    expect(graphicsChildren(fixture.applications[0])).toHaveLength(0);

    const canvasFixture = fakeRuntime("canvas");
    await expect(
      createStudioPixiSceneProvider({
        renderer: "webgpu",
        width: 100,
        height: 100,
        dpr: 1,
        ownerDocument: document,
        loadRuntime: async () => canvasFixture.runtime,
      }),
    ).rejects.toThrow(/require WebGPU or WebGL/u);
    expect(canvasFixture.applications[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("cleans up its dedicated canvas when runtime initialization fails", async () => {
    const failure = new Error("adapter request failed");
    const fixture = fakeRuntime("webgpu", failure);

    await expect(
      createStudioPixiSceneProvider({
        renderer: "webgpu",
        width: 100,
        height: 100,
        dpr: 1,
        ownerDocument: document,
        loadRuntime: async () => fixture.runtime,
      }),
    ).rejects.toBe(failure);
    expect(fixture.applications[0].destroy).toHaveBeenCalledTimes(1);
  });
});
