/**
 * Studio Kaleidoscope(만화경) 대칭 — 기존 "radial"(방사) 대칭자를 확장한다.
 *
 * StudioPage.tsx의 `getSymmetricPoints`(grep 앵커: `symmetry.type === "radial"`)는 중심점 주위로
 * N개 회전 복제만 한다(Krita/CSP의 기본 방사 대칭). Kaleidoscope는 그 N개 회전 계열은 그대로 두고,
 * "각 방사 쐐기(pie slice)를 거울로도 접는다" — 그래서 한 스트로크가 회전 N개 × 반사 2개 = 2N개로
 * 복제된다(Krita의 실제 Kaleidoscope 도구와 동일한 개념). 이 모듈은 그 수학만 다루는 순수 함수
 * 모음이다 — Konva/DOM 의존 0, StudioPage.tsx는 전혀 import하지 않는다(역참조 없음).
 *
 * 수학 요약(왜 이 공식이 "회전 N + 반사 N = 2N, 딱 맞아떨어지는 정이면체군(dihedral group) D_N"이
 * 되는지):
 *   - 회전 복제(family A, 기존 radial과 100% 동일): s=0..N-1, 각도 = s·(2π/N). s=0은 항상 원본
 *     그대로(회전 0) — `getSymmetricPoints`가 `result[0] = points` 그대로 두는 관례와 동일하다.
 *   - 반사 복제(family B, kaleidoscope에서만 추가): s=0..N-1, "중심을 지나는 축 각도" = s·(π/N)
 *     (회전 각도의 절반 스텝이다 — 회전 스텝 2π/N의 딱 절반). 이 축들은 0..π 구간을 N등분해
 *     정확히 겹치지 않는 N개의 서로 다른 거울선을 만든다.
 *   - 왜 축 각도가 회전 각도의 절반이어야 하는가: "원본을 축각도 0에서 한 번 반사한 뒤 그 결과를
 *     각도 θ만큼 회전"한 것은 대수적으로 "원본을 축각도 θ/2에서 바로 반사"한 것과 정확히 같다
 *     (회전행렬 R(θ)·반사행렬 Reflect(0) = Reflect(θ/2) — 2×2 행렬을 풀어보면 그렇다). 그래서
 *     family A와 동일한 s·(2π/N) 회전 각도 시퀀스를 그대로 "절반"만 적용하면 반사 축 시퀀스가
 *     나온다 — family A/B가 같은 s 인덱싱을 공유하는 대칭적인 API가 되는 이유다.
 *   - 결과: family A(회전, N개) ∪ family B(반사, N개) = 정이면체군 D_N(위수 2N) 전체 — 이게
 *     "만화경을 들여다보는 듯한" 패턴이 나오는 이유다(각 인접 쐐기가 서로 거울상이면서 동시에
 *     전체가 N회전 대칭).
 *
 * mirror=false로 호출하면(즉 family B 생략) 기존 radial 분기와 바이트 단위로 동일한 결과를 낸다
 * (studio-kaleidoscope.test.ts의 "기존 radial과의 동등성" 테스트로 고정해 뒀다) — 그래서
 * StudioPage.tsx 통합 시 기존 "radial" 분기를 이 함수 호출로 완전히 대체해도 회귀가 없다
 * (docs/studio-kaleidoscope-integration.md §2 참고).
 */

/** kaleidoscope 대칭 스펙 — StudioPage DrawEl.symmetry(type/centerX/centerY/radialCount)의
 * "중심점+방사개수" 부분과 동일한 필드명을 쓴다(대칭적인 API). `mirror`만 이 모듈 고유 —
 * StudioPage 쪽에서는 별도 필드로 저장하지 않고 symmetryType==="kaleidoscope"일 때 항상
 * true로 넘기면 된다(통합 문서 참고 — DrawEl.symmetry 구조 자체는 바뀌지 않는다). */
export interface KaleidoscopeSpec {
  /** 대칭 중심 X(캔버스 절대좌표) — symmetry.centerX와 동일 좌표계. */
  centerX: number;
  /** 대칭 중심 Y(캔버스 절대좌표) — symmetry.centerY와 동일 좌표계. */
  centerY: number;
  /** 방사 갈래 수(N) — symmetry.radialCount와 동일 필드. 미지정/비유한/1 미만이면 4(기존 radial
   * 기본값과 동일)로 정규화. 소수점은 반올림. */
  radialCount?: number;
  /** true면 반사 계열(family B)까지 포함해 2N개, false면 회전만(N개, 기존 radial과 동일). */
  mirror: boolean;
}

/** 2D 점 하나. */
export interface Point2D {
  x: number;
  y: number;
}

/** radialCount 정규화 — 미지정/NaN/1 미만이면 4, 그 외엔 반올림한 정수. 기존 radial 분기의
 * `symmetry.radialCount ?? 4`와 동일한 기본값을 쓰되, 0/음수/NaN 같은 방어적 입력도 흡수한다
 * (기존 radial 분기는 이런 입력을 방어하지 않았지만 — count가 1보다 작으면 `for (s=1; s<count; s++)`
 * 루프가 그냥 안 도는 것뿐이라 크래시는 없었다. 여기서도 크래시는 없지만 "4개로 정규화"가 더 예측
 * 가능한 동작이라 그렇게 정했다).
 */
function normalizeRadialCount(radialCount: number | undefined): number {
  if (typeof radialCount !== "number" || !Number.isFinite(radialCount) || radialCount < 1) return 4;
  return Math.round(radialCount);
}

/** family A(회전 복제) 각도 — 기존 radial 분기의 `(s * 2 * Math.PI) / count`와 완전히 동일한 공식.
 * s=0..count-1 전부에 대해 정의되며(기존 코드는 s=1부터 루프를 돌렸지만 s=0은 각도 0 = 항등이라
 * 결과가 같다), 캔버스 가이드 렌더(방사 쐐기 경계선)도 이 함수로 각도를 구해야 한 곳에서만
 * 공식을 관리할 수 있다(StudioPage.tsx의 기존 radial 가이드 렌더가 이 공식을 인라인으로 중복
 * 갖고 있는데, 그건 손대지 않아도 되지만 — kaleidoscope 가이드는 반드시 이 함수를 써서 드로잉
 * 시점 변환과 화면 가이드가 어긋나지 않게 한다). */
export function wedgeBoundaryAngle(index: number, radialCount: number): number {
  return (index * 2 * Math.PI) / radialCount;
}

/** family B(반사 복제) 축 각도 — wedgeBoundaryAngle의 절반 스텝(모듈 docstring의 대수적 증명 참고).
 * index=0..radialCount-1에 대해 0..π 구간을 radialCount등분한 서로 다른 거울축을 만든다. */
export function mirrorAxisAngle(index: number, radialCount: number): number {
  return (index * Math.PI) / radialCount;
}

/** 점 하나를 중심(cx,cy) 기준 angle만큼 회전(반시계, Konva 표준 2D 회전행렬과 동일 부호 — 기존
 * radial 분기의 `cx + dx*cos - dy*sin, cy + dx*sin + dy*cos`와 완전히 동일한 공식을 추출했다). */
function rotateAroundCenter(point: Point2D, cx: number, cy: number, angle: number): Point2D {
  const dx = point.x - cx;
  const dy = point.y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** 점 하나를 중심(cx,cy)을 지나고 axisAngle 방향인 직선에 대해 반사한다. 원점 기준 반사행렬
 * [[cos2φ, sin2φ], [sin2φ, -cos2φ]](φ=axisAngle)를 (dx,dy)에 적용한 것 — axisAngle=0이면 기존
 * "horizontal" 대칭(y만 반전)과, axisAngle=π/2면 기존 "vertical" 대칭(x만 반전)과 정확히 같은
 * 결과를 낸다(studio-kaleidoscope.test.ts에서 이 두 특수각을 기존 vertical/horizontal 공식과
 * 직접 대조해 고정해 뒀다) — 이 함수가 기존 두 거울 대칭 타입의 진짜 일반화라는 뜻이다. */
function reflectAcrossAxis(point: Point2D, cx: number, cy: number, axisAngle: number): Point2D {
  const dx = point.x - cx;
  const dy = point.y - cy;
  const twoPhi = 2 * axisAngle;
  const cos2 = Math.cos(twoPhi);
  const sin2 = Math.sin(twoPhi);
  return { x: cx + dx * cos2 + dy * sin2, y: cy + dx * sin2 - dy * cos2 };
}

/**
 * 점 하나(x,y)를 kaleidoscope 스펙에 따라 회전(+선택적 반사) 복제한 점들의 배열로 변환한다.
 * 인덱스 0은 항상 원본 그대로(회전각 0) — 배열 순서: [원본, 회전 1..N-1, (mirror면) 반사 0..N-1].
 * mirror=false면 정확히 radialCount개(기존 radial과 동등), mirror=true면 2*radialCount개.
 */
export function kaleidoscopePointVariations(point: Point2D, spec: KaleidoscopeSpec): Point2D[] {
  const count = normalizeRadialCount(spec.radialCount);
  const { centerX: cx, centerY: cy, mirror } = spec;
  const out: Point2D[] = [{ x: point.x, y: point.y }];
  for (let s = 1; s < count; s++) {
    out.push(rotateAroundCenter(point, cx, cy, wedgeBoundaryAngle(s, count)));
  }
  if (mirror) {
    for (let s = 0; s < count; s++) {
      out.push(reflectAcrossAxis(point, cx, cy, mirrorAxisAngle(s, count)));
    }
  }
  return out;
}

/**
 * 스트로크(평탄 좌표 배열 [x0,y0,x1,y1,...]) 버전 — StudioPage.tsx `getSymmetricPoints(points,
 * symmetry)`와 동일한 계약(입력 points: number[], 반환 number[][], result[0]은 항상 원본 그대로)
 * 으로 맞췄다. 통합 시 `getSymmetricPoints`의 `symmetry.type === "radial"` 분기(그리고
 * studio-svg-export.ts의 동일 이름 포트 함수 안 같은 분기)를 이 함수 호출로 교체하면 된다
 * (docs/studio-kaleidoscope-integration.md 참고). points.length가 홀수면 마지막 낙오 좌표는
 * 무시한다(기존 radial 분기와 동일한 방어 — `points[i]`/`points[i+1]` 둘 다 undefined가 아닐 때만
 * push).
 */
export function getKaleidoscopePoints(points: number[], spec: KaleidoscopeSpec): number[][] {
  if (points.length === 0) return [points];
  const count = normalizeRadialCount(spec.radialCount);
  const { centerX: cx, centerY: cy, mirror } = spec;

  const transform = (angleFn: (s: number) => number, reflect: boolean, sMax: number): number[][] => {
    const variations: number[][] = [];
    for (let s = reflect ? 0 : 1; s < sMax; s++) {
      const angle = angleFn(s);
      const mapped: number[] = [];
      for (let i = 0; i < points.length; i += 2) {
        const x = points[i];
        const y = points[i + 1];
        if (x === undefined || y === undefined) continue;
        const p = reflect
          ? reflectAcrossAxis({ x, y }, cx, cy, angle)
          : rotateAroundCenter({ x, y }, cx, cy, angle);
        mapped.push(p.x, p.y);
      }
      variations.push(mapped);
    }
    return variations;
  };

  const result: number[][] = [points];
  result.push(...transform((s) => wedgeBoundaryAngle(s, count), false, count));
  if (mirror) {
    result.push(...transform((s) => mirrorAxisAngle(s, count), true, count));
  }
  return result;
}
