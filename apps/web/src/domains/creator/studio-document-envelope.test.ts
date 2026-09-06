import { describe, expect, it } from "vitest";

import {
  StudioDocumentEnvelopeError,
  StudioDocumentMigratorRegistry,
  StudioDocumentRegistryError,
  canonicalizeStudioDocumentEnvelope,
  checksumCanonicalStudioDocumentEnvelope,
  createCanonicalStudioDocumentEnvelope,
  createStudioDocumentMigratorRegistry,
  parseCanonicalStudioDocumentEnvelope,
  serializeCanonicalStudioDocumentEnvelope,
  type CanonicalStudioDocumentEnvelope,
  type StudioDocumentFormatDefinition,
  type StudioDocumentJsonObject,
  type StudioDocumentJsonValue,
  type StudioDocumentRegistryErrorCode,
} from "./studio-document-envelope";

const CREATED_AT = "2026-07-01T00:00:00.000Z";
const UPDATED_AT = "2026-07-26T12:34:56.789Z";

function envelopeInput(
  version = 1,
  data: unknown = { title: "첫 문서" },
  extensions: Readonly<Record<string, unknown>> = {
    "vendor.future": {
      enabled: true,
      nested: { z: 3, a: 1 },
    },
  }
) {
  return {
    format: {
      id: "toonspectrum.studio-project",
      version,
    },
    document: {
      id: "doc:01J0TEST",
      revision: 7,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
    payload: {
      type: "project",
      data,
    },
    extensions,
  };
}

function payloadObject(
  envelope: CanonicalStudioDocumentEnvelope
): StudioDocumentJsonObject {
  const data = envelope.payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Expected object payload fixture.");
  }
  return data as StudioDocumentJsonObject;
}

function migrateEnvelope(
  envelope: CanonicalStudioDocumentEnvelope,
  version: number,
  data: StudioDocumentJsonValue
) {
  return {
    ...envelope,
    format: {
      ...envelope.format,
      version,
    },
    payload: {
      ...envelope.payload,
      data,
    },
  };
}

function versionedDefinition(
  migrators: StudioDocumentFormatDefinition["migrators"],
  options: {
    minimumVersion?: number;
    currentVersion?: number;
  } = {}
): StudioDocumentFormatDefinition {
  return {
    formatId: "toonspectrum.studio-project",
    payloadType: "project",
    minimumVersion: options.minimumVersion ?? 1,
    currentVersion: options.currentVersion ?? 3,
    migrators,
  };
}

const MIGRATE_ONE_TO_TWO = {
  id: "project-v1-to-v2",
  fromVersion: 1,
  toVersion: 2,
  migrate(envelope: CanonicalStudioDocumentEnvelope) {
    return migrateEnvelope(envelope, 2, {
      ...payloadObject(envelope),
      pages: [],
    });
  },
};

const MIGRATE_TWO_TO_THREE = {
  id: "project-v2-to-v3",
  fromVersion: 2,
  toVersion: 3,
  async migrate(envelope: CanonicalStudioDocumentEnvelope) {
    return migrateEnvelope(envelope, 3, {
      ...payloadObject(envelope),
      settings: { theme: "classic" },
    });
  },
};

function expectRegistryError(
  operation: () => unknown,
  code: StudioDocumentRegistryErrorCode
): void {
  try {
    operation();
    throw new Error("Expected StudioDocumentRegistryError.");
  } catch (error) {
    expect(error).toBeInstanceOf(StudioDocumentRegistryError);
    expect((error as StudioDocumentRegistryError).code).toBe(code);
  }
}

async function withoutCryptoSubtle<T>(operation: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    value: Object.freeze({}),
  });
  try {
    return await operation();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "crypto", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
  }
}

describe("canonical Studio document envelope", () => {
  it("validates, detaches, brands, and deeply freezes the complete envelope", () => {
    const input = envelopeInput();
    const result = canonicalizeStudioDocumentEnvelope(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope).not.toBe(input);
    expect(result.envelope).toMatchObject(input);
    expect(Object.isFrozen(result.envelope)).toBe(true);
    expect(Object.isFrozen(result.envelope.payload.data)).toBe(true);
    expect(Object.isFrozen(result.envelope.extensions["vendor.future"])).toBe(true);
    expect(result.envelope.extensions).not.toBe(input.extensions);
  });

  it("throws a typed error from the strict creation helper", () => {
    const invalid = envelopeInput();
    invalid.document.updatedAt = "2026-06-01T00:00:00.000Z";

    expect(() => createCanonicalStudioDocumentEnvelope(invalid)).toThrow(
      StudioDocumentEnvelopeError
    );
  });

  it.each([
    {
      label: "unknown root key",
      mutate: () => ({ ...envelopeInput(), future: true }),
      code: "INVALID_ENVELOPE",
    },
    {
      label: "invalid format id",
      mutate: () => ({
        ...envelopeInput(),
        format: { id: "Studio Project", version: 1 },
      }),
      code: "INVALID_ENVELOPE",
    },
    {
      label: "non-finite payload number",
      mutate: () => envelopeInput(1, { opacity: Number.POSITIVE_INFINITY }),
      code: "INVALID_JSON_VALUE",
    },
    {
      label: "oversized extension map",
      mutate: () =>
        envelopeInput(
          1,
          { title: "x" },
          { one: true, two: true }
        ),
      code: "LIMIT_EXCEEDED",
      limits: { maxExtensions: 1 },
    },
  ])("fails closed for $label", ({ mutate, code, limits }) => {
    const result = canonicalizeStudioDocumentEnvelope(mutate(), { limits });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(code);
  });

  it("rejects cyclic, accessor-backed, and sparse JSON graphs", () => {
    const cyclic: Record<string, unknown> = { title: "cycle" };
    cyclic.self = cyclic;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => "unsafe",
    });
    const sparse = new Array(2);
    sparse[1] = "value";

    for (const value of [cyclic, accessor, sparse]) {
      const result = canonicalizeStudioDocumentEnvelope(envelopeInput(1, value));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0].code).toBe("INVALID_JSON_VALUE");
      }
    }
  });

  it("serializes recursively in canonical key order and normalizes negative zero", () => {
    const left = createCanonicalStudioDocumentEnvelope(
      envelopeInput(1, {
        z: -0,
        a: { second: 2, first: 1 },
      })
    );
    const right = createCanonicalStudioDocumentEnvelope({
      extensions: {
        "vendor.future": {
          nested: { a: 1, z: 3 },
          enabled: true,
        },
      },
      payload: {
        data: {
          a: { first: 1, second: 2 },
          z: 0,
        },
        type: "project",
      },
      document: {
        updatedAt: UPDATED_AT,
        revision: 7,
        id: "doc:01J0TEST",
        createdAt: CREATED_AT,
      },
      format: {
        version: 1,
        id: "toonspectrum.studio-project",
      },
    });

    const serialized = serializeCanonicalStudioDocumentEnvelope(left);
    expect(serialized).toBe(serializeCanonicalStudioDocumentEnvelope(right));
    expect(serialized).toBe(
      `{"document":{"createdAt":"${CREATED_AT}","id":"doc:01J0TEST","revision":7,"updatedAt":"${UPDATED_AT}"},"extensions":{"vendor.future":{"enabled":true,"nested":{"a":1,"z":3}}},"format":{"id":"toonspectrum.studio-project","version":1},"payload":{"data":{"a":{"first":1,"second":2},"z":0},"type":"project"}}`
    );
  });

  it("accepts only its exact deterministic wire representation at the canonical parse boundary", () => {
    const envelope = createCanonicalStudioDocumentEnvelope(envelopeInput());
    const canonical = serializeCanonicalStudioDocumentEnvelope(envelope);
    const nonCanonical = JSON.stringify(envelopeInput());

    expect(parseCanonicalStudioDocumentEnvelope(canonical).ok).toBe(true);
    const rejected = parseCanonicalStudioDocumentEnvelope(nonCanonical);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]).toMatchObject({
        code: "NON_CANONICAL_SERIALIZATION",
        recoverable: true,
      });
    }
  });

  it("computes the same SHA-256 for semantically identical canonical envelopes", async () => {
    const first = createCanonicalStudioDocumentEnvelope(envelopeInput());
    const second = createCanonicalStudioDocumentEnvelope({
      ...envelopeInput(),
      extensions: {
        "vendor.future": {
          nested: { a: 1, z: 3 },
          enabled: true,
        },
      },
    });
    const changed = createCanonicalStudioDocumentEnvelope(
      envelopeInput(1, { title: "다른 문서" })
    );

    const firstChecksum = await checksumCanonicalStudioDocumentEnvelope(first);
    expect(firstChecksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await checksumCanonicalStudioDocumentEnvelope(second)).toBe(
      firstChecksum
    );
    expect(await checksumCanonicalStudioDocumentEnvelope(changed)).not.toBe(
      firstChecksum
    );
  });

  it("preserves the exact checksum contract when Web Crypto is unavailable", async () => {
    const envelope = createCanonicalStudioDocumentEnvelope(envelopeInput());
    const nativeChecksum =
      await checksumCanonicalStudioDocumentEnvelope(envelope);

    const portableChecksum = await withoutCryptoSubtle(() =>
      checksumCanonicalStudioDocumentEnvelope(envelope)
    );

    expect(portableChecksum).toBe(nativeChecksum);
    expect(globalThis.crypto?.subtle).toBeDefined();
  });
});

describe("Studio document migrator registry topology", () => {
  it("sorts a complete migration path and exposes immutable registry metadata", () => {
    const registry = createStudioDocumentMigratorRegistry([
      versionedDefinition([
        MIGRATE_TWO_TO_THREE,
        MIGRATE_ONE_TO_TWO,
      ]),
    ]);

    const formats = registry.list();
    expect(formats).toEqual([
      {
        formatId: "toonspectrum.studio-project",
        payloadType: "project",
        minimumVersion: 1,
        currentVersion: 3,
        migrators: [
          {
            id: "project-v1-to-v2",
            fromVersion: 1,
            toVersion: 2,
          },
          {
            id: "project-v2-to-v3",
            fromVersion: 2,
            toVersion: 3,
          },
        ],
      },
    ]);
    expect(Object.isFrozen(formats)).toBe(true);
    expect(Object.isFrozen(formats[0].migrators)).toBe(true);
  });

  it("rejects duplicate formats and duplicate migrator ids/from versions", () => {
    const definition = versionedDefinition([
      MIGRATE_ONE_TO_TWO,
      MIGRATE_TWO_TO_THREE,
    ]);
    const registry = new StudioDocumentMigratorRegistry([definition]);
    expectRegistryError(() => registry.register(definition), "DUPLICATE_FORMAT");

    expectRegistryError(
      () =>
        new StudioDocumentMigratorRegistry([
          versionedDefinition([
            MIGRATE_ONE_TO_TWO,
            {
              ...MIGRATE_ONE_TO_TWO,
              id: "another-v1-migrator",
            },
            MIGRATE_TWO_TO_THREE,
          ]),
        ]),
      "DUPLICATE_MIGRATOR"
    );
  });

  it("rejects gaps, downgrades, and cycles before any document can run", () => {
    expectRegistryError(
      () =>
        new StudioDocumentMigratorRegistry([
          versionedDefinition([MIGRATE_ONE_TO_TWO]),
        ]),
      "MIGRATOR_GAP"
    );

    expectRegistryError(
      () =>
        new StudioDocumentMigratorRegistry([
          versionedDefinition(
            [
              {
                id: "project-v2-to-v1",
                fromVersion: 2,
                toVersion: 1,
                migrate: (envelope) => envelope,
              },
            ],
            { minimumVersion: 2, currentVersion: 3 }
          ),
        ]),
      "MIGRATOR_DOWNGRADE"
    );

    expectRegistryError(
      () =>
        new StudioDocumentMigratorRegistry([
          versionedDefinition([
            MIGRATE_ONE_TO_TWO,
            {
              id: "project-v2-to-v1",
              fromVersion: 2,
              toVersion: 1,
              migrate: (envelope) => envelope,
            },
          ]),
        ]),
      "MIGRATOR_CYCLE"
    );
  });
});

describe("Studio document migration execution", () => {
  function registry(): StudioDocumentMigratorRegistry {
    return createStudioDocumentMigratorRegistry([
      versionedDefinition([
        MIGRATE_TWO_TO_THREE,
        MIGRATE_ONE_TO_TWO,
      ]),
    ]);
  }

  it("runs ordered sync/async migrators, preserves extensions and identity, and emits provenance", async () => {
    const result = await registry().migrate(envelopeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.format.version).toBe(3);
    expect(result.envelope.document).toEqual(envelopeInput().document);
    expect(result.envelope.extensions).toEqual(envelopeInput().extensions);
    expect(result.envelope.payload.data).toEqual({
      title: "첫 문서",
      pages: [],
      settings: { theme: "classic" },
    });
    expect(result.receipt).toMatchObject({
      receiptVersion: 1,
      formatId: "toonspectrum.studio-project",
      payloadType: "project",
      documentId: "doc:01J0TEST",
      documentRevision: 7,
      fromVersion: 1,
      toVersion: 3,
      migrated: true,
    });
    expect(result.receipt.steps.map((step) => step.migratorId)).toEqual([
      "project-v1-to-v2",
      "project-v2-to-v3",
    ]);
    expect(result.receipt.steps[0].inputChecksum).toBe(
      result.receipt.sourceChecksum
    );
    expect(result.receipt.steps[0].outputChecksum).toBe(
      result.receipt.steps[1].inputChecksum
    );
    expect(result.receipt.steps[1].outputChecksum).toBe(
      result.receipt.resultChecksum
    );
    expect(Object.isFrozen(result.receipt)).toBe(true);
    expect(Object.isFrozen(result.receipt.steps)).toBe(true);
  });

  it("is idempotent when a migrated document is passed through the registry again", async () => {
    const first = await registry().migrate(envelopeInput());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await registry().migrate(first.envelope);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(serializeCanonicalStudioDocumentEnvelope(second.envelope)).toBe(
      serializeCanonicalStudioDocumentEnvelope(first.envelope)
    );
    expect(second.receipt).toMatchObject({
      fromVersion: 3,
      toVersion: 3,
      migrated: false,
      sourceChecksum: first.receipt.resultChecksum,
      resultChecksum: first.receipt.resultChecksum,
      steps: [],
    });
  });

  it("keeps current-version migration idempotent without Web Crypto", async () => {
    await withoutCryptoSubtle(async () => {
      const current = createCanonicalStudioDocumentEnvelope(
        envelopeInput(3, {
          title: "현재 문서",
          pages: [],
          settings: { theme: "classic" },
        })
      );
      const first = await registry().migrate(current);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const second = await registry().migrate(first.envelope);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.receipt).toMatchObject({
        fromVersion: 3,
        toVersion: 3,
        migrated: false,
        sourceChecksum: first.receipt.resultChecksum,
        resultChecksum: first.receipt.resultChecksum,
        steps: [],
      });
      expect(second.receipt.resultChecksum).toMatch(
        /^sha256:[a-f0-9]{64}$/u
      );
    });
  });

  it("migrates v1 with complete provenance when Web Crypto is unavailable", async () => {
    const result = await withoutCryptoSubtle(() =>
      registry().migrate(envelopeInput())
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.format.version).toBe(3);
    expect(result.receipt.steps).toHaveLength(2);
    expect(result.receipt.sourceChecksum).toMatch(
      /^sha256:[a-f0-9]{64}$/u
    );
    expect(result.receipt.steps[0].inputChecksum).toBe(
      result.receipt.sourceChecksum
    );
    expect(result.receipt.steps[1].outputChecksum).toBe(
      result.receipt.resultChecksum
    );
  });

  it("fails closed on future versions with a recoverable typed diagnostic and preserved source", async () => {
    const input = envelopeInput(4);
    const result = await registry().migrate(input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "UNKNOWN_FUTURE_VERSION",
        recoverable: true,
        recovery: "upgrade-client",
        formatId: "toonspectrum.studio-project",
        payloadType: "project",
        actualVersion: 4,
        currentVersion: 3,
      })
    );
    expect(result.preservedEnvelope?.extensions).toEqual(input.extensions);
    expect(result.preservedEnvelope?.format.version).toBe(4);
  });

  it("returns recoverable diagnostics for unregistered format and payload discriminators", async () => {
    const registryWithProject = registry();
    const unknownFormat = await registryWithProject.migrate({
      ...envelopeInput(),
      format: { id: "vendor.future-format", version: 1 },
    });
    const unknownPayload = await registryWithProject.migrate({
      ...envelopeInput(),
      payload: { type: "scene", data: {} },
    });

    expect(unknownFormat.ok).toBe(false);
    expect(unknownPayload.ok).toBe(false);
    if (!unknownFormat.ok && !unknownPayload.ok) {
      expect(unknownFormat.diagnostics[0].code).toBe("FORMAT_NOT_REGISTERED");
      expect(unknownPayload.diagnostics[0].code).toBe(
        "PAYLOAD_TYPE_NOT_REGISTERED"
      );
      expect(unknownFormat.preservedEnvelope).toBeDefined();
      expect(unknownPayload.preservedEnvelope).toBeDefined();
    }
  });

  it("enforces both step and cumulative-byte migration budgets", async () => {
    const stepLimited = await registry().migrate(envelopeInput(), {
      budget: { maxSteps: 1 },
    });
    expect(stepLimited.ok).toBe(false);
    if (!stepLimited.ok) {
      expect(stepLimited.diagnostics[0]).toMatchObject({
        code: "MIGRATION_BUDGET_EXCEEDED",
        requiredSteps: 2,
        maximumSteps: 1,
      });
    }

    const source = createCanonicalStudioDocumentEnvelope(envelopeInput());
    const sourceBytes = new TextEncoder().encode(
      serializeCanonicalStudioDocumentEnvelope(source)
    ).byteLength;
    const byteLimited = await registry().migrate(source, {
      budget: {
        maxCumulativeBytes: sourceBytes,
      },
    });
    expect(byteLimited.ok).toBe(false);
    if (!byteLimited.ok) {
      expect(byteLimited.diagnostics[0]).toMatchObject({
        code: "MIGRATION_BUDGET_EXCEEDED",
        maximumCumulativeBytes: sourceBytes,
      });
      expect(byteLimited.preservedEnvelope).toBeDefined();
    }
  });

  it.each([
    {
      label: "extension mutation",
      migrate: (envelope: CanonicalStudioDocumentEnvelope) => ({
        ...migrateEnvelope(envelope, 2, payloadObject(envelope)),
        extensions: {
          ...envelope.extensions,
          "vendor.future": { overwritten: true },
        },
      }),
    },
    {
      label: "document revision mutation",
      migrate: (envelope: CanonicalStudioDocumentEnvelope) => ({
        ...migrateEnvelope(envelope, 2, payloadObject(envelope)),
        document: {
          ...envelope.document,
          revision: envelope.document.revision + 1,
        },
      }),
    },
    {
      label: "wrong target version",
      migrate: (envelope: CanonicalStudioDocumentEnvelope) =>
        migrateEnvelope(envelope, 3, payloadObject(envelope)),
    },
  ])("rejects a migrator invariant violation: $label", async ({ migrate }) => {
    const registry = createStudioDocumentMigratorRegistry([
      versionedDefinition(
        [
          {
            id: "bad-v1-to-v2",
            fromVersion: 1,
            toVersion: 2,
            migrate,
          },
        ],
        { currentVersion: 2 }
      ),
    ]);
    const result = await registry.migrate(envelopeInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "MIGRATION_INVARIANT_VIOLATION",
        migratorId: "bad-v1-to-v2",
      });
      expect(result.preservedEnvelope?.extensions).toEqual(
        envelopeInput().extensions
      );
    }
  });

  it("contains a throwing migrator and never exposes a partial result", async () => {
    const registry = createStudioDocumentMigratorRegistry([
      versionedDefinition(
        [
          {
            id: "throwing-v1-to-v2",
            fromVersion: 1,
            toVersion: 2,
            migrate() {
              throw new Error("fixture failure");
            },
          },
        ],
        { currentVersion: 2 }
      ),
    ]);
    const result = await registry.migrate(envelopeInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "MIGRATOR_FAILED",
        recoverable: true,
        migratorId: "throwing-v1-to-v2",
      });
      expect(result.preservedEnvelope?.format.version).toBe(1);
    }
  });
});
