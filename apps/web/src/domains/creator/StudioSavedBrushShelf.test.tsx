import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { studioBrushDynamicsPresetSettings } from "./brush/studio-brush-dynamics";
import { StudioSavedBrushShelf } from "./StudioSavedBrushShelf";

import type { StudioSavedBrush } from "./brush/studio-brush-library";

function savedBrush(index: number): StudioSavedBrush {
  return {
    id: `brush-${index}`,
    name: `작업 펜 ${index}`,
    createdAt: index,
    updatedAt: index,
    pinned: index === 1 || index === 3,
    lastUsedAt: index * 10,
    brushId: "gpen",
    strokeWidth: 4 + index,
    brushOpacity: 0.8,
    color: "#ff6600",
    stabilizer: 4,
    stabilizerMode: "adaptive",
    postCorrection: 3,
    preserveCorners: true,
    pressureCurve: 1,
      pressureMinSize: 0,
    useVelocityPressure: true,
    velocitySensitivity: 0.5,
    tiltEnabled: true,
    tipAngle: -30,
    tipRoundness: 0.24,
    brushDynamics: studioBrushDynamicsPresetSettings("ink-particle"),
    stampTuning: null,
  enginePrograms: null,
  };
}

describe("StudioSavedBrushShelf", () => {
  it("고정·최근 브러시를 최대 8개, 44px 이상 터치 버튼으로 렌더한다", () => {
    const html = renderToStaticMarkup(
      <StudioSavedBrushShelf
        brushes={Array.from({ length: 10 }, (_, index) => savedBrush(index))}
        activeBrushId="brush-3"
        onApply={() => undefined}
        onManage={() => undefined}
      />
    );
    expect(html).toContain("고정·최근");
    expect(html).toContain("8/8");
    expect(html.match(/브러시 적용/g)).toHaveLength(8);
    expect(html.match(/min-h-14/g)).toHaveLength(8);
    expect(html).toContain("min-h-11");
    expect(html).toContain(
      'aria-label="작업 펜 3 브러시 적용, 7px, 80퍼센트"'
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("저장·관리");
  });

  it("활성 체크와 밝고 어두운 배경의 투명 색상 미리보기를 렌더한다", () => {
    const html = renderToStaticMarkup(
      <StudioSavedBrushShelf
        brushes={[savedBrush(3)]}
        activeBrushId="brush-3"
        onApply={() => undefined}
        onManage={() => undefined}
      />
    );
    expect(html).toContain("lucide-check");
    expect(html).toContain("bg-accent text-on-accent");
    expect(html).toContain(
      "bg-[linear-gradient(90deg,#f8fafc_0_50%,#242936_50%_100%)]"
    );
    expect(html).toContain("background-color:#ff6600");
    expect(html).toContain("opacity:0.8");
  });

  it("고정·최근 기록이 없어도 저장·관리 CTA가 있는 빈 선반을 유지한다", () => {
    const neverUsed = { ...savedBrush(0), pinned: false, lastUsedAt: null };
    const html = renderToStaticMarkup(
      <StudioSavedBrushShelf
        brushes={[neverUsed]}
        onApply={() => undefined}
        onManage={() => undefined}
      />
    );
    expect(html).toContain('aria-label="고정 및 최근 브러시"');
    expect(html).toContain("0/8");
    expect(html).toContain("저장·관리");
    expect(html).toContain("브러시를 저장하거나 고정하면 이 선반에서 바로 꺼내 쓸 수 있어요.");
    expect(html).toContain("min-h-14");
    expect(html).not.toContain("브러시 적용");
  });
});
