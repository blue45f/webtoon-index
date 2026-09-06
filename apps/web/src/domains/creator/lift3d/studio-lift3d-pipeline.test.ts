import { describe, expect, it } from "vitest";

import { hashStudioEditableMesh } from "../studio-editable-half-edge-mesh";

import { STUDIO_LIFT3D_LIMITS, STUDIO_LIFT3D_SUBJECTS } from "./studio-lift3d-contract";
import { STUDIO_LIFT3D_MAX_DEPTH_BANDS } from "./studio-lift3d-depth";
import { buildStudioLift3dGeometry } from "./studio-lift3d-mesh";
import {
  STUDIO_LIFT3D_PRESETS,
  liftStudioImageTo3d,
  liftStudioImageTo3dGlb,
} from "./studio-lift3d-pipeline";
import { STUDIO_LIFT3D_SYMMETRY_CONFIDENT_SCORE } from "./studio-lift3d-symmetry";
import {
  cliffBackgroundImage,
  discImage,
  encodeTestPng,
  flatImage,
  opaqueSquareImage,
  texturedBackgroundImage,
  verticalGradientImage,
} from "./studio-lift3d.test-fixture";

describe("Studio Lift 3D 파이프라인", () => {
  it("잔결이 고운 원화에 층을 잘게 잡으면 카드 사이 틈을 경고한다", () => {
    // 실측(해상도 128, 카드 경계 대비): 8층까지 0.1% 이하이다가 12층 15.7%, 24층 57.6% 로 튄다.
    // 층수가 원화의 깊이 잔결보다 잘게 잡힌 탓이고, 사용자가 층수로 고칠 수 있는 자리다.
    // 프리셋 기본 해상도(224)는 이 원화에서 6층부터 예산 초과로 실패하므로 함께 낮춰 잡는다.
    const image = texturedBackgroundImage(256);
    const resolution = 128;

    const dense = liftStudioImageTo3d(image, {
      subject: "background",
      resolution,
      layerBands: STUDIO_LIFT3D_MAX_DEPTH_BANDS,
    });
    expect(dense.ok).toBe(true);
    if (!dense.ok) return;
    expect(dense.warnings.map((warning) => warning.code)).toContain("layer-depth-gap");

    // 같은 원화라도 기본 층수에서는 틈이 없다. 경고가 원화가 아니라 **층수**를 짚어야 한다.
    const sparse = liftStudioImageTo3d(image, { subject: "background", resolution, layerBands: 6 });
    expect(sparse.ok).toBe(true);
    if (!sparse.ok) return;
    expect(sparse.warnings.map((warning) => warning.code)).not.toContain("layer-depth-gap");
  });

  it("화면을 가르는 균열은 해상도를 올려도 계속 경고한다", () => {
    // 균열 길이는 해상도에 비례해 늘지만 인접 사각형 쌍은 제곱으로 는다. 분모를 인접 쌍
    // 전부로 잡으면 같은 균열이 해상도 64 에서 0.78%, 160 에서 0.31% 로 **임계 아래로
    // 가라앉아** 지오메트리는 그대로인데 경고만 조용해진다. 카드 경계를 분모로 삼으면
    // 91.0% → 96.3% 로 눕는다.
    const image = cliffBackgroundImage(256);

    for (const resolution of [64, 160]) {
      const lifted = liftStudioImageTo3d(image, {
        subject: "background",
        resolution,
        layerBands: 6,
      });

      expect(lifted.ok).toBe(true);
      if (!lifted.ok) return;
      expect(lifted.warnings.map((warning) => warning.code)).toContain("layer-depth-gap");
    }
  });

  it("매끄러운 배경은 층을 끝까지 올려도 틈을 경고하지 않는다", () => {
    const lifted = liftStudioImageTo3d(verticalGradientImage(256), {
      subject: "background",
      layerBands: STUDIO_LIFT3D_MAX_DEPTH_BANDS,
    });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.warnings.map((warning) => warning.code)).not.toContain("layer-depth-gap");
  });

  it("모든 피사체 종류에 프리셋이 있다", () => {
    for (const subject of STUDIO_LIFT3D_SUBJECTS) {
      expect(STUDIO_LIFT3D_PRESETS[subject].label.length).toBeGreaterThan(0);
    }
  });

  it("캐릭터 프리셋이 컷아웃 PNG 를 닫힌 입체로 들어올린다", () => {
    const lifted = liftStudioImageTo3d(discImage(128), { subject: "character" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.metrics.closed).toBe(true);
    expect(lifted.value.metrics.boundaryEdgeCount).toBe(0);
    expect(lifted.value.metrics.triangleCount).toBeGreaterThan(500);
    expect(lifted.value.geometry.bounds.max.y).toBeCloseTo(1.7, 5);
    expect(lifted.value.mask.mode).toBe("alpha");
  });

  it("배경 프리셋은 이미지 전체를 부조 슬래브로 세운다", () => {
    const lifted = liftStudioImageTo3d(verticalGradientImage(96), { subject: "background" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.mask.mode).toBe("full");
    expect(lifted.value.mask.coverage).toBe(1);
    expect(lifted.value.geometry.mode).toBe("relief");
    expect(lifted.value.metrics.closed).toBe(true);
    expect(lifted.value.geometry.bounds.max.y).toBeCloseTo(6, 5);
  });

  it("소품 프리셋이 캐릭터보다 두껍게 부풀린다", () => {
    const character = liftStudioImageTo3d(discImage(96), { subject: "character" });
    const prop = liftStudioImageTo3d(discImage(96), { subject: "prop" });

    expect(character.ok && prop.ok).toBe(true);
    if (!character.ok || !prop.ok) return;
    const relativeDepth = (bounds: { min: { z: number }; max: { z: number; y: number } }) =>
      (bounds.max.z - bounds.min.z) / bounds.max.y;
    expect(relativeDepth(prop.value.geometry.bounds))
      .toBeGreaterThan(relativeDepth(character.value.geometry.bounds) * 1.5);
  });

  it("알파 없는 원화는 배경 키로 넘어가며 그 사실을 경고로 남긴다", () => {
    const lifted = liftStudioImageTo3d(opaqueSquareImage(96), { subject: "character" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.mask.mode).toBe("key");
    expect(lifted.warnings.map((warning) => warning.code)).toContain("alpha-absent");
  });

  it("피사체가 없으면 예외가 아니라 사유 코드로 거절한다", () => {
    const blank = {
      width: 64,
      height: 64,
      pixels: new Uint8ClampedArray(64 * 64 * 4),
    };
    const lifted = liftStudioImageTo3d(blank, { subject: "character" });

    expect(lifted.ok).toBe(false);
    if (lifted.ok) return;
    expect(lifted.code).toBe("empty-subject");
    expect(lifted.detail.length).toBeGreaterThan(0);
  });

  it("잘못된 원본을 앞단에서 걸러낸다", () => {
    const broken = { width: 32, height: 32, pixels: new Uint8ClampedArray(16) };
    const lifted = liftStudioImageTo3d(broken, { subject: "character" });

    expect(lifted.ok).toBe(false);
    if (lifted.ok) return;
    expect(lifted.code).toBe("invalid-source");
  });

  it("해상도를 예산 안으로 조이고 조정 사실을 알린다", () => {
    const lifted = liftStudioImageTo3d(discImage(96), {
      subject: "character",
      resolution: STUDIO_LIFT3D_LIMITS.maxResolution + 400,
    });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.warnings.map((warning) => warning.code)).toContain("resolution-clamped");
    expect(Math.max(lifted.value.metrics.gridWidth, lifted.value.metrics.gridHeight))
      .toBeLessThanOrEqual(STUDIO_LIFT3D_LIMITS.maxResolution);
  });

  it("같은 원화·같은 설정이면 같은 메시 해시가 나온다", () => {
    const first = liftStudioImageTo3d(discImage(96), { subject: "character" });
    const second = liftStudioImageTo3d(discImage(96), { subject: "character" });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.meshHash).toBe(second.value.meshHash);
  });

  it("설정을 바꾸면 결과 해시도 바뀐다", () => {
    const base = liftStudioImageTo3d(discImage(96), { subject: "character" });
    const deeper = liftStudioImageTo3d(discImage(96), { subject: "character", depthScale: 0.6 });

    expect(base.ok && deeper.ok).toBe(true);
    if (!base.ok || !deeper.ok) return;
    expect(base.value.meshHash).not.toBe(deeper.value.meshHash);
  });

  it("최대 해상도의 배경 리프트가 예외 없이 끝난다", () => {
    // 이미지 전체가 피사체인 배경은 격자 한 변에 대해 사각형이 가장 많이 나온다. 면 개수만
    // 보고 통과시키던 시절에는 편집 메시 preflight 가 코너 예산에서 예외를 던졌다.
    const lifted = liftStudioImageTo3d(verticalGradientImage(256), {
      subject: "background",
      resolution: STUDIO_LIFT3D_LIMITS.maxResolution,
    });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.metrics.closed).toBe(true);
    expect(lifted.warnings.map((warning) => warning.code)).not.toContain("resolution-clamped");
  });

  it("최대 해상도와 최대 레이어를 함께 골라도 만들어진다", () => {
    // 두 슬라이더를 각각 끝까지 올린 조합은 사용자가 가장 먼저 시도하는 값이다. 레이어가
    // 해상도 상한을 깎지 않던 시절에는 이 조합이 결정론적으로 budget-exceeded 로만 끝났다.
    const lifted = liftStudioImageTo3d(verticalGradientImage(256), {
      subject: "background",
      resolution: STUDIO_LIFT3D_LIMITS.maxResolution,
      layerBands: STUDIO_LIFT3D_MAX_DEPTH_BANDS,
    });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.geometry.mode).toBe("parallax");
    expect(lifted.value.metrics.layerCount).toBeGreaterThan(1);
    // 상한을 내린 사실은 조용히 넘기지 않는다 — 결과가 왜 덜 촘촘한지 알 수 있어야 한다.
    expect(lifted.warnings.map((warning) => warning.code)).toContain("resolution-clamped");
    expect(Math.max(lifted.value.metrics.gridWidth, lifted.value.metrics.gridHeight))
      .toBeLessThan(STUDIO_LIFT3D_LIMITS.maxResolution);
  });

  it("분수 레이어 수는 반올림하지 않고 거절한다", () => {
    // 1.5 를 2 로 올리면 프리셋 위상(relief) 대신 parallax 가 되는데, 비교가 이미 반올림된
    // 값으로 이뤄져 조정 경고조차 나가지 않는다. 층은 개수이므로 계약을 분명히 한다.
    for (const layerBands of [1.5, 2.5, 0.5]) {
      const lifted = liftStudioImageTo3d(discImage(96), { subject: "background", layerBands });

      expect(lifted.ok).toBe(false);
      if (lifted.ok) return;
      expect(lifted.code).toBe("invalid-option");
      expect(lifted.detail).toContain("정수");
    }
  });

  it("지원 범위를 넘는 레이어 수는 한 번만 조이고 그 사실을 알린다", () => {
    // 유한하지만 24 를 넘는 값을 그대로 쓰면 해상도 상한만 쓸데없이 깎이고, MAX_VALUE 근처에서는
    // 상한 공식이 NaN 이 되어 상한 자체가 무시된다 — 그러면 최대 해상도로 24층을 쌓게 된다.
    for (const layerBands of [1_000, Number.MAX_VALUE]) {
      const lifted = liftStudioImageTo3d(verticalGradientImage(256), {
        subject: "background",
        resolution: STUDIO_LIFT3D_LIMITS.maxResolution,
        layerBands,
      });

      expect(lifted.ok).toBe(true);
      if (!lifted.ok) return;
      expect(lifted.warnings.map((warning) => warning.code)).toContain("layer-bands-clamped");
      expect(lifted.value.metrics.layerCount).toBeLessThanOrEqual(STUDIO_LIFT3D_MAX_DEPTH_BANDS);
      expect(Math.max(lifted.value.metrics.gridWidth, lifted.value.metrics.gridHeight))
        .toBeLessThan(STUDIO_LIFT3D_LIMITS.maxResolution);
    }
  });

  it("명암이 고르면 시차 레이어가 카드 한 장으로 주저앉는다", () => {
    // 밴드는 깊이 구간으로 나눈다. 깊이가 어디서나 같으면 한 구간만 차고 나머지는 비어
    // 버려진다. 위상은 여전히 parallax 인데 층은 하나다 — 화면이 그 사실을 감추면 안 된다.
    const lifted = liftStudioImageTo3d(flatImage(96), {
      subject: "background",
      layerBands: 12,
    });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.geometry.mode).toBe("parallax");
    expect(lifted.value.metrics.layerCount).toBe(1);
  });

  it("가는 부위가 있어도 위상 오류 없이 닫힌 solid 로 보고한다", () => {
    // 얇은 팔·꼬리에서 비다양체가 나던 시절에는 boundaryEdgeCount 만 보고 "닫힌 solid" 라고
    // 표시했다. 지금은 위상 오류 수까지 함께 봐야 closed 가 참이 된다.
    const lifted = liftStudioImageTo3d(discImage(128), { subject: "character" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.metrics.topologyErrorCount).toBe(0);
    expect(lifted.value.metrics.closed).toBe(true);
  });

  it("UV 가 작업 격자 셀의 중심을 가리킨다", () => {
    const lifted = liftStudioImageTo3d(verticalGradientImage(128), {
      subject: "background",
      resolution: 32,
    });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    const { gridWidth } = lifted.value.metrics;
    const us = lifted.value.geometry.uvs.map((uv) => uv.u);
    // 셀 0 의 중심은 0.5/gw, 마지막 셀의 중심은 (gw-0.5)/gw. 예전처럼 x/(gw-1) 로 잡으면
    // 0 과 1 이 나오면서 텍스처가 gw/(gw-1) 배로 늘어난다.
    expect(Math.min(...us)).toBeCloseTo(0.5 / gridWidth, 6);
    expect(Math.max(...us)).toBeCloseTo((gridWidth - 0.5) / gridWidth, 6);
  });

  it("유한하지 않은 두께 값을 예외 대신 사유 코드로 거절한다", () => {
    const lifted = liftStudioImageTo3d(discImage(64), {
      subject: "character",
      depthScale: Number.NaN,
    });

    expect(lifted.ok).toBe(false);
    if (lifted.ok) return;
    expect(lifted.code).toBe("invalid-option");
  });

  it("캐릭터 프리셋은 좌우대칭 보정을 걸고 그 사실을 지표에 남긴다", () => {
    const lifted = liftStudioImageTo3d(discImage(96), { subject: "character" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.metrics.symmetryScore).toBeGreaterThan(0.9);
    expect(lifted.value.metrics.symmetryApplied).toBe(true);
  });

  it("좌우가 다른 실루엣에는 보정을 걸지 않고 이유를 알린다", () => {
    // 몸통 한쪽에만 그만한 덩어리가 붙은 형상 — 옆모습이나 비대칭 포즈가 그렇다. 어떤 축으로
    // 접어도 실루엣의 상당 부분이 짝을 찾지 못한다.
    const size = 96;
    const source = discImage(size, 0.22);
    const pixels = source.pixels;
    for (let y = Math.round(size * 0.34); y < Math.round(size * 0.66); y += 1) {
      for (let x = Math.round(size * 0.5); x < size - 6; x += 1) {
        const offset = (y * size + x) * 4;
        pixels[offset] = 220;
        pixels[offset + 1] = 90;
        pixels[offset + 2] = 60;
        pixels[offset + 3] = 255;
      }
    }

    const lifted = liftStudioImageTo3d(source, { subject: "character" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.metrics.symmetryScore)
      .toBeLessThan(STUDIO_LIFT3D_SYMMETRY_CONFIDENT_SCORE);
    expect(lifted.value.metrics.symmetryApplied).toBe(false);
    expect(lifted.warnings.map((warning) => warning.code)).toContain("symmetry-skipped");
  });

  it("소품 프리셋은 대칭 보정을 아예 시도하지 않는다", () => {
    const lifted = liftStudioImageTo3d(discImage(96), { subject: "prop" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.metrics.symmetryScore).toBeNull();
    expect(lifted.value.metrics.symmetryApplied).toBe(false);
  });

  it("레이어를 2 이상 주면 배경이 시차 카드로 나뉜다", () => {
    const flat = liftStudioImageTo3d(verticalGradientImage(96), { subject: "background" });
    const layered = liftStudioImageTo3d(verticalGradientImage(96), {
      subject: "background",
      layerBands: 5,
    });

    expect(flat.ok && layered.ok).toBe(true);
    if (!flat.ok || !layered.ok) return;
    expect(flat.value.geometry.mode).toBe("relief");
    expect(flat.value.metrics.layerCount).toBe(1);
    expect(layered.value.geometry.mode).toBe("parallax");
    expect(layered.value.metrics.layerCount).toBe(5);
    // 층으로 나뉘어도 유효한 solid 여야 한다.
    expect(layered.value.metrics.closed).toBe(true);
  });

  it("앞쪽 두께 비율이 결과 형상을 바꾼다", () => {
    const even = liftStudioImageTo3d(discImage(96), { subject: "character", frontRatio: 0.5 });
    const forward = liftStudioImageTo3d(discImage(96), { subject: "character", frontRatio: 0.8 });

    expect(even.ok && forward.ok).toBe(true);
    if (!even.ok || !forward.ok) return;
    expect(even.value.meshHash).not.toBe(forward.value.meshHash);
  });

  it("돌려주는 깊이장이 메시를 만든 바로 그것이다", () => {
    // 대칭 보정을 걸어 놓고 원본 깊이장을 돌려주면 깊이 미리보기와 실제 형상이 어긋난다.
    const lifted = liftStudioImageTo3d(discImage(96), { subject: "character" });

    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.value.metrics.symmetryApplied).toBe(true);

    const preset = STUDIO_LIFT3D_PRESETS.character;
    const rebuilt = buildStudioLift3dGeometry(lifted.value.mask, lifted.value.depth, {
      mode: preset.geometryMode,
      depthScale: preset.depthScale,
      baseScale: preset.baseScale,
      targetHeight: preset.targetHeight,
      frontRatio: preset.frontRatio,
      layerBands: 1,
    });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(hashStudioEditableMesh(rebuilt.value.mesh)).toBe(lifted.value.meshHash);
  });

  it("유한하지 않은 레이어 수를 예외 대신 사유 코드로 거절한다", () => {
    for (const layerBands of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      const lifted = liftStudioImageTo3d(verticalGradientImage(64), {
        subject: "background",
        layerBands,
      });
      expect(lifted.ok).toBe(false);
      if (lifted.ok) continue;
      expect(lifted.code).toBe("invalid-option");
    }
  });

  it("리프트와 GLB 인코딩을 한 번에 돌려준다", () => {
    const source = discImage(96);
    const exported = liftStudioImageTo3dGlb(
      source,
      { subject: "character" },
      { name: "주인공", texture: { mimeType: "image/png", bytes: encodeTestPng(source) } },
    );

    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.value.glb.fileName).toBe("주인공.glb");
    expect(exported.value.glb.metrics.textureByteLength).toBeGreaterThan(0);
    expect(exported.value.lift.metrics.closed).toBe(true);
    // 미리보기가 다시 계산하지 않도록 GLB 에 실린 버퍼가 함께 나온다.
    expect(exported.value.buffers).toBe(exported.value.glb.buffers);
    expect(exported.value.buffers.triangleCount).toBe(exported.value.glb.metrics.triangleCount);
    // GLB 매직 "glTF".
    expect(Array.from(exported.value.glb.bytes.slice(0, 4)))
      .toEqual([0x67, 0x6c, 0x54, 0x46]);
  });
});
