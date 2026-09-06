/**
 * Studio Volume — 통합 계약(integration spec)
 *
 * 이 파일은 볼륨 렌더러의 **경계**를 데이터로 못 박는다. 두 이웃 모듈이 대상이다:
 *
 *   · 상류(upstream) = 스모크/유체 시뮬레이터(studio-smoke-*) → 우리에게 그리드를 준다.
 *   · 하류(downstream) = 패스트레이서/래스터 배경(studio-pathtrace-*) → 우리 출력을 합성한다.
 *
 * 양쪽 모두 **서로의 타입을 import 하지 않는다**. 계약은 평범한 typed array 와 숫자뿐이라
 * 세 모듈이 독립적으로 진화할 수 있다. 버전이 올라가면 `STUDIO_VOLUME_CONTRACT_VERSION` 을
 * 올리고 어댑터에서 분기한다.
 *
 * ── 상류 계약(시뮬레이터 → 볼륨) ─────────────────────────────────────────
 *   필드      타입            단위/의미
 *   ────────────────────────────────────────────────────────────────────
 *   resolution  [nx,ny,nz]    복셀 개수(정수 ≥ 1)
 *   density     Float32Array  무차원. index = x + nx*(y + ny*z). 셀 **중심** 값.
 *   temperature Float32Array? 켈빈(K). 없으면 방출 항 없음.
 *   boundsMin/Max [x,y,z]     오브젝트 공간 AABB(균등 분할)
 *   objectToWorld number[16]  열 우선 4×4. 비균등 스케일/회전 허용.
 *
 *   시뮬레이터가 MAC 그리드(속도는 면, 스칼라는 셀 중심)를 쓰더라도 **스칼라 필드만** 넘기면
 *   되므로 추가 보간이 필요 없다. 시뮬 도메인 크기가 프레임마다 바뀌면 bounds/transform 만
 *   갱신하고 배열은 그대로 재사용해도 된다(렌더러는 배열을 소유하지 않는다 — 복사하지 않고 읽기만).
 *
 *   ⚠️ 소유권: `prepareStudioVolume` 은 density/temperature 배열을 **복사하지 않는다**. 시뮬레이터가
 *      다음 스텝에서 같은 버퍼를 덮어쓰면 렌더 중인 프레임이 찢어진다. 더블 버퍼링은 시뮬레이터
 *      책임이다(렌더 시작 시 `prepareStudioVolume` 이 읽은 배열 참조를 그대로 붙잡는다).
 *
 * ── 하류 계약(볼륨 → 합성) ───────────────────────────────────────────────
 *   studio-volume-composite.ts 의 STUDIO_VOLUME_COMPOSITE_SPEC 참고. 요약:
 *   프리멀티플라이드 선형 sRGB RGBA + 픽셀별 투과율 + 두 종류 깊이. 깊이는 z-test 가 아니라
 *   **적분 구간 클립**으로 처리한다(불투명 배경 거리를 `backgroundDistance` 로 넘긴다).
 */

import { STUDIO_VOLUME_COMPOSITE_SPEC } from "./studio-volume-composite";
import { prepareStudioVolume } from "./studio-volume-grid";

import type { StudioVolumeGrid, StudioVolumePrepared, StudioVolumeVec3 } from "./studio-volume-grid";

export const STUDIO_VOLUME_CONTRACT_VERSION = 1;

export interface StudioVolumeInputContract {
  readonly version: number;
  /** 복셀 인덱싱 규약(문자열로 박아 계약 회귀를 테스트로 잡는다). */
  readonly indexing: "x + nx * (y + ny * z)";
  /** 값이 놓이는 위치. */
  readonly samplePosition: "cell-center";
  readonly densityUnits: "dimensionless (sigma_t = densityScale * density)";
  readonly temperatureUnits: "kelvin";
  readonly matrixLayout: "column-major (m[col*4 + row])";
  readonly matrixDirection: "object-to-world";
  readonly copiesInput: false;
  readonly requiredFields: readonly string[];
  readonly optionalFields: readonly string[];
}

export const STUDIO_VOLUME_INPUT_CONTRACT: StudioVolumeInputContract = Object.freeze({
  version: STUDIO_VOLUME_CONTRACT_VERSION,
  indexing: "x + nx * (y + ny * z)",
  samplePosition: "cell-center",
  densityUnits: "dimensionless (sigma_t = densityScale * density)",
  temperatureUnits: "kelvin",
  matrixLayout: "column-major (m[col*4 + row])",
  matrixDirection: "object-to-world",
  copiesInput: false,
  requiredFields: Object.freeze(["resolution", "density", "boundsMin", "boundsMax"]),
  optionalFields: Object.freeze(["temperature", "objectToWorld"]),
});

export const STUDIO_VOLUME_OUTPUT_CONTRACT = STUDIO_VOLUME_COMPOSITE_SPEC;

/**
 * 시뮬레이터가 흔히 갖고 있는 형태(해상도 + 셀 크기 + 원점)에서 그리드를 만든다.
 * bounds 를 직접 계산할 필요가 없어지고, 셀 중심 규약 실수를 원천 차단한다.
 */
export function createStudioVolumeGridFromCells(input: {
  readonly resolution: StudioVolumeVec3;
  readonly cellSize: number | StudioVolumeVec3;
  readonly origin?: StudioVolumeVec3;
  readonly density: Float32Array;
  readonly temperature?: Float32Array | null;
  readonly objectToWorld?: ArrayLike<number> | null;
}): StudioVolumeGrid {
  const cell: StudioVolumeVec3 =
    typeof input.cellSize === "number"
      ? [input.cellSize, input.cellSize, input.cellSize]
      : input.cellSize;
  const origin = input.origin ?? [0, 0, 0];
  return {
    resolution: input.resolution,
    density: input.density,
    temperature: input.temperature ?? null,
    boundsMin: origin,
    boundsMax: [
      origin[0] + cell[0] * input.resolution[0],
      origin[1] + cell[1] * input.resolution[1],
      origin[2] + cell[2] * input.resolution[2],
    ],
    objectToWorld: input.objectToWorld ?? null,
  };
}

export interface StudioVolumeContractReport {
  readonly ok: boolean;
  readonly degenerate: boolean;
  readonly issues: readonly string[];
  readonly prepared: StudioVolumePrepared;
}

/**
 * 상류가 준 그리드를 계약에 맞춰 검사한다. 절대 throw 하지 않는다 — 시뮬레이터의 한 프레임이
 * 이상해도 렌더 파이프라인은 "빈 볼륨"으로 계속 굴러가야 한다.
 */
export function validateStudioVolumeInput(grid: StudioVolumeGrid): StudioVolumeContractReport {
  const prepared = prepareStudioVolume(grid);
  return {
    ok: !prepared.degenerate && prepared.issues.length === 0,
    degenerate: prepared.degenerate,
    issues: prepared.issues,
    prepared,
  };
}
