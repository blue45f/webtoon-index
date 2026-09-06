import type { StudioWriterRoomStage } from "./studio-writer-room";

interface StudioWriterRoomStageMeta {
  label: string;
  shortLabel: string;
  description: string;
}

export const STUDIO_WRITER_ROOM_STAGE_META: Record<
  StudioWriterRoomStage,
  StudioWriterRoomStageMeta
> = {
  premise: {
    label: "한 줄 기획",
    shortLabel: "기획",
    description: "주인공, 목표, 갈등, 차별점을 한 문장으로 고정합니다.",
  },
  synopsis: {
    label: "시놉시스",
    shortLabel: "시놉시스",
    description: "시작부터 결말까지 핵심 인과와 감정의 흐름을 정리합니다.",
  },
  "episode-outline": {
    label: "회차 아웃라인",
    shortLabel: "회차",
    description: "이번 회차의 제목, 목표, 전환점과 마지막 훅을 설계합니다.",
  },
  beats: {
    label: "비트",
    shortLabel: "비트",
    description: "독자의 감정이 움직이는 사건 단위로 회차를 쪼갭니다.",
  },
  scenes: {
    label: "장면",
    shortLabel: "장면",
    description: "비트를 장소와 시간, 등장인물 중심의 장면으로 구체화합니다.",
  },
  "panel-plan": {
    label: "컷 플랜",
    shortLabel: "컷",
    description: "장면을 샷과 액션 단위로 나눠 세로 스크롤 리듬을 계획합니다.",
  },
  "dialogue-sfx": {
    label: "대사·효과음",
    shortLabel: "대사·SFX",
    description: "컷별 대사, 화자, 효과음의 강도와 크기를 마무리합니다.",
  },
};
