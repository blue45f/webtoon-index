// DB는 평점을 ×10 정수로 저장 (0.5~5 → 5~50)
export const toDb = (v: number) => Math.round(v * 10);
export const fromDb = (v: number) => v / 10;
