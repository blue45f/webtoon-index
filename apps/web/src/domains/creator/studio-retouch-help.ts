/**
 * 래스터 리터치 도구의 사용자 언어 단일 진실원천.
 *
 * 전문 용어를 없애지 않고, 처음 보는 사용자가 결과를 예측할 수 있는 행동 이름을 앞에 둔다.
 * 왼쪽 레일·속성 패널·튜토리얼이 같은 차이를 설명해야 스머지와 혼색처럼 비슷해 보이는 도구가
 * 실제 작업에서 뒤바뀌지 않는다.
 */

export const STUDIO_RETOUCH_TOOL_IDS = [
  "smudge",
  "wet-mix",
  "dodge-burn",
  "liquify",
] as const;

export type StudioRetouchToolId = (typeof STUDIO_RETOUCH_TOOL_IDS)[number];

export type StudioRetouchFirstUseStep = {
  readonly title: string;
  readonly body: string;
};

export type StudioRetouchToolHelp = {
  readonly actionName: string;
  readonly technicalName: string;
  readonly railName: string;
  readonly summary: string;
  readonly activeInstruction: string;
  readonly busyMessage: string;
  readonly steps: readonly [
    StudioRetouchFirstUseStep,
    StudioRetouchFirstUseStep,
    StudioRetouchFirstUseStep,
  ];
};

export const STUDIO_RETOUCH_EDITABLE_COPY_NOTE =
  "이미지 레이어가 없어도 벡터 선·도형이 있는 현재 페이지를 누르면, 원본은 숨겨 보존하고 편집용 이미지 복사본을 자동으로 준비합니다.";

const COMMON_TARGET_STEP: StudioRetouchFirstUseStep = {
  title: "대상 준비",
  body: STUDIO_RETOUCH_EDITABLE_COPY_NOTE,
};

export const STUDIO_RETOUCH_TOOL_HELP: Readonly<
  Record<StudioRetouchToolId, StudioRetouchToolHelp>
> = {
  smudge: {
    actionName: "색 밀어 섞기",
    technicalName: "스머지",
    railName: "색 밀어 섞기 · 스머지",
    summary: "이미 칠한 색을 드래그 방향으로 밀어 경계를 섞습니다. 새 색은 칠하지 않습니다.",
    activeInstruction: "색 경계에서 섞고 싶은 방향으로 드래그하세요.",
    busyMessage: "문지른 한 획을 이미지에 반영하고 있습니다.",
    steps: [
      COMMON_TARGET_STEP,
      {
        title: "색 밀기 켜기",
        body: "색 밀어 섞기를 켠 뒤 크기와 밀기 강도를 맞춥니다.",
      },
      {
        title: "드래그하고 확인",
        body: "색 경계를 따라 드래그하고 손을 떼면 한 획이 반영됩니다. ⌘Z로 그 획만 되돌릴 수 있습니다.",
      },
    ],
  },
  "wet-mix": {
    actionName: "물감 섞어 칠하기",
    technicalName: "혼색 브러시",
    railName: "물감 섞어 칠하기 · 혼색",
    summary: "현재 색을 새로 칠하면서 바닥색을 붓에 묻혀 함께 섞습니다.",
    activeInstruction: "바닥색 위를 드래그해 현재 색을 섞어 칠하세요.",
    busyMessage: "섞어 칠한 한 획을 이미지에 반영하고 있습니다.",
    steps: [
      COMMON_TARGET_STEP,
      {
        title: "칠할 색과 섞임 맞추기",
        body: "현재 색을 고른 뒤 칠하는 양·바닥색 섞기·색 줍기를 조절합니다.",
      },
      {
        title: "섞어 칠하고 확인",
        body: "바닥색 위를 드래그하고 손을 떼면 한 획이 반영됩니다. ⌘Z로 그 획만 되돌릴 수 있습니다.",
      },
    ],
  },
  "dodge-burn": {
    actionName: "밝기·채도 붓",
    technicalName: "닷지·번·스펀지",
    railName: "밝기·채도 붓 · 닷지·번",
    summary: "지나간 자리만 밝게·어둡게 하거나 색의 선명함을 조절합니다.",
    activeInstruction: "보정할 부분을 짧게 드래그하고 결과를 확인하세요.",
    busyMessage: "밝기·채도 보정 한 획을 이미지에 반영하고 있습니다.",
    steps: [
      COMMON_TARGET_STEP,
      {
        title: "원하는 결과 고르기",
        body: "밝게(닷지), 어둡게(번), 채도(스펀지) 중 하나를 고르고 효과 강도를 낮게 시작합니다.",
      },
      {
        title: "약하게 겹쳐 칠하기",
        body: "보정할 곳을 짧게 여러 번 지나면 자연스럽습니다. 한 획마다 ⌘Z로 되돌릴 수 있습니다.",
      },
    ],
  },
  liquify: {
    actionName: "형태 밀어 변형",
    technicalName: "리퀴파이",
    railName: "형태 밀어 변형 · 리퀴파이",
    summary: "브러시로 이미지 모양을 밀거나 비틀고, 오므리거나 부풀립니다.",
    activeInstruction: "바꿀 윤곽 안쪽에서 원하는 방향으로 짧게 드래그하세요.",
    busyMessage: "형태 변형 한 획을 이미지에 반영하고 있습니다.",
    steps: [
      COMMON_TARGET_STEP,
      {
        title: "변형 방식 고르기",
        body: "밀기·회전·오므리기·부풀리기 중 결과에 맞는 방식을 고르고 강도를 낮게 시작합니다.",
      },
      {
        title: "윤곽 안쪽에서 드래그",
        body: "짧게 드래그하고 손을 떼면 한 획이 반영됩니다. 형태가 과해지면 ⌘Z로 바로 되돌리세요.",
      },
    ],
  },
};

export function studioRetouchToolHelp(id: StudioRetouchToolId): StudioRetouchToolHelp {
  return STUDIO_RETOUCH_TOOL_HELP[id];
}
