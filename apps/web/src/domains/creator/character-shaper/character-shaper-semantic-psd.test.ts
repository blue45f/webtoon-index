import { initializeCanvas, readPsd } from "ag-psd";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  CHARACTER_SEMANTIC_MASK_ORDER,
  boundCharacterSemanticCaptureSize,
  buildCharacterSemanticPsd,
  captureCharacterSemanticPasses,
  exportCharacterSemanticPsd,
} from "./character-shaper-semantic-psd";

import type {
  CharacterSemanticPass,
  CharacterSemanticPassId,
} from "./character-shaper-contract";
import type {
  CharacterSemanticCaptureDependencies,
  CharacterSemanticSkip,
} from "./character-shaper-semantic-psd";
import type { VRM } from "@pixiv/three-vrm";

/**
 * `readPsd` decodes layer pixels through the DOM canvas even in `useImageData` mode. The shim
 * hands it a plain `ImageData` so the round trip can assert real bytes under `environment: node`.
 * It is module-local state inside ag-psd and Vitest isolates modules per file.
 */
initializeCanvas(
  (): HTMLCanvasElement => {
    throw new Error("PSD 검증에서는 캔버스를 만들지 않습니다.");
  },
  (width: number, height: number): ImageData => ({
    colorSpace: "srgb",
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  }),
);

const WIDTH = 2;
const HEIGHT = 2;
const PIXELS = WIDTH * HEIGHT;

type MToonLike = THREE.MeshStandardMaterial & {
  isMToonMaterial: boolean;
  shadeColorFactor: THREE.Color;
  shadingShiftFactor: number;
  shadingToonyFactor: number;
  isOutline?: boolean;
};

function mtoon(name: string, base: string, shade: string, outline = false): MToonLike {
  const material = new THREE.MeshStandardMaterial({ color: base }) as MToonLike;
  material.name = name;
  material.isMToonMaterial = true;
  material.shadeColorFactor = new THREE.Color(shade);
  material.shadingShiftFactor = -0.25;
  material.shadingToonyFactor = 0.9;
  if (outline) material.isOutline = true;
  return material;
}

function mesh(name: string, material: THREE.Material): THREE.Mesh {
  const object = new THREE.Mesh(new THREE.BoxGeometry(), material);
  object.name = name;
  return object;
}

function buildCharacterScene() {
  const face = mtoon("FaceBase", "#f0c8a8", "#c89878");
  const hair = mtoon("Hair", "#3a2a24", "#241814");
  const skin = mtoon("Skin", "#f5c6a0", "#d29a76");
  const tops = mtoon("Tops", "#4a6ea8", "#2c4468");
  const bottoms = mtoon("Bottoms", "#2a2a34", "#161620");
  const shoes = mtoon("Shoes", "#6a4a3a", "#402c22");
  const outline = mtoon("FaceBase (Outline)", "#1b1714", "#1b1714", true);
  const prop = new THREE.MeshStandardMaterial({ color: "#f5c6a0" });
  prop.name = "CatEarsMaterial";

  const root = new THREE.Group();
  root.name = "VRMRoot";
  const meshes = {
    face: mesh("Face", face),
    hair: mesh("Hair_01", hair),
    skin: mesh("Body", skin),
    tops: mesh("Tops_Shirt", tops),
    bottoms: mesh("Bottoms_Skirt", bottoms),
    shoes: mesh("Shoes", shoes),
    outline: mesh("Face_Outline", outline),
    prop: mesh("ears_cone", prop),
  };
  const propRoot = new THREE.Group();
  propRoot.name = "prop:catEars";
  propRoot.add(meshes.prop);

  root.add(
    meshes.face,
    meshes.hair,
    meshes.skin,
    meshes.tops,
    meshes.bottoms,
    meshes.shoes,
    meshes.outline,
    propRoot,
  );

  const scene = new THREE.Scene();
  scene.add(root);
  const vrm = { scene: root } as unknown as VRM;
  const capture = {
    gl: {} as THREE.WebGLRenderer,
    scene,
    camera: new THREE.PerspectiveCamera(),
  };
  return { vrm, capture, meshes, materials: { face, hair, skin, tops, bottoms, shoes, outline } };
}

interface Observation {
  readonly visible: readonly string[];
  readonly shading: readonly string[];
  readonly muted: readonly string[];
  readonly maps: readonly string[];
}

function observe(scene: THREE.Object3D): Observation {
  const visible: string[] = [];
  const shading: string[] = [];
  const muted: string[] = [];
  const maps: string[] = [];
  const seen = new Set<THREE.Material>();
  scene.traverse((object) => {
    const candidate = object as THREE.Mesh;
    if (!candidate.isMesh) return;
    if (candidate.visible) visible.push(candidate.name);
    const list = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
    for (const raw of list) {
      const material = raw as MToonLike & { map?: THREE.Texture | null };
      if (!material || seen.has(material)) continue;
      seen.add(material);
      if (material.shadeColorFactor) {
        shading.push(
          `${material.name}:#${material.shadeColorFactor.getHexString()}:${material.shadingShiftFactor}:${material.shadingToonyFactor}`,
        );
      }
      if (!material.colorWrite) muted.push(material.name);
      if (material.map) maps.push(`${material.name}:${material.map.name}`);
    }
  });
  return { visible, shading, muted, maps };
}

/** Two lit pixels (one shaded, one specular), one unchanged pixel, one transparent pixel. */
const BEAUTY = new Uint8ClampedArray([
  100, 100, 100, 255,
  255, 255, 255, 255,
  160, 160, 160, 255,
  0, 0, 0, 0,
]);
const FLAT = new Uint8ClampedArray([
  160, 160, 160, 255,
  160, 160, 160, 255,
  160, 160, 160, 255,
  0, 0, 0, 0,
]);
const COVERED = new Uint8ClampedArray(PIXELS * 4).fill(255);
const BLANK = new Uint8ClampedArray(PIXELS * 4);

interface FakeRenderer {
  readonly dependencies: CharacterSemanticCaptureDependencies;
  readonly observations: readonly Observation[];
}

function fakeRenderer(
  frame?: (observation: Observation, call: number) => Uint8ClampedArray | null,
): FakeRenderer {
  const observations: Observation[] = [];
  return {
    observations,
    dependencies: {
      captureRgba: (_gl, scene) => {
        const observation = observe(scene);
        observations.push(observation);
        const custom = frame?.(observation, observations.length - 1);
        if (custom) return custom;
        if (observations.length === 1) return BEAUTY.slice();
        if (observations.length === 2) return FLAT.slice();
        return COVERED.slice();
      },
    },
  };
}

function baseInput(scene: ReturnType<typeof buildCharacterScene>) {
  return { capture: scene.capture, vrm: scene.vrm, width: WIDTH, height: HEIGHT };
}

function reasonFor(skipped: readonly CharacterSemanticSkip[], pass: CharacterSemanticPassId): string {
  return skipped.find((entry) => entry.pass === pass)?.reason ?? "";
}

/**
 * VRoid 계열 머리 — 얼굴·눈이 한 메시 안에 재질 슬롯으로만 나뉜다. 메시 이름은 어느 쪽도
 * 가리키지 않으므로 슬롯 단위로 쪼개지 않으면 「눈」 레이어를 만들 수 없다.
 */
function buildMergedHeadScene() {
  const faceMaterial = mtoon("F00_000_00_FaceMouth_00_FACE", "#f0c8a8", "#c89878");
  const eyeMaterial = mtoon("F00_000_00_EyeIris_00_EYE", "#3a6ea8", "#24486a");
  const head = new THREE.Mesh(new THREE.BoxGeometry(), [faceMaterial, eyeMaterial]);
  head.name = "N00_000_00_HeadMesh";

  const root = new THREE.Group();
  root.name = "VRMRoot";
  root.add(head);
  const scene = new THREE.Scene();
  scene.add(root);
  return {
    head,
    faceMaterial,
    eyeMaterial,
    vrm: { scene: root } as unknown as VRM,
    capture: { gl: {} as THREE.WebGLRenderer, scene, camera: new THREE.PerspectiveCamera() },
  };
}

function pass(id: CharacterSemanticPassId, rgba: Uint8ClampedArray): CharacterSemanticPass {
  return { id, width: WIDTH, height: HEIGHT, rgba };
}

describe("character shaper semantic capture — budget", () => {
  it("caps a pass at 2048 on the long edge and keeps the aspect ratio", () => {
    expect(boundCharacterSemanticCaptureSize(1440, 900)).toEqual({ width: 1440, height: 900 });
    expect(boundCharacterSemanticCaptureSize(4096, 2048)).toEqual({ width: 2048, height: 1024 });
    expect(boundCharacterSemanticCaptureSize(1000, 5000)).toEqual({ width: 409, height: 2048 });
    expect(() => boundCharacterSemanticCaptureSize(0, 100)).toThrow(RangeError);
    expect(() => boundCharacterSemanticCaptureSize(100, Number.NaN)).toThrow(RangeError);
  });
});

describe("character shaper semantic capture — passes", () => {
  it("renders beauty with the model's own shading and flat with MToon shading neutralised", async () => {
    const scene = buildCharacterScene();
    const renderer = fakeRenderer();

    await captureCharacterSemanticPasses(baseInput(scene), renderer.dependencies);

    const [beauty, flat] = renderer.observations;
    expect(beauty.shading).toContain("FaceBase:#c89878:-0.25:0.9");
    expect(beauty.shading).toContain("Tops:#2c4468:-0.25:0.9");
    // Flat pass: shade colour := base colour, ramp pushed fully to the lit side.
    expect(flat.shading).toContain("FaceBase:#f0c8a8:1:1");
    expect(flat.shading).toContain("Tops:#4a6ea8:1:1");
    // The outline draw is deliberately left alone so the line pass can still find it.
    expect(flat.shading).toContain("FaceBase (Outline):#1b1714:-0.25:0.9");
  });

  it("separates eyes from a merged head by muting the other material slots", async () => {
    const scene = buildMergedHeadScene();
    const renderer = fakeRenderer();

    const result = await captureCharacterSemanticPasses(
      { capture: scene.capture, vrm: scene.vrm, width: WIDTH, height: HEIGHT },
      renderer.dependencies,
    );

    // 눈과 얼굴 둘 다 레이어가 나와야 한다 — 한 메시 안에 있다는 이유로 포기하지 않는다.
    const ids = result.passes.map((pass) => pass.id);
    expect(ids).toContain("mask-eyes");
    expect(ids).toContain("mask-face");
    expect(reasonFor(result.skipped, "mask-eyes")).toBe("");

    // 눈 패스에서는 얼굴 재질만 꺼진다. 메시 자체는 계속 그려져야 눈이 남는다.
    const eyePass = renderer.observations.find((observation) =>
      observation.muted.length === 1 && observation.muted[0] === scene.faceMaterial.name);
    expect(eyePass).toBeTruthy();
    expect(eyePass?.visible).toContain("N00_000_00_HeadMesh");

    const facePass = renderer.observations.find((observation) =>
      observation.muted.length === 1 && observation.muted[0] === scene.eyeMaterial.name);
    expect(facePass).toBeTruthy();

    // 캡처가 끝나면 두 재질의 colorWrite가 원래대로 돌아온다.
    expect(scene.faceMaterial.colorWrite).toBe(true);
    expect(scene.eyeMaterial.colorWrite).toBe(true);
  });

  it("leaves a single-purpose multi-material mesh classified as one whole mesh", async () => {
    // 슬롯이 전부 같은 부위를 가리키면 쪼갤 이유가 없다 — 메시 단위 분류가 그대로 맞다.
    const outer = mtoon("Tops_Outer", "#4a6ea8", "#2c4468");
    const inner = mtoon("Tops_Inner", "#3a5e98", "#1c3458");
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(), [outer, inner]);
    shirt.name = "Cloth_01";
    const root = new THREE.Group();
    root.name = "VRMRoot";
    root.add(shirt);
    const scene = new THREE.Scene();
    scene.add(root);
    const renderer = fakeRenderer();

    await captureCharacterSemanticPasses(
      {
        capture: { gl: {} as THREE.WebGLRenderer, scene, camera: new THREE.PerspectiveCamera() },
        vrm: { scene: root } as unknown as VRM,
        width: WIDTH,
        height: HEIGHT,
      },
      renderer.dependencies,
    );

    expect(renderer.observations.every((observation) => observation.muted.length === 0)).toBe(true);
  });

  it("restores every material factor after the flat pass", async () => {
    const scene = buildCharacterScene();
    const before = Object.entries(scene.materials).map(([key, material]) =>
      `${key}:#${material.shadeColorFactor.getHexString()}:${material.shadingShiftFactor}:${material.shadingToonyFactor}`);

    await captureCharacterSemanticPasses(baseInput(scene), fakeRenderer().dependencies);

    const after = Object.entries(scene.materials).map(([key, material]) =>
      `${key}:#${material.shadeColorFactor.getHexString()}:${material.shadingShiftFactor}:${material.shadingToonyFactor}`);
    expect(after).toEqual(before);
  });

  it("restores material factors in finally when the flat render throws", async () => {
    const scene = buildCharacterScene();
    const renderer = fakeRenderer((_observation, call) => {
      if (call === 1) throw new Error("WebGL 컨텍스트를 잃었습니다.");
      return null;
    });

    await expect(captureCharacterSemanticPasses(baseInput(scene), renderer.dependencies))
      .rejects.toThrow(/WebGL/u);

    expect(`#${scene.materials.face.shadeColorFactor.getHexString()}`).toBe("#c89878");
    expect(scene.materials.face.shadingShiftFactor).toBe(-0.25);
    expect(scene.materials.face.shadingToonyFactor).toBe(0.9);
  });

  it("isolates one semantic group per mask and restores visibility, even when a render throws", async () => {
    const scene = buildCharacterScene();
    const renderer = fakeRenderer();

    const { passes } = await captureCharacterSemanticPasses(
      baseInput(scene),
      renderer.dependencies,
    );

    const isolated = renderer.observations.slice(2).map(({ visible }) => [...visible].sort());
    // The face outline mesh rides along with the face — that is one drawable region, not two.
    expect(isolated).toContainEqual(["Face", "Face_Outline"]);
    expect(isolated).toContainEqual(["Hair_01"]);
    expect(isolated).toContainEqual(["ears_cone"]);
    expect(isolated).toContainEqual(["Tops_Shirt"]);
    expect(isolated).toContainEqual(["Bottoms_Skirt"]);
    expect(isolated).toContainEqual(["Shoes"]);
    expect(isolated).toContainEqual(["Body"]);
    expect(passes.map((entry) => entry.id)).toContain("mask-top");
    expect(Object.values(scene.meshes).every((node) => node.visible)).toBe(true);

    const failing = buildCharacterScene();
    const thrower = fakeRenderer((observation) => {
      if (observation.visible.length === 1 && observation.visible[0] === "Hair_01") {
        throw new Error("마스크 렌더 실패");
      }
      return null;
    });
    await expect(captureCharacterSemanticPasses(baseInput(failing), thrower.dependencies))
      .rejects.toThrow(/마스크 렌더 실패/u);
    expect(Object.values(failing.meshes).every((node) => node.visible)).toBe(true);
  });

  it("derives shadow, highlight and line from the two lit passes", async () => {
    const scene = buildCharacterScene();

    const { passes } = await captureCharacterSemanticPasses(
      baseInput(scene),
      fakeRenderer().dependencies,
    );

    const byId = new Map(passes.map((entry) => [entry.id, entry]));
    // pixel 0 is 60 darker in beauty → shadow; pixel 1 is 95 brighter → highlight.
    expect([...(byId.get("shadow")?.rgba ?? []).slice(0, 4)]).toEqual([60, 60, 60, 60]);
    expect([...(byId.get("shadow")?.rgba ?? []).slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...(byId.get("highlight")?.rgba ?? []).slice(4, 8)]).toEqual([95, 95, 95, 95]);
    expect(byId.get("line")).toBeDefined();
    expect(byId.get("beauty")?.rgba).toEqual(BEAUTY);
  });

  it("names the passes a model cannot produce instead of faking them", async () => {
    const scene = buildCharacterScene();
    const renderer = fakeRenderer((observation) =>
      observation.visible.length === 1 && observation.visible[0] === "Shoes" ? BLANK.slice() : null);

    const { passes, skipped } = await captureCharacterSemanticPasses(
      baseInput(scene),
      renderer.dependencies,
    );

    expect(passes.map((entry) => entry.id)).not.toContain("mask-eyes");
    expect(reasonFor(skipped, "mask-eyes")).toContain("얼굴과 한 재질로 합쳐진");
    expect(passes.map((entry) => entry.id)).not.toContain("mask-shoes");
    expect(reasonFor(skipped, "mask-shoes")).toContain("신발");
    expect(reasonFor(skipped, "surface-paint")).toContain("표면 드로잉");
  });

  it("skips the shadow pair with a specific reason when the model has no MToon material", async () => {
    const scene = buildCharacterScene();
    const plain = new THREE.MeshStandardMaterial({ color: "#cccccc" });
    plain.name = "Skin";
    const bare = new THREE.Group();
    bare.name = "VRMRoot";
    bare.add(mesh("Body", plain));
    const vrm = { scene: bare } as unknown as VRM;
    const host = new THREE.Scene();
    host.add(bare);
    const renderer = fakeRenderer(() => BEAUTY.slice());

    const { skipped } = await captureCharacterSemanticPasses(
      { capture: { ...scene.capture, scene: host }, vrm, width: WIDTH, height: HEIGHT },
      renderer.dependencies,
    );

    expect(reasonFor(skipped, "shadow")).toContain("MToon");
    expect(reasonFor(skipped, "highlight")).toContain("MToon");
  });

  it("renders the surface-paint pass only when the paint runtime hands over textures", async () => {
    const scene = buildCharacterScene();
    const texture = new THREE.Texture();
    texture.name = "paint-atlas";
    const renderer = fakeRenderer();

    const { passes, skipped } = await captureCharacterSemanticPasses(
      {
        ...baseInput(scene),
        paintTextureProvider: () => new Map([[scene.materials.face, texture]]),
      },
      renderer.dependencies,
    );

    expect(passes.map((entry) => entry.id)).toContain("surface-paint");
    expect(skipped.map((entry) => entry.pass)).not.toContain("surface-paint");
    const paintObservation = renderer.observations[2];
    expect(paintObservation.maps).toEqual(["FaceBase:paint-atlas"]);
    expect(paintObservation.muted).toContain("Tops");
    expect(paintObservation.muted).not.toContain("FaceBase");
    // The strokes are captured unshaded — the light rig must not bake into the drawing layer.
    expect(paintObservation.shading).toContain("FaceBase:#ffffff:1:1");
    // Every binding is handed back.
    expect(scene.materials.face.map).toBeNull();
    expect(scene.materials.tops.colorWrite).toBe(true);
    expect(scene.materials.tops.depthWrite).toBe(true);
    expect(`#${scene.materials.face.color.getHexString()}`).toBe("#f0c8a8");
    expect(`#${scene.materials.face.shadeColorFactor.getHexString()}`).toBe("#c89878");
    expect(scene.materials.face.shadingShiftFactor).toBe(-0.25);
  });

  it("aborts between passes and leaves the scene untouched", async () => {
    const scene = buildCharacterScene();
    const controller = new AbortController();
    const renderer = fakeRenderer((_observation, call) => {
      if (call === 0) controller.abort();
      return null;
    });

    await expect(captureCharacterSemanticPasses(
      { ...baseInput(scene), signal: controller.signal },
      renderer.dependencies,
    )).rejects.toMatchObject({ name: "AbortError" });

    expect(renderer.observations).toHaveLength(1);
    expect(`#${scene.materials.face.shadeColorFactor.getHexString()}`).toBe("#c89878");
    expect(Object.values(scene.meshes).every((node) => node.visible)).toBe(true);
  });
});

describe("character shaper semantic PSD", () => {
  const passes: CharacterSemanticPass[] = [
    pass("beauty", BEAUTY.slice()),
    pass("flat", FLAT.slice()),
    pass("shadow", new Uint8ClampedArray(PIXELS * 4).fill(60)),
    pass("highlight", new Uint8ClampedArray(PIXELS * 4).fill(95)),
    pass("line", new Uint8ClampedArray(PIXELS * 4).fill(200)),
    pass("mask-face", COVERED.slice()),
    pass("mask-hair", COVERED.slice()),
    pass("mask-skin", COVERED.slice()),
    pass("mask-top", COVERED.slice()),
    pass("mask-bottom", BLANK.slice()),
  ];
  const skipped: CharacterSemanticSkip[] = [
    { pass: "surface-paint", reason: "모델 위에 칠한 획이 없어 드로잉 레이어를 만들지 않았습니다." },
    { pass: "mask-eyes", reason: "눈 메시를 따로 찾지 못했습니다." },
  ];

  it("writes Photoshop top-to-bottom groups with the blend modes a colourist expects", async () => {
    const { blob, receipt } = buildCharacterSemanticPsd(passes, skipped, { title: "새 캐릭터" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parsed = readPsd(bytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });

    expect(blob.type).toBe("image/vnd.adobe.photoshop");
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("8BPS");
    expect(parsed.children?.map((layer) => layer.name)).toEqual([
      "주선",
      "하이라이트",
      "음영",
      "밑색",
      "미리보기 (Beauty)",
    ]);
    expect(parsed.children?.map((layer) => layer.blendMode)).toEqual([
      "normal",
      "screen",
      "multiply",
      "normal",
      "normal",
    ]);
    expect(parsed.children?.at(-1)?.hidden).toBe(true);
    expect(receipt.width).toBe(WIDTH);
    expect(receipt.height).toBe(HEIGHT);
    expect(receipt.byteLength).toBe(bytes.byteLength);
  });

  it("splits 밑색 into one layer per non-empty mask, in the documented stacking order", async () => {
    const { blob, receipt } = buildCharacterSemanticPsd(passes, skipped, { title: "새 캐릭터" });
    const parsed = readPsd(new Uint8Array(await blob.arrayBuffer()), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });

    const flats = parsed.children?.find((layer) => layer.name === "밑색");
    expect(flats?.children?.map((layer) => layer.name)).toEqual(["얼굴", "머리", "상의", "피부"]);
    expect(receipt.layerNames).toEqual([
      "주선",
      "윤곽선",
      "하이라이트",
      "밝은 면",
      "음영",
      "어두운 면",
      "밑색",
      "얼굴",
      "머리",
      "상의",
      "피부",
      "미리보기 (Beauty)",
    ]);
    expect(CHARACTER_SEMANTIC_MASK_ORDER.indexOf("mask-skin"))
      .toBe(CHARACTER_SEMANTIC_MASK_ORDER.length - 1);
  });

  it("fills the 밑색 layers with the flat pass gated by the mask", async () => {
    const half = new Uint8ClampedArray(PIXELS * 4);
    half.set([255, 255, 255, 255], 0);
    const { blob } = buildCharacterSemanticPsd(
      [pass("flat", FLAT.slice()), pass("mask-skin", half)],
      [],
      { title: "마스크" },
    );
    const parsed = readPsd(new Uint8Array(await blob.arrayBuffer()), {
      useImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
    });

    const skin = parsed.children?.[0]?.children?.[0];
    expect(skin?.name).toBe("피부");
    // Coverage is gated by the mask; the flat colour itself is carried through untouched.
    expect([...(skin?.imageData?.data ?? []).slice(0, 8)])
      .toEqual([160, 160, 160, 255, 160, 160, 160, 0]);
  });

  it("carries every skip reason into the receipt and adds one for an empty mask", () => {
    const { receipt } = buildCharacterSemanticPsd(passes, skipped, { title: "새 캐릭터" });

    expect(reasonFor(receipt.skipped, "surface-paint")).toContain("칠한 획이 없어");
    expect(reasonFor(receipt.skipped, "mask-eyes")).toContain("눈 메시");
    expect(reasonFor(receipt.skipped, "mask-bottom")).toContain("비어 있어");
    expect(receipt.layerNames).not.toContain("하의");
  });

  it("keeps 밑색 as one layer, and says so, when no mask separated", () => {
    const { receipt } = buildCharacterSemanticPsd(
      [pass("beauty", BEAUTY.slice()), pass("flat", FLAT.slice())],
      [],
      { title: "마스크 없음" },
    );

    expect(receipt.layerNames).toContain("밑색 (전체)");
    expect(reasonFor(receipt.skipped, "flat")).toContain("한 장으로");
  });

  it("refuses to write a document with no passes, or with passes of different sizes", () => {
    expect(() => buildCharacterSemanticPsd([], [], { title: "빈 문서" }))
      .toThrow(/렌더 패스가 없습니다/u);
    expect(() => buildCharacterSemanticPsd(
      [
        pass("flat", FLAT.slice()),
        { id: "mask-skin", width: 4, height: 1, rgba: new Uint8ClampedArray(16).fill(255) },
      ],
      [],
      { title: "크기 불일치" },
    )).toThrow(/크기가 서로 달라/u);
  });
});

describe("character shaper semantic PSD — end to end", () => {
  it("captures and assembles in one call, listing at least eight layers", async () => {
    const scene = buildCharacterScene();

    const { blob, receipt } = await exportCharacterSemanticPsd(
      { ...baseInput(scene), title: "캐릭터 셰이퍼" },
      fakeRenderer().dependencies,
    );

    expect(blob.size).toBeGreaterThan(0);
    expect(receipt.layerNames.length).toBeGreaterThanOrEqual(8);
    expect(receipt.layerNames).toContain("주선");
    expect(receipt.layerNames).toContain("액세서리");
    expect(receipt.skipped.map((entry) => entry.pass)).toContain("mask-eyes");
    expect(Object.values(scene.meshes).every((node) => node.visible)).toBe(true);
  });
});
