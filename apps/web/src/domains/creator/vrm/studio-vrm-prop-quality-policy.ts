/**
 * New-selection policy only. Existing documents retain their exact prop ID, color and transform.
 * Decisions are based on the rendered silhouette, not file size, triangle count or a 'Blender' name.
 * The rendering/serialization catalogue deliberately retains these definitions for compatibility.
 */
export const STUDIO_VRM_PROP_VISUAL_QUARANTINE: Readonly<Record<string, string>> = Object.freeze({
  crown: "원통과 원뿔 조합으로 왕관 가장자리·밴드 구조가 표현되지 않음",
  surgicalCap: "봉제선·테두리 없이 반구로만 표현된 수술모",
  faceMask: "얼굴 곡면과 주름이 없는 두꺼운 평판형 마스크",
  flowerCrown: "꽃잎 대신 구형 조각이 띠와 떨어져 떠 있음",
  catEars: "귓바퀴 없이 단순 원뿔로 표현됨",
  elfEars: "귓바퀴와 머리 연결면이 없는 원뿔 조각",
  horns: "곡률·기부 없이 각진 원뿔로만 표현됨",
  eyepatch: "눈 주위 곡면 없이 막대와 상자로 표현됨",
  earmuffs: "쿠션·이어컵 없이 구와 굵은 관으로 표현됨",
  hairpin: "핀 구조 없이 구와 막대만 조합됨",
  goggles: "렌즈 하우징과 얼굴 접촉 구조가 없는 다각형 링",
  shoulderbag: "어깨 접촉점과 스트랩 방향이 몸 안으로 묻혀 착용 품질 재검수가 필요함",
  cape: "어깨 재단과 드레이프가 없는 직사각형 평판",
  wings: "깃털·날개 윤곽 없이 구형 조각 두 개로 표현됨",
  scarf: "천의 접힘 없이 굵은 링과 직사각형 막대로 표현됨",
  holster: "착용 스트랩과 수납 구조 없이 상자와 막대로 표현됨",
  belt: "납작한 벨트 대신 굵은 관으로 표현됨",
  backwing: "관절·날개 구조 없이 구형 조각 두 개로 표현됨",
  gloves: "손가락·손바닥 형태 없이 단일 구로 표현됨",
  guitar: "기타 곡면·현·넥 구조 없이 상자와 막대로 표현됨",
  quiver: "입구·가죽 구조 없이 각진 원통과 막대로 표현됨",
  apron: "체형 재단·목끈 연결 없이 평판과 막대로 표현됨",
  tail: "연속된 곡선 없이 원통과 구가 떨어져 있음",
  sword: "날의 단면과 손잡이 디테일이 없는 초기 막대형 검",
  staff: "지팡이의 조형 없이 막대와 구만 조합됨",
  fan: "부챗살과 접힘 없이 반원 평판으로 표현됨",
  bouquet: "꽃잎 대신 구형 조각과 원뿔 포장으로 표현됨",
  umbrella: "우산살·곡면 없이 단순 원뿔형 천으로 표현됨",
  flute: "키·관 구조가 없는 초기 막대형 악기",
  wand: "조형 디테일이 없는 막대·구·원뿔 조합",
  laptop: "키보드·힌지·입력 면이 없는 초기 평판형 노트북",
  shield: "방패 면과 장식 링의 방향·윤곽이 맞지 않음",
  torch: "불꽃 대신 단일 원뿔로 표현됨",
  plate: "접시 면과 테두리 링이 서로 수직으로 배치됨",
  gun: "소품 윤곽을 상자와 원통으로만 표현한 초기 프록시",
});

export function isStudioVrmPropSelectable(id: string): boolean {
  return !Object.prototype.hasOwnProperty.call(STUDIO_VRM_PROP_VISUAL_QUARANTINE, id);
}

export function studioVrmPropQualityNotice(id: string): string | null {
  return STUDIO_VRM_PROP_VISUAL_QUARANTINE[id] ?? null;
}
