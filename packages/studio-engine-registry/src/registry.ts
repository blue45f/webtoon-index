import { z } from "zod";

import {
  DEFAULT_LICENSE_POLICY,
  evaluateLicenseGate,
  providerDescriptorSchema,
} from "./descriptor";
import { resolveVerifiedProviderActivationDescriptor } from "./manifest";

import type {
  Capability,
  LicenseGateResult,
  LicensePolicy,
  ProviderDescriptor,
  ProviderKind,
} from "./descriptor";
import type { VerifiedProviderActivation } from "./manifest";

/**
 * EngineCapabilityRegistry (V12 provider-governance boundary).
 *
 * A schema-valid descriptor is only a claim. It becomes queryable through one
 * of three auditable authorities:
 *
 * - an opaque VerifiedProviderActivation issued by the evidence validator;
 * - an opaque declaration for a checked-in production baseline; or
 * - a test fixture registered on an explicitly test-only registry.
 *
 * The legacy register(descriptor) entry point remains as a fail-closed trap so
 * stale product code cannot silently turn a candidate survey into support.
 */

export type ProviderRegistrationAuthority =
  | {
      readonly kind: "verified-activation";
      readonly candidateId: string;
      readonly candidateKey: string;
      readonly promotionScope: "capability-set" | "product-wide";
    }
  | {
      readonly kind: "trusted-bootstrap";
      readonly classification:
        | "checked-in-first-party"
        | "checked-in-production-baseline";
      readonly source: string;
      readonly owner: string;
      readonly justification: string;
    }
  | {
      readonly kind: "test-fixture";
      readonly source: "EngineCapabilityRegistry.forTestFixtures";
    };

export interface RegisteredProvider {
  readonly descriptor: ProviderDescriptor;
  readonly licenseGate: Exclude<LicenseGateResult, { mode: "rejected" }>;
  readonly authority: ProviderRegistrationAuthority;
}

export type ProviderRegistrationErrorCode =
  | "RAW_DESCRIPTOR_FORBIDDEN"
  | "INVALID_VERIFIED_ACTIVATION"
  | "INVALID_TRUSTED_BOOTSTRAP"
  | "TEST_FIXTURE_CONTEXT_REQUIRED"
  | "DUPLICATE_PROVIDER"
  | "LICENSE_REJECTED";

export class ProviderRegistrationError extends Error {
  readonly code: ProviderRegistrationErrorCode;

  constructor(code: ProviderRegistrationErrorCode, message: string) {
    super(message);
    this.name = "ProviderRegistrationError";
    this.code = code;
  }
}

export const trustedBootstrapAuditSchema = z
  .object({
    classification: z.enum([
      "checked-in-first-party",
      "checked-in-production-baseline",
    ]),
    source: z
      .string()
      .min(1)
      .refine(
        (source) =>
          (source.startsWith("packages/") || source.startsWith("apps/web/src/")) &&
          !source.startsWith("/") &&
          !source.includes("\\") &&
          !source.split("/").includes(".."),
        "bootstrap source must be a checked-in repository-relative packages/ or apps/web/src/ path",
      ),
    owner: z.string().trim().min(1),
    justification: z.string().trim().min(1),
  })
  .strict();
export type TrustedBootstrapAudit = z.infer<typeof trustedBootstrapAuditSchema>;

export interface TrustedBootstrapProvider {
  readonly status: "trusted-bootstrap-provider";
  readonly descriptor: ProviderDescriptor;
  readonly audit: TrustedBootstrapAudit;
}

interface TrustedBootstrapIssuance {
  readonly descriptor: ProviderDescriptor;
  readonly audit: TrustedBootstrapAudit;
  readonly descriptorFingerprint: string;
}

const trustedBootstrapIssuances = new WeakMap<object, TrustedBootstrapIssuance>();
const testFixtureRegistries = new WeakSet<EngineCapabilityRegistry>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function descriptorFingerprint(descriptor: ProviderDescriptor): string {
  return JSON.stringify(descriptor);
}

/**
 * Issues an opaque bootstrap capability for a checked-in baseline descriptor.
 * Candidate, conditional, experimental, and reference-only descriptors must
 * use verified activation instead; relabelling them is rejected at runtime.
 */
export function declareTrustedBootstrapProvider(
  descriptorInput: unknown,
  auditInput: unknown,
): TrustedBootstrapProvider {
  const descriptor = providerDescriptorSchema.parse(descriptorInput);
  const audit = trustedBootstrapAuditSchema.parse(auditInput);
  if (descriptor.maturity !== "production-baseline") {
    throw new ProviderRegistrationError(
      "INVALID_TRUSTED_BOOTSTRAP",
      `provider ${descriptor.id} has maturity ${descriptor.maturity}; trusted bootstrap is restricted to production-baseline descriptors`,
    );
  }

  const frozenDescriptor = deepFreeze(descriptor);
  const frozenAudit = deepFreeze(audit);
  const bootstrap: TrustedBootstrapProvider = Object.freeze({
    status: "trusted-bootstrap-provider",
    descriptor: frozenDescriptor,
    audit: frozenAudit,
  });
  trustedBootstrapIssuances.set(bootstrap, {
    descriptor: frozenDescriptor,
    audit: frozenAudit,
    descriptorFingerprint: descriptorFingerprint(frozenDescriptor),
  });
  return bootstrap;
}

function resolveTrustedBootstrapProvider(
  input: unknown,
): TrustedBootstrapIssuance {
  if (input === null || typeof input !== "object") {
    throw new ProviderRegistrationError(
      "INVALID_TRUSTED_BOOTSTRAP",
      "trusted bootstrap capability was not issued by declareTrustedBootstrapProvider",
    );
  }
  const issuance = trustedBootstrapIssuances.get(input);
  if (issuance === undefined) {
    throw new ProviderRegistrationError(
      "INVALID_TRUSTED_BOOTSTRAP",
      "trusted bootstrap capability was not issued by declareTrustedBootstrapProvider",
    );
  }

  const bootstrap = input as TrustedBootstrapProvider;
  if (
    bootstrap.status !== "trusted-bootstrap-provider" ||
    bootstrap.descriptor !== issuance.descriptor ||
    bootstrap.audit !== issuance.audit ||
    descriptorFingerprint(bootstrap.descriptor) !==
      issuance.descriptorFingerprint ||
    !Object.isFrozen(bootstrap) ||
    !Object.isFrozen(bootstrap.descriptor) ||
    !Object.isFrozen(bootstrap.descriptor.capabilities)
  ) {
    throw new ProviderRegistrationError(
      "INVALID_TRUSTED_BOOTSTRAP",
      "issued trusted bootstrap capability failed descriptor identity or integrity verification",
    );
  }
  return issuance;
}

export class EngineCapabilityRegistry {
  private readonly providers = new Map<string, RegisteredProvider>();

  constructor(private readonly licensePolicy: LicensePolicy = DEFAULT_LICENSE_POLICY) {}

  /**
   * Creates an isolated unit/integration-test registry. Test fixtures remain
   * impossible to register on a normal governed registry and carry an explicit
   * authority marker when queried.
   */
  static forTestFixtures(
    licensePolicy: LicensePolicy = DEFAULT_LICENSE_POLICY,
  ): EngineCapabilityRegistry {
    const registry = new EngineCapabilityRegistry(licensePolicy);
    testFixtureRegistries.add(registry);
    return registry;
  }

  /** @deprecated Raw descriptors are claims, not activation authority. */
  register(_descriptor: ProviderDescriptor): never {
    throw new ProviderRegistrationError(
      "RAW_DESCRIPTOR_FORBIDDEN",
      "raw provider registration is forbidden; use registerVerifiedActivation(), registerTrustedBootstrap(), or an explicit test-fixture registry",
    );
  }

  registerVerifiedActivation(
    activation: VerifiedProviderActivation,
  ): RegisteredProvider {
    let descriptor: ProviderDescriptor;
    try {
      descriptor = resolveVerifiedProviderActivationDescriptor(activation);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new ProviderRegistrationError(
        "INVALID_VERIFIED_ACTIVATION",
        `provider activation capability is not authentic${detail}`,
      );
    }

    return this.registerAuthorized(descriptor, {
      kind: "verified-activation",
      candidateId: activation.candidate.id,
      candidateKey: activation.candidate.key,
      promotionScope: activation.promotionScope.scope,
    });
  }

  registerTrustedBootstrap(
    bootstrap: TrustedBootstrapProvider,
  ): RegisteredProvider {
    const issuance = resolveTrustedBootstrapProvider(bootstrap);
    return this.registerAuthorized(issuance.descriptor, {
      kind: "trusted-bootstrap",
      classification: issuance.audit.classification,
      source: issuance.audit.source,
      owner: issuance.audit.owner,
      justification: issuance.audit.justification,
    });
  }

  registerTestFixture(descriptorInput: ProviderDescriptor): RegisteredProvider {
    if (!testFixtureRegistries.has(this)) {
      throw new ProviderRegistrationError(
        "TEST_FIXTURE_CONTEXT_REQUIRED",
        "test fixtures may only be registered on EngineCapabilityRegistry.forTestFixtures()",
      );
    }
    const descriptor = deepFreeze(providerDescriptorSchema.parse(descriptorInput));
    return this.registerAuthorized(descriptor, {
      kind: "test-fixture",
      source: "EngineCapabilityRegistry.forTestFixtures",
    });
  }

  get(id: string): RegisteredProvider | null {
    return this.providers.get(id) ?? null;
  }

  list(kind?: ProviderKind): RegisteredProvider[] {
    const all = [...this.providers.values()];
    return kind ? all.filter((p) => p.descriptor.kind === kind) : all;
  }

  /** Providers of `kind` that declare every capability in `required`. */
  query(kind: ProviderKind, required: Capability[]): RegisteredProvider[] {
    return this.list(kind).filter((provider) =>
      required.every((capability) =>
        provider.descriptor.capabilities.includes(capability),
      ),
    );
  }

  private registerAuthorized(
    descriptor: ProviderDescriptor,
    authority: ProviderRegistrationAuthority,
  ): RegisteredProvider {
    const validation = providerDescriptorSchema.safeParse(descriptor);
    if (
      !validation.success ||
      descriptorFingerprint(validation.data) !== descriptorFingerprint(descriptor)
    ) {
      throw new ProviderRegistrationError(
        authority.kind === "verified-activation"
          ? "INVALID_VERIFIED_ACTIVATION"
          : "INVALID_TRUSTED_BOOTSTRAP",
        `authorized descriptor failed canonical schema validation: ${descriptor.id}`,
      );
    }
    if (this.providers.has(descriptor.id)) {
      throw new ProviderRegistrationError(
        "DUPLICATE_PROVIDER",
        `provider already registered: ${descriptor.id}`,
      );
    }
    const gate = evaluateLicenseGate(descriptor.license, this.licensePolicy);
    if (gate.mode === "rejected") {
      throw new ProviderRegistrationError(
        "LICENSE_REJECTED",
        `provider ${descriptor.id} failed license gate: ${gate.reason}`,
      );
    }
    const registered: RegisteredProvider = deepFreeze({
      descriptor,
      licenseGate: gate,
      authority,
    });
    this.providers.set(descriptor.id, registered);
    return registered;
  }
}
