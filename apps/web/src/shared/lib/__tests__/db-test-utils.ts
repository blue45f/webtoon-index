/**
 * 병렬 테스트 DB 정리 유틸.
 * 여러 테스트 파일이 같은 테이블(user 등)을 동시에 delete 하면 Postgres 교착이
 * 드물게 난다(40P01 deadlock_detected / 40001 serialization_failure). Postgres가
 * 한쪽 트랜잭션만 abort 하므로 짧게 backoff 후 재시도하면 안정적으로 통과한다.
 * 정리(cleanup) 같은 멱등 연산에만 쓴다.
 */
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i < attempts - 1 && isTransientDbConflict(err)) {
        // 선형 backoff(25·50·75…ms): 상대 트랜잭션이 끝날 시간을 준다.
        await new Promise((resolve) => setTimeout(resolve, 25 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

// drizzle/pg 에러는 code가 최상위 또는 cause 체인에 있다 — 체인을 따라가며 일시적 충돌을 찾는다.
function isTransientDbConflict(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 6; depth++) {
    const e = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === "40P01" || e.code === "40001") return true;
    if (typeof e.message === "string" && /deadlock detected|could not serialize/i.test(e.message)) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}
