import { Inject, Injectable } from "@nestjs/common";

import {
  STUDIO_LIVE_GUEST_CREDENTIAL_TTL_MS,
  StudioLiveGuestCredentialSchema,
} from "../../../../web/src/shared/lib/studio-live-auth-ticket";

import {
  STUDIO_LIVE_SESSION_AUTHENTICATOR,
  STUDIO_LIVE_SESSION_REVALIDATOR,
} from "./studio-live.protocol";

import type {
  StudioLiveAuthPrincipal,
  StudioLiveSessionAuthenticator,
  StudioLiveSessionRevalidator,
  StudioLiveSocket,
} from "./studio-live.protocol";

const STUDIO_LIVE_MAX_SESSION_TOKEN_LENGTH = 8_192;

/**
 * Owns socket-private authentication state. Principals are deliberately keyed by the Socket
 * object, not its reusable id, and never touch adapter-visible `socket.data`.
 */
@Injectable()
export class StudioLiveSocketAuthService {
  private readonly principalsBySocket = new Map<StudioLiveSocket, StudioLiveAuthPrincipal>();
  private readonly guestSockets = new Set<StudioLiveSocket>();

  constructor(
    @Inject(STUDIO_LIVE_SESSION_AUTHENTICATOR)
    private readonly authenticateSession: StudioLiveSessionAuthenticator,
    @Inject(STUDIO_LIVE_SESSION_REVALIDATOR)
    private readonly revalidateSession: StudioLiveSessionRevalidator
  ) {}

  principal(client: StudioLiveSocket): StudioLiveAuthPrincipal | undefined {
    return this.principalsBySocket.get(client);
  }

  isPrincipalCurrent(
    client: StudioLiveSocket,
    principal: StudioLiveAuthPrincipal,
    userId: string
  ): boolean {
    return (
      this.principalsBySocket.get(client) === principal &&
      principal.userId === userId &&
      principal.expiresAt > Date.now()
    );
  }

  async authenticate(client: StudioLiveSocket): Promise<boolean> {
    const token = this.handshakeToken(client);
    try {
      if (!token) {
        this.clear(client);
        return false;
      }
      const guestCredential = StudioLiveGuestCredentialSchema.safeParse(token);
      if (guestCredential.success) {
        const guestId = guestCredential.data.slice("guest:v1:".length);
        const principal: StudioLiveAuthPrincipal = {
          userId: `guest_${guestId}`,
          sessionVersion: 1,
          expiresAt: Date.now() + STUDIO_LIVE_GUEST_CREDENTIAL_TTL_MS,
        };
        this.principalsBySocket.set(client, principal);
        this.guestSockets.add(client);
        return true;
      }
      const principal = await this.authenticateSession(token);
      if (!principal || principal.expiresAt <= Date.now()) {
        this.clear(client);
        return false;
      }
      this.principalsBySocket.set(client, { ...principal });
      this.guestSockets.delete(client);
      return true;
    } catch {
      this.clear(client);
      return false;
    } finally {
      const auth = client.handshake.auth;
      if (auth && typeof auth === "object") {
        delete (auth as Record<string, unknown>).sessionToken;
      }
    }
  }

  async revalidate(client: StudioLiveSocket): Promise<boolean> {
    const principal = this.principalsBySocket.get(client);
    if (!principal || principal.expiresAt <= Date.now()) return false;
    if (this.guestSockets.has(client)) {
      return this.isPrincipalCurrent(client, principal, principal.userId);
    }
    try {
      const allowed = await this.revalidateSession(principal);
      return allowed && this.isPrincipalCurrent(client, principal, principal.userId);
    } catch {
      return false;
    }
  }

  clear(client: StudioLiveSocket): void {
    this.principalsBySocket.delete(client);
    this.guestSockets.delete(client);
  }

  clearBySocketId(socketId: string, currentSocket?: StudioLiveSocket): void {
    if (currentSocket) {
      this.clear(currentSocket);
      return;
    }
    for (const socket of this.principalsBySocket.keys()) {
      if (socket.id === socketId) this.clear(socket);
    }
  }

  clearAll(): void {
    this.principalsBySocket.clear();
    this.guestSockets.clear();
  }

  private handshakeToken(client: StudioLiveSocket): string | null {
    const auth = client.handshake?.auth;
    if (!auth || typeof auth !== "object") return null;
    const token = (auth as Record<string, unknown>).sessionToken;
    return typeof token === "string" &&
      token.length > 0 &&
      token.length <= STUDIO_LIVE_MAX_SESSION_TOKEN_LENGTH
      ? token
      : null;
  }
}
