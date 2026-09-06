import type { StudioBg3dObjWorkerCanonicalResult } from "./studio-bg3d-obj-worker-protocol";
import type * as THREE from "three";

export interface StudioBg3dObjThreeHydrationOptions {
  readonly loadingManager: THREE.LoadingManager;
  readonly signal?: AbortSignal;
  readonly textureUrlForPath: (path: string) => string;
}
function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** Rebuilds only validated clone-safe IR. Parsing and geometry expansion stay in the Worker. */
export async function hydrateStudioBg3dObjWorkerResult(
  result: StudioBg3dObjWorkerCanonicalResult,
  options: StudioBg3dObjThreeHydrationOptions,
): Promise<THREE.Object3D> {
  throwIfAborted(options.signal);
  const {
    BufferAttribute,
    BufferGeometry,
    ClampToEdgeWrapping,
    Color,
    ColorManagement,
    EquirectangularReflectionMapping,
    Group,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshPhongMaterial,
    Points,
    PointsMaterial,
    RepeatWrapping,
    SRGBColorSpace,
    TextureLoader,
  } = await import("three");
  throwIfAborted(options.signal);

  const textureLoader = new TextureLoader(options.loadingManager);
  const loadedTextures = new Set<THREE.Texture>();
  const baseMaterials: THREE.MeshPhongMaterial[] = [];
  const createdObjects: THREE.Object3D[] = [];
  let returnedRoot: THREE.Object3D | null = null;

  const loadTexture = (
    binding: StudioBg3dObjWorkerCanonicalResult["materials"][number]["textures"][number],
  ): THREE.Texture => {
    throwIfAborted(options.signal);
    const texture = textureLoader.load(options.textureUrlForPath(binding.resourcePath));
    loadedTextures.add(texture);
    texture.repeat.set(binding.repeat[0], binding.repeat[1]);
    texture.offset.set(binding.offset[0], binding.offset[1]);
    texture.wrapS = binding.repeat[0] === 1 ? ClampToEdgeWrapping : RepeatWrapping;
    texture.wrapT = binding.repeat[1] === 1 ? ClampToEdgeWrapping : RepeatWrapping;
    if (binding.slot === "base-color" || binding.slot === "emissive") {
      texture.colorSpace = SRGBColorSpace;
    }
    if (binding.slot === "reflection") texture.mapping = EquirectangularReflectionMapping;
    return texture;
  };

  try {
    for (const source of result.materials) {
      throwIfAborted(options.signal);
      const material = new MeshPhongMaterial({
        color: ColorManagement.colorSpaceToWorking(
          new Color().fromArray(source.diffuse),
          SRGBColorSpace,
        ),
        emissive: ColorManagement.colorSpaceToWorking(
          new Color().fromArray(source.emissive),
          SRGBColorSpace,
        ),
        opacity: source.opacity,
        shininess: source.shininess,
        specular: ColorManagement.colorSpaceToWorking(
          new Color().fromArray(source.specular),
          SRGBColorSpace,
        ),
        transparent: source.opacity < 1,
      });
      material.name = source.name;
      for (const binding of source.textures) {
        const texture = loadTexture(binding);
        if (binding.slot === "ambient") material.aoMap = texture;
        else if (binding.slot === "base-color") material.map = texture;
        else if (binding.slot === "specular") material.specularMap = texture;
        else if (binding.slot === "emissive") material.emissiveMap = texture;
        else if (binding.slot === "normal") material.normalMap = texture;
        else if (binding.slot === "bump") {
          material.bumpMap = texture;
          material.bumpScale = binding.bumpScale;
        } else if (binding.slot === "displacement") {
          material.displacementMap = texture;
          material.displacementBias = binding.displacementBias;
          material.displacementScale = binding.displacementScale;
        } else if (binding.slot === "alpha") {
          material.alphaMap = texture;
          material.transparent = true;
        } else if (binding.slot === "reflection") material.envMap = texture;
      }
      baseMaterials.push(material);
    }

    const renderableObjects: THREE.Object3D[] = [];
    for (const source of result.renderables) {
      throwIfAborted(options.signal);
      const geometry = new BufferGeometry();
      for (const attribute of source.attributes) {
        geometry.setAttribute(
          attribute.name,
          new BufferAttribute(new Float32Array(attribute.buffer), attribute.itemSize, false),
        );
      }
      for (const group of source.groups) {
        geometry.addGroup(group.start, group.count, group.materialIndex);
      }

      const materials = source.materialSlots.map((slot) => {
        const base = baseMaterials[slot.canonicalMaterialIndex];
        if (!base) throw new TypeError("OBJ material index is outside the validated result");
        if (source.kind === "line-segments") {
          const line = new LineBasicMaterial({
            color: base.color,
            opacity: base.opacity,
            transparent: base.transparent,
            vertexColors: slot.vertexColors,
          });
          line.name = slot.name;
          return line;
        }
        if (source.kind === "points") {
          const points = new PointsMaterial({
            color: base.color,
            map: base.map,
            opacity: base.opacity,
            size: 1,
            sizeAttenuation: false,
            transparent: base.transparent,
            vertexColors: slot.vertexColors,
          });
          points.name = slot.name;
          return points;
        }
        const mesh = base.clone();
        mesh.name = slot.name;
        mesh.flatShading = slot.flatShading;
        mesh.vertexColors = slot.vertexColors;
        mesh.needsUpdate = true;
        return mesh;
      });
      let object: THREE.Object3D;
      if (source.kind === "line-segments") object = new LineSegments(geometry, materials);
      else if (source.kind === "points") object = new Points(geometry, materials);
      else object = new Mesh(geometry, materials);
      object.name = source.name;
      renderableObjects.push(object);
      createdObjects.push(object);
    }

    const nodes: THREE.Object3D[] = [];
    const roots: THREE.Object3D[] = [];
    for (const source of result.nodes) {
      throwIfAborted(options.signal);
      const object = source.renderableIndex === null
        ? new Group()
        : renderableObjects[source.renderableIndex];
      if (!object) throw new TypeError("OBJ renderable index is outside the validated result");
      object.name = source.name;
      nodes.push(object);
      if (source.parentIndex === null) roots.push(object);
      else {
        const parent = nodes[source.parentIndex];
        if (!parent) throw new TypeError("OBJ parent index is outside the validated result");
        parent.add(object);
      }
    }
    if (roots.length === 1 && roots[0]) returnedRoot = roots[0];
    else {
      const container = new Group();
      container.name = "obj-package";
      container.add(...roots);
      returnedRoot = container;
    }
    throwIfAborted(options.signal);
    return returnedRoot;
  } catch (error) {
    const disposableRoot = returnedRoot ?? (() => {
      const container = new Group();
      container.add(...createdObjects.filter((object) => object.parent === null));
      return container;
    })();
    disposableRoot.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        readonly geometry?: THREE.BufferGeometry;
        readonly material?: THREE.Material | readonly THREE.Material[];
      };
      renderable.geometry?.dispose();
      const materials = renderable.material
        ? Array.isArray(renderable.material) ? renderable.material : [renderable.material]
        : [];
      for (const material of materials) material.dispose();
    });
    for (const texture of loadedTextures) texture.dispose();
    throw error;
  } finally {
    // Attached renderables own cloned materials. Source bases are only construction templates;
    // disposing them does not dispose their shared texture slots.
    for (const material of baseMaterials) material.dispose();
  }
}
