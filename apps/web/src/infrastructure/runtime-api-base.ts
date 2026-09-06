let runtimeApiBase = "";

/**
 * 프리뷰나 별도 API 배포가 공용 클라이언트에 런타임 API 오리진을 주입할 수 있게 합니다.
 */
export function setRuntimeApiBase(value: string): void {
  runtimeApiBase = value.trim().replace(/\/+$/, "");
}

export function getRuntimeApiBase(): string {
  return runtimeApiBase;
}
