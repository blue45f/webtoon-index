// 주요 색상 팔레트 추출 — 100% 브라우저(클라이언트) 실행, 서버·토큰 비용 0원.
// 이미지를 작게 다운샘플한 뒤 RGB를 굵게 양자화(bucket)해 등장 빈도 상위 색을 뽑는다.
// k-means/미디언컷 같은 정교한 군집화 없이 히스토그램만으로 충분히 쓸만한 팔레트를 얻는다(v1).
//
// 한계(정직): 양자화 단계(step)가 굵어서 미세한 색조 차이는 하나로 뭉친다. 배경 제거된 이미지의
// 투명 영역은 "색"이 아니므로 집계에서 제외한다(alpha < 20).

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = src;
  });
}

// 양자화 스텝(채널당 32단계 버킷) — 값이 작을수록 팔레트가 촘촘해지고 느려진다.
const QUANTIZE_STEP = 32;
// 다운샘플 최대 변(가로/세로 중 긴 쪽) — 색 분포 통계엔 고해상도가 필요 없다.
const MAX_SAMPLE_DIM = 100;
// 이 알파 미만은 "실질적으로 투명"으로 보고 집계에서 제외한다.
const ALPHA_SKIP_THRESHOLD = 20;

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/**
 * 이미지의 주요 색상을 추출해 등장 빈도순 헥스 문자열 배열로 반환한다.
 * @param src 원본 이미지 URL(업로드 자산은 data URL 이라 CORS 문제 없음)
 * @param count 반환할 색상 개수(기본 6) — 실제 고유 색이 더 적으면 그만큼만 반환한다.
 */
export async function extractPalette(src: string, count = 6): Promise<string[]> {
  const img = await loadImage(src);

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) throw new Error("이미지 크기를 확인할 수 없습니다.");

  // 긴 변을 MAX_SAMPLE_DIM 에 맞춰 비율 유지 축소(통계용이라 화질 손실 무관).
  const scale = Math.min(1, MAX_SAMPLE_DIM / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const freq = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < ALPHA_SKIP_THRESHOLD) continue;
    const r = Math.min(255, Math.round(data[i]! / QUANTIZE_STEP) * QUANTIZE_STEP);
    const g = Math.min(255, Math.round(data[i + 1]! / QUANTIZE_STEP) * QUANTIZE_STEP);
    const b = Math.min(255, Math.round(data[i + 2]! / QUANTIZE_STEP) * QUANTIZE_STEP);
    // r,g,b(0~255) 를 하나의 정수 키로 패킹해 Map 키 비교를 가볍게 한다.
    const key = (r << 16) | (g << 8) | b;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => `#${toHex((key >> 16) & 0xff)}${toHex((key >> 8) & 0xff)}${toHex(key & 0xff)}`);
}
