/** Authored native compositions, not flattened art or color-generated variants. */
import type { SceneSeed, SceneSeedBubble, SceneSeedFrame, SceneSeedText, SceneTemplate } from "../studio-scene-templates";

function frame(x: number, y: number, width: number, height: number, bgColor = "#ffffff"): SceneSeedFrame {
  return { type: "frame", x, y, width, height, bgColor, stroke: "#242329", strokeWidth: 3 };
}
function bubble(text: string, x: number, y: number, width: number, height: number, variant: SceneSeedBubble["variant"] = "speech", tail: "left" | "right" | "none" = "left"): SceneSeedBubble {
  return { type: "bubble", text, x, y, width, height, variant, tail, tailDirection: "bottom", fill: "#ffffff", textFill: "#242329", rotation: 0, fontSize: 24 };
}
function text(value: string, x: number, y: number, width: number, fontSize = 32): SceneSeedText {
  return { type: "text", text: value, x, y, width, fontSize, fill: "#242329", rotation: 0, align: "center" };
}
function composition(id: string, label: string, category: string, description: string, seeds: readonly SceneSeed[]): SceneTemplate {
  return { id, label, category, description, build: (ox, oy) => seeds.map((seed) => ({ ...seed, x: seed.x + ox, y: seed.y + oy })) };
}

export const STUDIO_AUTHORED_SCENE_TEMPLATES: readonly SceneTemplate[] = [
  composition("school-exam-silence", "시험 종료의 정적", "school", "긴 안내 컷과 짧은 반응 컷으로 긴장 뒤의 정적을 나눕니다.", [
    frame(30, 0, 660, 360, "#f6f5ed"), frame(30, 420, 660, 200),
    bubble("펜을 내려놓으세요.", 62, 30, 350, 90, "box", "none"), text("…", 296, 236, 120, 54),
    bubble("마지막 문제…", 376, 458, 268, 100, "thought", "right"),
  ]),
  composition("school-locker-note", "사물함 속 쪽지", "school", "발견·쪽지·반응을 세 컷으로 나누는 학원 미스터리 구성.", [
    frame(30, 0, 310, 240), frame(374, 0, 316, 240, "#f9f1df"), frame(30, 286, 660, 300),
    bubble("이게 뭐지?", 58, 22, 244, 90, "thought"), text("방과 후, 도서관에서.", 399, 78, 260, 22),
    bubble("누가 남긴 걸까…", 286, 334, 350, 100, "whisper", "right"),
  ]),
  composition("daily-office-negotiation", "회의실의 조건", "daily", "제안과 반론을 좌우로 배치하고 아래 컷에서 결론을 받습니다. 회사·사무실·면접.", [
    frame(30, 0, 660, 340, "#f0f3f6"), frame(30, 382, 660, 220),
    bubble("일정을 먼저 정하죠.", 56, 26, 288, 98), bubble("품질 기준도 필요합니다.", 356, 174, 304, 104, "speech", "right"),
    bubble("그럼 이렇게 합의할까요?", 142, 426, 438, 108, "box", "none"),
  ]),
  composition("daily-transit-departure", "막차 안내", "daily", "방송 안내·짧은 속도 컷·내적 반응의 세로 흐름. 버스·지하철·대중교통.", [
    frame(30, 0, 660, 210, "#edf1f7"), frame(30, 248, 660, 150), frame(30, 446, 660, 290),
    bubble("이번 열차가 마지막 열차입니다.", 74, 24, 564, 100, "system", "none"),
    { type: "speedLines", x: 54, y: 268, width: 612, height: 106, lineCount: 12, direction: "horizontal", stroke: "#454958", strokeWidth: 2, rotation: 0 },
    bubble("아직 늦지 않았어.", 314, 490, 322, 112, "thought", "right"),
  ]),
  composition("daily-phone-read-receipt", "읽음 뒤의 침묵", "daily", "서로 다른 메시지와 긴 침묵 여백을 가진 휴대폰 대화.", [
    frame(110, 0, 500, 640, "#edf3f6"), bubble("지금 통화할 수 있어?", 144, 44, 370, 106, "phone"),
    bubble("잠깐만. 곧 연락할게.", 204, 198, 374, 106, "phone", "right"),
    text("읽음", 470, 328, 90, 18), text("30분 후", 264, 484, 192, 22),
  ]),
  composition("romance-cafe-empty-seat", "카페의 빈자리", "romance", "기다리는 대사와 빈 공간 뒤에 짧은 도착 반응을 붙입니다.", [
    frame(30, 0, 660, 440, "#fff5e9"), frame(30, 490, 660, 230, "#fff9f3"),
    bubble("오늘은 먼저 와 있네.", 64, 36, 330, 104), text("딸랑", 478, 334, 158, 32),
    bubble("많이 기다렸어?", 334, 528, 302, 102, "speech", "right"),
  ]),
  composition("romance-parallel-thoughts", "서로 다른 속마음", "romance", "평행한 두 컷의 생각을 마지막 공통 대사로 연결합니다.", [
    frame(30, 0, 310, 380, "#fff2f4"), frame(378, 0, 312, 380, "#f0f4fc"),
    bubble("먼저 말해볼까?", 54, 28, 262, 120, "thought"), bubble("왜 조용하지…", 402, 206, 264, 120, "thought", "right"),
    bubble("저기…!", 208, 438, 304, 120, "double", "none"),
  ]),
  composition("fantasy-royal-letter", "왕실의 봉인 편지", "fantasy", "서신 인용과 수신인의 반응을 분리한 로맨스판타지 연출.", [
    frame(30, 0, 660, 520, "#f5efdf"), bubble("왕실의 이름으로 귀하를 초대합니다.", 104, 62, 512, 154, "box", "none"),
    text("붉은 봉인이 찍혀 있었다.", 150, 252, 420, 24), bubble("이 초대는… 명령이군.", 274, 360, 360, 112, "whisper", "right"),
  ]),
  composition("fantasy-portal-choice", "문 너머의 선택", "fantasy", "두 갈림길과 중앙의 선택 질문. 시스템 문구를 개별 수정합니다.", [
    frame(30, 0, 310, 440, "#eaf2f8"), frame(380, 0, 310, 440, "#f8ece9"),
    bubble("기억을 되찾는 문", 54, 36, 262, 92, "system", "none"), bubble("모든 것을 잊는 문", 402, 306, 264, 94, "system", "none"),
    bubble("무엇을 선택하시겠습니까?", 122, 496, 476, 110, "system", "none"),
  ]),
  composition("action-security-monitor", "감시 화면의 단서", "action", "큰 관찰 컷과 세부 확대 컷을 분리한 추적·수사 상황.", [
    frame(30, 0, 660, 340, "#e9eeef"), frame(30, 386, 260, 206, "#eef2ee"), frame(332, 386, 358, 206),
    text("CAM 04  ·  23:17", 58, 22, 280, 20), text("확대", 60, 414, 200, 22), bubble("시간이 맞지 않아.", 354, 432, 306, 108, "whisper"),
  ]),
  composition("action-knock-suspense", "문밖의 세 번 노크", "action", "짧은 반복 컷 두 개와 길어진 침묵 컷으로 공포의 리듬을 만듭니다.", [
    frame(30, 0, 660, 120, "#e9e9ee"), frame(30, 168, 660, 120, "#dedee7"), frame(30, 382, 660, 360, "#d3d3df"),
    text("똑", 294, 30, 132, 38), text("똑, 똑", 270, 198, 180, 38),
    bubble("…아무도 없어야 하는데.", 232, 438, 408, 110, "scared", "right"),
  ]),
  composition("narrative-time-montage", "하루의 시간 몽타주", "narrative", "아침·오후·밤을 서로 다른 컷 길이로 압축한 시간 전환.", [
    frame(30, 0, 660, 160, "#fff7e8"), frame(30, 194, 660, 250, "#f2f7f9"), frame(30, 500, 660, 340, "#e9ebf4"),
    bubble("오전 8시", 52, 20, 170, 62, "box", "none"), bubble("오후 2시", 480, 214, 180, 62, "box", "none"),
    bubble("그리고, 자정.", 52, 524, 250, 70, "box", "none"),
  ]),
  composition("narrative-chapter-divider", "장 구분 타이틀", "narrative", "장 번호·큰 제목·짧은 서문을 나눈 여백 중심 타이틀.", [
    text("CHAPTER 02", 60, 62, 600, 24), text("돌아오지 않는 계절", 60, 170, 600, 52),
    frame(156, 316, 408, 3, "#242329"), bubble("우리가 마지막으로 만난 날의 이야기.", 86, 412, 548, 128, "box", "none"),
  ]),
  composition("narrative-creator-update", "휴재·복귀 안내", "narrative", "안내 제목·일정·작가 메시지를 따로 고칠 수 있는 회차 공지.", [
    frame(30, 0, 660, 620, "#faf8f2"), text("잠시 쉬어갑니다", 64, 52, 592, 48),
    bubble("복귀 예정일을 입력하세요", 114, 190, 492, 90, "system", "none"),
    bubble("더 좋은 이야기로 돌아오겠습니다.\n기다려 주셔서 감사합니다.", 84, 342, 552, 158, "box", "none"),
  ]),
];
