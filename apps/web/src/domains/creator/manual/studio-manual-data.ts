export interface ManualSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly steps?: readonly string[];
  readonly note?: string;
}

export interface ManualArticle {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly summary: string;
  readonly keywords: readonly string[];
  readonly workspace: string;
  readonly related: readonly string[];
  readonly sections: readonly ManualSection[];
}

export const MANUAL_UPDATED = "2026-09-06";
export const MANUAL_CATEGORIES = [
  { id: "start", title: "시작하기", description: "첫 작업과 화면 구성" },
  { id: "drawing", title: "드로잉과 편집", description: "브러시 · 선택 · 레이어" },
  { id: "comic", title: "웹툰 구성", description: "대사와 소재 배치" },
  { id: "three", title: "3D 활용", description: "캐릭터와 배경" },
  { id: "output", title: "저장과 내보내기", description: "원고 보호와 결과물 확인" },
  { id: "help", title: "찾아보기와 문제 해결", description: "단축키 · 진단 · 복구" },
] as const;

/** Original Korean reference copy, checked against the existing Studio help and source.
 * Keep this data independent of editor/renderer imports: reading must never boot a canvas.
 */
export const MANUAL_ARTICLES: readonly ManualArticle[] = [
  {
    id: "getting-started", category: "start", title: "첫 웹툰 작업 시작하기",
    summary: "캔버스를 준비하고 한 컷을 그린 뒤, 저장과 내보내기를 확인하는 기본 순서입니다.",
    keywords: ["입문", "처음", "새 문서", "튜토리얼", "quick start", "canvas"], workspace: "/studio",
    related: ["workspace", "brushes", "save-recovery", "export"],
    sections: [
      { id: "prepare", title: "시작 전 준비", paragraphs: ["스튜디오를 열고 작업할 캔버스를 준비합니다. 원고 크기는 게시할 곳의 현재 업로드 안내를 먼저 확인하세요. 매뉴얼의 작업 순서는 연습용이며 특정 플랫폼의 규격을 보증하지 않습니다.", "처음에는 작은 연습 문서로 도구와 저장 동작을 익히세요. 브라우저나 기기에 따라 일부 3D·렌더링 기능의 사용 가능 여부가 달라질 수 있습니다."] },
      { id: "first-panel", title: "한 컷을 완성하는 순서", paragraphs: [], steps: ["브러시 도구(B)를 선택하고 작은 크기로 시험선을 그립니다.", "러프와 선화를 서로 다른 레이어로 나누고 이름을 붙입니다.", "채우기 도구(G)로 밑색을 넣고, 새 레이어에서 명암을 추가합니다.", "텍스트 도구(T)로 짧은 대사를 넣고 축소한 화면에서 읽기 순서를 확인합니다.", "저장 상태를 확인한 뒤 이미지를 내보내고, 내려받은 파일을 별도로 열어 봅니다."], note: "이미지 내보내기와 편집 가능한 원본 저장은 다릅니다. 이미지만 남기면 레이어나 객체를 그대로 되살리지 못할 수 있습니다." },
      { id: "next", title: "이후에 익힐 기능", paragraphs: ["먼저 화면 이동과 확대, 실행 취소를 익히면 작업 중 길을 잃기 어렵습니다. 그다음 브러시, 레이어, 소재, 3D 순서로 필요한 기능을 확장하세요.", "이 페이지는 프로그램 조작을 찾아보는 매뉴얼입니다. 연출·스토리·작화 이론을 배우는 제작 강좌와는 목적이 다릅니다."] },
    ],
  },
  {
    id: "workspace", category: "start", title: "화면 구성과 작업 공간",
    summary: "도구 레일, 캔버스, 속성 패널의 역할과 화면 이동 방법을 알아봅니다.",
    keywords: ["인터페이스", "UI", "패널", "확대", "이동", "zoom", "pan", "workspace"], workspace: "/studio",
    related: ["getting-started", "shortcuts", "troubleshooting"],
    sections: [
      { id: "regions", title: "화면의 주요 영역", paragraphs: ["도구 레일에서는 그리기·선택·채우기·텍스트 같은 작업 도구를 고릅니다. 중앙 캔버스는 실제 원고를 편집하는 영역입니다.", "레이어와 속성 패널에서는 선택한 대상의 설정을 바꿉니다. 같은 패널이라도 선택한 도구나 3D 객체에 따라 보이는 설정이 달라질 수 있습니다."] },
      { id: "navigation", title: "캔버스 이동과 확대", paragraphs: [], steps: ["Space를 누른 채 드래그해 캔버스 화면을 이동합니다.", "Ctrl 또는 ⌘와 + / −로 확대·축소합니다. Ctrl 또는 ⌘와 0은 화면에 맞추기입니다.", "실제 객체를 옮길 때는 선택 도구(V)를 사용합니다. 화면 이동과 객체 이동을 구분하세요."], note: "단축키는 기본 설정 기준입니다. 입력란에 글을 쓰는 중이거나 단축키를 바꿨다면 도구 전환이 다르게 동작할 수 있습니다." },
      { id: "help", title: "원하는 기능 찾기", paragraphs: ["도움말의 명령·속성 통합 검색(F1)에서 기능 이름을 찾습니다. 다른 프로그램의 이름이 익숙하다면 CSP·Photoshop 용어 찾기를 사용하세요.", "작업을 보면서 매뉴얼을 읽으려면 도움말의 사용자 매뉴얼을 엽니다. 새 탭으로 열리므로 기존 편집 탭은 그대로 남습니다."] },
    ],
  },
  {
    id: "brushes", category: "drawing", title: "브러시와 지우개",
    summary: "브러시 선택, 크기 조절, 혼색과 시험 획을 통한 품질 확인 방법입니다.",
    keywords: ["펜", "붓", "필압", "스머지", "문지르기", "혼색", "brush", "eraser", "smudge", "wet mix"], workspace: "/studio/brushes",
    related: ["layers", "selection-fill", "filters", "troubleshooting"],
    sections: [
      { id: "basics", title: "기본 조작", paragraphs: [], steps: ["브러시(B) 또는 지우개(E)를 고릅니다.", "브러시 목록에서 원하는 표현을 선택하고 [ / ]로 크기를 조절합니다.", "짧은 선, 긴 곡선, 겹쳐 칠하기를 시험해 굵기와 불투명도를 확인합니다.", "필압이 필요한 브러시는 실제 펜 입력에서 시험합니다. 마우스만으로 필압 반응을 판단하지 마세요."] },
      { id: "mix", title: "혼색과 자연스러운 표현", paragraphs: ["혼색 도구(N)와 젖은 혼색(Shift+N)은 일반적인 덧칠과 결과가 다를 수 있습니다. 작은 영역에서 먼저 색이 섞이는 방식을 확인하세요.", "브러시 크기, 간격, 불투명도 등 여러 설정을 동시에 바꾸기보다 한 항목씩 바꿔 비교하면 원하는 표현을 찾기 쉽습니다."], note: "브러시별 엔진과 지원 설정이 같지는 않습니다. 사용할 수 없는 항목은 화면에 표시된 이유를 확인하고, 모든 기기에서 동일한 효과가 나온다고 가정하지 마세요." },
      { id: "reliable", title: "작업이 느려지거나 획이 끊길 때", paragraphs: ["먼저 작업을 보존한 뒤 작은 크기의 기본 브러시로 같은 동작을 비교합니다. 특정 브러시에서만 재현되는지, 모든 도구에서 느린지 구분하세요.", "반복 적용이나 빠른 도구 전환을 멈추고 완료 상태를 확인합니다. 문제가 반복되면 브러시 이름과 크기, 레이어 상태를 함께 기록해 진단 자료를 만드세요."] },
    ],
  },
  {
    id: "selection-fill", category: "drawing", title: "선택 영역과 채우기",
    summary: "객체 선택과 픽셀 선택을 구분하고, 밑색이 새는 문제를 확인합니다.",
    keywords: ["올가미", "레이소", "버킷", "페인트", "퀵 마스크", "틈", "lasso", "bucket", "fill", "quick mask"], workspace: "/studio",
    related: ["brushes", "layers", "shortcuts"],
    sections: [
      { id: "selection", title: "무엇을 선택했는지 확인하기", paragraphs: ["객체 선택은 텍스트·이미지 등의 대상을 옮기거나 편집할 때 사용합니다. 픽셀 선택 영역은 칠하거나 지울 범위를 제한하는 데 사용합니다.", "선택 도구(V)에서 객체를 클릭하고, 여러 객체는 Shift를 누른 채 클릭합니다. 픽셀 선택을 해제하는 기본 단축키는 Ctrl/⌘+D입니다."] },
      { id: "fill", title: "밑색 채우기", paragraphs: [], steps: ["선화가 닫혀 있는지, 현재 레이어가 의도한 채색 대상인지 확인합니다.", "채우기(G)를 선택하고 원하는 색으로 작은 영역부터 채웁니다.", "색이 밖으로 새면 선의 틈과 선택 영역을 확인하고 사용 가능한 틈 닫기 설정을 조절합니다.", "확대해 경계의 흰 틈이나 불필요한 번짐을 확인합니다."], note: "틈 닫기가 모든 열린 선을 자동 복구하는 것은 아닙니다. 원본을 보존하고 큰 틈은 직접 수정하세요." },
      { id: "mask", title: "선택이 이상하게 느껴질 때", paragraphs: ["일부 영역만 그려진다면 남아 있는 픽셀 선택이나 마스크를 먼저 확인합니다. 퀵 마스크(Q)와 일반 선택 상태도 구분하세요.", "레이어 잠금, 표시 여부, 불투명도를 점검한 다음 다시 시험하면 도구 자체의 문제와 문서 상태를 구분할 수 있습니다."] },
    ],
  },
  {
    id: "layers", category: "drawing", title: "레이어와 비파괴 편집",
    summary: "러프·선화·색·대사를 분리하고 원본을 보존하며 편집하는 방법입니다.",
    keywords: ["레이어", "잠금", "불투명도", "합성", "순서", "layer", "opacity", "blend"], workspace: "/studio",
    related: ["selection-fill", "lettering", "filters", "save-recovery"],
    sections: [
      { id: "organize", title: "역할별로 나누기", paragraphs: ["러프, 선화, 밑색, 명암, 대사를 분리하고 알아보기 쉬운 이름을 붙입니다. 나중에 고칠 부분을 찾는 시간을 줄일 수 있습니다.", "큰 변경을 하기 전에는 대상 레이어나 문서의 복사본을 남겨 비교하세요. 실행 취소 기록만을 장기 백업으로 사용하지 마세요."] },
      { id: "check", title: "선택한 레이어 점검", paragraphs: [], steps: ["편집하려는 레이어가 실제로 선택되었는지 확인합니다.", "숨김·잠금 상태와 불투명도를 확인합니다.", "앞뒤 순서가 바뀌어 다른 객체에 가려진 것은 아닌지 확인합니다.", "픽셀 선택 영역이나 마스크가 남아 있는지 확인한 뒤 시험 획을 그립니다."] },
      { id: "preserve", title: "합치기 전 주의", paragraphs: ["레이어를 합치거나 결과를 이미지로 굳히면 이후 수정 가능한 범위가 줄어들 수 있습니다. 수정할 원본과 배포할 결과물을 따로 보관하세요.", "필터 적용 전후를 비교할 때는 같은 확대율에서 확인하고, 투명한 가장자리도 함께 점검합니다."] },
    ],
  },
  {
    id: "lettering", category: "comic", title: "텍스트와 말풍선",
    summary: "대사를 배치하고, 읽기 순서와 최종 이미지에서의 가독성을 확인합니다.",
    keywords: ["대사", "글자", "말풍선", "폰트", "행간", "text", "balloon", "lettering"], workspace: "/studio/comic",
    related: ["layers", "assets", "export"],
    sections: [
      { id: "dialogue", title: "대사 배치 순서", paragraphs: [], steps: ["텍스트 도구(T)를 선택하고 대사를 입력합니다.", "대사의 길이에 맞춰 글자 크기와 줄바꿈을 조절합니다.", "말풍선과 글자의 여백을 확보하고 인물이나 중요한 표정을 가리지 않게 배치합니다.", "세로로 읽어 보며 말풍선 순서와 컷 사이의 흐름을 확인합니다."] },
      { id: "readable", title: "작업 화면과 독자 화면 비교", paragraphs: ["확대한 편집 화면에서 잘 보이는 글자가 휴대전화 크기에서도 잘 읽히는 것은 아닙니다. 축소한 화면과 실제 내보낸 이미지에서 다시 확인하세요.", "다른 기기에서 열 때 글꼴이 달라질 수 있으므로 최종 결과물을 확인합니다. 외부 글꼴은 상업 이용과 배포 조건도 따로 확인하세요."] },
      { id: "editing", title: "대사 편집 중 단축키", paragraphs: ["글을 입력하는 동안은 키 입력이 텍스트에 사용됩니다. 도구 단축키를 누르기 전에 텍스트 편집을 마치고 캔버스로 초점을 옮기세요.", "원본 대사를 수정할 계획이라면 텍스트를 편집 가능한 상태로 보관하고, 이미지로 변환한 결과만 남기지 마세요."] },
    ],
  },
  {
    id: "assets", category: "comic", title: "소재와 템플릿 활용",
    summary: "소재를 찾고 배치한 뒤 해상도, 투명도, 출처와 이용 조건을 확인합니다.",
    keywords: ["에셋", "소재", "템플릿", "이미지", "배경", "asset", "template", "material"], workspace: "/studio",
    related: ["layers", "background-3d", "export"],
    sections: [
      { id: "choose", title: "용도에 맞는 소재 찾기", paragraphs: ["소재 선택 화면에서 필요한 종류를 검색하고 미리보기를 확인합니다. 장식, 배경, 참고용 모델처럼 원고에서 맡을 역할을 먼저 정하면 고르기 쉽습니다.", "목록에 보이는 미리보기와 원본 파일의 크기·세부 표현은 다를 수 있습니다. 실제 배치 결과로 판단하세요."] },
      { id: "place", title: "배치 후 확인 순서", paragraphs: [], steps: ["원본 비율을 유지한 채 크기를 조절합니다.", "확대해 가장자리, 투명 배경, 잘림과 흐림을 확인합니다.", "인물과 배경의 시점, 빛 방향, 선 굵기를 비교합니다.", "소재 레이어를 분리하고 내보내기 결과에서도 정상 표시되는지 확인합니다."] },
      { id: "license", title: "이용 조건과 출처", paragraphs: ["각 소재의 라이선스와 출처를 확인합니다. 외부에서 가져온 파일은 상업 이용, 수정, 재배포 조건이 서로 다를 수 있습니다.", "무료 또는 유료라는 표시만으로 모든 용도의 사용이 허용되는 것은 아닙니다. 필요한 경우 원본 파일과 함께 이용 조건을 보관하세요."] },
    ],
  },
  {
    id: "character-3d", category: "three", title: "3D 캐릭터와 포즈",
    summary: "캐릭터 셰이퍼에서 구도를 잡고, 지원 범위와 결과물을 확인하는 순서입니다.",
    keywords: ["인체", "마네킹", "셰이퍼", "의상", "VRM", "포즈", "poser", "character"], workspace: "/studio/character",
    related: ["background-3d", "assets", "troubleshooting"],
    sections: [
      { id: "setup", title: "캐릭터 작업 시작", paragraphs: [], steps: ["캐릭터 셰이퍼 작업 공간을 엽니다.", "모델과 프리셋을 고른 뒤 얼굴·체형·의상 등 사용 가능한 항목을 조절합니다.", "포즈를 고르고 손, 관절, 의상의 겹침을 여러 방향에서 확인합니다.", "카메라 구도를 정한 뒤 캔버스 삽입 또는 내보내기 결과를 확인합니다."], note: "모든 모델이 모든 프리셋이나 의상 항목을 지원하지는 않습니다. 비활성 항목의 이유와 내보내기 화면의 제한 안내를 확인하세요." },
      { id: "pose", title: "포즈와 카메라 구분", paragraphs: ["포즈는 인물의 관절 배치이고 카메라는 인물을 보는 위치입니다. 원하는 실루엣을 만든 뒤 카메라를 조절하면 수정의 원인을 파악하기 쉽습니다.", "손과 소품의 접촉, 발의 접지, 옷과 몸의 관통을 확대해 살핍니다. 한 방향의 미리보기만으로 완성도를 판단하지 마세요."] },
      { id: "capture", title: "사진·웹캠 참고 기능", paragraphs: ["사진이나 웹캠을 사용하는 기능은 화면의 권한 요청과 처리 안내를 먼저 확인합니다. 촬영 대상의 동의를 얻고 불필요한 개인 정보가 함께 담기지 않게 하세요.", "추정한 포즈는 수동으로 검토해야 합니다. 손이나 관절이 가려진 장면에서는 기대한 포즈와 차이가 날 수 있으며, 작업이 끝나면 카메라 사용을 종료합니다."] },
    ],
  },
  {
    id: "background-3d", category: "three", title: "3D 배경과 선화 활용",
    summary: "배경의 카메라와 배치를 조절하고, 원고에 어울리는 선화·이미지를 확인합니다.",
    keywords: ["건축", "교실", "카메라", "원근", "선화 추출", "3d", "background", "line art"], workspace: "/studio/bg3d",
    related: ["character-3d", "assets", "filters"],
    sections: [
      { id: "compose", title: "배경 구도 잡기", paragraphs: [], steps: ["3D 배경 작업 공간에서 장면이나 지원되는 모델을 선택합니다.", "카메라 높이와 시점을 먼저 정하고 주요 객체를 배치합니다.", "이동·회전·크기 조절 후 바닥과 물체의 접촉을 확인합니다.", "인물을 함께 사용할 경우 눈높이와 원근이 맞는지 비교합니다."] },
      { id: "line", title: "선화와 원고 비교", paragraphs: ["선화 추출 또는 이미지 출력 설정에서 제공하는 옵션을 조절합니다. 원고의 인물 선과 배경 선이 서로 과도하게 경쟁하지 않도록 굵기와 밀도를 비교하세요.", "출력된 결과를 확대해 작은 틈, 겹친 선, 투명 영역의 테두리를 확인합니다. 필요한 보정은 원본 3D 장면과 분리된 레이어에서 진행하세요."] },
      { id: "formats", title: "파일과 성능의 제한", paragraphs: ["가져오기 화면에 표시된 지원 형식을 기준으로 사용하세요. 확장자가 같아도 모델의 재질·텍스처·구조에 따라 결과가 다를 수 있습니다.", "복잡한 장면이 느리다면 작업을 보존하고 표시 객체나 품질을 줄여 비교합니다. 변환 중에는 추가 작업을 반복 실행하기보다 완료 또는 오류 상태를 먼저 확인하세요."] },
    ],
  },
  {
    id: "filters", category: "drawing", title: "필터와 보정",
    summary: "필터의 대상과 강도를 확인하고, 원본과 비교하며 안전하게 적용합니다.",
    keywords: ["블러", "색보정", "비네팅", "효과", "취소", "filter", "blur", "FX"], workspace: "/studio",
    related: ["layers", "brushes", "troubleshooting"],
    sections: [
      { id: "prepare", title: "적용 전 확인", paragraphs: ["필터가 선택 레이어에 적용되는지, 전체 결과에 적용되는지 확인합니다. 원본을 남긴 뒤 작은 강도로 시작하세요.", "미리보기와 실제 적용 결과가 항상 같은 조건에서 계산되는 것은 아닙니다. 적용 후에도 가장자리와 투명 영역을 확인합니다."] },
      { id: "compare", title: "비교하면서 적용", paragraphs: [], steps: ["원본 레이어나 문서의 복사본을 준비합니다.", "필터 하나를 선택하고 낮은 강도부터 조절합니다.", "같은 확대율에서 적용 전후를 비교합니다.", "작업 완료 상태를 확인한 뒤 다음 필터를 적용합니다.", "최종 내보낸 이미지의 색과 테두리도 확인합니다."] },
      { id: "cancel", title: "오래 걸리거나 오류가 날 때", paragraphs: ["처리 중에는 적용 버튼을 반복해서 누르지 마세요. 취소 기능이 표시되면 취소 후 안정된 상태로 돌아왔는지 확인합니다.", "오류가 반복되면 필터 이름, 설정값, 원고 크기와 재현 순서를 기록합니다. 브라우저 저장 데이터를 지우기 전에 반드시 작업 복사본을 확보하세요."] },
    ],
  },
  {
    id: "save-recovery", category: "output", title: "저장·백업·복구",
    summary: "로컬 저장과 백업의 차이, 작업을 잃지 않기 위한 확인 절차입니다.",
    keywords: ["자동저장", "복원", "복구", "백업", "원본", "저장 실패", "save", "backup", "recovery"], workspace: "/studio",
    related: ["export", "troubleshooting", "layers"],
    sections: [
      { id: "save", title: "저장 상태를 직접 확인하기", paragraphs: ["저장 중, 완료, 실패 같은 화면의 상태를 확인한 뒤 탭을 닫습니다. 자동 저장이 있다는 이유만으로 모든 변경이 이미 보존되었다고 가정하지 마세요.", "브라우저 안에 남는 작업 데이터와 계정·서버에 저장되는 데이터는 서로 다를 수 있습니다. 현재 사용 중인 저장 방식과 로그인 상태를 확인하세요."], note: "시크릿 모드, 사이트 데이터 삭제, 저장 공간 부족, 브라우저 프로필 변경은 로컬 데이터에 영향을 줄 수 있습니다. 로컬 저장만을 유일한 백업으로 사용하지 마세요." },
      { id: "backup", title: "중요 작업의 보존 순서", paragraphs: [], steps: ["문서를 닫기 전에 저장 완료 여부를 확인합니다.", "화면에서 제공하는 원본 저장·다운로드 방식으로 별도 복사본을 만듭니다.", "이미지 결과물도 내보내 시각적 상태를 확인합니다.", "원래 작업을 덮어쓰지 않는 환경에서 복사본을 열어 내용이 맞는지 확인합니다."], note: "이미지 파일만으로는 레이어·편집 객체·3D 설정이 복구되지 않을 수 있습니다." },
      { id: "recover", title: "복구가 필요할 때", paragraphs: ["먼저 원래 사용하던 브라우저와 프로필로 접속합니다. 도움말의 복구 가이드에서 남아 있는 저장 데이터와 가능한 조치를 확인하세요.", "복구 가능 여부를 확인하기 전에 저장소 초기화나 사이트 데이터 삭제를 하지 마세요. 복구본을 열었다면 내용을 확인한 뒤 새로운 복사본으로 보관합니다."] },
    ],
  },
  {
    id: "export", category: "output", title: "이미지 내보내기와 게시 준비",
    summary: "편집 원본과 배포 이미지를 구분하고 크기·잘림·색·텍스트를 최종 확인합니다.",
    keywords: ["PNG", "JPEG", "WebP", "다운로드", "분할", "업로드", "게시", "export", "publish"], workspace: "/studio/publish",
    related: ["save-recovery", "lettering", "assets"],
    sections: [
      { id: "format", title: "원본과 결과물 구분", paragraphs: ["계속 수정할 편집 원본과 독자에게 보여 줄 이미지 결과물을 따로 보관합니다. 내보내기 화면에서 현재 제공하는 형식, 투명 배경, 품질 설정을 확인하세요.", "지원 형식과 게시 규격은 작업 종류와 게시처에 따라 다릅니다. 특정 픽셀 크기를 모든 웹툰 플랫폼의 공통 규격으로 사용하지 마세요."] },
      { id: "review", title: "내보낸 파일 검수", paragraphs: [], steps: ["현재 문서를 먼저 저장합니다.", "필요한 형식과 이미지 크기를 선택해 내보냅니다.", "다운로드한 파일을 별도로 열어 잘림·투명 영역·글꼴을 확인합니다.", "분할 원고라면 파일 순서와 경계에서 내용이 끊기지 않는지 확인합니다.", "최종 게시 화면의 미리보기와 현재 업로드 제한을 확인합니다."] },
      { id: "publish", title: "게시 전 점검", paragraphs: ["대사 오탈자와 개인정보 노출, 소재·글꼴의 이용 조건을 확인합니다. 썸네일과 본문 이미지가 뒤섞이지 않았는지도 확인하세요.", "업로드 완료와 실제 게시 완료는 다른 단계일 수 있습니다. 화면의 상태와 게시 결과를 확인하고, 오류가 난 경우 같은 게시물을 반복 생성하지 않도록 주의합니다."] },
    ],
  },
  {
    id: "shortcuts", category: "help", title: "기본 단축키 찾아보기",
    summary: "자주 쓰는 기본 조작과 입력 초점, 사용자 설정에 따른 차이를 확인합니다.",
    keywords: ["키보드", "키맵", "실행 취소", "되돌리기", "shortcut", "keyboard", "undo", "F1"], workspace: "/studio",
    related: ["workspace", "brushes", "selection-fill"],
    sections: [
      { id: "platform", title: "키 표기를 읽는 방법", paragraphs: ["아래 표는 기본 단축키의 일부입니다. Ctrl/⌘는 Windows·Linux에서는 Ctrl, macOS에서는 Command 키를 뜻합니다.", "스튜디오의 단축키 도움말(?)에서는 더 많은 조작과 사용자 설정을 확인할 수 있습니다. 매뉴얼은 다른 탭의 사용자 지정 키맵을 읽거나 변경하지 않습니다."] },
      { id: "focus", title: "단축키가 동작하지 않을 때", paragraphs: [], steps: ["텍스트나 검색 입력란을 편집 중인지 확인합니다.", "편집 중인 입력을 마치고 캔버스에 초점을 옮깁니다.", "사용자 지정 단축키와 브라우저 자체 단축키가 겹치는지 확인합니다.", "도움말의 단축키 화면과 명령·속성 통합 검색에서 해당 기능을 찾습니다."] },
      { id: "manual-search", title: "이 매뉴얼에서 검색", paragraphs: ["매뉴얼에서는 / 키로 검색창으로 이동할 수 있습니다. 검색창에서 Escape를 누르면 검색어를 지웁니다.", "기능 이름이나 익숙한 용어로 검색하세요. 예를 들어 스머지, 버킷, backup 같은 별칭도 검색에 포함됩니다."] },
    ],
  },
  {
    id: "troubleshooting", category: "help", title: "오류 진단과 문제 해결",
    summary: "작업 보존을 우선으로, 재현 조건을 좁히고 진단 자료를 준비합니다.",
    keywords: ["에러", "멈춤", "느림", "브라우저", "검은 화면", "필압", "진단", "버그", "error", "crash", "diagnostics"], workspace: "/studio",
    related: ["save-recovery", "brushes", "filters", "character-3d"],
    sections: [
      { id: "protect", title: "가장 먼저 작업 보존", paragraphs: ["저장 상태를 확인하고 가능한 복사본을 확보합니다. 저장에 실패했다면 원래 탭을 유지한 채 복구 가이드의 안내를 확인하세요.", "데이터 삭제·저장소 초기화·확인되지 않은 복구 명령을 첫 조치로 사용하지 마세요. 문제를 해결하려다 남아 있는 원고를 지울 수 있습니다."] },
      { id: "isolate", title: "증상별 확인 순서", paragraphs: [], steps: ["안 그려짐: 선택 레이어, 잠금, 표시 여부, 불투명도, 픽셀 선택 영역을 확인합니다.", "브러시 지연: 작은 기본 브러시와 작은 연습 문서에서 같은 동작을 비교합니다.", "필터 오류: 필터 이름·강도·원고 크기·재현 순서를 기록합니다.", "3D 표시 오류: 기기·브라우저 진단과 해당 모델의 지원 안내를 확인합니다.", "저장 실패: 저장 공간과 현재 저장 방식, 로그인·연결 상태를 확인합니다."] },
      { id: "report", title: "진단 자료와 버그 제보", paragraphs: ["도움말에서 기기·브라우저 진단과 버그 리포트 패키지를 엽니다. 직접 확인하지 못한 항목은 추측해서 채우지 말고 확인 불가로 남깁니다.", "버그를 제보할 때 기대한 결과, 실제 결과, 재현 순서와 빈도를 함께 적습니다. 첨부 전 원고, 계정 정보, 사적인 이미지가 포함되지 않았는지 직접 검토하세요."], note: "이 매뉴얼은 진단이나 복구 작업을 자동으로 실행하지 않습니다. 실행이 필요한 조치는 스튜디오의 해당 화면에서 상태와 영향을 확인한 뒤 진행하세요." },
    ],
  },
];

/** Verified subset of StudioShortcutsHelp.tsx; these are defaults, not the user's live keymap. */
export const MANUAL_SHORTCUTS = [
  { keys: "B / E", action: "브러시 / 지우개" },
  { keys: "[ / ]", action: "브러시 크기 줄이기 / 늘리기" },
  { keys: "N / Shift+N", action: "혼색 / 젖은 혼색" },
  { keys: "V", action: "객체 선택" },
  { keys: "G", action: "채우기" },
  { keys: "T", action: "텍스트" },
  { keys: "Q", action: "퀵 마스크" },
  { keys: "Ctrl/⌘+D", action: "픽셀 선택 해제" },
  { keys: "Ctrl/⌘+Z", action: "실행 취소" },
  { keys: "Ctrl/⌘+Shift+Z", action: "다시 실행" },
  { keys: "Space + 드래그", action: "캔버스 화면 이동" },
  { keys: "Ctrl/⌘+0", action: "화면에 맞추기" },
  { keys: "F1", action: "명령·속성 통합 검색" },
  { keys: "?", action: "단축키 도움말" },
] as const;
