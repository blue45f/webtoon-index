// 경량 인메모리 슬라이딩 윈도 레이트리밋 — 인증 엔드포인트 남용(열거·크리덴셜 스터핑) 완화.
// 한계: 단일 인스턴스 기준 베이스라인. 서버리스 멀티 인스턴스에선 인스턴스별로 카운트되므로
// 강건한 보호가 필요하면 공유 스토어(KV/Upstash 등)로 교체해야 한다.
const hits = new Map<string, number[]>();
const MAX_KEYS = 5000;

// true=허용, false=한도 초과(차단)
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // 만료 키 정리 — 허용/차단과 무관하게 맵이 임계 이상이면 수행 (위조 키 폭주 시 메모리/CPU 방어).
  if (hits.size > MAX_KEYS) {
    for (const [k, v] of hits) {
      const live = v.filter((t) => now - t < windowMs);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
    }
    // 정리 후에도 초과면 가장 오래된 키부터 강제 축출(삽입 순서 = Map 반복 순서) → 메모리 상한 보장.
    if (hits.size > MAX_KEYS) {
      let excess = hits.size - MAX_KEYS;
      for (const k of hits.keys()) {
        if (excess-- <= 0) break;
        hits.delete(k);
      }
    }
  }

  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// 요청에서 클라이언트 IP 추정.
// 주의: x-forwarded-for 맨 왼쪽은 클라이언트가 위조할 수 있다(베이스라인 한계). 신뢰 가능한
// 보호가 필요하면 배포 플랫폼이 보장하는 IP(예: Vercel) 또는 신뢰 프록시 hop 기반으로 교체할 것.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
