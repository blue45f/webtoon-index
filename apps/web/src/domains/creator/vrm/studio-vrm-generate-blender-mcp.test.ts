import { describe, expect, it } from "vitest";

import {
  createBlenderStudioVrmGenerateMcpHost,
  probeBlenderVrmGenerateMcp,
} from "./studio-vrm-generate-blender-mcp";
import { generateStudioVrmCharacter } from "./studio-vrm-generate-mcp";

describe("Blender VRM generate MCP probe", () => {
  it("fails closed instead of inventing VRM bytes when Blender MCP cannot generate", async () => {
    const probe = probeBlenderVrmGenerateMcp({
      BLENDER_PATH: "",
      BLENDER_BIN: "",
      STUDIO_MCP_BRIDGE_COMMAND: "",
      STUDIO_MCP_BRIDGE_PATH: "",
      PATH: "",
    });
    expect(probe.available).toBe(false);
    expect(probe.reason.length).toBeGreaterThan(8);

    const result = await generateStudioVrmCharacter(
      { presetId: "natural-short" },
      { host: createBlenderStudioVrmGenerateMcpHost({ PATH: "" }) },
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") throw new Error("expected fail-closed blender host");
    expect(result.hostId).toBe("blender-mcp");
    expect(result.code).toBe("vrm_generate_mcp_unavailable");
  });
});
