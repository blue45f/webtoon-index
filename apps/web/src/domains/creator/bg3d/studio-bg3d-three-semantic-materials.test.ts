import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { classifyStudioBg3dThreeSemanticMaterials } from "./studio-bg3d-three-semantic-materials";

describe("Three semantic material adapter", () => {
  it("aggregates shared material usage and classifies bounded multilingual names", () => {
    const root = new THREE.Group();
    root.name = "Character";
    const hair = new THREE.MeshStandardMaterial({ name: "Hair_Main" });
    const first = new THREE.Mesh(new THREE.BoxGeometry(), hair);
    first.name = "앞머리";
    const second = new THREE.Mesh(new THREE.BoxGeometry(), hair);
    second.name = "Ponytail";
    root.add(first, second);

    const result = classifyStudioBg3dThreeSemanticMaterials(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({
      materialKey: "material-0",
      slot: "hair",
      confidence: "high",
    });
    expect(result.assignments[0]?.evidence.some((item) => item.term === "hair")).toBe(true);
  });

  it("omits URL-like metadata while retaining safe mesh evidence", () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ name: "https://host.invalid/eyes.png" });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.name = "Iris";
    root.add(mesh);

    const result = classifyStudioBg3dThreeSemanticMaterials(root);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments[0]).toMatchObject({ slot: "eyes" });
    expect(JSON.stringify(result)).not.toContain("host.invalid");
  });

  it("fails closed when unique source materials exceed the adapter budget", () => {
    const root = new THREE.Group();
    for (let index = 0; index < 513; index += 1) {
      root.add(new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshBasicMaterial({ name: `material ${index}` }),
      ));
    }

    expect(classifyStudioBg3dThreeSemanticMaterials(root)).toEqual({
      ok: false,
      code: "material-budget-exceeded",
    });
  });
});
