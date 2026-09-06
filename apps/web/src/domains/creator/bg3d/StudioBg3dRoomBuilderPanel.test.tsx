import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  getStudioBg3dRoomPreset,
  buildStudioBg3dRoomParts,
} from "./studio-bg3d-room-builder";
import { StudioBg3dRoomBuilderPanel } from "./StudioBg3dRoomBuilderPanel";

const cafeSpec = getStudioBg3dRoomPreset("cafe")!.spec;

function renderPanel(overrides: Partial<Parameters<typeof StudioBg3dRoomBuilderPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <StudioBg3dRoomBuilderPanel
      spec={cafeSpec}
      onSpecChange={vi.fn()}
      onApplyPreset={vi.fn()}
      onInsert={vi.fn()}
      {...overrides}
    />,
  );
}

describe("StudioBg3dRoomBuilderPanel", () => {
  it("프리셋 5종 칩과 치수 슬라이더·색상 컨트롤을 렌더한다", () => {
    const markup = renderPanel();
    for (const label of ["교실", "카페", "원룸", "복도", "옥상"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("가로 폭");
    expect(markup).toContain("세로 깊이");
    expect(markup).toContain("벽 높이");
    expect(markup).toContain("벽 두께");
    expect(markup).toContain("바닥색");
    expect(markup).toContain("벽색");
  });

  it("오프닝 목록이 스펙과 일치하고 삭제 버튼이 각 행에 있다", () => {
    const markup = renderPanel();
    expect(markup).toContain("문 · 창 오프닝");
    for (let index = 1; index <= cafeSpec.openings.length; index += 1) {
      expect(markup).toContain(`오프닝 ${index} 삭제`);
    }
    // 창 오프닝에만 창턱 입력이 붙는다.
    const sillCount = markup.split("창턱 높이").length - 1;
    expect(sillCount).toBe(cafeSpec.openings.filter((opening) => opening.type === "window").length);
  });

  it("추가 버튼 라벨이 실제 생성 파츠 수와 일치한다", () => {
    const markup = renderPanel();
    expect(markup).toContain(`방 추가 · 오브젝트 ${buildStudioBg3dRoomParts(cafeSpec).length}개`);
  });

  it("disabled면 컨트롤이 비활성화된다", () => {
    const markup = renderPanel({ disabled: true });
    expect(markup).toContain("disabled");
  });
});
