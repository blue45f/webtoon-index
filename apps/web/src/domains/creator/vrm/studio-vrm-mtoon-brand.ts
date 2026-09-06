/**
 * "이 재질이 MToon 인가" 판정 — 두 구현을 하나로 본다.
 *
 * MToon 은 같은 명세를 두 클래스로 구현한다. `MToonMaterial` 은 `WebGLRenderer` 만 컴파일할 수
 * 있는 `ShaderMaterial` 이고, `MToonNodeMaterial` 은 `WebGPURenderer` 만 빌드할 수 있는 TSL
 * 노드 포트다. 유니폼 이름(`shadeColorFactor`, `outlineColorFactor`, `parametricRimColorFactor`,
 * `rimLightingMixFactor` …)은 **완전히 같지만 브랜드 플래그가 다르다** —
 * `isMToonMaterial` 대 `isMToonNodeMaterial`.
 *
 * 그래서 브랜드 하나만 보는 가드는 WebGPU 로 로드된 캐릭터에서 조용히 아무 일도 하지 않는다.
 * 외곽선 색·셰이드·림 라이트가 안 먹는데 오류는 없는 상태가 되고, 그건 선화 추출 품질이 통째로
 * 달라진다는 뜻이다. 판정은 한 곳에서만 한다.
 *
 * @pixiv 패키지를 import 하지 않는다 — 재질은 구조적 타입으로만 받아 GPU 없이 테스트한다.
 */

export interface StudioVrmMtoonBrand {
  readonly isMToonMaterial?: boolean;
  readonly isMToonNodeMaterial?: boolean;
}

/** WebGL `MToonMaterial` 이든 WebGPU `MToonNodeMaterial` 이든 true. */
export function isStudioVrmMtoonMaterial(
  material: StudioVrmMtoonBrand | null | undefined,
): boolean {
  if (!material) return false;
  return material.isMToonMaterial === true || material.isMToonNodeMaterial === true;
}
