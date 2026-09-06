/**
 * Studio 기능별 튜토리얼 카탈로그와 순수 진행 상태 모델.
 * 제품 진행도 권위는 SQLite/OPFS이며 아래 Storage 함수는 명시적 레거시 테스트 seam이다.
 * UI(StudioFeatureTutorialHub)와 StudioPage 액션 배선이 같은 id 를 공유한다.
 */

export type StudioTutorialCategory =
  | "drawing"
  | "adjustments"
  | "dialogue"
  | "composition"
  | "threed"
  | "aiExport";

/** 튜토리얼 한 단계 — 짧고 행동 가능한 문장. */
export type StudioTutorialStep = {
  title: string;
  body: string;
  /** 선택: 한 줄 팁(심리적으로 부담 줄이는 안심 문구). */
  tip?: string;
};

/**
 * tryAction — 허브의 "따라 해보기"가 StudioPage 에서 실행할 액션 키.
 * 새 액션 추가 시 StudioPage 의 handleTutorialTry 분기에도 같은 키를 추가한다.
 */
export type StudioTutorialTryAction =
  | "pen"
  | "wet-mix"
  | "dodge-burn"
  | "quick-mask"
  | "mannequin"
  | "frame-anim"
  | "smart-shape"
  | "bubble"
  | "brush"
  | "template"
  | "layers"
  | "character"
  | "character-shaper"
  | "bg3d"
  | "ai-assist"
  | "dialogue"
  | "export";

export type StudioFeatureTutorial = {
  id: string;
  category: StudioTutorialCategory;
  title: string;
  /** 카드 한 줄 요약. */
  summary: string;
  /** 목록 이모지 대신 쓸 짧은 배지 글자(1~2자). */
  badge: string;
  steps: StudioTutorialStep[];
  tryAction?: StudioTutorialTryAction;
  tryLabel?: string;
};

export const STUDIO_TUTORIAL_CATEGORY_ORDER: StudioTutorialCategory[] = [
  "drawing",
  "adjustments",
  "dialogue",
  "composition",
  "threed",
  "aiExport",
];

export const STUDIO_FEATURE_TUTORIALS: StudioFeatureTutorial[] = [
  {
    id: "pen",
    category: "drawing",
    title: "펜으로 스케치",
    summary: "빈 캔버스에 바로 선을 긋고 크기·불투명도를 조절해요.",
    badge: "펜",
    tryAction: "pen",
    tryLabel: "펜 켜기",
    steps: [
      {
        title: "펜 도구 선택",
        body: "하단 도구막대에서 펜을 누르거나 B 키를 눌러요. 그리기 준비가 끝납니다.",
        tip: "지우개는 E 로 바로 전환할 수 있어요.",
      },
      {
        title: "크기와 농도",
        body: "그리기 옵션에서 브러시 크기와 불투명도를 맞춰요. [ ] 키로 크기를 빠르게 바꿀 수 있어요.",
      },
      {
        title: "자연스럽게 긋기",
        body: "선을 그은 뒤 손을 떼면 한 획이 저장됩니다. ⌘Z 로 언제든 되돌릴 수 있어요.",
        tip: "떨림이 거슬리면 안정화 옵션을 살짝 올려 보세요.",
      },
    ],
  },
  {
    id: "eraser",
    category: "drawing",
    title: "지우개로 지우기",
    summary: "브러시 크기를 보면서 필요한 부분만 지우고, 한 획씩 되돌려요.",
    badge: "지움",
    steps: [
      {
        title: "지우개 선택",
        body: "왼쪽 도구막대에서 지우개를 누르거나 E 키를 누르세요. 캔버스 커서가 현재 지우개 크기로 바뀝니다.",
        tip: "다시 그리려면 B 키로 펜에 바로 돌아갈 수 있어요.",
      },
      {
        title: "크기 맞추기",
        body: "[ · ] 키나 그리기 옵션으로 크기를 맞춘 뒤, 지울 선보다 조금 크게 커서를 놓으세요.",
      },
      {
        title: "짧게 지우고 확인",
        body: "짧은 획으로 나눠 지우면 실수를 줄일 수 있어요. 손을 뗀 한 획마다 ⌘Z로 되돌릴 수 있습니다.",
      },
    ],
  },
  {
    id: "fill",
    category: "drawing",
    title: "닫힌 영역 색 채우기",
    summary: "페인트 버킷으로 선 안쪽을 찾고, 틈과 허용치를 조절해 한 번에 채워요.",
    badge: "채움",
    steps: [
      {
        title: "채우기 선택",
        body: "왼쪽 도구막대에서 채우기를 누르거나 G 키를 누르세요. 직접 그린 벡터 선·도형만 있어도 원본은 숨겨 보존하고 편집용 이미지 복사본을 자동으로 준비합니다.",
      },
      {
        title: "영역 안쪽 누르기",
        body: "채울 색을 고르고 닫힌 선 안쪽을 누르세요. 새는 곳은 틈 닫기, 비슷한 색 범위는 허용치로 조절합니다.",
      },
      {
        title: "선택 영역과 결과 확인",
        body: "픽셀 선택이 있으면 그 안에서만 채워집니다. 원하는 결과가 아니면 ⌘Z로 되돌리고 값을 조금씩 바꿔 보세요.",
      },
    ],
  },
  {
    id: "smart-shape",
    category: "drawing",
    title: "스마트 도형",
    summary: "선·네모·원·삼각을 대충 그려도 손을 떼면 단정한 도형으로 다듬어요.",
    badge: "도형",
    tryAction: "smart-shape",
    tryLabel: "스마트 도형 켜기",
    steps: [
      {
        title: "펜 모드에서 켜기",
        body: "펜이 선택된 상태에서 그리기 옵션의 스마트 도형을 ON 으로 바꿔요.",
        tip: "끄적여도 괜찮아요 — 완벽할 필요 없습니다.",
      },
      {
        title: "도형처럼 그리기",
        body: "선·네모·원·삼각·다각형을 한 획으로 그려 보세요. 끝에서 잠깐 멈추면 미리보기가 뜹니다.",
      },
      {
        title: "손을 떼면 확정",
        body: "손을 떼는 순간 깔끔한 도형으로 스냅됩니다. 마음에 안 들면 ⌘Z 로 되돌리면 돼요.",
        tip: "원은 끝까지 살짝 이어 주고, 삼각형은 꼭짓점을 또렷하게 꺾어 주면 인식이 잘 됩니다.",
      },
    ],
  },
  {
    id: "brush",
    category: "drawing",
    title: "브러시 키트",
    summary: "연필·마커·붓·형광펜 등 용도별 브러시로 분위기를 바꿔요.",
    badge: "붓",
    tryAction: "brush",
    tryLabel: "브러시 열기",
    steps: [
      {
        title: "브러시 트레이",
        body: "그리기 옵션에서 브러시 목록을 열고 원하는 질감을 골라요.",
      },
      {
        title: "슬롯에 저장",
        body: "자주 쓰는 브러시는 ⇧1–6 으로 슬롯에 저장하고, 1–6 으로 바로 불러올 수 있어요.",
      },
      {
        title: "색과 함께",
        body: "주 색을 고른 뒤 그어 보세요. X 키로 주 색과 보조 색을 바꿀 수 있습니다.",
      },
    ],
  },
  {
    id: "smudge",
    category: "adjustments",
    title: "색 밀어 섞기 (스머지)",
    summary: "새 색을 칠하지 않고, 이미 칠한 색을 드래그 방향으로 밀어 경계를 부드럽게 섞어요.",
    badge: "밀",
    steps: [
      {
        title: "대상 준비",
        body: "이미지를 고르거나 왼쪽 도구막대에서 색 밀어 섞기를 누르세요. 직접 그린 벡터 선·도형만 있어도 원본은 숨겨 보존하고 편집용 이미지 복사본을 자동으로 준비합니다.",
        tip: "복사본 준비가 끝나면 같은 도구가 자동으로 켜집니다.",
      },
      {
        title: "색 경계를 따라 밀기",
        body: "브러시 크기와 밀기 강도를 맞춘 뒤 섞고 싶은 방향으로 드래그하세요. 새 색은 추가되지 않습니다.",
      },
      {
        title: "손을 떼고 확인",
        body: "손을 떼면 한 획이 이미지에 반영됩니다. 결과가 과하면 ⌘Z로 그 획만 되돌릴 수 있어요.",
      },
    ],
  },
  {
    id: "wet-mix",
    category: "drawing",
    title: "물감 섞어 칠하기 (혼색)",
    summary: "현재 색을 새로 칠하면서 바닥색을 붓에 묻혀 함께 섞는 물감 느낌 브러시예요.",
    badge: "혼",
    tryAction: "wet-mix",
    tryLabel: "섞어 칠하기 시작",
    steps: [
      {
        title: "대상 준비",
        body: "이미지를 고르거나 왼쪽 도구막대에서 물감 섞어 칠하기를 누르세요. 직접 그린 벡터 선·도형만 있어도 원본은 숨겨 보존하고 편집용 이미지 복사본을 자동으로 준비합니다.",
        tip: "복사본 준비가 끝나면 혼색 브러시가 자동으로 켜집니다.",
      },
      {
        title: "섞임 맞추기",
        body: "현재 색을 고르고 칠하는 양·바닥색 섞기·색 줍기를 조절한 뒤 바닥색 위를 드래그하세요.",
      },
      {
        title: "손을 떼고 확인",
        body: "손을 떼면 한 획이 이미지에 반영됩니다. 한 획마다 ⌘Z로 되돌릴 수 있어요.",
      },
    ],
  },
  {
    id: "dual-brush",
    category: "drawing",
    title: "듀얼 브러시",
    summary: "두 브러시 팁을 겹쳐 종이·수채 같은 복합 질감을 만들어요.",
    badge: "듀",
    tryAction: "brush",
    tryLabel: "브러시 열기",
    steps: [
      {
        title: "브러시 스튜디오 열기",
        body: "그리기 옵션의 브러시 목록에서 브러시 스튜디오로 들어가요.",
      },
      {
        title: "듀얼 브러시 켜기",
        body: "듀얼 브러시 사용을 켜고 2차 팁과 합성 모드를 골라요. 2차 팁이 1차 팁의 질감을 변조합니다.",
      },
      {
        title: "미리보고 저장",
        body: "미리보기 획을 보며 크기·간격을 다듬고, 마음에 들면 프리셋으로 저장해 두세요.",
        tip: "합성 모드만 바꿔도 분위기가 크게 달라져요.",
      },
    ],
  },
  {
    id: "sketch-shape",
    category: "drawing",
    title: "스케치 도형",
    summary: "도형을 손으로 그린 듯 흔들리는 선(rough.js)으로 바꿔요.",
    badge: "낙",
    steps: [
      {
        title: "도형 선택",
        body: "사각형·타원 같은 도형을 캔버스에 그린 뒤 선택 도구로 골라요.",
      },
      {
        title: "손그림 스케치 켜기",
        body: "속성 패널의 선·도형 스타일에서 손그림 스케치를 켜요.",
      },
      {
        title: "거칠기 조절",
        body: "거칠기·휘어짐과 채우기 질감(해칭 등)을 조절해 콘티나 낙서 느낌을 맞춰요.",
        tip: "콘티 단계에서 켜 두면 그림이 완성처럼 안 보여 부담이 줄어요.",
      },
    ],
  },
  {
    id: "special-rulers",
    category: "drawing",
    title: "특수 자 3종",
    summary: "평행선·동심원·방사선 자에 선을 스냅해 배경 선을 편하게 그어요.",
    badge: "자",
    tryAction: "pen",
    tryLabel: "펜 켜기",
    steps: [
      {
        title: "자 추가",
        body: "펜 모드에서 아무것도 선택하지 않으면 보이는 그리기 도구 설정에서 평행선·동심원·방사선 자를 추가해요.",
      },
      {
        title: "기준 맞추기",
        body: "각도·중심점을 장면에 맞게 옮겨요. 자는 여러 개 표시할 수 있고 스냅은 하나만 적용됩니다.",
      },
      {
        title: "스냅해서 긋기",
        body: "활성 자를 켠 채 선을 그으면 가이드를 따라 스냅돼요. 빗줄기·스피드선·집중선에 좋아요.",
      },
    ],
  },
  {
    id: "dodge-burn",
    category: "adjustments",
    title: "밝기·채도 붓 (닷지·번)",
    summary: "브러시가 지나간 자리만 밝게·어둡게 하거나 색의 선명함을 조절해요.",
    badge: "빛",
    tryAction: "dodge-burn",
    tryLabel: "밝기·채도 보정 시작",
    steps: [
      {
        title: "대상 준비",
        body: "이미지를 고르거나 도구막대에서 밝기·채도 붓을 누르세요. 직접 그린 벡터 선·도형만 있어도 원본은 숨겨 보존하고 편집용 이미지 복사본을 자동으로 준비합니다.",
      },
      {
        title: "원하는 결과 고르기",
        body: "밝게(닷지), 어둡게(번), 채도(스펀지) 중 하나를 고르고 보정할 밝기 영역과 효과 강도를 맞춰요.",
      },
      {
        title: "약하게 여러 번",
        body: "노출을 낮게 두고 여러 번 문지르는 편이 자연스러워요. 결과가 과하면 한 획씩 ⌘Z로 되돌릴 수 있어요.",
        tip: "볼 터치·역광 림라이트처럼 좁은 영역부터 시도해 보세요.",
      },
    ],
  },
  {
    id: "liquify",
    category: "adjustments",
    title: "형태 밀어 변형 (리퀴파이)",
    summary: "브러시로 이미지 모양을 밀거나 비틀고, 오므리거나 부풀려 윤곽을 다듬어요.",
    badge: "변",
    steps: [
      {
        title: "대상 준비",
        body: "이미지를 고르거나 도구막대에서 형태 밀어 변형을 누르세요. 직접 그린 벡터 선·도형만 있어도 원본은 숨겨 보존하고 편집용 이미지 복사본을 자동으로 준비합니다.",
        tip: "복사본 준비가 끝나면 리퀴파이가 자동으로 켜집니다.",
      },
      {
        title: "변형 방식 고르기",
        body: "밀기·회전·오므리기·부풀리기 중 원하는 결과를 고르고 변형 강도를 낮게 시작하세요.",
      },
      {
        title: "윤곽 안쪽에서 짧게 드래그",
        body: "손을 떼면 한 획이 반영됩니다. 형태가 과해지면 ⌘Z로 바로 되돌릴 수 있어요.",
      },
    ],
  },
  {
    id: "quick-mask",
    category: "adjustments",
    title: "퀵 마스크",
    summary: "선택 영역을 브러시로 칠해 다듬는 포토샵식 Q 모드예요.",
    badge: "Q",
    tryAction: "quick-mask",
    tryLabel: "퀵 마스크 시작",
    steps: [
      {
        title: "Q 로 진입",
        body: "이미지 레이어를 고르고 Q 를 눌러요. 현재 픽셀 선택이 색 오버레이(마스크)로 바뀝니다.",
        tip: "선택·리터치 탭의 퀵 마스크 패널에서도 시작할 수 있어요.",
      },
      {
        title: "칠해서 다듬기",
        body: "브러시로 칠하면 선택에 더해지고, 지우기 모드로 칠하면 빠져요. 반전도 한 번에 됩니다.",
      },
      {
        title: "선택 영역으로 완료",
        body: "다시 Q 를 누르면 다듬은 마스크가 픽셀 선택으로 바뀌어요. 부드러운 가장자리는 페더로 보존됩니다.",
      },
    ],
  },
  {
    id: "color-range",
    category: "adjustments",
    title: "색상 범위 선택",
    summary: "비슷한 색 픽셀을 한 번에 선택 영역으로 잡아요.",
    badge: "색",
    steps: [
      {
        title: "선택·리터치 탭 열기",
        body: "이미지 레이어를 고르고 속성의 선택·리터치 탭에서 색상 범위 섹션을 찾아요.",
      },
      {
        title: "기준 색과 허용치",
        body: "기준 색을 고르고 허용치를 조절하면 미리보기로 선택될 영역이 보여요.",
      },
      {
        title: "선택 적용",
        body: "적용하면 현재 결합 모드(새 선택·합치기·빼기)에 맞춰 픽셀 선택이 만들어져요. 이어서 색 보정이나 삭제를 하면 됩니다.",
        tip: "하늘·머리카락처럼 색이 뚜렷한 영역에 특히 잘 맞아요.",
      },
    ],
  },
  {
    id: "filters",
    category: "adjustments",
    title: "선과 그림에 필터 적용",
    summary: "직접 그린 선만 있어도 편집 복사본을 만들고 색·블러·질감 효과를 적용해요.",
    badge: "필터",
    steps: [
      {
        title: "효과를 줄 내용 고르기",
        body: "이미지를 선택하거나 상단 필터 메뉴를 여세요. 직접 그린 벡터 선·도형만 있어도 원본은 숨겨 보존하고 편집용 이미지 복사본을 자동으로 준비합니다.",
      },
      {
        title: "미리보며 효과 맞추기",
        body: "색 보정·블러·선명도·질감 중 원하는 효과를 고르고 강도를 낮게 시작하세요. 픽셀 선택이 있으면 그 영역에만 적용됩니다.",
      },
      {
        title: "순서 확인하고 반영",
        body: "스마트 필터 스택에서는 효과 순서를 바꿔 결과를 비교할 수 있어요. 반영 뒤에도 ⌘Z로 한 단계씩 되돌릴 수 있습니다.",
      },
    ],
  },
  {
    id: "bubble",
    category: "dialogue",
    title: "말풍선",
    summary: "말하기·생각·외침 등 장면에 맞는 목소리를 골라 넣어요.",
    badge: "말",
    tryAction: "bubble",
    tryLabel: "말풍선 메뉴",
    steps: [
      {
        title: "종류 고르기",
        body: "상단 말풍선 메뉴에서 대사·감정·연출 UI 그룹을 보고 형태를 골라요.",
        tip: "대충 골라도 나중에 속성에서 모양을 바꿀 수 있어요.",
      },
      {
        title: "대사 입력",
        body: "캔버스의 말풍선을 더블클릭(또는 탭)해 글을 고쳐요. 선택하면 오른쪽 속성에서 색·꼬리·분위기도 조절됩니다.",
      },
      {
        title: "분위기 스와치",
        body: "속성 패널의 분위기 스와치로 색·선·모양을 한 번에 맞춰 보세요.",
      },
    ],
  },
  {
    id: "dialogue",
    category: "dialogue",
    title: "대사 한 번에 넣기",
    summary: "스크립트를 붙여 넣으면 말풍선이 줄줄이 배치됩니다.",
    badge: "대본",
    tryAction: "dialogue",
    tryLabel: "말풍선·대본",
    steps: [
      {
        title: "스크립트 형식",
        body: "한 줄에 한 대사. 「이름: 대사」면 화자가 나뉘고, 「(지문)」은 나레이션 박스가 됩니다.",
      },
      {
        title: "한 번에 넣기",
        body: "말풍선 메뉴 아래 입력칸에 붙여 넣고 「말풍선으로 한 번에 넣기」를 눌러요.",
      },
      {
        title: "일괄 편집",
        body: "이미 올린 대사는 「배치 대사 편집」에서 한꺼번에 고칠 수 있어요.",
      },
    ],
  },
  {
    id: "comment-collaboration",
    category: "dialogue",
    title: "위치 댓글로 함께 검토",
    summary: "캔버스의 정확한 위치에 핀을 놓고 답글·멘션·해결 상태로 협업해요.",
    badge: "댓글",
    steps: [
      {
        title: "댓글 핀 놓기",
        body: "왼쪽 도구막대의 댓글 핀 배치를 누르거나 ⌥C를 누른 뒤, 의견을 남길 캔버스 위치를 한 번 누르세요.",
        tip: "핀 배치 중 Esc를 누르면 그림을 바꾸지 않고 바로 취소됩니다.",
      },
      {
        title: "짧고 구체적으로 쓰기",
        body: "바꿀 내용과 이유를 적고 필요한 팀원을 멘션하세요. 같은 핀에서 답글을 이어가면 장면 맥락이 흩어지지 않습니다.",
      },
      {
        title: "온라인으로 확인하고 해결",
        body: "같은 공동 문서에 연결된 팀원은 핀과 답글을 함께 확인할 수 있어요. 반영이 끝난 대화는 해결로 표시하고 필요하면 다시 열 수 있습니다.",
      },
    ],
  },
  {
    id: "canvas-view",
    category: "composition",
    title: "캔버스 이동·확대와 배율 잠금",
    summary: "그림은 건드리지 않고 화면만 옮기고, 포인터 중심으로 확대하거나 배율을 잠가요.",
    badge: "이동",
    steps: [
      {
        title: "화면만 이동",
        body: "Space를 누른 채 드래그하거나 핸드 도구를 사용하세요. 모바일에서는 두 손가락으로 캔버스를 이동할 수 있습니다.",
      },
      {
        title: "포인터 중심으로 확대",
        body: "휠 확대 모드에서는 포인터가 있는 위치를 중심으로 배율이 바뀝니다. 휠 역할 버튼으로 확대·축소와 캔버스 스크롤을 전환할 수 있어요.",
      },
      {
        title: "원하는 배율에서 잠금",
        body: "배율 잠금을 켜면 휠·핀치로 우연히 확대되는 것을 막습니다. 다시 배율을 바꾸려면 같은 버튼으로 잠금을 해제하세요.",
      },
    ],
  },
  {
    id: "select-move-group",
    category: "composition",
    title: "선택·이동·다중 선택과 그룹",
    summary: "PPT처럼 객체를 고르고 여러 개를 묶어 한 덩어리로 옮기거나 잠가요.",
    badge: "선택",
    steps: [
      {
        title: "객체 선택",
        body: "V 키로 선택 도구를 켠 뒤 객체를 누르세요. 빈 곳에서 드래그하면 선택 상자로 여러 객체를 한 번에 고를 수 있습니다.",
      },
      {
        title: "여러 개 고르고 그룹화",
        body: "Shift를 누른 채 객체를 더 고르거나 레이어 패널의 다중 선택을 사용하세요. 필요한 항목을 모두 고른 뒤 그룹으로 묶습니다.",
      },
      {
        title: "한 덩어리로 이동·잠금",
        body: "그룹 경계 상자를 드래그하면 멤버가 함께 이동·변형됩니다. 배치가 끝나면 그룹 잠금으로 실수 이동을 막고, 다시 편집할 때 잠금을 해제하세요.",
      },
    ],
  },
  {
    id: "asset-drop",
    category: "composition",
    title: "에셋을 원하는 위치에 끌어놓기",
    summary: "말풍선·도형·이미지 소재를 캔버스의 정확한 위치나 컷 안에 바로 배치해요.",
    badge: "에셋",
    steps: [
      {
        title: "라이브러리에서 잡기",
        body: "템플릿·에셋 라이브러리에서 원하는 카드나 썸네일을 길게 누른 채 드래그하세요. 한 번 누르면 현재 보이는 위치에 빠르게 추가할 수도 있어요.",
      },
      {
        title: "캔버스 위치 확인",
        body: "삽입 미리보기를 보며 원하는 컷이나 빈 공간까지 옮긴 뒤 손을 떼세요. Esc를 누르면 배치 전에 취소됩니다.",
      },
      {
        title: "크기·정렬 다듬기",
        body: "선택 경계로 크기를 조절하고 정렬선이나 방향키로 위치를 맞추세요. 자주 쓰는 소재는 즐겨찾기나 내 에셋에 보관하면 빨라집니다.",
      },
    ],
  },
  {
    id: "template",
    category: "composition",
    title: "컷 템플릿",
    summary: "세로 웹툰·4컷·그리드 등 레이아웃을 한 번에 깔아요.",
    badge: "컷",
    tryAction: "template",
    tryLabel: "템플릿 열기",
    steps: [
      {
        title: "템플릿 고르기",
        body: "연동/템플릿 메뉴에서 세로 웹툰·그리드 등 구성을 선택해요.",
      },
      {
        title: "프레임 안에 그리기",
        body: "각 컷(프레임) 안에 그림·말풍선·캐릭터를 넣어요. 프레임이 장면을 나눠 줍니다.",
      },
      {
        title: "크기 조절",
        body: "캔버스 높이나 프레임을 선택해 길이를 조절할 수 있어요. 스크롤 웹툰은 세로로 길게 두는 편이 좋아요.",
      },
    ],
  },
  {
    id: "layers",
    category: "composition",
    title: "레이어와 선택",
    summary: "겹친 요소를 고르고, 순서·숨김·잠금으로 정리해요.",
    badge: "겹",
    tryAction: "layers",
    tryLabel: "레이어 패널",
    steps: [
      {
        title: "선택하기",
        body: "선택 도구로 요소를 탭하면 속성·레이어 목록에 강조됩니다.",
      },
      {
        title: "순서 바꾸기",
        body: "레이어 목록을 드래그하거나 ⌘] / ⌘[ 로 앞·뒤를 바꿔요.",
      },
      {
        title: "숨김·잠금",
        body: "작업 중 방해되는 요소는 숨기거나 잠가 두면 실수로 움직이지 않아요.",
        tip: "방향키로 1px, ⇧+방향키로 10px 미세 이동할 수 있어요.",
      },
    ],
  },
  {
    id: "path-boolean",
    category: "composition",
    title: "도형 결합",
    summary: "도형 두 개를 합치기·빼기·교집합으로 한 도형으로 만들어요.",
    badge: "합",
    steps: [
      {
        title: "도형 2개 선택",
        body: "합칠 도형 두 개를 드래그나 Shift+클릭으로 함께 선택해요.",
      },
      {
        title: "연산 고르기",
        body: "속성 패널의 도형 결합에서 합치기·빼기·교집합·나누기를 골라요.",
      },
      {
        title: "결과 다듬기",
        body: "결합된 도형은 하나의 패스가 됩니다. 마음에 안 들면 ⌘Z 로 되돌리고 다시 시도해요.",
        tip: "말풍선 실루엣이나 간판 같은 복합 도형을 만들 때 편해요.",
      },
    ],
  },
  {
    id: "character",
    category: "threed",
    title: "3D 캐릭터",
    summary: "VRM 캐릭터 포즈·의상·소품으로 장면을 잡아요.",
    badge: "캐",
    tryAction: "character",
    tryLabel: "캐릭터 열기",
    steps: [
      {
        title: "캐릭터 추가",
        body: "캐릭터 메뉴에서 모델이나 프리셋을 넣어 캔버스에 배치해요.",
      },
      {
        title: "포즈 잡기",
        body: "포즈 프리셋이나 조인트 조작으로 동작을 맞춰요.",
      },
      {
        title: "의상·소품",
        body: "워드로브와 소품 목록으로 분위기를 더해요. 어색하면 위치를 조금만 미세 조정해 보세요.",
      },
    ],
  },
  {
    id: "character-shaper",
    category: "threed",
    title: "캐릭터 셰이퍼",
    summary: "프리셋 카드로 얼굴·헤어·의상을 고르고 투명 PNG나 레이어 PSD로 내보내요.",
    badge: "셰",
    tryAction: "character-shaper",
    tryLabel: "셰이퍼 열기",
    steps: [
      {
        title: "모델 고르고 카드 고르기",
        body: "VRM을 불러온 뒤 왼쪽 슬롯 레일에서 얼굴형·눈·헤어·상의를 카드로 고릅니다. 한 번 누르면 바로 적용되고 되돌리기 한 단계로 남아요.",
        tip: "모델이 지원하지 않는 항목은 이유를 적어 두고 흐리게 보여 줍니다.",
      },
      {
        title: "사진·웹캠으로 포즈 잡기",
        body: "참고 이미지로 추천을 받고, 사진이나 웹캠으로 포즈를 옮깁니다. 어떤 부위를 가져올지 고를 수 있어요.",
      },
      {
        title: "칠하고 내보내기",
        body: "표면 드로잉으로 모델 위에 직접 칠한 뒤 투명 배경 PNG로 캔버스에 추가하거나, 레이어가 나뉜 PSD로 내보냅니다.",
        tip: "PSD는 밑색·음영·하이라이트·주선 그룹으로 나옵니다. 만들지 못한 레이어는 이유를 함께 적어 줍니다.",
      },
    ],
  },
  {
    id: "bg3d",
    category: "threed",
    title: "3D 배경",
    summary: "방·거리·세트 템플릿으로 배경 공간을 빠르게 깔아요.",
    badge: "배경",
    tryAction: "bg3d",
    tryLabel: "3D 배경",
    steps: [
      {
        title: "장면 템플릿",
        body: "3D 배경에서 방·거리 등 템플릿을 골라 한 번에 배치해요.",
      },
      {
        title: "오브젝트 배치",
        body: "가구·소품을 옮기고 바닥 스냅으로 정렬해요. 숨김·잠금으로 정리할 수 있습니다.",
      },
      {
        title: "카메라 감각",
        body: "시점과 조명을 살짝 바꿔 컷의 분위기를 잡아 보세요.",
      },
    ],
  },
  {
    id: "mannequin",
    category: "threed",
    title: "3D 데생 인형",
    summary: "관절 인형으로 포즈를 잡아 인체 밑그림으로 넣어요.",
    badge: "인",
    tryAction: "mannequin",
    tryLabel: "데생 인형 열기",
    steps: [
      {
        title: "데생 인형 열기",
        body: "도구 모음에서 3D 데생 인형을 열어요. 회전·확대는 3D 캐릭터와 같은 조작이에요.",
      },
      {
        title: "포즈 잡기",
        body: "관절을 끌어 동작을 만들거나 포즈 프리셋에서 시작해요. 비율 슬라이더로 체형도 바꿀 수 있어요.",
      },
      {
        title: "밑그림으로 삽입",
        body: "캔버스에 삽입한 뒤 불투명도를 낮추고 위에 선을 얹으면 인체 데생 가이드가 됩니다.",
        tip: "어려운 앵글일수록 인형을 먼저 돌려 보고 그리면 빨라요.",
      },
    ],
  },
  {
    id: "room-builder",
    category: "threed",
    title: "방 만들기",
    summary: "치수를 바꿔 가며 방 구조를 빠르게 블로킹해요.",
    badge: "방",
    tryAction: "bg3d",
    tryLabel: "3D 배경 열기",
    steps: [
      {
        title: "방 만들기 열기",
        body: "3D 배경에서 방 만들기를 골라요. 바닥·벽이 있는 기본 방이 준비됩니다.",
      },
      {
        title: "치수와 개구부",
        body: "가로·세로·높이와 문·창 위치를 조절해요. 값을 바꾸면 방이 즉시 다시 지어져요.",
      },
      {
        title: "장면에 추가",
        body: "장면에 추가하면 가구·소품을 배치할 수 있어요. 태양 리그·조명으로 시간대 분위기도 잡아 보세요.",
      },
    ],
  },
  {
    id: "ai-assist",
    category: "aiExport",
    title: "AI 어시스트",
    summary: "대사 제안·리라이트 등 보조 도구로 막힌 장면을 풀어요.",
    badge: "AI",
    tryAction: "ai-assist",
    tryLabel: "AI 어시스트",
    steps: [
      {
        title: "허브 열기",
        body: "AI 어시스트 메뉴에서 필요한 도구 탭을 고르세요.",
      },
      {
        title: "맥락 넣기",
        body: "장면·화자·톤을 짧게 적어 주면 제안이 더 잘 맞아요. 결과는 그대로 쓰지 말고 손봐 주세요.",
        tip: "일부 기능은 내 API 키(BYOK)가 필요할 수 있어요.",
      },
      {
        title: "캔버스에 반영",
        body: "마음에 드는 문장을 말풍선에 붙여 넣거나 적용 버튼으로 반영해요.",
      },
    ],
  },
  {
    id: "save-recovery",
    category: "aiExport",
    title: "저장·자동복구와 안전 백업",
    summary: "자동 저장 상태를 확인하고 공동 저장·기기 백업으로 작업 손실을 막아요.",
    badge: "복구",
    steps: [
      {
        title: "자동 저장 상태 확인",
        body: "작업 중에는 로컬 임시 저장과 복구 지점이 갱신됩니다. 상단 저장 상태가 완료로 바뀐 뒤 탭을 닫는 습관이 안전해요.",
      },
      {
        title: "팀 작업은 공동 저장",
        body: "공동 문서에서는 최신 revision을 확인해 저장하세요. 다른 변경과 충돌한 임시본은 자동으로 덮어쓰지 않고 원본을 보존합니다.",
      },
      {
        title: "중요 시점은 파일로 백업",
        body: "작업 전환이나 기기 이동 전에는 JSON 또는 자산 포함 아카이브를 내려받으세요. 자동복구가 막힌 경우에도 백업 파일로 안전하게 수동 복원할 수 있습니다.",
      },
    ],
  },
  {
    id: "export",
    category: "aiExport",
    title: "내보내기",
    summary: "PNG·JSON 백업 등으로 작업을 저장하고 공유해요.",
    badge: "저장",
    tryAction: "export",
    tryLabel: "다운로드 위치",
    steps: [
      {
        title: "이미지로 저장",
        body: "상단 다운로드에서 배율(예: 2× PNG)을 고른 뒤 저장해요.",
      },
      {
        title: "작업 백업",
        body: "JSON 백업으로 레이어·말풍선까지 통째로 보관할 수 있어요. 나중에 다시 불러오세요.",
      },
      {
        title: "게시 전 확인",
        body: "게시/업로드 전에 한 번 더 보고, 필요한 컷만 내보내도 됩니다.",
      },
    ],
  },
  {
    id: "gif-export",
    category: "aiExport",
    title: "GIF·APNG 내보내기",
    summary: "프레임 애니메이션을 어디서나 재생되는 움짤 파일로 저장해요.",
    badge: "움",
    tryAction: "frame-anim",
    tryLabel: "프레임 애니 열기",
    steps: [
      {
        title: "프레임 만들기",
        body: "이미지 레이어를 고르고 프레임 애니 패널에서 프레임을 쌓아 짧은 셀 애니를 만들어요.",
      },
      {
        title: "형식 고르기",
        body: "내보내기에서 GIF 또는 APNG 를 골라요. GIF 는 어디서나 재생되고, APNG 는 화질이 더 좋아요.",
      },
      {
        title: "저장하고 공유",
        body: "속도·반복을 확인하고 저장하면 바로 공유할 수 있는 애니메이션 파일이 나와요.",
        tip: "커뮤니티 업로드용은 GIF, 화질 보존용은 APNG 가 무난해요.",
      },
    ],
  },
];

export const STUDIO_FEATURE_TUTORIAL_BY_ID = new Map(
  STUDIO_FEATURE_TUTORIALS.map((t) => [t.id, t] as const)
);

export function groupStudioFeatureTutorials(
  list: readonly StudioFeatureTutorial[] = STUDIO_FEATURE_TUTORIALS
): { category: StudioTutorialCategory; items: StudioFeatureTutorial[] }[] {
  return STUDIO_TUTORIAL_CATEGORY_ORDER.map((category) => ({
    category,
    items: list.filter((t) => t.category === category),
  })).filter((g) => g.items.length > 0);
}

// ── 진행 상태 ─────────────────────────────────────────────────────────────

export const STUDIO_TUTORIAL_PROGRESS_KEY = "toonspectrum.studio.tutorialProgress.v1";

export type StudioTutorialProgress = {
  /** 마지막 단계까지 본 튜토리얼 id. */
  completed: string[];
  /** 마지막으로 열어 둔 튜토리얼 id. */
  lastId?: string;
};

export function emptyTutorialProgress(): StudioTutorialProgress {
  return { completed: [] };
}

export function normalizeTutorialProgress(value: unknown): StudioTutorialProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyTutorialProgress();
  }
  const candidate = value as Partial<StudioTutorialProgress>;
  const completed = Array.isArray(candidate.completed)
    ? [...new Set(candidate.completed.filter(
        (id): id is string => typeof id === "string" && STUDIO_FEATURE_TUTORIAL_BY_ID.has(id),
      ))]
    : [];
  const lastId = typeof candidate.lastId === "string"
    && STUDIO_FEATURE_TUTORIAL_BY_ID.has(candidate.lastId)
    ? candidate.lastId
    : undefined;
  return { completed, ...(lastId ? { lastId } : {}) };
}

/** Explicit pre-V12 import/test seam. Product Studio uses SQLite/OPFS. */
export function readTutorialProgress(): StudioTutorialProgress {
  if (typeof window === "undefined") return emptyTutorialProgress();
  try {
    const raw = globalThis.localStorage.getItem(STUDIO_TUTORIAL_PROGRESS_KEY);
    if (!raw) return emptyTutorialProgress();
    return normalizeTutorialProgress(JSON.parse(raw) as unknown);
  } catch {
    return emptyTutorialProgress();
  }
}

/** Explicit pre-V12 import/test seam. Product Studio uses SQLite/OPFS. */
export function writeTutorialProgress(progress: StudioTutorialProgress): void {
  if (typeof window === "undefined") return;
  try {
    globalThis.localStorage.setItem(
      STUDIO_TUTORIAL_PROGRESS_KEY,
      JSON.stringify(normalizeTutorialProgress(progress)),
    );
  } catch {
    // private mode / quota
  }
}

export function markTutorialCompleted(
  progress: StudioTutorialProgress,
  id: string
): StudioTutorialProgress {
  if (progress.completed.includes(id)) {
    return { ...progress, lastId: id };
  }
  return {
    completed: [...progress.completed, id],
    lastId: id,
  };
}

export function isTutorialCompleted(progress: StudioTutorialProgress, id: string): boolean {
  return progress.completed.includes(id);
}

export function tutorialCompletionRatio(progress: StudioTutorialProgress): {
  done: number;
  total: number;
} {
  const total = STUDIO_FEATURE_TUTORIALS.length;
  const done = STUDIO_FEATURE_TUTORIALS.filter((t) => progress.completed.includes(t.id)).length;
  return { done, total };
}
