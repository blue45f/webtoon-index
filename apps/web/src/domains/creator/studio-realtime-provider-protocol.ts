import { z } from "zod";

export const STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION = 1 as const;

export const STUDIO_REALTIME_PROVIDER_LIMITS = Object.freeze({
  maxCapabilities: 32,
  maxCommentParticipants: 256,
  maxDisplayNameCodeUnits: 80,
  maxEventBytes: 64 * 1024,
  maxIceCandidateCodeUnits: 8 * 1024,
  maxIdentifierCodeUnits: 160,
  maxPresenceParticipants: 256,
  maxSdpCodeUnits: 48 * 1024,
  maxTicketCodeUnits: 8 * 1024,
  maxTicketLifetimeMs: 5 * 60 * 1_000,
  minTicketCodeUnits: 32,
} as const);

export const STUDIO_REALTIME_WORKLOADS = [
  "presence",
  "comments",
  "screen-signaling",
] as const;

export const STUDIO_REALTIME_CAPABILITIES = [
  "presence.snapshot-v1",
  "presence.members-v1",
  "presence.cursor-v1",
  "presence.resume-v1",
  "comments.invalidation-v1",
  "comments.resume-v1",
  "screen-signaling.session-v1",
  "screen-signaling.webrtc-v1",
  "screen-signaling.resume-v1",
] as const;

export type StudioRealtimeWorkload =
  (typeof STUDIO_REALTIME_WORKLOADS)[number];
export type StudioRealtimeCapability =
  (typeof STUDIO_REALTIME_CAPABILITIES)[number];

const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function containsControlCharacter(
  value: string,
  rejectSpace = false,
): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= (rejectSpace ? 32 : 31) ||
      (codePoint >= 127 && codePoint <= 159)
    ) {
      return true;
    }
  }
  return false;
}

const BoundedIdentifierSchema = z
  .string()
  .min(1)
  .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxIdentifierCodeUnits)
  .refine((value) => value === value.trim(), "identifier must be canonical")
  .refine(
    (value) => !containsControlCharacter(value),
    "identifier contains control characters",
  );

const UuidSchema = z
  .string()
  .max(36)
  .refine((value) => UUID.test(value), "identifier must be a lowercase RFC 4122 UUID");

const CanonicalSequenceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,18})$/u)
  .refine((value) => BigInt(value) <= POSTGRES_BIGINT_MAX);

const PositiveCanonicalSequenceSchema = CanonicalSequenceSchema.refine(
  (value) => value !== "0",
  "sequence must be positive",
);

const DateTimeSchema = z.iso.datetime({ offset: true });
const WorkloadSchema = z.enum(STUDIO_REALTIME_WORKLOADS);
const CapabilitySchema = z.enum(STUDIO_REALTIME_CAPABILITIES);

export const StudioRealtimeScopeSchema = z
  .object({
    workId: BoundedIdentifierSchema,
    roomId: BoundedIdentifierSchema,
  })
  .strict();

export type StudioRealtimeScope = z.infer<typeof StudioRealtimeScopeSchema>;

const ResumeCursorSchema = z
  .object({
    workload: WorkloadSchema,
    serverSequence: PositiveCanonicalSequenceSchema,
    eventId: UuidSchema,
  })
  .strict();

const CapabilityListSchema = z
  .array(CapabilitySchema)
  .min(1)
  .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxCapabilities)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "capabilities must be unique" });
    }
  });

const WorkloadListSchema = z
  .array(WorkloadSchema)
  .min(1)
  .max(STUDIO_REALTIME_WORKLOADS.length)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "workloads must be unique" });
    }
  });

const CAPABILITY_WORKLOAD: Readonly<
  Record<StudioRealtimeCapability, StudioRealtimeWorkload>
> = Object.freeze({
  "presence.snapshot-v1": "presence",
  "presence.members-v1": "presence",
  "presence.cursor-v1": "presence",
  "presence.resume-v1": "presence",
  "comments.invalidation-v1": "comments",
  "comments.resume-v1": "comments",
  "screen-signaling.session-v1": "screen-signaling",
  "screen-signaling.webrtc-v1": "screen-signaling",
  "screen-signaling.resume-v1": "screen-signaling",
});

function validateCapabilityWorkloads(
  workloads: readonly StudioRealtimeWorkload[],
  capabilities: readonly StudioRealtimeCapability[],
  context: z.core.$RefinementCtx,
): void {
  const workloadSet = new Set(workloads);
  for (let index = 0; index < capabilities.length; index += 1) {
    const capability = capabilities[index];
    if (!workloadSet.has(CAPABILITY_WORKLOAD[capability])) {
      context.addIssue({
        code: "custom",
        message: "capability belongs to a workload that was not requested",
        path: ["capabilities", index],
      });
    }
  }
}

export const StudioRealtimeConnectionRequestSchema = z
  .object({
    version: z.literal(STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION),
    clientInstanceId: UuidSchema,
    sessionId: BoundedIdentifierSchema,
    scope: StudioRealtimeScopeSchema,
    requiredWorkloads: WorkloadListSchema,
    requiredCapabilities: CapabilityListSchema,
    resume: z
      .array(ResumeCursorSchema)
      .max(STUDIO_REALTIME_WORKLOADS.length),
  })
  .strict()
  .superRefine((request, context) => {
    validateCapabilityWorkloads(
      request.requiredWorkloads,
      request.requiredCapabilities,
      context,
    );
    const workloads = new Set(request.requiredWorkloads);
    const resumeWorkloads = new Set<StudioRealtimeWorkload>();
    for (let index = 0; index < request.resume.length; index += 1) {
      const cursor = request.resume[index];
      if (!workloads.has(cursor.workload)) {
        context.addIssue({
          code: "custom",
          message: "resume cursor belongs to an unrequested workload",
          path: ["resume", index, "workload"],
        });
      }
      if (resumeWorkloads.has(cursor.workload)) {
        context.addIssue({
          code: "custom",
          message: "resume workload must be unique",
          path: ["resume", index, "workload"],
        });
      }
      resumeWorkloads.add(cursor.workload);
      const resumeCapability =
        `${cursor.workload}.resume-v1` as StudioRealtimeCapability;
      if (!request.requiredCapabilities.includes(resumeCapability)) {
        context.addIssue({
          code: "custom",
          message: "resume cursor requires its exact resume capability",
          path: ["resume", index],
        });
      }
    }
  });

export type StudioRealtimeConnectionRequest = z.infer<
  typeof StudioRealtimeConnectionRequestSchema
>;

export const StudioRealtimeTicketRequestSchema = z
  .object({
    version: z.literal(STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION),
    providerId: BoundedIdentifierSchema,
    sessionId: BoundedIdentifierSchema,
    scope: StudioRealtimeScopeSchema,
    workloads: WorkloadListSchema,
    capabilities: CapabilityListSchema,
  })
  .strict()
  .superRefine((request, context) => {
    validateCapabilityWorkloads(
      request.workloads,
      request.capabilities,
      context,
    );
  });

export type StudioRealtimeTicketRequest = z.infer<
  typeof StudioRealtimeTicketRequestSchema
>;

/**
 * Server-minted, short-lived admission ticket. The opaque token is deliberately absent from every
 * event, status, receipt and error type. Callers must keep this parsed value in one connect stack
 * frame only and must never persist or log it.
 */
export const StudioRealtimeTicketSchema = z
  .object({
    version: z.literal(STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION),
    providerId: BoundedIdentifierSchema,
    scope: StudioRealtimeScopeSchema,
    workloads: WorkloadListSchema,
    capabilities: CapabilityListSchema,
    issuedAt: DateTimeSchema,
    expiresAt: DateTimeSchema,
    ticket: z
      .string()
      .min(STUDIO_REALTIME_PROVIDER_LIMITS.minTicketCodeUnits)
      .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxTicketCodeUnits)
      .refine(
        (value) => !containsControlCharacter(value, true),
        "ticket contains whitespace or control characters",
      ),
  })
  .strict()
  .superRefine((ticket, context) => {
    validateCapabilityWorkloads(ticket.workloads, ticket.capabilities, context);
    const issuedAt = Date.parse(ticket.issuedAt);
    const expiresAt = Date.parse(ticket.expiresAt);
    const lifetime = expiresAt - issuedAt;
    if (
      !Number.isFinite(lifetime) ||
      lifetime <= 0 ||
      lifetime > STUDIO_REALTIME_PROVIDER_LIMITS.maxTicketLifetimeMs
    ) {
      context.addIssue({
        code: "custom",
        message: "ticket lifetime is outside the short-lived boundary",
        path: ["expiresAt"],
      });
    }
  });

export type StudioRealtimeTicket = z.infer<typeof StudioRealtimeTicketSchema>;

const ProviderResumeResultSchema = z
  .object({
    workload: WorkloadSchema,
    status: z.enum(["fresh", "resumed", "unavailable"]),
    serverSequence: CanonicalSequenceSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "fresh" && result.serverSequence !== "0") {
      context.addIssue({
        code: "custom",
        message: "fresh streams must begin at the zero sentinel",
        path: ["serverSequence"],
      });
    }
    if (result.status === "resumed" && result.serverSequence === "0") {
      context.addIssue({
        code: "custom",
        message: "resumed streams require a positive sequence",
        path: ["serverSequence"],
      });
    }
  });

export const StudioRealtimeProviderHelloSchema = z
  .object({
    version: z.literal(STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION),
    providerId: BoundedIdentifierSchema,
    providerSessionId: BoundedIdentifierSchema,
    scope: StudioRealtimeScopeSchema,
    acceptedWorkloads: WorkloadListSchema,
    capabilities: CapabilityListSchema,
    resume: z
      .array(ProviderResumeResultSchema)
      .min(1)
      .max(STUDIO_REALTIME_WORKLOADS.length),
    limits: z
      .object({
        maxEventBytes: z
          .number()
          .int()
          .min(1)
          .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxEventBytes),
        heartbeatMs: z.number().int().min(1_000).max(120_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((hello, context) => {
    validateCapabilityWorkloads(
      hello.acceptedWorkloads,
      hello.capabilities,
      context,
    );
    const accepted = new Set(hello.acceptedWorkloads);
    const seen = new Set<StudioRealtimeWorkload>();
    for (let index = 0; index < hello.resume.length; index += 1) {
      const result = hello.resume[index];
      if (!accepted.has(result.workload)) {
        context.addIssue({
          code: "custom",
          message: "resume result belongs to an unaccepted workload",
          path: ["resume", index, "workload"],
        });
      }
      if (seen.has(result.workload)) {
        context.addIssue({
          code: "custom",
          message: "resume result workload must be unique",
          path: ["resume", index, "workload"],
        });
      }
      seen.add(result.workload);
    }
    for (const workload of accepted) {
      if (!seen.has(workload)) {
        context.addIssue({
          code: "custom",
          message: "every accepted workload needs an explicit resume result",
          path: ["resume"],
        });
      }
    }
  });

export type StudioRealtimeProviderHello = z.infer<
  typeof StudioRealtimeProviderHelloSchema
>;

export type StudioRealtimeNegotiationFailureCode =
  | "invalid-request"
  | "invalid-hello"
  | "provider-mismatch"
  | "scope-mismatch"
  | "workload-missing"
  | "workload-unexpected"
  | "capability-missing"
  | "capability-unexpected"
  | "payload-limit-insufficient"
  | "resume-unavailable"
  | "resume-mismatch";

export type StudioRealtimeNegotiationResult =
  | Readonly<{
      ok: true;
      hello: StudioRealtimeProviderHello;
    }>
  | Readonly<{
      ok: false;
      code: StudioRealtimeNegotiationFailureCode;
      missingWorkloads: readonly StudioRealtimeWorkload[];
      missingCapabilities: readonly StudioRealtimeCapability[];
    }>;

/**
 * Full-capability negotiation. A provider is either accepted with every requested workload and
 * capability, or rejected so a caller can try the next provider without silently shrinking UX.
 */
export function negotiateStudioRealtimeProvider(
  requestValue: unknown,
  helloValue: unknown,
  expectedProviderId: string,
): StudioRealtimeNegotiationResult {
  const request = StudioRealtimeConnectionRequestSchema.safeParse(requestValue);
  if (!request.success) {
    return {
      ok: false,
      code: "invalid-request",
      missingWorkloads: [],
      missingCapabilities: [],
    };
  }
  const hello = StudioRealtimeProviderHelloSchema.safeParse(helloValue);
  if (!hello.success) {
    return {
      ok: false,
      code: "invalid-hello",
      missingWorkloads: [],
      missingCapabilities: [],
    };
  }
  if (hello.data.providerId !== expectedProviderId) {
    return {
      ok: false,
      code: "provider-mismatch",
      missingWorkloads: [],
      missingCapabilities: [],
    };
  }
  if (
    hello.data.scope.workId !== request.data.scope.workId ||
    hello.data.scope.roomId !== request.data.scope.roomId
  ) {
    return {
      ok: false,
      code: "scope-mismatch",
      missingWorkloads: [],
      missingCapabilities: [],
    };
  }
  const acceptedWorkloads = new Set(hello.data.acceptedWorkloads);
  const missingWorkloads = request.data.requiredWorkloads.filter(
    (workload) => !acceptedWorkloads.has(workload),
  );
  if (missingWorkloads.length > 0) {
    return {
      ok: false,
      code: "workload-missing",
      missingWorkloads,
      missingCapabilities: [],
    };
  }
  const requestedWorkloads = new Set(request.data.requiredWorkloads);
  if (
    hello.data.acceptedWorkloads.some(
      (workload) => !requestedWorkloads.has(workload),
    )
  ) {
    return {
      ok: false,
      code: "workload-unexpected",
      missingWorkloads: [],
      missingCapabilities: [],
    };
  }
  const acceptedCapabilities = new Set(hello.data.capabilities);
  const missingCapabilities = request.data.requiredCapabilities.filter(
    (capability) => !acceptedCapabilities.has(capability),
  );
  if (missingCapabilities.length > 0) {
    return {
      ok: false,
      code: "capability-missing",
      missingWorkloads: [],
      missingCapabilities,
    };
  }
  const requestedCapabilities = new Set(request.data.requiredCapabilities);
  if (
    hello.data.capabilities.some(
      (capability) => !requestedCapabilities.has(capability),
    )
  ) {
    return {
      ok: false,
      code: "capability-unexpected",
      missingWorkloads: [],
      missingCapabilities: [],
    };
  }
  if (
    hello.data.limits.maxEventBytes <
    STUDIO_REALTIME_PROVIDER_LIMITS.maxEventBytes
  ) {
    return {
      ok: false,
      code: "payload-limit-insufficient",
      missingWorkloads: [],
      missingCapabilities: [],
    };
  }
  const resumeByWorkload = new Map(
    hello.data.resume.map((result) => [result.workload, result]),
  );
  const requestedResumeWorkloads = new Set(
    request.data.resume.map((cursor) => cursor.workload),
  );
  for (const workload of request.data.requiredWorkloads) {
    if (requestedResumeWorkloads.has(workload)) continue;
    const result = resumeByWorkload.get(workload);
    if (
      !result ||
      result.status !== "fresh" ||
      result.serverSequence !== "0"
    ) {
      return {
        ok: false,
        code: "resume-unavailable",
        missingWorkloads: [],
        missingCapabilities: [],
      };
    }
  }
  for (const cursor of request.data.resume) {
    const result = resumeByWorkload.get(cursor.workload);
    if (!result || result.status !== "resumed") {
      return {
        ok: false,
        code: "resume-unavailable",
        missingWorkloads: [],
        missingCapabilities: [],
      };
    }
    if (result.serverSequence !== cursor.serverSequence) {
      return {
        ok: false,
        code: "resume-mismatch",
        missingWorkloads: [],
        missingCapabilities: [],
      };
    }
  }
  return { ok: true, hello: hello.data };
}

const ParticipantSchema = z
  .object({
    sessionId: BoundedIdentifierSchema,
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxDisplayNameCodeUnits)
      .refine((value) => !containsControlCharacter(value)),
    role: z.enum(["owner", "admin", "editor", "commenter", "viewer"]),
    state: z.enum(["active", "idle", "away"]),
    pageId: BoundedIdentifierSchema.nullable(),
    tool: z.string().trim().min(1).max(64).nullable(),
    updatedAt: DateTimeSchema,
  })
  .strict();

const CursorPayloadSchema = z
  .object({
    // StudioLiveRoom publishes viewport-normalized cursor coordinates. Keeping this exact
    // contract prevents a provider event from becoming invalid when projected back to Studio.
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    pageId: BoundedIdentifierSchema.nullable(),
    tool: z.string().trim().min(1).max(64).nullable(),
    drawing: z.boolean(),
    strokeColor: z.string().trim().min(1).max(64).optional(),
    strokeWidth: z.number().finite().min(0.01).max(4_096).optional(),
    strokeOpacity: z.number().finite().min(0).max(1).optional(),
    points: z
      .array(z.number().finite().min(-1_000_000).max(1_000_000))
      .max(512)
      .optional(),
  })
  .strict();

const PresenceSnapshotPayloadSchema = z
  .object({
    participants: z
      .array(ParticipantSchema)
      .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxPresenceParticipants),
  })
  .strict();

const PresenceUpsertPayloadSchema = z
  .object({ participant: ParticipantSchema })
  .strict();

const PresenceRemovePayloadSchema = z
  .object({
    sessionId: BoundedIdentifierSchema,
    reason: z.enum(["left", "timeout", "revoked"]),
  })
  .strict();

const CommentChangedPayloadSchema = z
  .object({
    threadId: BoundedIdentifierSchema,
    activitySequence: PositiveCanonicalSequenceSchema,
    change: z.enum(["created", "replied", "resolved", "reopened", "reanchored"]),
  })
  .strict();

const ShareIdSchema = BoundedIdentifierSchema;
const ScreenAnnouncePayloadSchema = z
  .object({
    shareId: ShareIdSchema,
    label: z.string().trim().min(1).max(80),
  })
  .strict();
const ScreenRequestPayloadSchema = z.object({ shareId: ShareIdSchema }).strict();
const ScreenAccessPayloadSchema = z
  .object({
    shareId: ShareIdSchema,
    decision: z.enum(["approved", "rejected", "ended"]),
  })
  .strict();
const ScreenDescriptionPayloadSchema = z
  .object({
    shareId: ShareIdSchema,
    type: z.enum(["offer", "answer"]),
    sdp: z
      .string()
      .min(1)
      .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxSdpCodeUnits),
  })
  .strict();
const ScreenIcePayloadSchema = z
  .object({
    shareId: ShareIdSchema,
    candidate: z
      .string()
      .max(STUDIO_REALTIME_PROVIDER_LIMITS.maxIceCandidateCodeUnits),
    sdpMid: z.string().max(256).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable(),
    usernameFragment: z.string().max(256).nullable(),
  })
  .strict();
const ScreenStopPayloadSchema = z.object({ shareId: ShareIdSchema }).strict();

const EventCommonShape = {
  version: z.literal(STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION),
  scope: StudioRealtimeScopeSchema,
  eventId: UuidSchema,
  idempotencyKey: UuidSchema,
  sentAt: DateTimeSchema,
  senderSessionId: BoundedIdentifierSchema,
  targetSessionId: BoundedIdentifierSchema.nullable(),
} as const;

function outboundVariant<
  Workload extends StudioRealtimeWorkload,
  Kind extends string,
  Payload extends z.ZodType,
>(workload: Workload, kind: Kind, payload: Payload) {
  return z
    .object({
      ...EventCommonShape,
      workload: z.literal(workload),
      kind: z.literal(kind),
      clientSequence: PositiveCanonicalSequenceSchema,
      payload,
    })
    .strict();
}

function inboundVariant<
  Workload extends StudioRealtimeWorkload,
  Kind extends string,
  Payload extends z.ZodType,
>(workload: Workload, kind: Kind, payload: Payload) {
  return z
    .object({
      ...EventCommonShape,
      workload: z.literal(workload),
      kind: z.literal(kind),
      serverSequence: PositiveCanonicalSequenceSchema,
      payload,
    })
    .strict();
}

const OutboundEventUnionSchema = z.discriminatedUnion(
  "kind",
  [
    outboundVariant("presence", "presence.upsert", PresenceUpsertPayloadSchema),
    outboundVariant("presence", "presence.remove", PresenceRemovePayloadSchema),
    outboundVariant("presence", "presence.cursor", CursorPayloadSchema),
    outboundVariant("comments", "comments.changed", CommentChangedPayloadSchema),
    outboundVariant(
      "screen-signaling",
      "screen.announce",
      ScreenAnnouncePayloadSchema,
    ),
    outboundVariant(
      "screen-signaling",
      "screen.request",
      ScreenRequestPayloadSchema,
    ),
    outboundVariant(
      "screen-signaling",
      "screen.access",
      ScreenAccessPayloadSchema,
    ),
    outboundVariant(
      "screen-signaling",
      "screen.description",
      ScreenDescriptionPayloadSchema,
    ),
    outboundVariant("screen-signaling", "screen.ice", ScreenIcePayloadSchema),
    outboundVariant("screen-signaling", "screen.stop", ScreenStopPayloadSchema),
  ],
);

const TARGETED_EVENT_KINDS = new Set([
  "screen.request",
  "screen.access",
  "screen.description",
  "screen.ice",
]);

function validateEventTarget(
  event: { readonly kind: string; readonly targetSessionId: string | null },
  context: z.core.$RefinementCtx,
): void {
  const targeted = TARGETED_EVENT_KINDS.has(event.kind);
  if (
    (targeted && event.targetSessionId === null) ||
    (!targeted && event.targetSessionId !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["targetSessionId"],
      message: targeted
        ? "targeted event requires a target session"
        : "broadcast event cannot name a target session",
    });
  }
}

function validatePresenceIdentity(
  event: {
    readonly kind: string;
    readonly senderSessionId: string;
    readonly payload: unknown;
  },
  context: z.core.$RefinementCtx,
): void {
  if (
    event.kind === "presence.upsert" &&
    typeof event.payload === "object" &&
    event.payload !== null &&
    "participant" in event.payload &&
    typeof event.payload.participant === "object" &&
    event.payload.participant !== null &&
    "sessionId" in event.payload.participant &&
    event.payload.participant.sessionId !== event.senderSessionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["payload", "participant", "sessionId"],
      message: "presence participant must match the authenticated sender",
    });
  }
  if (
    event.kind === "presence.remove" &&
    typeof event.payload === "object" &&
    event.payload !== null &&
    "sessionId" in event.payload &&
    event.payload.sessionId !== event.senderSessionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["payload", "sessionId"],
      message: "presence removal must match the authenticated sender",
    });
  }
}

const InboundEventUnionSchema = z.discriminatedUnion(
  "kind",
  [
    inboundVariant("presence", "presence.snapshot", PresenceSnapshotPayloadSchema),
    inboundVariant("presence", "presence.upsert", PresenceUpsertPayloadSchema),
    inboundVariant("presence", "presence.remove", PresenceRemovePayloadSchema),
    inboundVariant("presence", "presence.cursor", CursorPayloadSchema),
    inboundVariant("comments", "comments.changed", CommentChangedPayloadSchema),
    inboundVariant(
      "screen-signaling",
      "screen.announce",
      ScreenAnnouncePayloadSchema,
    ),
    inboundVariant(
      "screen-signaling",
      "screen.request",
      ScreenRequestPayloadSchema,
    ),
    inboundVariant(
      "screen-signaling",
      "screen.access",
      ScreenAccessPayloadSchema,
    ),
    inboundVariant(
      "screen-signaling",
      "screen.description",
      ScreenDescriptionPayloadSchema,
    ),
    inboundVariant("screen-signaling", "screen.ice", ScreenIcePayloadSchema),
    inboundVariant("screen-signaling", "screen.stop", ScreenStopPayloadSchema),
  ],
);

const TEXT_ENCODER = new TextEncoder();

function eventFitsByteBoundary(event: unknown): boolean {
  try {
    return (
      TEXT_ENCODER.encode(JSON.stringify(event)).byteLength <=
      STUDIO_REALTIME_PROVIDER_LIMITS.maxEventBytes
    );
  } catch {
    return false;
  }
}

export const StudioRealtimeOutboundEventSchema =
  OutboundEventUnionSchema.superRefine(validateEventTarget)
    .superRefine(validatePresenceIdentity)
    .refine(
      eventFitsByteBoundary,
      "event exceeds the realtime payload boundary",
    );

export const StudioRealtimeInboundEventSchema =
  InboundEventUnionSchema.superRefine(validateEventTarget)
    .superRefine(validatePresenceIdentity)
    .refine(
      eventFitsByteBoundary,
      "event exceeds the realtime payload boundary",
    );

export type StudioRealtimeOutboundEvent = z.infer<
  typeof StudioRealtimeOutboundEventSchema
>;
export type StudioRealtimeInboundEvent = z.infer<
  typeof StudioRealtimeInboundEventSchema
>;

export const StudioRealtimePublishAckSchema = z
  .object({
    version: z.literal(STUDIO_REALTIME_PROVIDER_PROTOCOL_VERSION),
    providerId: BoundedIdentifierSchema,
    providerSessionId: BoundedIdentifierSchema,
    scope: StudioRealtimeScopeSchema,
    workload: WorkloadSchema,
    eventId: UuidSchema,
    idempotencyKey: UuidSchema,
    clientSequence: PositiveCanonicalSequenceSchema,
    serverSequence: PositiveCanonicalSequenceSchema,
    duplicate: z.boolean(),
  })
  .strict();

export type StudioRealtimePublishAck = z.infer<
  typeof StudioRealtimePublishAckSchema
>;

export function parseStudioRealtimeInboundEvent(
  value: unknown,
  expectedScope: StudioRealtimeScope,
): StudioRealtimeInboundEvent | null {
  const parsed = StudioRealtimeInboundEventSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.scope.workId !== expectedScope.workId ||
    parsed.data.scope.roomId !== expectedScope.roomId
  ) {
    return null;
  }
  return parsed.data;
}

export function parseStudioRealtimeOutboundEvent(
  value: unknown,
  expectedScope: StudioRealtimeScope,
  expectedSessionId: string,
): StudioRealtimeOutboundEvent | null {
  const parsed = StudioRealtimeOutboundEventSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.scope.workId !== expectedScope.workId ||
    parsed.data.scope.roomId !== expectedScope.roomId ||
    parsed.data.senderSessionId !== expectedSessionId
  ) {
    return null;
  }
  return parsed.data;
}
