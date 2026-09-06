/**
 * Studio 3D 배경/모델 툰 선화(LineArt) 및 스크린톤 자동 추출 엔진.
 *
 * 3D 렌더링 래스터(RGB / Depth / Normal / ObjectID) 버퍼에서
 * - Sobel, Canny, Difference of Gaussians (DoG/XDoG) 필터링
 * - Normal & Depth 불연속성(Crease / Silhouette) 감지
 * - 픽셀 선화의 2D 벡터 스트로크(SVG/Bézier Path) 자동 추출
 * - 만화 전용 스크린톤(Halftone Dot / Cross-Hatch / Diamond / Line) 합성
 * 을 지원하는 고성능 툰 렌더링 코어입니다.
 */

export type EdgeDetectionAlgorithm =
  | "sobel"
  | "canny"
  | "dog" // Difference of Gaussians (Manga Inking)
  | "normal-depth" // 3D Normal & Depth discontinuity
  | "hybrid"; // Combined RGB + Normal + Depth

export interface Studio3DLineArtExtractorOptions {
  /** 엣지 감지 알고리즘. 기본값 'sobel'. */
  readonly algorithm?: EdgeDetectionAlgorithm;
  /** 엣지 감지 감도 (0–255). 낮을수록 미세한 선 감지. 기본값 48. */
  readonly threshold?: number;
  /** Canny용 저임계값 (0–255). 기본값 threshold * 0.4. */
  readonly cannyLowThreshold?: number;
  /** 선화 두께(px). 1–8. 기본값 1. */
  readonly lineThickness?: number;
  /** 추출된 선화 색상 (RGBA, 0-255). 기본값 검은색 [0, 0, 0, 255]. */
  readonly lineColor?: readonly [number, number, number, number];
  /** 배경 투명화 여부. 기본값 true. */
  readonly transparentBackground?: boolean;
  /** 선화 스무딩 / 노이즈 억제 활성화 여부. 기본값 false. */
  readonly smoothLines?: boolean;
  /** Depth 버퍼 데이터 (Float32Array 또는 Uint8Array, width × height). */
  readonly depthBuffer?: Float32Array | Uint8Array;
  /** Normal 버퍼 데이터 (RGBA, width × height × 4). */
  readonly normalBuffer?: Uint8Array | Uint8ClampedArray;
  /** Normal 엣지 각도 임계값 (도, 0-90). 기본값 35도. */
  readonly normalAngleThresholdDeg?: number;
  /** Depth 엣지 차이 임계값 (0-1). 기본값 0.05. */
  readonly depthThreshold?: number;
}

export interface VectorPathPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
}

export interface VectorStrokePath {
  readonly id: string;
  readonly points: readonly VectorPathPoint[];
  readonly svgPathData: string;
  readonly isClosed: boolean;
  readonly length: number;
}

export interface Studio3DLineArtExtractorResult {
  /** 추출된 선화 RGBA 픽셀 버퍼 (width × height × 4). */
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** 추출된 총 선화 픽셀 수. */
  readonly linePixelCount: number;
  /** 단일 채널 엣지 마스크 (0 또는 255). */
  readonly edgeMask: Uint8Array;
  /** 벡터화된 스트로크 목록 (선택적 생성). */
  readonly vectorStrokes?: readonly VectorStrokePath[];
  /** SVG 문자열 표현 (선택적). */
  readonly svgMarkup?: string;
}

export type ScreentonePattern = "dots" | "cross-hatch" | "lines" | "diamonds" | "sand";

export interface ScreentoneOptions {
  readonly pattern?: ScreentonePattern;
  /** 스크린톤 선 밀도 / LPI (Lines Per Inch). 20–120. 기본값 60. */
  readonly frequency?: number;
  /** 패턴 각도 (도). 기본값 45도. */
  readonly angleDeg?: number;
  /** 톤 농도 / 명암 임계 (0–1). 0이면 완전 흰색, 1이면 완전 검은색. */
  readonly density?: number;
  /** 톤 도트 색상 (RGBA). 기본값 [30, 30, 30, 255]. */
  readonly toneColor?: readonly [number, number, number, number];
  /** 배경 투명 여부. 기본값 true. */
  readonly transparentBackground?: boolean;
}

/**
 * 3D 렌더 RGBA 버퍼에서 툰 윤곽선(LineArt) 레이어를 추출한다.
 */
export function extractStudio3DLineArt(
  pixelData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: Studio3DLineArtExtractorOptions = {},
): Studio3DLineArtExtractorResult {
  const algorithm = options.algorithm ?? "sobel";
  const threshold = Math.max(1, Math.min(255, options.threshold ?? 48));
  const lineThickness = Math.max(1, Math.min(8, options.lineThickness ?? 1));
  const lineColor = options.lineColor ?? [0, 0, 0, 255];
  const transparentBackground = options.transparentBackground ?? true;

  const totalPixels = width * height;
  const gray = new Float32Array(totalPixels);

  // 1단계: 픽셀 휘도(Grayscale) 변환
  for (let i = 0; i < totalPixels; i += 1) {
    const idx = i * 4;
    const r = pixelData[idx] ?? 0;
    const g = pixelData[idx + 1] ?? 0;
    const b = pixelData[idx + 2] ?? 0;
    gray[i] = r * 0.299 + g * 0.587 + b * 0.114;
  }

  let rawEdges: Uint8Array;

  // 2단계: 알고리즘별 엣지 맵 생성
  switch (algorithm) {
    case "canny":
      rawEdges = computeCannyEdges(gray, width, height, threshold, options.cannyLowThreshold ?? threshold * 0.4);
      break;
    case "dog":
      rawEdges = computeDoGEdges(gray, width, height, threshold);
      break;
    case "normal-depth":
      rawEdges = computeNormalDepthEdges(width, height, options);
      break;
    case "hybrid": {
      const sobelEdges = computeSobelEdges(gray, width, height, threshold);
      const geomEdges = computeNormalDepthEdges(width, height, options);
      rawEdges = combineEdgeBuffers(sobelEdges, geomEdges, totalPixels);
      break;
    }
    case "sobel":
    default:
      rawEdges = computeSobelEdges(gray, width, height, threshold);
      break;
  }

  // 3단계: 두께 확장 (Line Thickness Expansion)
  const thickEdges = expandLineThickness(rawEdges, width, height, lineThickness);

  // 4단계: 선화 픽셀 개수 집계
  let linePixelCount = 0;
  for (let i = 0; i < totalPixels; i += 1) {
    if (thickEdges[i] === 255) linePixelCount += 1;
  }

  // 5단계: RGBA 결과 버퍼 조합
  const rgba = new Uint8Array(totalPixels * 4);
  for (let i = 0; i < totalPixels; i += 1) {
    const isLine = thickEdges[i] === 255;
    const outIdx = i * 4;

    if (isLine) {
      rgba[outIdx] = lineColor[0];
      rgba[outIdx + 1] = lineColor[1];
      rgba[outIdx + 2] = lineColor[2];
      rgba[outIdx + 3] = lineColor[3];
    } else if (!transparentBackground) {
      rgba[outIdx] = 255;
      rgba[outIdx + 1] = 255;
      rgba[outIdx + 2] = 255;
      rgba[outIdx + 3] = 255;
    }
  }

  return {
    rgba,
    width,
    height,
    linePixelCount,
    edgeMask: thickEdges,
  };
}

/**
 * Sobel 필터 기반 엣지 감지
 */
function computeSobelEdges(gray: Float32Array, width: number, height: number, threshold: number): Uint8Array {
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    const rowPrev = (y - 1) * width;
    const rowCurr = y * width;
    const rowNext = (y + 1) * width;

    for (let x = 1; x < width - 1; x += 1) {
      const idx = rowCurr + x;

      const gx =
        -1 * gray[rowPrev + x - 1] +
        1 * gray[rowPrev + x + 1] +
        -2 * gray[rowCurr + x - 1] +
        2 * gray[rowCurr + x + 1] +
        -1 * gray[rowNext + x - 1] +
        1 * gray[rowNext + x + 1];

      const gy =
        -1 * gray[rowPrev + x - 1] +
        -2 * gray[rowPrev + x] +
        -1 * gray[rowPrev + x + 1] +
        1 * gray[rowNext + x - 1] +
        2 * gray[rowNext + x] +
        1 * gray[rowNext + x + 1];

      const magnitude = Math.hypot(gx, gy);
      if (magnitude >= threshold) {
        edges[idx] = 255;
      }
    }
  }

  return edges;
}

/**
 * Canny 엣지 디텍터 (Gaussian Blur + Gradient + Non-Maximum Suppression + Hysteresis)
 */
function computeCannyEdges(
  gray: Float32Array,
  width: number,
  height: number,
  highThreshold: number,
  lowThreshold: number,
): Uint8Array {
  const total = width * height;
  const smoothed = gaussianBlurGrayscale(gray, width, height);

  const magnitude = new Float32Array(total);
  const direction = new Uint8Array(total); // 0: 0°, 1: 45°, 2: 90°, 3: 135°

  for (let y = 1; y < height - 1; y += 1) {
    const rowPrev = (y - 1) * width;
    const rowCurr = y * width;
    const rowNext = (y + 1) * width;

    for (let x = 1; x < width - 1; x += 1) {
      const idx = rowCurr + x;

      const gx =
        -1 * smoothed[rowPrev + x - 1] +
        1 * smoothed[rowPrev + x + 1] +
        -2 * smoothed[rowCurr + x - 1] +
        2 * smoothed[rowCurr + x + 1] +
        -1 * smoothed[rowNext + x - 1] +
        1 * smoothed[rowNext + x + 1];

      const gy =
        -1 * smoothed[rowPrev + x - 1] +
        -2 * smoothed[rowPrev + x] +
        -1 * smoothed[rowPrev + x + 1] +
        1 * smoothed[rowNext + x - 1] +
        2 * smoothed[rowNext + x] +
        1 * smoothed[rowNext + x + 1];

      const mag = Math.hypot(gx, gy);
      magnitude[idx] = mag;

      let angle = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (angle < 0) angle += 180;

      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        direction[idx] = 0; // horizontal
      } else if (angle >= 22.5 && angle < 67.5) {
        direction[idx] = 1; // 45°
      } else if (angle >= 67.5 && angle < 112.5) {
        direction[idx] = 2; // vertical
      } else {
        direction[idx] = 3; // 135°
      }
    }
  }

  // Non-maximum suppression
  const nms = new Float32Array(total);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      const dir = direction[idx];

      let neighborA: number;
      let neighborB: number;

      if (dir === 0) {
        neighborA = magnitude[idx - 1];
        neighborB = magnitude[idx + 1];
      } else if (dir === 1) {
        neighborA = magnitude[(y - 1) * width + (x + 1)];
        neighborB = magnitude[(y + 1) * width + (x - 1)];
      } else if (dir === 2) {
        neighborA = magnitude[(y - 1) * width + x];
        neighborB = magnitude[(y + 1) * width + x];
      } else {
        neighborA = magnitude[(y - 1) * width + (x - 1)];
        neighborB = magnitude[(y + 1) * width + (x + 1)];
      }

      if (mag >= neighborA && mag >= neighborB) {
        nms[idx] = mag;
      }
    }
  }

  // Hysteresis thresholding
  const edges = new Uint8Array(total);
  const strongQueue: number[] = [];

  for (let idx = 0; idx < total; idx += 1) {
    if (nms[idx] >= highThreshold) {
      edges[idx] = 255;
      strongQueue.push(idx);
    }
  }

  // Link weak edges connected to strong edges
  let queueHead = 0;
  while (queueHead < strongQueue.length) {
    const strongIdx = strongQueue[queueHead++];
    const sy = Math.floor(strongIdx / width);
    const sx = strongIdx % width;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const ny = sy + dy;
        const nx = sx + dx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (edges[nIdx] === 0 && nms[nIdx] >= lowThreshold) {
            edges[nIdx] = 255;
            strongQueue.push(nIdx);
          }
        }
      }
    }
  }

  return edges;
}

/**
 * Difference of Gaussians (DoG) for Manga / Webtoon Inking
 */
function computeDoGEdges(
  gray: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const total = width * height;
  const blur1 = gaussianBlurGrayscale(gray, width, height, 1.0);
  const blur2 = gaussianBlurGrayscale(gray, width, height, 2.2);

  const edges = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const diff = blur1[i] - 0.97 * blur2[i];
    // Hyperbolic tangent or threshold activation for crisp inking
    if (diff < -threshold * 0.1 || diff > threshold * 0.1) {
      edges[i] = 255;
    }
  }

  return edges;
}

/**
 * Normal & Depth Discontinuity Detection
 */
function computeNormalDepthEdges(
  width: number,
  height: number,
  options: Studio3DLineArtExtractorOptions,
): Uint8Array {
  const total = width * height;
  const edges = new Uint8Array(total);

  const depthBuf = options.depthBuffer;
  const normalBuf = options.normalBuffer;
  const depthThresh = options.depthThreshold ?? 0.05;
  const normalThreshRad = ((options.normalAngleThresholdDeg ?? 35) * Math.PI) / 180;
  const cosNormalThresh = Math.cos(normalThreshRad);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      let isEdge = false;

      // Depth jump (silhouette)
      if (depthBuf) {
        const currD = depthBuf[idx];
        const rightD = depthBuf[idx + 1];
        const downD = depthBuf[(y + 1) * width + x];

        if (Math.abs(currD - rightD) > depthThresh || Math.abs(currD - downD) > depthThresh) {
          isEdge = true;
        }
      }

      // Normal crease (creases & interior contours)
      if (!isEdge && normalBuf) {
        const nIdx = idx * 4;
        const rightNIdx = (idx + 1) * 4;
        const downNIdx = ((y + 1) * width + x) * 4;

        // Unpack normal vectors [-1, 1] from [0, 255]
        const nx = (normalBuf[nIdx] / 127.5) - 1;
        const ny = (normalBuf[nIdx + 1] / 127.5) - 1;
        const nz = (normalBuf[nIdx + 2] / 127.5) - 1;

        const rnx = (normalBuf[rightNIdx] / 127.5) - 1;
        const rny = (normalBuf[rightNIdx + 1] / 127.5) - 1;
        const rnz = (normalBuf[rightNIdx + 2] / 127.5) - 1;

        const dnx = (normalBuf[downNIdx] / 127.5) - 1;
        const dny = (normalBuf[downNIdx + 1] / 127.5) - 1;
        const dnz = (normalBuf[downNIdx + 2] / 127.5) - 1;

        const dotR = nx * rnx + ny * rny + nz * rnz;
        const dotD = nx * dnx + ny * dny + nz * dnz;

        if (dotR < cosNormalThresh || dotD < cosNormalThresh) {
          isEdge = true;
        }
      }

      if (isEdge) {
        edges[idx] = 255;
      }
    }
  }

  return edges;
}

function combineEdgeBuffers(a: Uint8Array, b: Uint8Array, total: number): Uint8Array {
  const result = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    if (a[i] === 255 || b[i] === 255) {
      result[i] = 255;
    }
  }
  return result;
}

function expandLineThickness(edges: Uint8Array, width: number, height: number, thickness: number): Uint8Array {
  if (thickness <= 1) return edges;

  const thickEdges = new Uint8Array(edges);
  const radius = Math.floor(thickness / 2);

  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      if (edges[y * width + x] === 255) {
        for (let ey = -radius; ey <= radius; ey += 1) {
          for (let ex = -radius; ex <= radius; ex += 1) {
            thickEdges[(y + ey) * width + (x + ex)] = 255;
          }
        }
      }
    }
  }

  return thickEdges;
}

function gaussianBlurGrayscale(src: Float32Array, width: number, height: number, sigma = 1.4): Float32Array {
  const dst = new Float32Array(width * height);
  const kernelSize = Math.max(3, Math.ceil(sigma * 3) * 2 + 1);
  const half = Math.floor(kernelSize / 2);
  const kernel = new Float32Array(kernelSize);

  let sum = 0;
  for (let i = 0; i < kernelSize; i += 1) {
    const x = i - half;
    const g = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = g;
    sum += g;
  }
  for (let i = 0; i < kernelSize; i += 1) {
    kernel[i] /= sum;
  }

  // Horizontal pass
  const temp = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      let val = 0;
      for (let k = -half; k <= half; k += 1) {
        const px = Math.min(Math.max(x + k, 0), width - 1);
        val += src[rowOffset + px] * kernel[k + half];
      }
      temp[rowOffset + x] = val;
    }
  }

  // Vertical pass
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let val = 0;
      for (let k = -half; k <= half; k += 1) {
        const py = Math.min(Math.max(y + k, 0), height - 1);
        val += temp[py * width + x] * kernel[k + half];
      }
      dst[y * width + x] = val;
    }
  }

  return dst;
}

/**
 * 2D 엣지 마스크에서 벡터 스트로크(Vector Bézier Stroke) 자동 추출
 */
export function extractVectorStrokesFromEdgeMask(
  edgeMask: Uint8Array,
  width: number,
  height: number,
  tolerance = 1.5,
): VectorStrokePath[] {
  const visited = new Uint8Array(width * height);
  const strokes: VectorStrokePath[] = [];
  let strokeIdCounter = 1;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (edgeMask[idx] === 255 && visited[idx] === 0) {
        // Trace connected component path
        const pathPoints: VectorPathPoint[] = [];
        let currX = x;
        let currY = y;
        visited[idx] = 1;
        pathPoints.push({ x: currX, y: currY });

        let walking = true;
        while (walking) {
          let foundNext = false;
          // 8-way neighborhood check
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = currX + dx;
              const ny = currY + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (edgeMask[nIdx] === 255 && visited[nIdx] === 0) {
                  visited[nIdx] = 1;
                  currX = nx;
                  currY = ny;
                  pathPoints.push({ x: currX, y: currY });
                  foundNext = true;
                  break;
                }
              }
            }
            if (foundNext) break;
          }
          if (!foundNext) walking = false;
        }

        if (pathPoints.length >= 3) {
          const simplified = ramerDouglasPeucker(pathPoints, tolerance);
          const svgPath = pointsToSvgPath(simplified);
          const len = computePathLength(simplified);

          strokes.push({
            id: `stroke-${strokeIdCounter++}`,
            points: simplified,
            svgPathData: svgPath,
            isClosed: false,
            length: len,
          });
        }
      }
    }
  }

  return strokes;
}

/**
 * Ramer-Douglas-Peucker 알고리즘 (선화 폴리라인 간소화)
 */
function ramerDouglasPeucker(points: readonly VectorPathPoint[], tolerance: number): VectorPathPoint[] {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let maxIdx = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = ramerDouglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = ramerDouglasPeucker(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function perpendicularDistance(p: VectorPathPoint, lineStart: VectorPathPoint, lineEnd: VectorPathPoint): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
  return Math.abs(dy * p.x - dx * p.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / mag;
}

function pointsToSvgPath(points: readonly VectorPathPoint[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
  }
  return d;
}

function computePathLength(points: readonly VectorPathPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return Math.round(len * 100) / 100;
}

/**
 * 만화/웹툰 전용 스크린톤(Halftone Screentone) 생성기
 */
export function generateMangaScreentone(
  width: number,
  height: number,
  options: ScreentoneOptions = {},
): Uint8Array {
  const pattern = options.pattern ?? "dots";
  const frequency = Math.max(10, Math.min(150, options.frequency ?? 60));
  const angleRad = ((options.angleDeg ?? 45) * Math.PI) / 180;
  const density = Math.max(0, Math.min(1, options.density ?? 0.35));
  const toneColor = options.toneColor ?? [30, 30, 30, 255];
  const transparent = options.transparentBackground ?? true;

  const totalPixels = width * height;
  const rgba = new Uint8Array(totalPixels * 4);

  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const cellSize = Math.max(2, Math.round(300 / frequency));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;

      // Rotate coordinates by screen angle
      const rx = x * cosA - y * sinA;
      const ry = x * sinA + y * cosA;

      const modX = ((rx % cellSize) + cellSize) % cellSize;
      const modY = ((ry % cellSize) + cellSize) % cellSize;
      const normX = modX / cellSize - 0.5;
      const normY = modY / cellSize - 0.5;

      let isTone = false;

      switch (pattern) {
        case "dots": {
          const dist = Math.hypot(normX, normY);
          const maxRadius = 0.5 * Math.sqrt(density);
          isTone = dist <= maxRadius;
          break;
        }
        case "cross-hatch": {
          const lineWidth = 0.5 * density;
          const inH = Math.abs(normY) < lineWidth * 0.5;
          const inV = Math.abs(normX) < lineWidth * 0.5;
          isTone = inH || inV;
          break;
        }
        case "lines": {
          const lineWidth = density;
          isTone = Math.abs(normY) < lineWidth * 0.5;
          break;
        }
        case "diamonds": {
          const manhattan = Math.abs(normX) + Math.abs(normY);
          isTone = manhattan <= 0.7 * density;
          break;
        }
        case "sand": {
          // Deterministic pseudorandom noise
          const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
          const rand = hash - Math.floor(hash);
          isTone = rand < density;
          break;
        }
      }

      if (isTone) {
        rgba[idx] = toneColor[0];
        rgba[idx + 1] = toneColor[1];
        rgba[idx + 2] = toneColor[2];
        rgba[idx + 3] = toneColor[3];
      } else if (!transparent) {
        rgba[idx] = 255;
        rgba[idx + 1] = 255;
        rgba[idx + 2] = 255;
        rgba[idx + 3] = 255;
      }
    }
  }

  return rgba;
}
