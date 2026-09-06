export const RECIPES = [
  { id: "scroll", title: "스크롤 여백으로 긴장 만들기", tag: "컷 연출", minutes: 15, control: "컷 사이 여백", min: 16, max: 160, initial: 48,
    intro: "같은 세 컷에서도 사이 공간이 바뀌면 다음 정보를 만나는 속도가 달라집니다. 중요한 반응 직전에 긴 여백을 주는 실험입니다.",
    steps: ["문 앞에 선 인물, 문을 여는 손, 놀란 얼굴의 세 장면을 간단히 배치합니다.", "여백을 작게 두고 빠르게 스크롤하며 정보가 얼마나 빨리 읽히는지 확인합니다.", "반응 컷 앞의 여백을 늘려 다시 읽어봅니다. 모든 여백을 늘리기보다 한 번의 멈춤을 선택합니다.", "휴대폰 크기로 확인한 뒤 여백이 단순한 빈 화면처럼 느껴지지 않는 지점을 기록합니다."],
    tip: "여백의 정답 크기는 없습니다. 중요한 것은 독자가 기다리는 동안 무엇을 예상하게 되는가입니다." },
  { id: "dialogue", title: "대사 많은 컷을 가볍게 읽히게", tag: "말풍선", minutes: 20, control: "말풍선 한 줄의 글자 수", min: 6, max: 20, initial: 10,
    intro: "대사의 의미 단위를 먼저 나누고 말풍선 폭을 조정해 보세요. 폭만 줄여 억지로 줄바꿈하면 세로 길이가 과해집니다.",
    steps: ["설명, 감정, 행동이 섞인 대사에서 독자가 꼭 알아야 하는 한 문장을 고릅니다.", "대사를 의미 단위로 나누고 한 줄 길이 슬라이더로 읽는 리듬을 비교합니다.", "말풍선을 얼굴·손·중요 소품과 겹치지 않게 배치합니다.", "낭독하면서 숨을 쉬는 위치와 줄바꿈 위치가 어울리는지 점검합니다."],
    tip: "모든 설명을 대사로 전달할 필요는 없습니다. 이미 그림이 보여주는 정보를 덜어보세요." },
  { id: "camera", title: "한 인물을 세 가지 거리에서 보기", tag: "구도", minutes: 20, control: "인물 확대 비율", min: 50, max: 180, initial: 100,
    intro: "멀리서는 장소와 관계를, 가까이서는 표정과 반응을 읽습니다. 단순 인물 도형의 화면 점유율을 바꾸며 정보의 차이를 비교하세요.",
    steps: ["장소를 설명하는 넓은 컷을 한 장 만듭니다.", "같은 장면에서 인물 크기를 키워 배경 정보가 어떻게 줄어드는지 확인합니다.", "감정이 달라지는 순간에만 가까운 컷을 사용해 봅니다.", "독자가 인물의 위치를 놓치지 않는지 세 컷을 이어서 읽어봅니다."],
    tip: "확대가 항상 강한 감정을 뜻하지는 않습니다. 앞선 컷과의 대비가 중요합니다." },
  { id: "values", title: "명암으로 주인공을 먼저 보이게", tag: "채색", minutes: 15, control: "배경의 밝기", min: 15, max: 95, initial: 80,
    intro: "색을 잠시 지우고 밝기만으로 실루엣을 비교합니다. 인물과 배경의 밝기가 가까워질수록 경계가 흐려지는 것을 확인하세요.",
    steps: ["인물, 전경, 배경을 세 덩어리의 명암으로 나눕니다.", "배경 밝기를 움직여 인물이 가장 빨리 보이는 조합을 찾습니다.", "중요한 얼굴 주변의 복잡한 무늬나 대비를 덜어봅니다.", "화면을 작게 축소해도 이야기의 중심이 식별되는지 확인합니다."],
    tip: "전부 강하게 대비시키면 시선이 분산됩니다. 강조할 곳과 쉬어갈 곳을 함께 정하세요." },
  { id: "motion", title: "효과선으로 움직임의 방향 정하기", tag: "효과", minutes: 15, control: "효과선의 수", min: 3, max: 18, initial: 7,
    intro: "효과선의 수와 방향이 동작을 돕는지 비교하세요. 선을 많이 넣는 것보다 독자가 운동 방향을 바로 이해하는 것이 중요합니다.",
    steps: ["팔을 뻗는 동작처럼 방향이 분명한 실루엣을 그립니다.", "움직임의 반대쪽에 적은 수의 효과선을 배치합니다.", "선의 수를 늘려 동작이 또렷해지는 구간과 가려지는 구간을 비교합니다.", "얼굴과 손끝 주변의 선을 덜어 중요한 형태가 읽히는지 확인합니다."],
    tip: "효과선은 동작의 부족한 실루엣을 대신하기보다 이미 있는 동작을 보조하도록 사용하세요." },
  { id: "beats", title: "첫 화의 마지막 반응 컷 설계", tag: "스토리", minutes: 25, control: "반응 컷의 높이", min: 60, max: 240, initial: 120,
    intro: "정보 제시, 선택, 결과의 순서로 짧은 장면을 구성합니다. 마지막 컷의 비중을 바꾸며 다음 장면을 궁금하게 하는 질문을 남겨보세요.",
    steps: ["주인공이 지금 원하는 것을 한 컷으로 제시합니다.", "원하는 것을 얻기 위해 선택하게 하고 작은 대가를 보여줍니다.", "마지막 컷의 높이를 바꾸어 반응에 머무는 시간을 비교합니다.", "단순히 정보를 감추기보다 다음 선택을 궁금하게 하는 문장을 기획서에 적습니다."],
    tip: "독자가 이미 이해한 정보를 다시 설명하는 대신, 인물이 무엇을 선택할지 기대하게 해보세요." },
] as const;
export type Recipe = typeof RECIPES[number];
export function recipeById(id: string | null): Recipe { return RECIPES.find((recipe) => recipe.id === id) ?? RECIPES[0]; }
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function exerciseSvg(recipe: Recipe, amount: number): string {
  const value = Number.isFinite(amount) ? Math.max(recipe.min, Math.min(recipe.max, Math.round(amount))) : recipe.initial;
  const gap = recipe.id === "scroll" ? value : 48;
  const heights = [260, 260, recipe.id === "beats" ? value + 160 : 260];
  let y = 130;
  const panels = heights.map((height, index) => {
    const block = `<g id="panel-${index + 1}"><rect x="40" y="${y}" width="720" height="${height}" fill="white" stroke="#333" stroke-width="3"/><text x="64" y="${y + 36}" font-size="20">${index + 1}. ${["정보 제시", "행동과 선택", "반응과 다음 질문"][index]}</text></g>`;
    y += height + gap; return block;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${y + 70}" viewBox="0 0 800 ${y + 70}"><title>${xml(recipe.title)} 실습 시트</title><rect width="800" height="${y + 70}" fill="#f5f5f5"/><text x="40" y="52" font-size="27" font-family="sans-serif">${xml(recipe.title)}</text><text x="40" y="92" font-size="18">${xml(recipe.control)}: ${value} · 직접 그리는 원본 실습용 프레임</text>${panels}<text x="40" y="${y + 32}" font-size="16">ToonStudio 자체 제작 실습 시트 · 외부 작품·에셋 미포함</text></svg>`;
}
