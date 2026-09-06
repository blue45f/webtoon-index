import { describe, expect, it } from "vitest";

import source from "./StudioTimelapsePanel.tsx?raw";

describe("StudioTimelapsePanel motion coach", () => {
  it("uses a stable semantic coach for the primary recording action", () => {
    expect(source).toContain("<StudioToolHintTarget");
    expect(source).toContain('id: "timelapse-record"');
    expect(source).toContain('preview: "timelapse"');
    expect(source).toContain("unavailableReason={recordDisabledReason}");
    expect(source).toContain("disabled={Boolean(recordDisabledReason)}");
  });

  it("derives an exact reason for every recording precondition", () => {
    expect(source).toContain("이 브라우저는 MediaRecorder/WebM 영상 녹화를 지원하지 않아요.");
    expect(source).toContain("마스터 편집을 종료하면 타임랩스를 만들 수 있어요.");
    expect(source).toContain("이 페이지에 그린 내용이 생기면 타임랩스를 만들 수 있어요.");
    expect(source).toContain("타임랩스 영상을 만드는 중이에요. 완료되거나 취소한 뒤 다시 실행할 수 있어요.");
    expect(source).toContain("const canRecord = recordDisabledReason === undefined;");
  });
});
