/** Searchable metadata shared by the smart-filter catalog and Motion Coach hints. */
import { matchesStudioToolSearch, studioToolSearchTerms } from "../studio-tool-search";

import { STUDIO_FILTER_ALL_LABELS } from "./studio-filter-pack-registry";

import type { StudioFilterKind } from "./studio-filter-menu";

export type StudioFilterCatalogGroup =
  | "blur"
  | "tone"
  | "color"
  | "detail"
  | "repair"
  | "stylize"
  | "light"
  | "transform"
  | "texture";

export type StudioFilterCatalogEntry = {
  engine: string;
  title: string;
  description: string;
  group: StudioFilterCatalogGroup;
  keywords: readonly string[];
};

export type StudioFilterPreviewKind =
  | "soft-blur"
  | "motion"
  | "radial"
  | "tone"
  | "spectrum"
  | "curve"
  | "mosaic"
  | "channels"
  | "glitch"
  | "scanline"
  | "vignette"
  | "flare"
  | "relief"
  | "solarize"
  | "threshold"
  | "paint"
  | "duotone"
  | "noise"
  | "warp"
  | "grain"
  | "dots"
  | "glass"
  | "edges"
  | "normal"
  | "rays"
  | "transform";

export type StudioFilterDialogCatalogEntry = StudioFilterCatalogEntry & {
  /** Dialog kind that can be previewed and applied through StudioFilterDialog. */
  kind: StudioFilterKind;
  /** Original, deterministic CSS preview family. Never references a remote image or asset. */
  preview: StudioFilterPreviewKind;
};

export type StudioFilterPreviewStyle = {
  background: string;
  backgroundSize?: string;
  filter?: string;
};

export const STUDIO_FILTER_CATALOG: readonly StudioFilterCatalogEntry[] = [
  {
    engine: "gaussian-blur",
    title: "가우시안 블러",
    description: "픽셀을 고르게 퍼뜨려 배경·그림자를 부드럽게 흐립니다.",
    group: "blur",
    keywords: ["gaussian", "blur", "흐림", "소프트"],
  },
  {
    engine: "motion-blur",
    title: "모션 블러",
    description: "지정한 각도로 선형 잔상을 만들어 속도와 이동감을 냅니다.",
    group: "blur",
    keywords: ["motion", "blur", "속도", "잔상", "방향"],
  },
  {
    engine: "spin-blur",
    title: "회전 블러",
    description: "화면 중심을 축으로 원형 잔상을 만들어 회전·충격·현기증을 표현합니다.",
    group: "blur",
    keywords: ["spin", "radial", "blur", "회전", "방사형", "원형", "잔상"],
  },
  {
    engine: "zoom-blur",
    title: "줌 블러",
    description: "화면 중심에서 바깥으로 뻗는 방사 잔상으로 돌진과 집중 효과를 만듭니다.",
    group: "blur",
    keywords: ["zoom", "radial", "blur", "줌", "방사형", "돌진", "집중"],
  },
  {
    engine: "lens-blur",
    title: "렌즈 블러",
    description: "다각형 조리개 샘플링으로 사진 렌즈 같은 보케와 부드러운 심도를 만듭니다.",
    group: "blur",
    keywords: ["lens blur", "bokeh", "aperture", "렌즈 블러", "보케", "조리개"],
  },
  {
    engine: "field-iris-blur",
    title: "영역 초점 블러",
    description: "초점 중심과 반경을 유지하고 바깥 영역만 조리개 모양으로 점진적으로 흐립니다.",
    group: "blur",
    keywords: ["필드 아이리스 블러", "field blur", "iris blur", "focus", "필드 블러", "아이리스", "초점", "심도"],
  },
  {
    engine: "tilt-shift-blur",
    title: "틸트 시프트 블러",
    description: "회전 가능한 초점 띠 바깥을 흐려 미니어처·원근 강조 효과를 만듭니다.",
    group: "blur",
    keywords: ["tilt shift", "miniature", "focus band", "틸트 시프트", "미니어처", "초점 띠"],
  },
  {
    engine: "selective-gaussian-blur",
    title: "선택적 가우시안 블러",
    description: "색 경계를 보호하면서 평탄한 영역의 작은 요철과 노이즈만 가우시안으로 고릅니다.",
    group: "blur",
    keywords: ["selective gaussian", "bilateral", "edge aware", "선택적 가우시안", "경계 보호", "평활"],
  },
  {
    engine: "tileable-blur",
    title: "이음매 없는 블러",
    description: "반대편 가장자리를 이어 샘플링해 배경·패턴 소재의 이음매를 부드럽게 없앱니다.",
    group: "blur",
    keywords: ["타일러블 블러", "tileable blur", "seamless", "wrap", "타일러블 블러", "이음매", "반복 소재"],
  },
  {
    engine: "blur",
    title: "빠른 블러",
    description: "가벼운 박스 블러로 빠르게 흐림을 더합니다.",
    group: "blur",
    keywords: ["box", "blur", "흐림", "빠른"],
  },
  {
    engine: "curves",
    title: "색상 곡선",
    description: "톤 커브 프리셋으로 명암 응답과 대비를 정밀하게 잡습니다.",
    group: "tone",
    keywords: ["curve", "curves", "커브", "톤", "대비"],
  },
  {
    engine: "levels",
    title: "레벨",
    description: "입력·출력 검정점, 흰점과 감마로 명암 범위를 보정합니다.",
    group: "tone",
    keywords: ["levels", "black", "white", "gamma", "레벨", "감마"],
  },
  {
    engine: "brightness-contrast",
    title: "밝기 / 대비",
    description: "전체 밝기와 대비를 한 번에 조절합니다.",
    group: "tone",
    keywords: ["brightness", "contrast", "명도", "밝기", "대비"],
  },
  {
    engine: "shadow-highlight",
    title: "섀도우/하이라이트",
    description: "어두운 영역을 밝히고 날아간 밝은 영역을 되살리며 미드톤 대비를 함께 다듬습니다.",
    group: "tone",
    keywords: ["shadow", "highlight", "섀도우", "하이라이트", "역광", "명암 복구", "톤 범위"],
  },
  {
    engine: "exposure",
    title: "노출 / 감마 / 오프셋",
    description: "스톱 단위 노출, 중간톤 감마와 선형 오프셋을 함께 조정합니다.",
    group: "tone",
    keywords: ["exposure", "gamma", "offset", "노출", "감마", "오프셋", "ev"],
  },
  {
    engine: "posterize",
    title: "포스터화",
    description: "채널 계조 수를 제한해 셀 채색과 그래픽 포스터 같은 색면을 만듭니다.",
    group: "stylize",
    keywords: ["posterize", "poster", "포스터", "계조", "양자화", "셀 채색"],
  },
  {
    engine: "solarize",
    title: "솔라리제이션",
    description: "밝은 채널을 임계점부터 부분 반전해 초현실적인 필름 톤을 만듭니다.",
    group: "stylize",
    keywords: ["solarize", "solarization", "솔라리제이션", "부분 반전", "필름"],
  },
  {
    engine: "hue-saturation",
    title: "색조 / 채도",
    description: "색상 회전과 채도를 조절합니다.",
    group: "color",
    keywords: ["hue", "saturation", "색조", "채도", "hsl"],
  },
  {
    engine: "color-balance",
    title: "색 균형",
    description: "그림자·중간톤·하이라이트의 색 기운을 프리셋으로 조절합니다.",
    group: "color",
    keywords: ["color balance", "색 균형", "컬러 밸런스", "shadow", "highlight"],
  },
  {
    engine: "channel-mixer",
    title: "채널 믹서",
    description: "RGB 채널 기여도를 교차 조절해 흑백 변환과 채널 룩을 만듭니다.",
    group: "color",
    keywords: ["channel mixer", "채널", "믹서", "rgb", "monochrome", "흑백"],
  },
  {
    engine: "gradient-map",
    title: "그라디언트 맵",
    description: "명암을 다색 그라디언트에 매핑해 통일된 스타일 색감을 만듭니다.",
    group: "color",
    keywords: ["gradient map", "그라디언트", "듀오톤", "색상화"],
  },
  {
    engine: "grayscale",
    title: "그레이스케일",
    description: "색상 정보를 휘도로 변환해 중립적인 흑백 명암으로 정리합니다.",
    group: "color",
    keywords: ["grayscale", "monochrome", "gray", "그레이", "흑백", "무채색"],
  },
  {
    engine: "sepia",
    title: "세피아",
    description: "갈색 계열의 고전 사진 색감으로 회상과 과거 장면을 연출합니다.",
    group: "color",
    keywords: ["sepia", "세피아", "빈티지", "고전", "회상", "갈색"],
  },
  {
    engine: "chromatic-aberration",
    title: "색수차",
    description: "빨강과 파랑 채널을 반대 방향으로 어긋나게 해 렌즈 왜곡과 속도감을 냅니다.",
    group: "light",
    keywords: ["chromatic aberration", "rgb split", "색수차", "색 왜곡", "채널 분리"],
  },
  {
    engine: "color-to-alpha",
    title: "색상 투명화",
    description: "흰 종이·미색 스캔·크로마키 배경을 헤일로 없이 투명하게 만들고 원래 전경색을 복원합니다.",
    group: "color",
    keywords: ["color to alpha", "paper removal", "색상 투명화", "배경 제거", "휘도 투명도", "스캔"],
  },
  {
    engine: "sharpen",
    title: "샤픈",
    description: "가벼운 고정 커널로 가장자리를 빠르게 선명하게 만듭니다.",
    group: "detail",
    keywords: ["sharpen", "샤픈", "선명", "디테일"],
  },
  {
    engine: "smart-sharpen",
    title: "스마트 샤픈",
    description: "평탄한 노이즈는 억제하고 의미 있는 경계의 고주파 디테일만 강화합니다.",
    group: "detail",
    keywords: ["smart sharpen", "adaptive", "스마트 샤픈", "엣지", "노이즈 억제"],
  },
  {
    engine: "median-despeckle",
    title: "미디언 잡티 제거",
    description: "주변 픽셀의 중앙값으로 소금·후추 잡티를 줄이면서 경계는 보존합니다.",
    group: "repair",
    keywords: ["median", "despeckle", "dust", "미디언", "잡티", "노이즈 제거"],
  },
  {
    engine: "high-pass",
    title: "하이패스",
    description: "제한된 3×3 고역 통과 커널로 윤곽과 미세 질감만 중성 회색 위에 분리합니다.",
    group: "detail",
    keywords: ["high pass", "high-pass", "frequency", "하이패스", "고주파", "질감"],
  },
  {
    engine: "unsharp-mask",
    title: "언샤프 마스크",
    description: "양·반경·임계값을 조절해 노이즈를 억제하며 정교하게 선명도를 높입니다.",
    group: "detail",
    keywords: ["unsharp mask", "언샤프", "샤픈", "선명", "threshold", "radius"],
  },
  {
    engine: "morphology",
    title: "팽창 / 침식",
    description: "밝은 영역 또는 어두운 선을 확장해 선화 굵기와 마스크 경계를 다듬습니다.",
    group: "repair",
    keywords: ["dilate", "erode", "morphology", "팽창", "침식", "선화", "마스크"],
  },
  {
    engine: "ink-threshold",
    title: "흑백 이진화",
    description: "휘도 임계값을 기준으로 순흑과 순백을 나눠 스캔 선화를 정리합니다.",
    group: "repair",
    keywords: ["먹선 임계값", "한계값 (흑백 2값)", "threshold", "binarize", "ink", "임계값", "이진화", "먹선", "선화"],
  },
  {
    engine: "line-extraction",
    title: "선화 추출",
    description: "Sobel 기울기와 고정 임계값으로 명확한 흑백 윤곽선을 추출합니다.",
    group: "repair",
    keywords: ["line extraction", "sobel", "lineart", "선화 추출", "윤곽", "외곽선"],
  },
  {
    engine: "line-cleanup",
    title: "스케치 선화 정리",
    description: "그레이스케일·자동 대비·선명화·선택적 이진화를 한 번에 적용해 흐린 스케치를 또렷한 먹선으로 정리합니다.",
    group: "repair",
    keywords: [
      "line cleanup",
      "clean lineart",
      "scan cleanup",
      "선화 정리",
      "스케치 정리",
      "먹선",
      "스캔",
      "이진화",
    ],
  },
  {
    engine: "screentone-removal",
    title: "스크린톤 제거",
    description: "주기적인 망점과 스캔 톤 자국을 억제하면서 원래 먹선과 실루엣은 보호합니다.",
    group: "repair",
    keywords: [
      "screentone removal",
      "descreen",
      "halftone removal",
      "스크린톤 제거",
      "망점 제거",
      "디스크린",
      "스캔",
    ],
  },
  {
    engine: "jpeg-artifact-reduction",
    title: "JPEG 압축 깨짐 제거",
    description: "8px 블록 경계와 윤곽 주변 링잉을 줄이되 강한 선과 투명도는 보존합니다.",
    group: "repair",
    keywords: ["JPEG 아티팩트 감소",
      "jpeg artifact reduction",
      "deblock",
      "dering",
      "jpeg 노이즈",
      "블록 제거",
      "링잉 제거",
      "압축",
    ],
  },
  {
    engine: "edge-aware-denoise",
    title: "윤곽 보존 노이즈 제거",
    description: "색상 차이를 인식하는 이웃 필터로 평탄부 노이즈를 줄이면서 선과 색 경계를 지킵니다.",
    group: "repair",
    keywords: ["엣지 보존 노이즈 감소",
      "edge aware denoise",
      "bilateral",
      "denoise",
      "엣지 보존",
      "노이즈 감소",
      "색 경계",
      "잡티",
    ],
  },
  {
    engine: "dust-scratches",
    title: "먼지와 스크래치 제거",
    description: "임계값을 넘는 고립된 먼지·스크래치만 주변 중앙값으로 복원하고 원래 선은 유지합니다.",
    group: "repair",
    keywords: ["dust scratches", "restoration", "먼지", "스크래치", "스캔 복원", "결함 제거"],
  },
  {
    engine: "difference-of-gaussians",
    title: "가우시안 차분 선화",
    description: "서로 다른 두 흐림 반경의 차이를 이용해 사진과 3D 렌더에서 깨끗한 검은 선을 추출합니다.",
    group: "repair",
    keywords: ["difference of gaussians", "dog", "edge", "가우시안 차분", "선화", "윤곽 추출"],
  },
  {
    engine: "edge-detect",
    title: "외곽선 검출",
    description: "Sobel 경사 강도를 연속 톤으로 계산해 조절 가능한 윤곽 효과를 만듭니다.",
    group: "repair",
    keywords: ["edge detect", "sobel", "find edges", "외곽선", "엣지", "윤곽 검출"],
  },
  {
    engine: "emboss",
    title: "엠보스",
    description: "방향성 이웃 차이를 중성 회색에 합성해 종이에 눌러 찍은 양각을 표현합니다.",
    group: "stylize",
    keywords: ["emboss", "relief", "엠보스", "양각", "음각", "릴리프"],
  },
  {
    engine: "custom-convolution",
    title: "사용자 컨볼루션",
    description: "안전하게 제한된 3×3 커널로 샤픈·엠보스·외곽선 등 사용자 효과를 만듭니다.",
    group: "detail",
    keywords: ["custom convolution", "kernel", "matrix", "컨볼루션", "커널", "행렬", "엠보스"],
  },
  {
    engine: "invert",
    title: "반전",
    description: "RGB 색상을 반전해 네거티브·마스크 확인 효과를 만듭니다.",
    group: "color",
    keywords: ["invert", "negative", "반전", "네거티브"],
  },
  {
    engine: "offset",
    title: "픽셀 오프셋",
    description: "이미지를 x·y 방향으로 옮기고 투명·반복·가장자리 채우기를 선택합니다.",
    group: "transform",
    keywords: ["offset", "shift", "wrap", "오프셋", "이동", "반복"],
  },
  {
    engine: "pixelate",
    title: "모자이크 / 픽셀화",
    description: "픽셀 블록 크기를 키워 검열 모자이크와 레트로 도트 표현을 만듭니다.",
    group: "stylize",
    keywords: ["pixelate", "mosaic", "pixel", "픽셀화", "모자이크", "도트"],
  },
  {
    engine: "noise",
    title: "노이즈",
    description: "필름 입자처럼 미세한 무작위 잡음을 더합니다.",
    group: "texture",
    keywords: ["noise", "grain", "노이즈", "그레인", "입자"],
  },
  {
    engine: "clouds",
    title: "구름 텍스처",
    description: "시드가 고정된 로컬 프랙탈 노이즈로 안개·구름·종이 얼룩을 합성합니다.",
    group: "texture",
    keywords: ["clouds", "fractal", "texture", "구름", "안개", "텍스처", "시드"],
  },
  {
    engine: "screentone",
    title: "흑백 스크린톤",
    description: "블록별 평균 휘도를 검정 망점 크기로 바꿔 흑백 만화 톤을 만듭니다.",
    group: "texture",
    keywords: ["screentone", "manga tone", "스크린톤", "망점", "흑백 만화"],
  },
  {
    engine: "color-halftone",
    title: "컬러 하프톤",
    description: "CMYK 채널별 회전 망점을 합성해 코믹 인쇄와 신문 질감을 만듭니다.",
    group: "texture",
    keywords: ["color halftone", "cmyk", "dot screen", "컬러 하프톤", "망점", "인쇄"],
  },
  {
    engine: "oil-paint",
    title: "유화",
    description: "국소 휘도 군집의 대표색으로 면을 평탄화해 두꺼운 물감 질감을 만듭니다.",
    group: "stylize",
    keywords: ["oil paint", "painterly", "kuwahara", "유화", "회화", "물감"],
  },
  {
    engine: "surface-blur",
    title: "표면 보존 블러",
    description: "미디언 기반의 제한된 이웃 샘플로 작은 잡티를 줄이면서 강한 경계는 보존합니다.",
    group: "blur",
    keywords: ["surface blur", "edge preserving", "표면", "경계 보존", "피부", "잡티"],
  },
  {
    engine: "crystal-mosaic",
    title: "크리스털 모자이크",
    description: "색상 셀을 양자화하고 국소 회화 처리를 더해 결정 조각 같은 색면을 만듭니다.",
    group: "stylize",
    keywords: ["crystallize", "crystal", "mosaic", "크리스털", "결정", "모자이크", "색면"],
  },
  {
    engine: "pencil-sketch",
    title: "연필 스케치",
    description: "국소 기울기에서 종이 여백과 어두운 연필선을 추출해 드로잉 초안을 만듭니다.",
    group: "stylize",
    keywords: ["pencil", "sketch", "photocopy", "연필", "스케치", "밑그림"],
  },
  {
    engine: "crosshatch",
    title: "교차 해칭",
    description: "명암에 따라 두 방향의 결정적 해칭 선을 겹쳐 펜화 질감을 만듭니다.",
    group: "stylize",
    keywords: ["crosshatch", "hatching", "pen", "교차", "해칭", "펜화"],
  },
  {
    engine: "ordered-dither",
    title: "순서 디더",
    description: "고정 베이어 패턴으로 명암을 흑백 점에 배분해 재현 가능한 레트로 인쇄 톤을 만듭니다.",
    group: "texture",
    keywords: ["ordered dither", "bayer", "mezzotint", "디더", "베이어", "메조틴트", "도트"],
  },
  {
    engine: "glowing-edges",
    title: "빛나는 외곽선",
    description: "색상 경계를 검출한 다음 밝은 선만 제한 반경으로 번지게 해 네온 외곽선을 만듭니다.",
    group: "light",
    keywords: ["glowing edges", "neon", "edge", "빛나는", "외곽선", "네온"],
  },
  {
    engine: "cutout",
    title: "종이 컷아웃",
    description: "색면을 부드럽게 단순화하고 계조 수를 줄여 겹친 색종이처럼 표현합니다.",
    group: "stylize",
    keywords: ["cutout", "paper", "collage", "컷아웃", "색종이", "콜라주", "포스터"],
  },
  {
    engine: "retro-film",
    title: "레트로 필름",
    description: "세피아 톤, 고정 시드 필름 입자, 옅은 페이드와 색수차를 결합합니다.",
    group: "color",
    keywords: ["retro film", "vintage", "grain", "레트로", "빈티지", "필름", "그레인"],
  },
  {
    engine: "watercolor",
    title: "수채화",
    description: "안료 확산·가장자리 번짐·종이 섬유·과립을 결정적으로 합성합니다.",
    group: "stylize",
    keywords: ["watercolor", "wash", "paper", "수채", "번짐", "안료", "종이"],
  },
  {
    engine: "diffuse-glow",
    title: "확산 글로우",
    description: "밝은 영역의 부드러운 빛 번짐과 미세한 고정 시드 입자를 결합해 몽환적인 톤을 만듭니다.",
    group: "light",
    keywords: ["diffuse glow", "soft light", "dreamy", "확산", "글로우", "빛 번짐", "몽환"],
  },
  {
    engine: "wave-warp",
    title: "물결 왜곡",
    description: "가로·세로 위상이 다른 역매핑 파동으로 물결치는 장면과 열기 아지랑이를 만듭니다.",
    group: "transform",
    keywords: ["사인 웨이브", "wave", "sine", "warp", "웨이브", "파동", "물결", "아지랑이"],
  },
  {
    engine: "ripple-warp",
    title: "동심원 물결",
    description: "지정한 중심에서 퍼지는 동심원 변위로 수면 충격과 에너지 파장을 표현합니다.",
    group: "transform",
    keywords: ["원형 리플", "ripple", "water", "radial", "리플", "동심원", "수면", "파장"],
  },
  {
    engine: "fisheye",
    title: "어안 렌즈",
    description: "광학 곡률을 역산해 중심을 강조하는 볼록·오목 어안 원근을 만듭니다.",
    group: "transform",
    keywords: ["fisheye", "lens", "어안", "볼록", "오목", "원근"],
  },
  {
    engine: "twirl",
    title: "소용돌이",
    description: "중심에서 가장자리로 감쇠하는 회전장으로 소용돌이와 마법 연출을 만듭니다.",
    group: "transform",
    keywords: ["트월 회전", "twirl", "swirl", "vortex", "트월", "소용돌이", "회전"],
  },
  {
    engine: "pinch-bloat",
    title: "오므리기 / 부풀리기",
    description: "선택 중심을 부드럽게 수축하거나 팽창시켜 표정과 실루엣을 과장합니다.",
    group: "transform",
    keywords: ["핀치 / 블로트", "pinch", "bloat", "bulge", "핀치", "블로트", "수축", "팽창"],
  },
  {
    engine: "lens-distortion",
    title: "렌즈 왜곡 보정",
    description: "배럴·핀쿠션 방사 왜곡과 광학 배율을 함께 조절해 카메라 공간감을 설계합니다.",
    group: "transform",
    keywords: ["lens distortion", "barrel", "pincushion", "렌즈", "배럴", "핀쿠션"],
  },
  {
    engine: "film-grain-pro",
    title: "시네마 필름 그레인",
    description: "중간톤에 반응하는 결정적 종형 입자로 스캔 필름의 유기적인 밀도를 더합니다.",
    group: "texture",
    keywords: ["film grain", "cinema", "grain", "필름", "그레인", "입자", "시네마"],
  },
  {
    engine: "salt-pepper",
    title: "소금·후추 노이즈",
    description: "고정 시드의 희소 흑백 점을 배치해 아날로그 전송 오류와 먼지 질감을 만듭니다.",
    group: "texture",
    keywords: ["salt pepper", "impulse", "noise", "소금", "후추", "점잡음", "먼지"],
  },
  {
    engine: "rgb-noise",
    title: "RGB 채널 노이즈",
    description: "각 색 채널을 독립적인 결정 노이즈로 흔들어 디지털 센서와 VHS 색입자를 표현합니다.",
    group: "texture",
    keywords: ["rgb noise", "chroma", "sensor", "RGB", "채널", "컬러 노이즈", "VHS"],
  },
  {
    engine: "perlin-texture",
    title: "프랙탈 밸류 텍스처",
    description: "여러 옥타브의 보간 노이즈를 겹쳐 안개·석재·종이용 저주파 재질을 생성합니다.",
    group: "texture",
    keywords: ["perlin", "value noise", "fractal", "프랙탈", "밸류", "옥타브", "절차형"],
  },
  {
    engine: "pointillize",
    title: "점묘화",
    description: "시드로 흔들린 원형 색점을 종이 여백 위에 찍어 점묘 회화 질감을 만듭니다.",
    group: "stylize",
    keywords: ["포인틸리즘", "pointillize", "pointillism", "dots", "점묘", "색점", "회화"],
  },
  {
    engine: "stained-glass",
    title: "스테인드글라스",
    description: "결정적 보로노이 색면과 어두운 납선을 합성해 유리 조각 모자이크를 만듭니다.",
    group: "stylize",
    keywords: ["stained glass", "voronoi", "mosaic", "스테인드글라스", "보로노이", "납선"],
  },
  {
    engine: "poster-edges",
    title: "포스터 엣지",
    description: "색상 단계를 줄이면서 소벨 경계를 선택적으로 눌러 강한 그래픽 외곽을 만듭니다.",
    group: "stylize",
    keywords: ["poster edges", "sobel", "poster", "포스터 엣지", "윤곽", "색면"],
  },
  {
    engine: "photocopy",
    title: "복사기 효과",
    description: "국소 평균과 용지 임계값을 결합해 복사기 특유의 뭉친 먹선과 흰 여백을 만듭니다.",
    group: "stylize",
    keywords: ["고대비 포토카피", "photocopy", "xerox", "copy", "포토카피", "복사기", "먹선", "고대비"],
  },
  {
    engine: "normal-map",
    title: "노멀 맵 변환",
    description: "휘도 기울기를 정규화된 RGB 표면 방향으로 바꿔 3D 조명용 노멀 소스를 만듭니다.",
    group: "texture",
    keywords: ["normal map", "surface", "3d", "노멀 맵", "표면", "기울기", "조명"],
  },
  {
    engine: "polar-coordinates",
    title: "극좌표 변환",
    description: "직교좌표와 극좌표를 상호 변환하여 파노라마나 만화경 효과를 만듭니다.",
    group: "transform",
    keywords: ["polar", "coordinates", "극좌표", "파노라마"],
  },
  {
    engine: "god-rays",
    title: "빛줄기",
    description: "광원 방향으로 밝은 픽셀을 제한 샘플링해 장면을 가르는 따뜻한 빛줄기를 더합니다.",
    group: "light",
    keywords: ["볼류메트릭 광선", "god rays", "volumetric", "light shafts", "볼류메트릭", "광선", "빛줄기", "역광"],
  },
] as const;

export const STUDIO_FILTER_GROUP_ORDER: readonly StudioFilterCatalogGroup[] = [
  "tone",
  "color",
  "blur",
  "detail",
  "repair",
  "light",
  "stylize",
  "texture",
  "transform",
];

export function studioFilterCatalogEntry(engine: string): StudioFilterCatalogEntry | null {
  return STUDIO_FILTER_CATALOG.find((entry) => entry.engine === engine) ?? null;
}

export function studioFilterGroupLabel(group: StudioFilterCatalogGroup): string {
  switch (group) {
    case "blur":
      return "흐림·초점";
    case "tone":
      return "밝기·명암";
    case "color":
      return "색상 보정";
    case "detail":
      return "선명도";
    case "repair":
      return "선화·복원";
    case "stylize":
      return "그림체·스타일";
    case "light":
      return "빛·렌즈";
    case "transform":
      return "변형·왜곡";
    case "texture":
      return "질감·노이즈";
  }
}

type StudioFilterDialogCatalogSource = {
  kind: StudioFilterKind;
  engine?: string;
  preview: StudioFilterPreviewKind;
  fallback?: Omit<StudioFilterCatalogEntry, "engine">;
};

const STUDIO_FILTER_DIALOG_CATALOG_SOURCES: readonly StudioFilterDialogCatalogSource[] = [
  { kind: "gaussian-blur", engine: "gaussian-blur", preview: "soft-blur" },
  { kind: "motion-blur", engine: "motion-blur", preview: "motion" },
  { kind: "hue-saturation-brightness", engine: "hue-saturation", preview: "spectrum" },
  { kind: "brightness-contrast", engine: "brightness-contrast", preview: "tone" },
  { kind: "color-curves", engine: "curves", preview: "curve" },
  { kind: "mosaic", engine: "pixelate", preview: "mosaic" },
  { kind: "radial-blur", engine: "spin-blur", preview: "radial" },
  { kind: "zoom-blur", engine: "zoom-blur", preview: "radial" },
  { kind: "lens-blur", engine: "lens-blur", preview: "soft-blur" },
  { kind: "field-iris-blur", engine: "field-iris-blur", preview: "radial" },
  { kind: "tilt-shift-blur", engine: "tilt-shift-blur", preview: "motion" },
  {
    kind: "selective-gaussian-blur",
    engine: "selective-gaussian-blur",
    preview: "soft-blur",
  },
  { kind: "tileable-blur", engine: "tileable-blur", preview: "soft-blur" },
  {
    kind: "chromatic-aberration",
    engine: "chromatic-aberration",
    preview: "channels",
  },
  {
    kind: "glitch",
    preview: "glitch",
    fallback: {
      title: "글리치",
      description: "결정적인 가로 조각 이동과 RGB 분리로 디지털 오류 리듬을 만듭니다.",
      group: "texture",
      keywords: ["glitch", "rgb", "글리치", "디지털", "채널 분리"],
    },
  },
  {
    kind: "scanline",
    preview: "scanline",
    fallback: {
      title: "스캔라인",
      description: "주사선과 화면 명암을 더해 CRT·방송 화면 같은 질감을 만듭니다.",
      group: "texture",
      keywords: ["scanline", "crt", "스캔라인", "주사선", "방송"],
    },
  },
  {
    kind: "vignette",
    preview: "vignette",
    fallback: {
      title: "비네트",
      description: "중앙의 시선을 유지하면서 가장자리를 부드럽게 어둡게 만듭니다.",
      group: "light",
      keywords: ["vignette", "비네트", "가장자리", "집중"],
    },
  },
  {
    kind: "lens-flare",
    preview: "flare",
    fallback: {
      title: "렌즈 플레어",
      description: "광원과 렌즈 반사를 더해 역광 장면의 빛 번짐을 표현합니다.",
      group: "light",
      keywords: ["lens flare", "렌즈 플레어", "광원", "역광", "빛 번짐"],
    },
  },
  { kind: "emboss", engine: "emboss", preview: "relief" },
  { kind: "solarize", engine: "solarize", preview: "solarize" },
  { kind: "threshold", engine: "ink-threshold", preview: "threshold" },
  { kind: "oil-paint", engine: "oil-paint", preview: "paint" },
  { kind: "surface-blur", engine: "surface-blur", preview: "soft-blur" },
  { kind: "line-cleanup", engine: "line-cleanup", preview: "threshold" },
  { kind: "screentone-removal", engine: "screentone-removal", preview: "dots" },
  {
    kind: "jpeg-artifact-reduction",
    engine: "jpeg-artifact-reduction",
    preview: "edges",
  },
  { kind: "edge-aware-denoise", engine: "edge-aware-denoise", preview: "soft-blur" },
  { kind: "dust-scratches", engine: "dust-scratches", preview: "edges" },
  {
    kind: "difference-of-gaussians",
    engine: "difference-of-gaussians",
    preview: "edges",
  },
  { kind: "color-to-alpha", engine: "color-to-alpha", preview: "threshold" },
  {
    kind: "duotone",
    preview: "duotone",
    fallback: {
      title: "세피아 / 듀오톤",
      description: "어두운 영역과 밝은 영역을 두 색으로 다시 매핑해 통일된 룩을 만듭니다.",
      group: "color",
      keywords: ["duotone", "sepia", "듀오톤", "세피아", "투톤"],
    },
  },
  { kind: "noise-add", engine: "noise", preview: "noise" },
  { kind: "wave-warp", engine: "wave-warp", preview: "warp" },
  { kind: "ripple-warp", engine: "ripple-warp", preview: "radial" },
  { kind: "fisheye", engine: "fisheye", preview: "warp" },
  { kind: "twirl", engine: "twirl", preview: "radial" },
  { kind: "pinch-bloat", engine: "pinch-bloat", preview: "warp" },
  { kind: "lens-distortion", engine: "lens-distortion", preview: "warp" },
  { kind: "film-grain-pro", engine: "film-grain-pro", preview: "grain" },
  { kind: "salt-pepper", engine: "salt-pepper", preview: "noise" },
  { kind: "rgb-noise", engine: "rgb-noise", preview: "channels" },
  { kind: "perlin-texture", engine: "perlin-texture", preview: "grain" },
  { kind: "pointillize", engine: "pointillize", preview: "dots" },
  { kind: "stained-glass", engine: "stained-glass", preview: "glass" },
  { kind: "poster-edges", engine: "poster-edges", preview: "edges" },
  { kind: "photocopy", engine: "photocopy", preview: "threshold" },
  { kind: "normal-map", engine: "normal-map", preview: "normal" },
  { kind: "god-rays", engine: "god-rays", preview: "rays" },
  { kind: "polar-coordinates", engine: "polar-coordinates", preview: "transform" },
];

/**
 * Every filter exposed by the modal has searchable metadata and an original preview family.
 * This is deliberately separate from the smart-filter inventory: dialog aliases such
 * as `mosaic -> pixelate` keep their persisted document kind while reusing engine metadata.
 */
export const STUDIO_FILTER_DIALOG_CATALOG: readonly StudioFilterDialogCatalogEntry[] =
  Object.freeze(
    STUDIO_FILTER_DIALOG_CATALOG_SOURCES.map((source) => {
      const engine = source.engine ?? source.kind;
      const shared = source.engine ? studioFilterCatalogEntry(source.engine) : null;
      const metadata = shared ?? source.fallback;
      if (!metadata) {
        throw new Error(`Missing dialog filter catalog metadata: ${source.kind}`);
      }
      return Object.freeze({
        ...metadata,
        title: STUDIO_FILTER_ALL_LABELS[source.kind],
        keywords: [...metadata.keywords, metadata.title],
        engine,
        kind: source.kind,
        preview: source.preview,
      });
    }),
  );

function studioFilterPreviewHue(kind: StudioFilterKind): number {
  let hash = 0;
  for (let index = 0; index < kind.length; index += 1) {
    hash = (hash * 31 + kind.charCodeAt(index)) % 360;
  }
  return hash;
}

/**
 * Small deterministic, copyright-free preview art. The gallery never downloads thumbnails and
 * therefore remains available offline or when image/font CORS is unavailable.
 */
export function studioFilterDialogPreviewStyle(
  entry: Pick<StudioFilterDialogCatalogEntry, "kind" | "preview">,
): StudioFilterPreviewStyle {
  const hue = studioFilterPreviewHue(entry.kind);
  const accent = `hsl(${hue} 78% 58%)`;
  const accentSoft = `hsl(${(hue + 52) % 360} 68% 70%)`;
  const ink = "hsl(225 20% 12%)";
  switch (entry.preview) {
    case "soft-blur":
      return {
        background: `radial-gradient(circle at 28% 36%, ${accent} 0 12%, transparent 38%), radial-gradient(circle at 72% 62%, ${accentSoft} 0 10%, transparent 40%), ${ink}`,
        filter: "blur(1.2px) saturate(1.08)",
      };
    case "motion":
      return {
        background: `repeating-linear-gradient(112deg, transparent 0 8%, ${accent} 10% 13%, transparent 18% 25%), linear-gradient(145deg, ${ink}, ${accentSoft})`,
      };
    case "radial":
      return {
        background: `repeating-conic-gradient(from 18deg at 50% 50%, ${accent} 0 3deg, transparent 5deg 15deg), radial-gradient(circle, ${accentSoft}, ${ink} 68%)`,
      };
    case "tone":
      return {
        background: `linear-gradient(120deg, hsl(${hue} 18% 8%) 0 34%, hsl(${hue} 28% 45%) 34% 66%, hsl(${hue} 42% 88%) 66%)`,
      };
    case "spectrum":
      return {
        background: "conic-gradient(from 30deg, #f45, #fc3, #4c8, #39e, #a5e, #f45)",
      };
    case "curve":
      return {
        background: `radial-gradient(ellipse at 24% 78%, transparent 0 22%, ${accent} 24% 27%, transparent 29%), linear-gradient(135deg, ${ink}, hsl(${hue} 20% 78%))`,
      };
    case "mosaic":
      return {
        background: `conic-gradient(from 90deg, ${accent} 25%, ${accentSoft} 0 50%, hsl(${hue} 28% 24%) 0 75%, hsl(${hue} 38% 82%) 0)`,
        backgroundSize: "18px 18px",
      };
    case "transform":
      return {
        background: `repeating-conic-gradient(from 0deg, ${accent} 0 10deg, transparent 10deg 20deg), radial-gradient(circle, ${ink} 0 40%, ${accentSoft} 100%)`,
      };
    case "channels":
      return {
        background: "radial-gradient(circle at 42% 50%, #f04 0 20%, transparent 22%), radial-gradient(circle at 50% 50%, #0ee 0 20%, transparent 22%), radial-gradient(circle at 58% 50%, #55f 0 20%, transparent 22%), #10131d",
      };
    case "glitch":
      return {
        background: `linear-gradient(174deg, transparent 0 26%, #f24 27% 34%, transparent 35% 48%, #2ef 49% 57%, transparent 58%), repeating-linear-gradient(0deg, ${ink} 0 7px, ${accent} 8px 11px)`,
      };
    case "scanline":
      return {
        background: `repeating-linear-gradient(0deg, transparent 0 4px, hsl(0 0% 0% / .58) 5px 7px), linear-gradient(125deg, ${accent}, ${ink})`,
      };
    case "vignette":
      return {
        background: `radial-gradient(ellipse at center, ${accentSoft} 0 24%, ${accent} 42%, ${ink} 82%)`,
      };
    case "flare":
      return {
        background: `radial-gradient(circle at 68% 28%, white 0 3%, ${accentSoft} 5%, transparent 18%), radial-gradient(circle at 38% 64%, ${accent} 0 6%, transparent 17%), linear-gradient(145deg, ${ink}, hsl(${hue} 36% 36%))`,
      };
    case "relief":
      return {
        background: `linear-gradient(135deg, hsl(${hue} 8% 82%), hsl(${hue} 8% 26%)), repeating-radial-gradient(circle at 35% 45%, transparent 0 8px, hsl(0 0% 100% / .38) 9px 11px, hsl(0 0% 0% / .35) 12px 14px)`,
      };
    case "solarize":
      return {
        background: `linear-gradient(100deg, ${accent} 0 25%, hsl(${(hue + 180) % 360} 84% 52%) 25% 50%, #f4f0d8 50% 75%, ${ink} 75%)`,
      };
    case "threshold":
      return {
        background: "radial-gradient(circle at 28% 38%, #fff 0 16%, #111 17% 29%, #fff 30% 42%, #111 43%)",
      };
    case "paint":
      return {
        background: `radial-gradient(ellipse at 24% 32%, ${accent} 0 12%, transparent 14%), radial-gradient(ellipse at 62% 58%, ${accentSoft} 0 18%, transparent 21%), repeating-linear-gradient(165deg, ${ink} 0 6px, hsl(${hue} 32% 40%) 7px 12px)`,
        filter: "saturate(1.18)",
      };
    case "duotone":
      return {
        background: `linear-gradient(135deg, hsl(${hue} 62% 18%) 0 45%, hsl(${(hue + 62) % 360} 82% 72%) 46% 100%)`,
      };
    case "noise":
    case "grain":
      return {
        background: `repeating-radial-gradient(circle at 30% 40%, ${accent} 0 1px, transparent 2px 5px), repeating-radial-gradient(circle at 70% 60%, ${accentSoft} 0 1px, transparent 2px 7px), ${ink}`,
        backgroundSize: entry.preview === "grain" ? "13px 13px" : "9px 9px",
      };
    case "warp":
      return {
        background: `repeating-radial-gradient(ellipse at 50% 50%, ${accent} 0 5px, transparent 7px 15px), linear-gradient(135deg, ${ink}, ${accentSoft})`,
      };
    case "dots":
      return {
        background: `radial-gradient(circle, ${accent} 0 28%, transparent 30%), radial-gradient(circle, ${accentSoft} 0 24%, transparent 26%), ${ink}`,
        backgroundSize: "14px 14px, 18px 18px",
      };
    case "glass":
      return {
        background: `conic-gradient(from 30deg at 30% 40%, ${accent}, ${ink}, ${accentSoft}, ${accent}), conic-gradient(from 210deg at 72% 62%, ${accentSoft}, ${ink}, ${accent})`,
        backgroundSize: "52% 100%, 54% 100%",
      };
    case "edges":
      return {
        background: `repeating-linear-gradient(45deg, ${ink} 0 4px, ${accent} 5px 7px, hsl(${hue} 15% 86%) 8px 15px)`,
      };
    case "normal":
      return {
        background: "radial-gradient(circle at 38% 34%, #8ff 0 8%, transparent 26%), radial-gradient(circle at 62% 62%, #f8f 0 10%, transparent 30%), linear-gradient(135deg, #46e, #a4f)",
      };
    case "rays":
      return {
        background: `repeating-conic-gradient(from 210deg at 18% 20%, ${accentSoft} 0 5deg, transparent 7deg 19deg), linear-gradient(145deg, ${ink}, hsl(${hue} 38% 36%))`,
      };
  }
}

function normalizedSearchTerms(query: string): readonly string[] {
  return studioToolSearchTerms(query);
}

/** Local-only search; every term must match title, description, engine id, or an alias. */
export function searchStudioFilterCatalog(
  query: string,
  allowedEngineIds?: readonly string[],
): readonly StudioFilterCatalogEntry[] {
  const allowed = allowedEngineIds ? new Set(allowedEngineIds) : null;
  const terms = normalizedSearchTerms(query);
  return STUDIO_FILTER_CATALOG.filter((entry) => {
    if (allowed && !allowed.has(entry.engine)) return false;
    if (terms.length === 0) return true;
    return matchesStudioToolSearch(terms, [
      entry.engine,
      entry.title,
      entry.description,
      studioFilterGroupLabel(entry.group),
      ...entry.keywords,
    ]);
  });
}

/** Search only the filters that can be opened and applied by StudioFilterDialog. */
export function searchStudioFilterDialogCatalog(
  query: string,
): readonly StudioFilterDialogCatalogEntry[] {
  const terms = normalizedSearchTerms(query);
  if (terms.length === 0) return STUDIO_FILTER_DIALOG_CATALOG;
  return STUDIO_FILTER_DIALOG_CATALOG.filter((entry) => {
    return matchesStudioToolSearch(terms, [
      entry.kind,
      entry.engine,
      entry.title,
      entry.description,
      studioFilterGroupLabel(entry.group),
      ...entry.keywords,
    ]);
  });
}
