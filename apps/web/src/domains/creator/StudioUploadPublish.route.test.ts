import { describe, expect, it } from "vitest";

import { resolveStudioUploadWorkId } from "./studio-upload-route";

describe("StudioUploadPublish route identity", () => {
  it("prefers the canonical path identity and preserves the legacy query fallback", () => {
    expect(resolveStudioUploadWorkId("canonical-work", "legacy-work")).toBe("canonical-work");
    expect(resolveStudioUploadWorkId(undefined, "legacy-work")).toBe("legacy-work");
    expect(resolveStudioUploadWorkId(null, "legacy-work")).toBeNull();
  });
});
