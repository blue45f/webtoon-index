import { z } from "zod";

import { isStudioLiveJamScope } from "../../../../web/src/shared/lib/studio-live-jam-scope";
import { CreatorCollaborationRepository } from "../creator/creator-collaboration.repository";

import {
  StudioRealtimeTicketIdentifierSchema,
} from "./studio-realtime-ticket.dto";

import type {
  StudioRealtimeTicketAuthorizationDecision,
  StudioRealtimeTicketAuthorizationInput,
  StudioRealtimeTicketAuthorizationPort,
} from "./studio-realtime-ticket.authorization";

const CreatorRealtimeAuthorizationSnapshotSchema = z
  .object({
    workId: StudioRealtimeTicketIdentifierSchema,
    viewer: z.object({
      userId: StudioRealtimeTicketIdentifierSchema,
      role: z.enum(["owner", "admin", "editor", "commenter", "viewer"]),
      status: z.enum(["pending", "active", "declined"]),
      capabilities: z
        .object({
          view: z.boolean(),
          comment: z.boolean(),
          edit: z.boolean(),
          manageMembers: z.boolean(),
        })
        .strict(),
    }),
    authorizationEpoch: z.iso.datetime({ offset: true }),
    authorizationExpiresAt: z.iso.datetime({ offset: true }).optional(),
  });

const CanonicalHttpsOriginSchema = z
  .string()
  .url()
  .max(256)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.origin === value &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === "" &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  });

const CreatorStudioRealtimeAuthorizationConfigurationSchema = z
  .object({
    providerIds: z
      .array(StudioRealtimeTicketIdentifierSchema)
      .min(1)
      .max(16)
      .refine((values) => new Set(values).size === values.length),
    allowedOrigins: z
      .array(CanonicalHttpsOriginSchema)
      .min(1)
      .max(32)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();

export interface CreatorStudioRealtimeAuthorizationConfiguration {
  readonly providerIds: readonly string[];
  readonly allowedOrigins: readonly string[];
}

/**
 * Existing Studio Socket.IO rooms are keyed only by `workId`, including provisional
 * collaboration works. The separate `draft-room_<uuid>` value is a provisioning/lease
 * record identifier and is not a live transport room. Protocol v1 therefore uses the
 * canonical work id for both signed scope fields.
 */
export function isCanonicalCreatorStudioRealtimeScope(scope: {
  readonly workId: string;
  readonly roomId: string;
}): boolean {
  return scope.workId === scope.roomId;
}

export class CreatorStudioRealtimeTicketAuthorization
implements StudioRealtimeTicketAuthorizationPort {
  private readonly providerIds: ReadonlySet<string>;
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    private readonly collaborationRepository: CreatorCollaborationRepository,
    unsafeConfiguration: CreatorStudioRealtimeAuthorizationConfiguration,
  ) {
    const configuration =
      CreatorStudioRealtimeAuthorizationConfigurationSchema.parse(
        unsafeConfiguration,
      );
    this.providerIds = new Set(configuration.providerIds);
    this.allowedOrigins = new Set(configuration.allowedOrigins);
  }

  async authorize(
    input: StudioRealtimeTicketAuthorizationInput,
  ): Promise<StudioRealtimeTicketAuthorizationDecision> {
    if (
      input.origin === null ||
      !this.allowedOrigins.has(input.origin) ||
      !this.providerIds.has(input.providerId) ||
      !isCanonicalCreatorStudioRealtimeScope(input.scope)
    ) {
      return { allowed: false };
    }

    if (isStudioLiveJamScope(input.scope)) {
      return {
        allowed: true,
        ...input,
        role: "editor",
        creatorCapabilities: {
          view: true,
          comment: true,
          edit: true,
          manageMembers: false,
        },
        authorizationEpoch: new Date().toISOString(),
      };
    }

    let unsafeAuthorization: unknown;
    try {
      unsafeAuthorization =
        await this.collaborationRepository.getAuthorization(
          input.actorUserId,
          input.scope.workId,
        );
    } catch {
      return { allowed: false };
    }
    const authorization =
      CreatorRealtimeAuthorizationSnapshotSchema.safeParse(
        unsafeAuthorization,
      );
    if (
      !authorization.success ||
      authorization.data.workId !== input.scope.workId ||
      authorization.data.viewer.userId !== input.actorUserId ||
      authorization.data.viewer.status !== "active" ||
      !authorization.data.viewer.capabilities.view
    ) {
      return { allowed: false };
    }

    return {
      allowed: true,
      ...input,
      role: authorization.data.viewer.role,
      creatorCapabilities: authorization.data.viewer.capabilities,
      authorizationEpoch: authorization.data.authorizationEpoch,
      ...(authorization.data.authorizationExpiresAt === undefined
        ? {}
        : {
            authorizationExpiresAt:
              authorization.data.authorizationExpiresAt,
          }),
    };
  }
}
