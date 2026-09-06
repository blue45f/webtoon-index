/**
 * Presentation only. Familiar old names stay search aliases; IDs, operations, pressure,
 * opacity, renderer routing and saved snapshots are deliberately not migrated.
 */
export interface StudioBrushDiscovery {
  readonly name: string;
  readonly hint: string;
  readonly aliases: readonly string[];
}

export const STUDIO_BRUSH_DISCOVERY: Readonly<Record<string, StudioBrushDiscovery>> = Object.freeze({
  pen: { name: "매끈한 펜", hint: "굵기가 일정한 선 · 도형과 깔끔한 필기", aliases: ["기본 펜", "균일 선", "round pen", "fineliner"] },
  gpen: { name: "G펜(필압)", hint: "누르는 힘에 따라 굵기 변화 · 웹툰 선화", aliases: ["지펜", "선화", "g pen", "g-pen", "inking"] },
  "fountain-pen": { name: "캘리그래피 펜", hint: "사선 펜촉의 굵고 가는 획 · 손글씨", aliases: ["만년필", "사선 촉", "calligraphy"] },
  pencil: { name: "연필", hint: "가늘고 옅은 흑연 선 · 밑그림과 러프", aliases: ["흑연", "밑그림", "graphite", "sketch"] },
  "pencil--side-shade": { name: "옆면 연필", hint: "눕힌 연필의 넓은 면 · 명암과 면 채우기", aliases: ["측면 연필", "셰이딩", "side shade"] },
  "charcoal--compressed-edge": { name: "단단한 목탄", hint: "각진 가장자리와 거친 가루 · 강한 명암", aliases: ["압축 목탄", "charcoal", "compressed"] },
  watercolor: { name: "수채 번짐", hint: "투명한 물감과 부드러운 번짐 · 워시 채색", aliases: ["수채화", "watercolor", "wash"] },
  marker: { name: "반투명 마커", hint: "넓고 균일한 반투명 획 · 빠른 색 덩어리", aliases: ["마커", "넓은 채색", "marker"] },
  "gouache--matte-body": { name: "불투명 과슈", hint: "매트하게 덮이는 물감 · 평면 채색", aliases: ["과슈", "불투명 수채", "gouache", "matte"] },
  "oil--filbert-ribbon": { name: "둥근 유화 붓", hint: "둥근 모서리와 붓결 · 두툼한 물감 표현", aliases: ["유화", "필버트", "oil", "filbert"] },
  airbrush: { name: "소프트 에어브러시", hint: "경계가 부드러운 분사 · 음영과 빛", aliases: ["부드러운 분사", "airbrush", "soft"] },
  spray: { name: "미세 스프레이", hint: "작은 입자를 고르게 분사 · 가벼운 질감", aliases: ["스프레이", "분무", "spray"] },
  splatter: { name: "물감 튀김", hint: "크고 작은 물방울 · 불규칙한 흩뿌리기", aliases: ["스플래터", "흩뿌리기", "splatter"] },
  "standard-eraser": { name: "일반 지우개", hint: "명확한 경계로 지우기 · 선과 형태 정리", aliases: ["단단한 지우개", "hard eraser"] },
  "kneaded-eraser": { name: "연한 떡지우개", hint: "여러 번 문질러 옅게 지우기 · 농도 조절", aliases: ["떡지우개", "저농도", "kneaded eraser"] },
  screentone: { name: "망점 브러시", hint: "간격이 일정한 점 무늬 · 만화 명암", aliases: ["스크린톤", "도트", "screentone", "halftone"] },
  "web-cross-hatch-pen": { name: "교차 해칭 펜", hint: "교차하는 선으로 음영 · 펜화 질감", aliases: ["교차 해칭", "크로스 해치", "cross hatch", "hatching"] },
  "web-radial-burst": { name: "방사형 집중선", hint: "중심에서 퍼지는 선 · 속도와 강조", aliases: ["방사 버스트", "스피드라인", "radial burst"] },
  "inkwash-pen": { name: "유체 잉크 펜", hint: "젖은 잉크의 흐름과 번짐 · 수묵 선화", aliases: ["잉크워시", "딥펜", "fluid ink"] },
  "inkwash-water-brush": { name: "물 번짐 붓", hint: "물을 머금은 번짐 · 잉크워시 채색", aliases: ["잉크워시", "생동하는 물", "water brush"] },
});
