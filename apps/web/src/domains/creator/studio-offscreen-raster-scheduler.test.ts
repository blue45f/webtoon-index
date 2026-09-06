import { describe, expect, it } from "vitest";

import {
  StudioOffscreenRasterScheduler,
  arbitrateStudioOffscreenRunId,
  type StudioOffscreenDroppedJob,
} from "./studio-offscreen-raster-scheduler";

function reasons(dropped: readonly StudioOffscreenDroppedJob<string>[]): string[] {
  return dropped.map((entry) => `${entry.job.payload}:${entry.reason}`);
}

describe("studio offscreen raster scheduler — runId 중재", () => {
  it("비행 중인 런과 정확히 일치하는 결과만 받아들인다", () => {
    const state = { inFlightRunId: 5, cancelledRunIds: new Set<number>(), highestIssuedRunId: 7 };
    expect(arbitrateStudioOffscreenRunId(state, 5)).toBe("accept");
    expect(arbitrateStudioOffscreenRunId(state, 4)).toBe("superseded");
    expect(arbitrateStudioOffscreenRunId(state, 8)).toBe("unknown-run");
    expect(arbitrateStudioOffscreenRunId(state, 0)).toBe("unknown-run");
    expect(arbitrateStudioOffscreenRunId(
      { ...state, cancelledRunIds: new Set([5]) },
      5,
    )).toBe("cancelled");
  });

  it("늦게 도착한 옛 런의 결과를 stale 로 거부하고 실행 슬롯을 건드리지 않는다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>({ policy: "queue-all" });
    const first = scheduler.submit("page", "a").job;
    const second = scheduler.submit("page", "b").job;

    expect(scheduler.takeNext()?.runId).toBe(first.runId);
    expect(scheduler.settle(first.runId).kind).toBe("accept");
    expect(scheduler.takeNext()?.runId).toBe(second.runId);

    const stale = scheduler.settle(first.runId);
    expect(stale.kind).toBe("stale");
    expect(scheduler.inFlightRunId).toBe(second.runId);

    const accepted = scheduler.settle(second.runId);
    expect(accepted).toEqual({ kind: "accept", job: second });
    expect(scheduler.inFlightRunId).toBeNull();
  });

  it("최신 제출이 같은 키의 비행 중 런을 무효화한다(newest wins)", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    const first = scheduler.submit("thumb", "old").job;
    scheduler.takeNext();
    const outcome = scheduler.submit("thumb", "new");

    expect(outcome.supersededInFlightRunId).toBe(first.runId);
    // 대체된 런의 결과는 커밋되지 않지만, 그 런이 끝났으므로 실행 슬롯은 열린다.
    expect(scheduler.settle(first.runId)).toEqual({ kind: "stale", reason: "cancelled" });
    expect(scheduler.inFlightRunId).toBeNull();
    expect(scheduler.takeNext()?.payload).toBe("new");
  });

  it("비행 중이 아닌 옛 런의 늦은 결과는 현재 비행 슬롯을 건드리지 않는다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>({ policy: "queue-all" });
    const first = scheduler.submit("a", "a1").job;
    const second = scheduler.submit("b", "b1").job;
    scheduler.takeNext();
    scheduler.settle(first.runId);
    scheduler.takeNext();

    expect(scheduler.settle(first.runId)).toEqual({ kind: "stale", reason: "superseded" });
    expect(scheduler.inFlightRunId).toBe(second.runId);
  });
});

describe("studio offscreen raster scheduler — 코얼레싱과 백프레셔", () => {
  it("폭주하는 같은 키 요청을 대기열에서 최신 하나로 접는다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    scheduler.submit("thumb:1", "v1");
    scheduler.submit("thumb:1", "v2");
    const third = scheduler.submit("thumb:1", "v3");

    expect(reasons(third.dropped)).toEqual(["v2:coalesced"]);
    expect(scheduler.queuedCount).toBe(1);
    expect(scheduler.peekQueue()[0]?.payload).toBe("v3");
  });

  it("서로 다른 키는 접지 않고 제출 순서를 유지한다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    scheduler.submit("a", "a1");
    scheduler.submit("b", "b1");
    scheduler.submit("a", "a2");

    expect(scheduler.peekQueue().map((job) => job.payload)).toEqual(["b1", "a2"]);
  });

  it("queue-all 정책은 같은 키도 접지 않는다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>({ policy: "queue-all", maxQueued: 4 });
    scheduler.submit("a", "a1");
    const second = scheduler.submit("a", "a2");

    expect(second.dropped).toEqual([]);
    expect(second.supersededInFlightRunId).toBeNull();
    expect(scheduler.queuedCount).toBe(2);
  });

  it("대기열 상한을 넘으면 가장 오래된 잡부터 백프레셔로 버린다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>({ maxQueued: 2 });
    scheduler.submit("a", "a1");
    scheduler.submit("b", "b1");
    const third = scheduler.submit("c", "c1");

    expect(reasons(third.dropped)).toEqual(["a1:backpressure"]);
    expect(scheduler.peekQueue().map((job) => job.payload)).toEqual(["b1", "c1"]);
  });

  it("버스트 100회가 왕복 1건과 최신 페이로드로 수렴한다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    let coalesced = 0;
    for (let index = 0; index < 100; index += 1) {
      const outcome = scheduler.submit("stroke-preview", `frame-${index}`);
      coalesced += outcome.dropped.filter((entry) => entry.reason === "coalesced").length;
    }
    expect(coalesced).toBe(99);
    expect(scheduler.queuedCount).toBe(1);
    expect(scheduler.takeNext()?.payload).toBe("frame-99");
    expect(scheduler.takeNext()).toBeNull();
  });
});

describe("studio offscreen raster scheduler — 취소와 폐기", () => {
  it("대기 중인 잡 취소는 큐에서 빼고 이후 실행되지 않는다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    const first = scheduler.submit("a", "a1").job;
    const second = scheduler.submit("b", "b1").job;

    expect(scheduler.cancel(first.runId)).toEqual({ job: first, reason: "cancelled" });
    expect(scheduler.queuedCount).toBe(1);
    expect(scheduler.takeNext()?.runId).toBe(second.runId);
  });

  it("비행 중 취소는 결과가 와도 stale 로 떨어뜨린다(mid-flight)", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    const job = scheduler.submit("a", "a1").job;
    scheduler.takeNext();

    expect(scheduler.cancel(job.runId)?.reason).toBe("cancelled");
    expect(scheduler.settle(job.runId)).toEqual({ kind: "stale", reason: "cancelled" });
  });

  it("존재하지 않는 런 취소는 null 을 돌려준다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    expect(scheduler.cancel(999)).toBeNull();
  });

  it("abandonInFlight 는 슬롯을 열고 다음 잡을 진행시킨다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    const first = scheduler.submit("a", "a1").job;
    const second = scheduler.submit("b", "b1").job;
    scheduler.takeNext();

    expect(scheduler.takeNext()).toBeNull();
    expect(scheduler.abandonInFlight()?.runId).toBe(first.runId);
    expect(scheduler.takeNext()?.runId).toBe(second.runId);
  });

  it("dispose 는 대기·비행 잡 전부를 disposed 로 회수하고 재제출을 막는다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>();
    scheduler.submit("a", "a1");
    scheduler.takeNext();
    scheduler.submit("b", "b1");

    const dropped = scheduler.dispose();
    expect(reasons(dropped).sort()).toEqual(["a1:disposed", "b1:disposed"]);
    expect(scheduler.isDisposed).toBe(true);
    expect(scheduler.dispose()).toEqual([]);
    expect(() => scheduler.submit("c", "c1")).toThrow(/폐기된/u);
  });
});

describe("studio offscreen raster scheduler — 결정성", () => {
  it("같은 제출 시퀀스는 같은 runId·드롭 결정을 만든다", () => {
    const script: readonly (readonly [string, string])[] = [
      ["a", "a1"], ["a", "a2"], ["b", "b1"], ["c", "c1"], ["b", "b2"], ["a", "a3"],
    ];
    const replay = () => {
      const scheduler = new StudioOffscreenRasterScheduler<string>({ maxQueued: 3, firstRunId: 1 });
      const trace: string[] = [];
      for (const [key, payload] of script) {
        const outcome = scheduler.submit(key, payload);
        trace.push(`${outcome.job.runId}|${key}|${reasons(outcome.dropped).join(",")}`);
      }
      let next = scheduler.takeNext();
      while (next) {
        trace.push(`run:${next.runId}:${next.payload}`);
        scheduler.settle(next.runId);
        next = scheduler.takeNext();
      }
      return trace;
    };

    const first = replay();
    expect(first).toEqual(replay());
    expect(first[0]).toBe("1|a|");
    expect(first.at(-1)).toBe("run:6:a3");
  });

  it("runId 는 코얼레싱·취소와 무관하게 단조 증가한다", () => {
    const scheduler = new StudioOffscreenRasterScheduler<string>({ firstRunId: 10 });
    const ids = [
      scheduler.submit("a", "1").job.runId,
      scheduler.submit("a", "2").job.runId,
      scheduler.submit("b", "3").job.runId,
    ];
    expect(ids).toEqual([10, 11, 12]);
    expect(scheduler.arbitrationState().highestIssuedRunId).toBe(12);
  });
});
