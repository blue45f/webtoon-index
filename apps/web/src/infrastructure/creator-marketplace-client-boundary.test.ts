import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const facadeSource = readFileSync(
  new URL("./creator-marketplace-client.ts", import.meta.url),
  "utf8",
);
const networkSource = readFileSync(
  new URL("./creator-marketplace-client-network.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("../domains/creator/studio-creator-pack-runtime.ts", import.meta.url),
  "utf8",
);

describe("creator marketplace feature bundle boundary", () => {
  it("순수 delivery facade에서 API transport를 정적 로드하지 않는다", () => {
    expect(facadeSource).not.toContain(
      'from "@/src/infrastructure/api"',
    );
    expect(facadeSource).toContain(
      'import("./creator-marketplace-client-network")',
    );
    expect(facadeSource).toContain("loadChunkWithReloadRecovery");
    expect(facadeSource).toContain('"CreatorMarketplaceNetworkClient"');
    expect(networkSource).toContain(
      'from "@/src/infrastructure/api"',
    );
  });

  it("creator pack runtime의 delivery 생성은 가짜 동적 import 없이 순수 facade를 사용한다", () => {
    expect(runtimeSource).toContain(
      'from "@/src/infrastructure/creator-marketplace-client"',
    );
    expect(runtimeSource).not.toMatch(
      /await import\(\s*"@\/src\/infrastructure\/creator-marketplace-client"\s*\)/u,
    );
  });
});
