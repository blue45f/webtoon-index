import { describe, expect, it } from "vitest";

import {
  captureStudioInkInputContractV1,
  captureStudioInkInputContractV2,
  isStudioInkInputContractV1,
  isStudioInkInputContractV2,
  normalizeStudioInkInputContract,
} from "./studio-ink-input-contract";

describe("studio ink input contract", () => {
  it("captures pen provenance without a device identifier", () => {
    const contract = captureStudioInkInputContractV1("pen");
    expect(contract).toMatchObject({
      kind: "studio-ink-input-contract",
      version: 1,
      pointerType: "pen",
      pressureSource: "device-or-browser",
      authoritativeSamples: "coalesced-or-dispatched-v1",
      predictedSamples: "preview-only-never-persisted-v1",
      privacy: "no-device-identifier-v1",
      channels: {
        position: "studio-document-px",
        pressure: "normalized-0-1",
        orientation: "pointer-event-degrees-or-neutral",
        speed: "client-css-px-per-ms-derived",
        tangentialPressure: "normalized-minus1-to1-or-neutral",
        timestamps: "not-persisted-v1",
      },
    });
    expect(JSON.stringify(contract)).not.toContain("deviceId");
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.channels)).toBe(true);
  });

  it("captures v2 authoritative relative-time and extended Pointer Events semantics", () => {
    const contract = captureStudioInkInputContractV2("pen");
    expect(contract).toMatchObject({
      version: 2,
      pointerType: "pen",
      predictedSamples: "preview-only-never-persisted-v1",
      privacy: "no-device-identifier-v1",
      channels: {
        tilt: "pointer-event-degrees-or-neutral",
        altitudeAngle: "pointer-event-radians-0-pi-over-2-or-neutral",
        azimuthAngle: "pointer-event-radians-0-2pi-or-neutral",
        twist: "pointer-event-degrees-0-360-or-neutral",
        contactGeometry: "pointer-event-css-px-or-neutral",
        timestamps: "authoritative-gesture-relative-ms-v1",
      },
    });
    expect(JSON.stringify(contract)).not.toContain("deviceId");
    expect(JSON.stringify(contract)).not.toContain("timeOrigin");
    expect(isStudioInkInputContractV2(contract)).toBe(true);
    expect(isStudioInkInputContractV1(contract)).toBe(false);
  });

  it.each(["mouse", "touch", "unsupported"])(
    "marks %s pressure as simulated",
    (pointerType) => {
      const contract = captureStudioInkInputContractV1(pointerType);
      expect(contract.pointerType).toBe(
        pointerType === "unsupported" ? "unknown" : pointerType,
      );
      expect(contract.pressureSource).toBe("simulated");
    },
  );

  it("round-trips canonical JSON and rejects unknown or contradictory semantics", () => {
    const canonical = captureStudioInkInputContractV1("pen");
    expect(normalizeStudioInkInputContract(
      JSON.parse(JSON.stringify(canonical)),
    )).toEqual(canonical);

    expect(normalizeStudioInkInputContract({
      ...canonical,
      version: 2,
    })).toBeNull();
    expect(normalizeStudioInkInputContract({
      ...canonical,
      pressureSource: "simulated",
    })).toBeNull();
    expect(normalizeStudioInkInputContract({
      ...canonical,
      vendorDeviceId: "fingerprint",
    })).toBeNull();
    expect(normalizeStudioInkInputContract({
      ...canonical,
      channels: {
        ...canonical.channels,
        timestamps: "milliseconds",
      },
    })).toBeNull();
  });

  it("round-trips v1 and v2 as exact discriminated versions and rejects future mixes", () => {
    const v1 = captureStudioInkInputContractV1("touch");
    const v2 = captureStudioInkInputContractV2("touch");
    expect(normalizeStudioInkInputContract(structuredClone(v1))).toEqual(v1);
    expect(normalizeStudioInkInputContract(structuredClone(v2))).toEqual(v2);
    expect(normalizeStudioInkInputContract({
      ...v2,
      version: 3,
    })).toBeNull();
    expect(normalizeStudioInkInputContract({
      ...v1,
      version: 2,
    })).toBeNull();
    expect(normalizeStudioInkInputContract({
      ...v2,
      version: 1,
    })).toBeNull();
  });

  it("rejects accessors and exotic prototypes at the persistence boundary", () => {
    const accessor = {
      ...captureStudioInkInputContractV1("pen"),
      get pointerType() {
        return "pen";
      },
    };
    expect(normalizeStudioInkInputContract(accessor)).toBeNull();
    expect(normalizeStudioInkInputContract(
      Object.assign(Object.create({}), captureStudioInkInputContractV1("pen")),
    )).toBeNull();
  });
});
