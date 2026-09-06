/**
 * V5 §15.3 menu specification and our measured coverage of it.
 *
 * §15.3 declares 17 menu groups and, inside each, a list of things the group is
 * supposed to offer. This module is the **only** place that says which of those
 * rows we actually ship, which we do not, and which of our menu items answer to
 * no §15.3 row at all (`extras`).
 *
 * It exists so a gap cannot close itself quietly: `studio-main-menu-group-spec.test.ts`
 * asserts that the live `buildStudioMainMenuGroups()` output and this table claim
 * exactly the same item ids, so adding, moving or dropping a menu item without
 * updating the coverage table fails the build.
 *
 * Source: `docs/architecture/ToonStudio_…_V5_2026-08-07.md` §15.3 (lines 574-645).
 * Audit that ordered the regroup: `docs/rewrite/ux-audit-v5.md` §2.7, §4 Wave C.
 */

import { STUDIO_MENU_HELP_GROUP_SPEC } from "./studio-main-menu-group-spec-help";
import { gap, has, ours, part } from "./studio-main-menu-group-spec-model";

import type { StudioMenuGroupSpec } from "./studio-main-menu-group-spec-model";

export type {
  StudioMenuGroupSpec,
  StudioMenuSpecCoverage,
  StudioMenuSpecExtra,
  StudioMenuSpecRow,
} from "./studio-main-menu-group-spec-model";

export const STUDIO_MENU_GROUP_SPEC: readonly StudioMenuGroupSpec[] = Object.freeze([
  {
    id: "file",
    labelKo: "파일",
    specName: "File",
    inV5Spec: true,
    rows: [
      part(
        "새 프로젝트",
        "빠른 시작 패널(템플릿·웹툰 마법사)만. 현재 문서를 비우는 ‘새로 만들기’ 명령은 여전히 없다.",
        "file/quick-start",
      ),
      part("열기·최근 파일", "프로젝트 도구 패널이 최근 작업 목록을 대신한다.", "file/project"),
      part(
        "CSP/PSD/ORA/PDF/Office/3D 가져오기",
        "PSD·ORA·CBZ·WILL·자체 JSON 만. `.clip`·PDF·Office·3D 가져오기는 없다.",
        "file/import-json",
        "file/import-psd",
        "file/import-ora-cbz",
      ),
      gap("원본 파일 연결"),
      part(
        "저장·다른 이름·버전 체크포인트",
        "초안 저장·게시·명명 체크포인트. ‘다른 이름으로 저장’은 여전히 없다.",
        "file/save-draft",
        "file/publish",
        "file/checkpoints",
      ),
      has("Publish Package", "file/publish-package", "file/export-archive"),
      gap("포맷 호환성 보고서", "손실 미리보기는 가져오기 흐름 안에만 있고, 호환성 표는 데이터로만 있다."),
      gap("복구 센터", "세션 복구 배너·신뢰성 레일만 있고 센터는 없다(감사 §2.10)."),
      part(
        "프로젝트 권리 BOM",
        "에셋 권리 매니페스트(출처·라이선스·진단·CSV/JSON 내보내기)까지. 3D 패키지 BOM 은 아직 이 표에 합류하지 않았다.",
        "file/rights-manifest",
      ),
    ],
    extras: [
      ours("file/export", "내보내기 / 다운로드 — 현행 배포 동선의 진입점."),
      ours("file/copy-image", "이미지를 클립보드로."),
      ours("file/export-json", "백업(.json)."),
      ours("file/publish-preflight", "게시 사전검사 — §15.3 행이 없지만 게시 패키지의 전제다."),
    ],
  },
  {
    id: "edit",
    labelKo: "편집",
    specName: "Edit",
    inV5Spec: true,
    rows: [
      has("Undo/Redo", "edit/undo", "edit/redo"),
      part("History Branch", "선형 작업 내역만. 분기는 없다.", "edit/history"),
      has("잘라내기·복사·붙여넣기", "edit/cut", "edit/copy", "edit/paste"),
      has("Paste in Place", "edit/paste-in-place"),
      gap("명령 반복", "필터 전용 ‘마지막 필터 다시 열기’만 있고 범용 명령 반복은 없다."),
      part(
        "Automation Recipe",
        "액션 세트 편집·가져오기·내보내기·드라이런과 매크로 녹음까지. 조건 분기·스케줄은 없다.",
        "edit/auto-actions",
      ),
      has("Preferences", "edit/app-settings"),
      has("Input Device Calibration", "edit/pen-pressure"),
    ],
    extras: [
      ours("edit/paste-file", "이미지 파일 붙여넣기…"),
      ours("edit/duplicate", "복제."),
      ours("edit/clear-selection", "선택 제거 — 선택 영역이 아니라 그 내용을 지운다."),
    ],
  },
  {
    id: "view",
    labelKo: "보기",
    specName: "View",
    inV5Spec: true,
    rows: [
      has(
        "Zoom/Rotate/Mirror",
        "view/zoom-in",
        "view/zoom-out",
        "view/flip-horizontal",
        "view/rotate-left",
        "view/rotate-right",
        "view/reset-rotation",
        "view/fit",
        "view/actual-pixels",
      ),
      has("Navigator", "view/navigator"),
      gap("Proof/Pixel/Vector Preview"),
      part(
        "Color/ICC Soft Proof",
        "색각 검수 5종만. ICC 소프트 프루프는 없다.",
        "view/color-vision-original",
        "view/color-vision-grayscale",
        "view/color-vision-protanopia",
        "view/color-vision-deuteranopia",
        "view/color-vision-tritanopia",
      ),
      gap("Onion Skin", "어니언 스킨은 애니메이션 그룹이 정본 위치다(‘애니메이션 ▸ 어니언 스킨’)."),
      part(
        "Reference Overlay",
        "밑그림(이메레스) 오버레이만. 참고 ‘이미지’ 는 창(Window)▸Reference Desk 로 옮겼다.",
        "view/underlay",
      ),
      part("Performance HUD", "제작 인사이트는 생산성 지표다. 렌더 성능 HUD 는 없다.", "view/production-insights"),
      gap(
        "Safe Mode",
        "런타임은 있다(GPU 손실·저장소 압박이 자동 진입). 수동 진입은 신뢰성 계층의 제품 경계라 메뉴가 임의로 열지 않는다.",
      ),
    ],
    extras: [
      ours("view/fullscreen", "전체화면."),
      ours("view/save-current-view", "현재 보기 저장."),
      ours("view/restore-view", "보기 복원."),
      // 검수·미리보기 3종(타임라인·세로 스크롤·스토리보드)은 View 중복을 제거했다 —
      // 같은 핸들러의 단일 행이 Animation/Comic 그룹에 있다(메뉴당 한 문 원칙).
    ],
  },
  {
    id: "canvas",
    labelKo: "캔버스",
    labelEn: "Canvas",
    specName: "Canvas",
    inV5Spec: true,
    hintKo: {
      description: "눈금자·원근 도우미처럼 캔버스 위에 겹치는 보조선을 켜고 끕니다.",
      tip: "페이지 추가·시퀀스는 ‘만화’ 메뉴의 페이지 관리에 있습니다.",
    },
    rows: [
      part(
        "크기·해상도·작업 색공간",
        "캔버스 크기·매직 리사이즈·가이드까지. 문서 DPI 와 작업 색공간 선택은 없다(내보내기에만 DPI 가 있다).",
        "canvas/canvas-settings",
      ),
      gap("Crop/Trim", "레이어 자르기는 레이어 메뉴에 있고 캔버스 자르기는 없다."),
      gap("웹툰 세로 캔버스", "세로 프리셋과 플랫폼 폭 가이드는 캔버스 설정 안에 있고 전용 명령은 없다."),
      gap("페이지/아트보드/슬라이드", "페이지 명령은 ‘만화’ 그룹의 Page Manager 로 묶었다."),
      part(
        "그리드·자·퍼스",
        "px 눈금자·그리드·원근 도우미. 아이소메트릭 그리드와 고급 자는 그리기 인스펙터 전용이다.",
        "canvas/canvas-rulers",
        "canvas/perspective-guide",
        "canvas/grid",
        "canvas/sticky-note"
      ),
      gap("대칭·만다라", "6종 대칭(방사·만화경 포함)이 있으나 그리기 옵션 바와 인스펙터 전용이다."),
      gap("Seamless/Wrap-around"),
    ],
    extras: [],
  },
  {
    id: "layer",
    labelKo: "레이어",
    labelEn: "Layer",
    specName: "Layer",
    inV5Spec: true,
    hintKo: {
      description: "레이어를 추가하고 순서를 바꾸고 잘라냅니다.",
      tip: "메뉴를 열면 오른쪽 패널을 먼저 펼치지 않아도 레이어 순서를 바꿀 수 있습니다.",
    },
    rows: [
      part(
        "Raster/Vector/Text/Balloon/3D/Adjustment/Material",
        "이미지(래스터) 추가만 메뉴에 있다. 나머지 레이어 종류 생성은 우패널 전용이다.",
        "layer/image",
      ),
      gap("Group/Folder"),
      part("Mask/Clipping", "클리핑 토글과 마스크 편집면 진입만. 마스크 생성·적용·반전은 인스펙터 전용이다.", "layer/clipping-mask", "layer/mask"),
      part("Reference/Draft/Lock", "나만 숨긴 레이어 복구만 있다.", "layer/reset-local-visibility"),
      gap("Smart Linked Object"),
      gap("Layer Comp"),
      gap("Merge/Flatten with Report"),
    ],
    extras: [
      ours("layer/bring-front", "레이어 · 맨 위로 — §15.3 행에 명시가 없으나 레이어가 정본 위치다."),
      ours("layer/bring-forward", "레이어 · 위로."),
      ours("layer/send-back", "레이어 · 맨 뒤로."),
      ours("layer/send-backward", "레이어 · 뒤로."),
      ours("layer/crop-layer", "레이어 자르기 — §15.3은 Canvas 의 Crop/Trim 만 정의한다."),
      ours(
        "layer/border-effect",
        "레이어 경계 효과(CSP 境界効果/fuchi) — §15.3 에 대응 행이 없다. 이미지 레이어 실루엣의 비파괴 테두리로, 레이어 탭의 경계 효과 패널을 연다(2026-08-20).",
      ),
    ],
  },
  {
    id: "select",
    labelKo: "선택",
    labelEn: "Select",
    specName: "Select",
    inV5Spec: true,
    hintKo: {
      description: "선택 도구를 고르고, 문서 전체 선택·해제·반전을 실행합니다.",
      tip: "같은 도구를 한 번 더 고르면 꺼집니다. 툴레일에도 사각·원형·올가미가 있습니다.",
    },
    rows: [
      has(
        "Rectangle/Ellipse/Lasso/Polygon",
        "select/marquee-rect",
        "select/marquee-ellipse",
        "select/lasso",
        "select/poly-lasso",
      ),
      has("Magic Wand/Color Range", "select/magic-wand", "select/color-range"),
      gap(
        "Semantic/Object Select",
        "AI 피사체 분리는 ‘레이어 분리’로 있으나 결과가 선택 영역이 아니라 레이어라 이 행을 채우지 못한다.",
      ),
      gap(
        "Expand/Shrink/Feather/Smooth",
        "확장·축소·페더는 선택 도구 패널의 슬라이더로만 있고 명령이 아니다. Smooth 는 아예 없다.",
      ),
      has("Quick Mask", "select/quick-mask"),
      gap("Save Selection", "선택 실행취소·다시실행만 있고 이름 붙인 선택 저장은 없다."),
      gap("Selection HUD", "요소 선택용 컨텍스트 바만 있고 픽셀 선택용 HUD 는 없다."),
    ],
    extras: [
      ours("select/select-all", "모두 선택 — §15.3 행에 명시가 없으나 Select 가 정본 위치다."),
      ours("select/deselect", "선택 해제."),
      ours("select/invert-selection", "선택 반전."),
    ],
  },
  {
    id: "transform",
    labelKo: "변형",
    labelEn: "Transform",
    specName: "Transform",
    inV5Spec: true,
    hintKo: { description: "선택 영역과 레이어의 크기·회전·왜곡을 다룹니다." },
    rows: [
      part("Scale/Rotate/Skew/Perspective", "선택 대상에 맞는 자유 변형 진입만. 왜곡·원근은 리터치 패널 안이다.", "transform/pixel-transform"),
      gap("Mesh Warp"),
      gap("Puppet Warp"),
      gap("Liquify", "리퀴파이는 툴레일 도구로만 있다."),
      gap("Content-aware Scale optional"),
      gap("Repeat Transform"),
      gap("Snap/Constraint"),
    ],
    extras: [],
  },
  {
    id: "brush",
    labelKo: "그리기",
    specName: "Brush",
    labelKey: "studio.mainMenu.group.draw.label",
    inV5Spec: true,
    // Wave D. The audit read 0 of 10 here, yet every feature shipped — behind a
    // right-inspector hunt. Rows below open those surfaces; the ones left absent
    // are product gaps, not routing gaps, and each says which.
    rows: [
      has("Preset Browser", "brush/preset-browser"),
      has("Brush Studio/Brush DNA", "brush/brush-studio"),
      // 한 항목은 한 행만 주장한다. 아래 셋은 조정 수단이 Brush Studio 행 안에 있을
      // 뿐 전용 행이 없으므로, 커버된 척하지 않고 위치만 기록한다.
      gap(
        "Pressure/Tilt/Velocity",
        "전용 행이 없다. 필압·틸트·속도 곡선은 브러시 스튜디오의 ‘반응’·‘입력’ 탭에 있고, 기기 캘리브레이션은 편집▸Input Device Calibration 이 담당한다.",
      ),
      gap("Stabilizer", "전용 행이 없다. 보정 강도·모드는 브러시 스튜디오와 그리기 옵션 바에 있다."),
      gap("Tip/Texture/Dual Tip", "전용 행이 없다. 촉 모양·경도·간격은 브러시 스튜디오 ‘촉’ 탭에 있고, 듀얼 팁은 편집 UI 가 없다."),
      part(
        "Natural Media/Pigment",
        "hokusai 자연매체 변환만. 안료 혼합(Kubelka-Munk) 모델은 없다.",
        "brush/natural-media",
      ),
      gap("Particle/Physics", "입자·물리 브러시 엔진 자체가 없다."),
      part(
        "Import SUT/ABR/MYB/KPP",
        "ABR·MYB·KPP·자체 JSON 만. `.sut`(CSP) 파서는 없다. MYB/KPP 는 굵기·농도·필압·촉만 옮기고 나머지는 경고로 표시한다(studio-brush-pack-import.ts).",
        "brush/import-pack",
      ),
      gap("Fidelity Lab", "hokusai 충실도 골든 테스트만 있고 작가가 여는 비교 랩은 없다."),
      gap("Team Preset Versioning", "브러시는 기기 로컬 저장이고 팀 버전 관리가 없다."),
    ],
    extras: [
      ours("brush/pen", "펜 — §15.3은 도구 활성화를 팔레트로 다루지만 메뉴에서도 1클릭이어야 한다."),
      ours("brush/eraser", "지우개."),
      ours("brush/fill", "채우기."),
      ours("brush/smart-shape", "스마트 도형 — 펜 + 도형 보정 모드."),
      ours("brush/pixel-art", "픽셀 아트 모드."),
      ours("brush/silk-flow", "실크 흐름 대칭 브러시."),
      ours(
        "brush/my-brushes",
        "내 브러시 — §15.3에 대응 행이 없다. 저장·가져오기·재적용을 한 곳에서 하는 사용자 라이브러리다.",
      ),
      ours("brush/bg", "배경 · 톤."),
      ours("brush/style", "팔레트 · 브랜드."),
    ],
  },
  {
    id: "filter",
    labelKo: "필터",
    specName: "Filter",
    inV5Spec: true,
    rows: [
      part("Adjustment Layer", "레벨·톤 커브만 레이어 파라미터라 비파괴다. 보정 레이어 개체는 없고 나머지 48개 필터는 파괴적이다.", "filter/levels", "filter/tone-curve"),
      has(
        "Color/Blur/Sharpen",
        "filter/gaussian-blur",
        "filter/motion-blur",
        "filter/hue-saturation-brightness",
        "filter/brightness-contrast",
        "filter/color-curves",
        "filter/radial-blur",
        "filter/zoom-blur",
        "filter/surface-blur",
        "filter/lens-blur",
        "filter/field-iris-blur",
        "filter/tilt-shift-blur",
        "filter/selective-gaussian-blur",
        "filter/tileable-blur",
        "filter/solarize",
        "filter/threshold",
        "filter/color-to-alpha",
        "filter/duotone",
      ),
      part(
        "Distort/Liquify",
        "웨이브·리플·어안·트월·핀치/블로트·렌즈 왜곡까지 기하 왜곡 6종이 메뉴에 있다. 리퀴파이(브러시로 미는 대화형 왜곡)만 툴레일 도구로 남아 있다.",
        "filter/glitch",
        "filter/chromatic-aberration",
        "filter/wave-warp",
        "filter/ripple-warp",
        "filter/fisheye",
        "filter/twirl",
        "filter/pinch-bloat",
        "filter/lens-distortion",
        "filter/polar-coordinates",
      ),
      has(
        "Line/Tone/Webtoon",
        "filter/line-cleanup",
        "filter/screentone-removal",
        "filter/difference-of-gaussians",
        "filter/photocopy",
        "filter/poster-edges",
      ),
      has(
        "Texture/Style",
        "filter/mosaic",
        "filter/emboss",
        "filter/oil-paint",
        "filter/scanline",
        "filter/vignette",
        "filter/lens-flare",
        "filter/noise-add",
        "filter/film-grain-pro",
        "filter/salt-pepper",
        "filter/rgb-noise",
        "filter/perlin-texture",
        "filter/pointillize",
        "filter/stained-glass",
      ),
      part(
        "Depth/Normal Effects",
        "휘도에서 노멀 맵을 굽고 광원 기준 볼류메트릭 광선을 낸다. 깊이 맵 입력이나 재조명(relight)은 없다.",
        "filter/normal-map",
        "filter/god-rays",
      ),
      gap("Filter Gallery"),
      gap("EffectGraph Editor"),
      gap("Bake/Proxy"),
    ],
    extras: [
      ours("filter/last-filter", "마지막 필터 다시 열기 — §15.3 Edit 의 ‘명령 반복’에 가까운 필터 전용판."),
      ours("filter/jpeg-artifact-reduction", "복원 계열 — §15.3 행이 없다."),
      ours("filter/edge-aware-denoise", "복원 계열."),
      ours("filter/dust-scratches", "복원 계열."),
    ],
  },
  {
    id: "vector",
    labelKo: "벡터",
    labelEn: "Vector",
    specName: "Vector",
    inV5Spec: true,
    hintKo: { description: "도형·프레임·화살표 같은 벡터 요소를 캔버스에 놓습니다." },
    rows: [
      part("Pen/Bezier/Shape", "SVG 도형·프레임 배치만. 베지어 편집은 없다.", "vector/elements"),
      gap(
        "Anchor/Width/Edit Stroke",
        "노드 편집·획 스타일 패널은 있으나 ‘draw’ 요소를 고른 상태의 인스펙터 전용이라 메뉴에서 켤 대상이 없다.",
      ),
      gap("Boolean/Offset/Trim", "패스 불리언은 도형 2개를 마퀴로 고른 인스펙터 전용이고, 오프셋 엔진은 UI 가 없다."),
      has("Vector Eraser", "vector/erase-to-intersection"),
      gap("Live Appearance"),
      gap("Pattern Along Path"),
      gap("Vectorize Raster", "래스터→패스 커널은 있으나 제품 호출자가 없다."),
    ],
    extras: [],
  },
  {
    id: "text",
    labelKo: "텍스트",
    labelEn: "Text",
    specName: "Text & Balloon",
    inV5Spec: true,
    hintKo: {
      description: "대사 텍스트와 말풍선을 추가합니다.",
      tip: "말풍선을 먼저 놓고 안쪽을 두 번 눌러 대사를 입력하세요.",
    },
    rows: [
      has("CJK Text", "text/text"),
      gap(
        "Vertical Writing/Ruby/Kinsoku",
        "세로쓰기·금칙·루비 모두 구현돼 있으나 선택한 텍스트의 인스펙터 체크박스와 대사 일괄 편집 안에만 있다.",
      ),
      gap("Paragraph/Style", "요소별 서식만 있고 이름 붙인 문단·문자 스타일 객체가 없다."),
      has("Balloon/Leader/Tail", "text/bubble"),
      has("Dialogue Link", "text/dialogue-batch"),
      part(
        "Localization Layout",
        "언어 전환·번역 메모리·말풍선 자동 맞춤에 현지화 QA(넘침 예측·영문 문체 린트·MQM 점수)까지. 로케일별 폰트/박스 오버라이드는 없다.",
        "text/dialogue-translate",
        "text/localization-qa",
      ),
      gap("Font Report", "폰트 사용·라이선스 보고서가 없다(사용자 폰트 관리 패널도 아직 미배선)."),
    ],
    extras: [],
  },
  {
    id: "comic",
    labelKo: "만화",
    labelEn: "Comic",
    specName: "Comic & Story",
    inV5Spec: true,
    hintKo: {
      description: "페이지·톤·대본·연속성까지 회차 전체를 관리합니다.",
      tip: "콜라주는 여러 칸을 한 번에 배치할 때 씁니다.",
    },
    rows: [
      part(
        "Panel/Frame Border",
        "콜라주 레이아웃만 메뉴에 있다. 칸 테두리·컷 분할 편집은 프레임을 고른 인스펙터 전용이다.",
        "comic/collage",
      ),
      part(
        "Tone/Focus/Speed Lines",
        "톤 라이브러리만. 집중선·속도선은 해당 요소를 고른 인스펙터 전용이고 하프톤은 보정 스택 안이다.",
        "comic/tone",
      ),
      has("Page Manager", "comic/page", "comic/page-sequence"),
      part(
        "Script/Shot/Panel",
        "Writer Room(대본)과 스토리보드 그리드(샷·카메라 태그)까지. 시나리오 자동 배치는 AI 팝오버 안에 남아 있다.",
        "comic/writer-room",
        "comic/storyboard",
      ),
      has("Continuity Check", "comic/continuity"),
      has("Scroll Rhythm", "comic/scroll-preview"),
      part(
        "Story Bible",
        "제작 바이블(설정·약속/회수 원장)까지. 캐릭터 바이블은 아직 프로젝트 시트 전용이다.",
        "comic/story-bible",
      ),
      has("Animatic", "comic/animatic"),
    ],
    extras: [
      ours("comic/webtoon-assistant", "웹툰 어시스턴트 도구"),
      ours("comic/ai-super-suite", "AI 슈퍼 스위트 도구"),
    ],
  },
  {
    id: "animation",
    labelKo: "애니메이션",
    labelEn: "Animation",
    specName: "Animation",
    inV5Spec: true,
    hintKo: {
      description: "타임라인·프레임 편집과 어니언 스킨을 켭니다.",
      tip: "프레임 애니메이션은 이미지 레이어를 고른 뒤 여세요.",
    },
    rows: [
      has("Timeline", "animation/timeline"),
      has("Frame/Cel", "animation/frame-anim"),
      gap("Rig/Puppet", "퍼펫 워프는 있으나 변형 도구지 애니메이션 릭이 아니다."),
      gap("State Machine"),
      has("Onion Skin", "animation/onion-skin"),
      gap("Audio/Markers", "애니매틱의 대사·효과음 큐는 마커지 오디오 트랙이 아니다. 오디오 가져오기가 없다."),
      gap("Motion Capture", "웹캠 포즈 스캐너는 VRM 포저 안의 단계라 애니메이션 명령으로 꺼낼 대상이 아니다."),
      gap(
        "Export GIF/Video/Sequence/OTIO",
        "GIF·APNG·WebM 내보내기는 프레임 애니메이션 패널 안에만 있다. 이미지 시퀀스·OTIO 는 없다.",
      ),
    ],
    extras: [],
  },
  {
    id: "3d",
    labelKo: "3D",
    labelEn: "3D",
    specName: "3D & Physics",
    inV5Spec: true,
    hintKo: {
      description: "데생 인형·3D 캐릭터·3D 배경을 불러와 각도를 잡습니다.",
      tip: "포즈를 잡은 뒤 캔버스로 굽고 그 위에 선을 따세요.",
    },
    rows: [
      gap("Scene/Outliner", "레이어 목록 탭으로 있으나 3D 배경 대화상자 안의 탭이라 메뉴가 직접 열 대상이 아니다."),
      has("VRM/Pose/Expression", "3d/mannequin3d", "3d/char", "3d/character"),
      gap("Camera/Light", "카메라·조명 스튜디오는 3D 배경 대화상자 ▸ 뷰 탭 ▸ 카메라 섹션 안에 있다."),
      part("Room Builder", "3D 배경 패널 안에서만 구성한다.", "3d/bg3d"),
      has("Sculpt", "3d/sculpt"),
      gap("Modeling/Boolean", "Hybrid DCC 패널이 있으나 3D 그룹이 아니라 툴레일·프로젝트 시트가 연다."),
      gap("Physics/Cloth/Hair", "강체 물리만 있고 천·머리카락 저작 UI 는 없다."),
      gap("3D→2D Pass", "굽기(삽입·LT 출력)는 3D 배경 대화상자 하단에 있고 메뉴 항목이 없다."),
      gap("Surface Paint", "VRM 텍스처 페인트는 3D 캐릭터 대화상자 안의 단계다."),
      gap("Camera Tracking"),
    ],
    extras: [],
  },
  {
    id: "collaboration",
    labelKo: "협업",
    labelEn: "Collaboration",
    specName: "Collaboration",
    inV5Spec: true,
    hintKo: {
      description: "공유 권한·댓글·검토 승인을 엽니다.",
      tip: "라이브 세션과 참여자 현황도 팀 패널 안에 있습니다.",
    },
    rows: [
      has("Share/Permission", "collaboration/team"),
      has("Ephemeral Board", "collaboration/ephemeral-board"),
      gap(
        "Presence/Soft Lock",
        "참여자 표시와 소프트 잠금은 동작하지만 켜고 끄는 명령이 아니라 상태다. 세션 화면은 팀 패널이 연다.",
      ),
      part("Comment/Paint-over", "댓글 스레드까지. 덧그리기(paint-over)는 없다.", "collaboration/comments"),
      gap("Proposal Branch"),
      gap("Version Compare", "리비전 비교는 체크포인트 패널 안에 있고, 그 문은 파일 ▸ 버전 체크포인트가 연다."),
      has("Approval", "collaboration/page-review"),
      gap("Review Session", "Writer Room 의 검토 화면이 근사치이며 만화 ▸ Writer Room 이 연다."),
      gap("Audit Log", "팀 활동 피드가 근사치이고 감사 로그 규격은 없다."),
    ],
    extras: [],
  },
  {
    id: "window",
    labelKo: "창",
    labelEn: "Window",
    specName: "Window",
    inV5Spec: true,
    hintKo: {
      description: "패널을 여닫고 작업공간 밀도와 보조 창을 고릅니다.",
      tip: "‘캔버스만’은 ` 키로도 바로 들어갑니다.",
    },
    rows: [
      part(
        "Workspace Profile",
        "UI 밀도 2종과 보조 창만. §15.2 프로파일 12종 전환은 메뉴 밖이다.",
        "window/density-focus",
        "window/density-full",
        "window/tools-companion",
      ),
      part(
        "Panel Docking",
        "열고 닫기만. 도킹 재배치는 없다.",
        "window/left-panel",
        "window/right-panel",
        "window/wide",
        "window/canvas-only",
      ),
      has("Quick Deck", "window/quick-access-palette"),
      part(
        "Action Bar",
        "메뉴바의 상시 명령 바 — 표시 전환과 8슬롯 사용자화(기본: 실행취소·다시실행·초안 저장·내보내기 옵션·화면 맞춤). 드래그 재배치와 구분자 편집은 없다.",
        "window/command-bar",
      ),
      part("Asset Vault", "템플릿·에셋 패널.", "window/template"),
      part("Reference Desk", "참고 이미지 창 토글(단일 행).", "window/reference-window"),
      gap("Capability Center"),
      gap("Diagnostics"),
    ],
    extras: [
      // 애플리케이션 설정 두 번째 진입점은 제거 — 단일 행은 편집 메뉴가 소유한다.
    ],
  },
  {
    id: "ai",
    labelKo: "AI",
    specName: "(§15.3 미정의 · 제품 고유)",
    inV5Spec: false,
    rows: [],
    extras: [
      ours("ai/ai-assist", "AI 어시스트 — §15.3에 대응 그룹이 없어 제품 고유 그룹으로 남긴다."),
      ours("ai/stock", "스톡 이미지."),
      ours("ai/integrations", "연동 설정."),
    ],
  },
  STUDIO_MENU_HELP_GROUP_SPEC,
]);
