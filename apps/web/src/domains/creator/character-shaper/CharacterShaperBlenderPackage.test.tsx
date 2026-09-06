// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterShaperBlenderPackage } from "./CharacterShaperBlenderPackage";

import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

afterEach(cleanup);

const VALID_MANIFEST = {
  schemaVersion: 1,
  kind: "toonstudio.character-package",
  characterId: "rin-a",
  displayName: "린 (A)",
  configDigest: "a".repeat(64),
  pipelineVersion: 1,
  capabilities: {
    authoredHair: { enabled: true, style: "bob", lodTriangles: [1200], replacedSourceMeshes: [] },
    semanticFaceShapes: { mode: "native", confidence: 0.9, objects: ["Face"], shapeKeys: ["eyeSize"] },
    mtoonReady: true,
    vrmCustomExpressions: { status: "available", names: ["happy"] },
    lods: false,
  },
  quality: { score: 92, passed: true, minimumScore: 80, report: "ok" },
  files: { vrm: { path: "build/rin-a.vrm", bytes: 4, sha256: "b".repeat(64) } },
  provenance: { blender: "4.2" },
};

function makeHost(): { host: StudioVrmPoserHost; installed: File[] } {
  const installed: File[] = [];
  const host = {
    handleGeneratedVrmFile: vi.fn(async (file: File) => {
      installed.push(file);
    }),
  } as unknown as StudioVrmPoserHost;
  return { host, installed };
}

function selectFiles(files: readonly File[]): void {
  const input = screen.getByLabelText("Blender 캐릭터 패키지 파일 선택") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

function jsonFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}

describe("CharacterShaperBlenderPackage", () => {
  it("explains where packages come from and never claims to run Blender", () => {
    const { host } = makeHost();
    render(<CharacterShaperBlenderPackage h={host} />);
    expect(screen.getByText(/character-package\.json/u)).toBeTruthy();
    expect(screen.getByText(/docs\/studio\/blender-character-pipeline\.md/u)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("아직 불러온 패키지가 없습니다.");
  });

  it("fails closed with the parser's own reason and never installs an invalid package", async () => {
    const { host, installed } = makeHost();
    render(<CharacterShaperBlenderPackage h={host} />);

    selectFiles([jsonFile("character-package.json", { ...VALID_MANIFEST, kind: "something-else" })]);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("package.kind is unsupported");
    });
    expect(screen.getByRole("status").textContent).toContain("불러오지 못했습니다");
    expect(installed).toHaveLength(0);
    expect(host.handleGeneratedVrmFile).not.toHaveBeenCalled();
  });

  it("refuses a package whose quality gate did not pass", async () => {
    const { host, installed } = makeHost();
    render(<CharacterShaperBlenderPackage h={host} />);

    selectFiles([
      jsonFile("character-package.json", {
        ...VALID_MANIFEST,
        quality: { ...VALID_MANIFEST.quality, passed: false },
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("did not pass its quality gate");
    });
    expect(installed).toHaveLength(0);
  });

  it("asks for the runtime file when only the manifest was selected", async () => {
    const { host, installed } = makeHost();
    render(<CharacterShaperBlenderPackage h={host} />);

    selectFiles([jsonFile("character-package.json", VALID_MANIFEST)]);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("rin-a.vrm 파일을 함께 선택해 주세요");
    });
    expect(installed).toHaveLength(0);
  });

  it("refuses a runtime file whose byte length disagrees with the manifest", async () => {
    const { host, installed } = makeHost();
    render(<CharacterShaperBlenderPackage h={host} />);

    selectFiles([
      jsonFile("character-package.json", VALID_MANIFEST),
      new File(["not four bytes"], "rin-a.vrm"),
    ]);

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("크기가 패키지 기록과 다릅니다");
    });
    expect(installed).toHaveLength(0);
  });
});
