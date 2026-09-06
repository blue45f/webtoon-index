import { describe, expect, it, vi } from "vitest";

import {
  ensureStudioLinked3dPassCloudProject,
  hydrateStudioLinked3dPassCloudProject,
} from "./studio-linked-3d-pass-cloud-project";
import { parseStudioProjectFile } from "./studio-project-file";

function ordinaryProject() {
  return parseStudioProjectFile({
    version: 2,
    title: "ordinary",
    description: "",
    tagsText: "",
    pagesList: [{ id: "page-1", elements: [], bg: "#fff", bgGrad: null, canvasH: 1080 }],
    currentPageId: "page-1",
    webtoonTheme: "classic",
    panelGutter: 24,
  });
}

describe("Studio linked 3D cloud project boundary", () => {
  it("keeps an ordinary project off OPFS and applies its exact identity", async () => {
    const project = ordinaryProject();
    const apply = vi.fn((candidate) => candidate);

    await expect(ensureStudioLinked3dPassCloudProject({
      workId: "work-1",
      project,
    })).resolves.toEqual([]);
    await expect(hydrateStudioLinked3dPassCloudProject({
      workId: "work-1",
      project,
      apply,
    })).resolves.toBe(project);
    expect(apply).toHaveBeenCalledWith(project);
  });

  it("treats a stale no-artifact apply as a rejected hydration", async () => {
    const project = ordinaryProject();
    await expect(hydrateStudioLinked3dPassCloudProject({
      workId: "work-1",
      project,
      apply: () => false,
    })).rejects.toMatchObject({ name: "StudioLinked3dPassCloudProjectError" });
  });
});
