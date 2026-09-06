/**
 * 수채 웻 텍스처 프로그램의 커스텀 조합 계약.
 *
 * 레인 정적 테이블만 프로그램을 핀할 수 있던 동안 "일반 watercolor 위에 크로마토그래피" 같은
 * 조합은 id 가 없어 성립하지 못했다. 오버라이드 세트가 실리면 재질 행이 없는 베이스에서도
 * 프로그램이 실제로 적용되고, 오버라이드가 없으면 기존 레인/베이스 동작이 바이트 단위로
 * 유지된다는 것을 여기서 증명한다.
 */
import { describe, expect, it } from "vitest";

import {
  applyStudioBrushAliasWatercolorMaterial,
  type StudioBrushAliasWatercolorDab,
} from "./studio-brush-alias-profile";
import { studioBrushWatercolorProgramSetFrom } from "./studio-brush-engine-program-set";

function dabs(): StudioBrushAliasWatercolorDab[] {
  return [
    { x: 20, y: 20, radius: 8, opacity: 0.5, role: "core" },
    { x: 34, y: 22, radius: 12, opacity: 0.3, role: "diffuse" },
    { x: 48, y: 24, radius: 6, opacity: 0.4, role: "core" },
  ];
}

describe("applyStudioBrushAliasWatercolorMaterial · 커스텀 수채 프로그램", () => {
  it("프로그램도 재질 행도 없는 브러시는 입력 dabs 를 그대로 돌려준다", () => {
    const input = dabs();
    expect(applyStudioBrushAliasWatercolorMaterial("pen", input, 11, "settled")).toBe(input);
  });

  it("일반 watercolor 베이스는 오버라이드 없으면 기존 재질 스케일만 적용한다", () => {
    const plain = applyStudioBrushAliasWatercolorMaterial("watercolor", dabs(), 13);
    const again = applyStudioBrushAliasWatercolorMaterial("watercolor", dabs(), 13);
    // 결정적 재질 스케일 — 시드가 프로그램 없이는 소비되지 않는다.
    expect(again).toEqual(plain);
    expect(plain.map((dab) => dab.x)).toEqual(dabs().map((dab) => dab.x));
  });

  it("오버라이드 블룸 프로그램이 일반 watercolor 위에 실제로 적용된다", () => {
    const plain = applyStudioBrushAliasWatercolorMaterial("watercolor", dabs(), 13);
    const withBloom = applyStudioBrushAliasWatercolorMaterial(
      "watercolor",
      dabs(),
      13,
      "settled",
      studioBrushWatercolorProgramSetFrom({ wetEdgeBloomProgramId: "chroma-halo" }),
    );
    // 블룸 증강은 코어/확산 dab 외에 가장자리 bead dab을 추가한다.
    expect(withBloom.length).toBeGreaterThan(plain.length);
    expect(withBloom).not.toEqual(plain);
  });

  it("같은 시드라면 오버라이드 결과가 결정적이다", () => {
    const a = applyStudioBrushAliasWatercolorMaterial(
      "watercolor",
      dabs(),
      29,
      "settled",
      studioBrushWatercolorProgramSetFrom({ wetEdgeBloomProgramId: "fiber-feather" }),
    );
    const b = applyStudioBrushAliasWatercolorMaterial(
      "watercolor",
      dabs(),
      29,
      "settled",
      studioBrushWatercolorProgramSetFrom({ wetEdgeBloomProgramId: "fiber-feather" }),
    );
    expect(b).toEqual(a);
  });

  it("모르는 프로그램 id 는 실패 닫힘으로 베이스라인에 맡긴다", () => {
    const baseline = applyStudioBrushAliasWatercolorMaterial("watercolor", dabs(), 31);
    const unknown = applyStudioBrushAliasWatercolorMaterial(
      "watercolor",
      dabs(),
      31,
      "settled",
      studioBrushWatercolorProgramSetFrom({ wetEdgeBloomProgramId: "no-such-program" }),
    );
    expect(unknown).toEqual(baseline);
  });
});
