import { readFileSync } from "node:fs";

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  applyStudioVrmCostumeState,
  collectStudioVrmCostumeMeshes,
} from "./studio-vrm-costume-runtime";
import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

import type { VRM } from "@pixiv/three-vrm";

function createVrm(scene: THREE.Group): VRM {
  return { scene } as VRM;
}

describe("Studio VRM baked costume runtime", () => {
  it("keeps authored materials on load, then isolates once at the first recolor", () => {
    const scene = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const sharedMaterial = new THREE.MeshStandardMaterial({ color: "#336699" });
    sharedMaterial.name = "Jacket";
    const mesh = new THREE.Mesh(geometry, sharedMaterial);
    mesh.name = "Body";
    scene.add(mesh);
    const vrm = createVrm(scene);

    const firstEntries = collectStudioVrmCostumeMeshes(vrm);
    expect(firstEntries).toHaveLength(1);
    expect(firstEntries[0]).toMatchObject({ key: "Body", label: "Body", slot: "outer" });
    expect(mesh.material).toBe(sharedMaterial);

    const secondEntries = collectStudioVrmCostumeMeshes(vrm);
    expect(mesh.material).toBe(sharedMaterial);
    expect(secondEntries[0]?.mesh).toBe(mesh);

    applyStudioVrmCostumeState(secondEntries, {
      hidden: ["Body"],
      recolor: { Body: "#cc3300" },
    });
    const isolatedMaterial = mesh.material as THREE.MeshStandardMaterial;
    expect(mesh.visible).toBe(false);
    expect(isolatedMaterial).not.toBe(sharedMaterial);
    expect(isolatedMaterial.color.getHexString()).not.toBe("336699");
    expect(sharedMaterial.color.getHexString()).toBe("336699");

    applyStudioVrmCostumeState(secondEntries, { hidden: [], recolor: {} });
    expect(mesh.visible).toBe(true);
    expect(isolatedMaterial.color.getHexString()).toBe("336699");

    geometry.dispose();
    isolatedMaterial.dispose();
    sharedMaterial.dispose();
  });

  it("keeps the Poser on the shared non-React runtime without moving rest-pose measurement", () => {
    const poserSource = readStudioVrmPoserImplementationSource();
    const runtimeSource = readFileSync(
      new URL("./studio-vrm-costume-runtime.ts", import.meta.url),
      "utf8",
    );

    expect(poserSource).toContain('from "./studio-vrm-costume-runtime"');
    expect(poserSource).toContain("collectStudioVrmCostumeMeshes(");
    expect(poserSource).toContain("applyStudioVrmCostumeState(");
    expect(poserSource).not.toMatch(/\b(?:interface|type) CostumeMeshEntry\b/u);
    expect(poserSource).not.toMatch(/\bfunction collectCostumeMeshes\b/u);
    expect(poserSource).not.toMatch(/\bfunction applyCostumeState\b/u);
    expect(runtimeSource).not.toMatch(
      /["'](?:react(?:-dom)?|@react-three\/[^"']+|\.\/StudioVrmPoser)["']/u,
    );
    expect(runtimeSource).not.toContain("StudioVrmPoser");

    const installStart = poserSource.indexOf("function installVrm(");
    // 2026-08-21 의도적 변경: beginModelLoad 가 use-studio-vrm-model-loading.ts 로 옮겨가,
    // installVrm 다음 선언인 handlePoseSelect 를 종료 마커로 쓴다(잘라내는 구간은 동일).
    const installEnd = poserSource.indexOf("function handlePoseSelect(", installStart);
    const installSource = poserSource.slice(installStart, installEnd);
    expect(installStart).toBeGreaterThanOrEqual(0);
    expect(installEnd).toBeGreaterThan(installStart);
    expect(installSource.indexOf("measureVrmWardrobeMetrics(nextVrm)")).toBeLessThan(
      installSource.indexOf("collectStudioVrmCostumeMeshes(nextVrm)"),
    );
    expect(installSource.indexOf("measureVrmPropRigMetrics(nextVrm)")).toBeLessThan(
      installSource.indexOf("collectStudioVrmCostumeMeshes(nextVrm)"),
    );
  });
});
