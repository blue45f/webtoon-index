import { describe, expect, it } from "vitest";

import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";

describe("creatorWorkSnapshotToStudioProject", () => {
  it("normalizes live work details and private revision snapshots through one project boundary", () => {
    const project = creatorWorkSnapshotToStudioProject({
      title: "1화",
      description: "첫 장면",
      tags: ["로맨스", "학원"],
      titleId: "title-1",
      seriesId: "series-1",
      challengeId: null,
      episodeNo: 4,
      remixFromId: null,
      format: "cuttoon",
      status: "draft",
      doc: {
        pagesList: [
          {
            id: "page-2",
            elements: [{ id: "text-1", type: "text", text: "안녕" }],
            bg: "#fff",
            bgGrad: null,
            canvasH: 2400,
          },
        ],
        currentPageId: "page-2",
        webtoonTheme: "vivid",
        panelGutter: 32,
        characterBible: { version: 1, characters: [] },
        referenceBoard: {
          version: 1,
          items: [{
            id: "pose-reference",
            asset: { sha256: `sha256:${"d".repeat(64)}` },
            view: {
              centerX: 0.5,
              centerY: 0.5,
              zoom: 1,
              rotationDeg: 0,
              flipX: false,
              flipY: false,
              opacity: 1,
              grayscale: false,
            },
          }],
        },
        publishPack: { profile: "naver-webtoon" },
      },
    });

    expect(project).toMatchObject({
      version: 2,
      title: "1화",
      description: "첫 장면",
      tagsText: "로맨스, 학원",
      currentPageId: "page-2",
      webtoonTheme: "vivid",
      panelGutter: 32,
      titleId: "title-1",
      seriesId: "series-1",
      challengeId: null,
      episodeNo: 4,
      remixFromId: null,
      format: "cuttoon",
      status: "draft",
      pagesList: [expect.objectContaining({ id: "page-2", canvasH: 2400 })],
      publishPack: { profile: "naver-webtoon" },
      referenceBoard: expect.objectContaining({
        version: 1,
        items: [expect.objectContaining({ id: "pose-reference" })],
      }),
    });
  });

  it("uses a deterministic legacy page for older single-canvas documents", () => {
    const project = creatorWorkSnapshotToStudioProject({
      title: "레거시",
      tags: "not-an-array",
      doc: {
        elements: [{ id: "image-1", type: "image" }],
        bg: "#112233",
        bgGrad: ["#000", "#fff"],
        height: 1800,
      },
    });

    expect(project.tagsText).toBe("");
    expect(project.pagesList).toEqual([
      expect.objectContaining({
        id: "legacy-page-1",
        bg: "#112233",
        bgGrad: ["#000", "#fff"],
        canvasH: 1800,
        elements: [expect.objectContaining({ id: "image-1" })],
      }),
    ]);
  });

  it("projects the registered motion-FX extension through a bounded canonical shape", () => {
    const project = creatorWorkSnapshotToStudioProject({
      title: "효과툰",
      doc: {
        pagesList: [{ id: "page-1", elements: [], bg: "#fff", bgGrad: null, canvasH: 1200 }],
        fx: {
          reveal: "fade-up",
          ambient: "snow",
          bgmMood: "calm",
          bgmUrl: "https://example.test/music.mp3",
          bgmVolume: 0.3,
          cuts: [{ reveal: "zoom-in", emphasis: "shake" }],
        },
      },
    });

    expect(project.fx).toEqual({
      reveal: "fade-up",
      ambient: "snow",
      bgmMood: "calm",
      bgmUrl: "https://example.test/music.mp3",
      bgmVolume: 0.3,
      cuts: [{ reveal: "zoom-in", emphasis: "shake" }],
    });
  });

  it("normalizes malformed page review lock payload into safe editable defaults", () => {
    const project = creatorWorkSnapshotToStudioProject({
      title: "검토 잠금 정합성",
      doc: {
        pagesList: [{
          id: "page-1",
          elements: [],
          bg: "#fff",
          bgGrad: null,
          canvasH: 1080,
          review: {
            status: "unknown",
            locked: "true",
            assignee: 123,
          },
        }],
      },
    });

    expect(project.pagesList[0].review).toMatchObject({
      status: "draft",
      locked: false,
    });
  });

  it("rejects non-object snapshots and invalid bounded project data", () => {
    expect(() => creatorWorkSnapshotToStudioProject(null)).toThrow("올바르지 않습니다");
    expect(() => creatorWorkSnapshotToStudioProject({ doc: "corrupt" })).toThrow("손상되었습니다");
    expect(() => creatorWorkSnapshotToStudioProject({ doc: { pagesList: [] } })).toThrow("페이지 목록");
    expect(() => creatorWorkSnapshotToStudioProject({ doc: { pagesList: "corrupt" } })).toThrow("페이지 목록");
    expect(() => creatorWorkSnapshotToStudioProject({ doc: { elements: "corrupt" } })).toThrow("레거시 요소");
    expect(() =>
      creatorWorkSnapshotToStudioProject({
        title: "손상",
        doc: {
          pagesList: [{ id: "page-1", elements: [], bg: "#fff", bgGrad: null, canvasH: -1 }],
        },
      })
    ).toThrow("올바르지 않은 ToonSpectrum 프로젝트 파일");
  });
});
