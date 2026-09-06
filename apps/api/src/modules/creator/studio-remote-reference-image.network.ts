import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { BlockList, isIP } from "node:net";

import { Injectable } from "@nestjs/common";

import { StudioRemoteReferenceImageRequestSchema } from "../../../../web/src/shared/lib/studio-remote-reference-image-contract";

import type { LookupFunction } from "node:net";

const REMOTE_REFERENCE_MAX_RESPONSE_HEADER_BYTES = 16 * 1_024;

// Keep families in separate BlockLists. Node intentionally treats IPv4 addresses as mapped IPv6
// for a mixed-family list; combining them with the ::ffff:0:0/96 rule would therefore block every
// ordinary public IPv4 address as well.
const blockedIpv4Networks = new BlockList();
const blockedIpv6Networks = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Networks.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  // Unspecified, loopback and deprecated IPv4-compatible forms.
  ["::", 96],
  // IPv4-mapped, IPv4-translated and NAT64 addresses can otherwise re-encode a private IPv4.
  ["::ffff:0.0.0.0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  // IETF protocol assignments, ORCHID, documentation and transition address space are not
  // ordinary public image origins and create unnecessary parser/route ambiguity.
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Networks.addSubnet(network, prefix, "ipv6");
}

const FORBIDDEN_HOSTNAME_SUFFIXES = [
  ".internal",
  ".localhost",
  ".local",
  ".localdomain",
  ".home",
  ".lan",
  ".test",
  ".invalid",
  ".example",
] as const;

const FORBIDDEN_METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google",
  "metadata.azure.internal",
  "instance-data.ec2.internal",
]);

export class StudioRemoteReferenceNetworkPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StudioRemoteReferenceNetworkPolicyError";
  }
}

export class StudioRemoteReferenceNetworkError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) {
    super(code, options);
    this.name = "StudioRemoteReferenceNetworkError";
  }
}

export interface StudioRemoteReferenceResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface StudioRemoteReferenceDnsResolver {
  resolve(hostname: string): Promise<readonly StudioRemoteReferenceResolvedAddress[]>;
}

export interface StudioRemoteReferenceHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  cancel(): void;
}

export interface StudioRemoteReferenceHttpRequester {
  request(input: {
    readonly url: URL;
    readonly endpoint: StudioRemoteReferenceResolvedAddress;
    readonly signal: AbortSignal;
  }): Promise<StudioRemoteReferenceHttpResponse>;
}

export const STUDIO_REMOTE_REFERENCE_DNS_RESOLVER = Symbol(
  "STUDIO_REMOTE_REFERENCE_DNS_RESOLVER"
);
export const STUDIO_REMOTE_REFERENCE_HTTP_REQUESTER = Symbol(
  "STUDIO_REMOTE_REFERENCE_HTTP_REQUESTER"
);

function unbracketedHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function normalizedHostname(hostname: string): string {
  return unbracketedHostname(hostname).replace(/\.$/u, "").toLowerCase();
}

export function isPublicStudioRemoteReferenceAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedIpv4Networks.check(address, "ipv4");
  if (family === 6) return !blockedIpv6Networks.check(address, "ipv6");
  return false;
}

export function parseStudioRemoteReferenceUrl(value: string): URL {
  const parsed = StudioRemoteReferenceImageRequestSchema.safeParse({ url: value });
  if (!parsed.success) {
    throw new StudioRemoteReferenceNetworkPolicyError("invalid_url");
  }
  return new URL(parsed.data.url);
}

export async function resolveStudioRemoteReferenceEndpoint(
  url: URL,
  resolver: StudioRemoteReferenceDnsResolver
): Promise<StudioRemoteReferenceResolvedAddress> {
  const hostname = normalizedHostname(url.hostname);
  if (
    !hostname ||
    hostname === "localhost" ||
    FORBIDDEN_METADATA_HOSTNAMES.has(hostname) ||
    FORBIDDEN_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new StudioRemoteReferenceNetworkPolicyError("forbidden_hostname");
  }

  const literalFamily = isIP(hostname);
  let resolved: readonly StudioRemoteReferenceResolvedAddress[];
  if (literalFamily === 4 || literalFamily === 6) {
    resolved = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      resolved = await resolver.resolve(hostname);
    } catch (error) {
      throw new StudioRemoteReferenceNetworkError("dns_failed", { cause: error });
    }
  }

  if (resolved.length === 0 || resolved.length > 64) {
    throw new StudioRemoteReferenceNetworkError("dns_answer_invalid");
  }

  const unique = new Map<string, StudioRemoteReferenceResolvedAddress>();
  for (const answer of resolved) {
    if (
      (answer.family !== 4 && answer.family !== 6) ||
      isIP(answer.address) !== answer.family
    ) {
      throw new StudioRemoteReferenceNetworkError("dns_answer_invalid");
    }
    if (!isPublicStudioRemoteReferenceAddress(answer.address)) {
      // Reject the complete DNS answer when even one route is private. Choosing only the public
      // result would leave split-horizon and fallback behavior open to DNS rebinding tricks.
      throw new StudioRemoteReferenceNetworkPolicyError("forbidden_address");
    }
    unique.set(`${answer.family}:${answer.address}`, {
      address: answer.address,
      family: answer.family,
    });
  }

  const endpoint = unique.values().next().value;
  if (!endpoint) throw new StudioRemoteReferenceNetworkError("dns_answer_invalid");
  return endpoint;
}

@Injectable()
export class NodeStudioRemoteReferenceDnsResolver
implements StudioRemoteReferenceDnsResolver {
  async resolve(hostname: string): Promise<readonly StudioRemoteReferenceResolvedAddress[]> {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    }));
  }
}

function pinnedLookup(
  endpoint: StudioRemoteReferenceResolvedAddress
): LookupFunction {
  return ((
    _hostname: string,
    options: unknown,
    callback: (...args: unknown[]) => void
  ) => {
    if (
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      options.all === true
    ) {
      callback(null, [{ address: endpoint.address, family: endpoint.family }]);
      return;
    }
    callback(null, endpoint.address, endpoint.family);
  }) as LookupFunction;
}

@Injectable()
export class NodeStudioRemoteReferenceHttpRequester
implements StudioRemoteReferenceHttpRequester {
  request({
    url,
    endpoint,
    signal,
  }: {
    readonly url: URL;
    readonly endpoint: StudioRemoteReferenceResolvedAddress;
    readonly signal: AbortSignal;
  }): Promise<StudioRemoteReferenceHttpResponse> {
    return new Promise<StudioRemoteReferenceHttpResponse>((resolve, reject) => {
      const request = url.protocol === "https:" ? requestHttps : requestHttp;
      const hostname = normalizedHostname(url.hostname);
      const requestHandle = request(url, {
        method: "GET",
        agent: false,
        family: endpoint.family,
        lookup: pinnedLookup(endpoint),
        maxHeaderSize: REMOTE_REFERENCE_MAX_RESPONSE_HEADER_BYTES,
        rejectUnauthorized: true,
        servername: isIP(hostname) === 0 ? hostname : undefined,
        setHost: true,
        signal,
        headers: {
          Accept: "image/png,image/jpeg,image/webp,image/gif;q=0.9",
          "Accept-Encoding": "identity",
          Connection: "close",
          "User-Agent": "ToonSpectrum-RemoteReference/1.0",
        },
      }, (response) => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          cancel: () => response.destroy(),
        });
      });
      requestHandle.once("error", reject);
      requestHandle.end();
    }).catch((error: unknown) => {
      throw new StudioRemoteReferenceNetworkError("request_failed", {
        cause: error,
      });
    });
  }
}

export const studioRemoteReferenceDnsResolverProvider = {
  provide: STUDIO_REMOTE_REFERENCE_DNS_RESOLVER,
  useClass: NodeStudioRemoteReferenceDnsResolver,
};

export const studioRemoteReferenceHttpRequesterProvider = {
  provide: STUDIO_REMOTE_REFERENCE_HTTP_REQUESTER,
  useClass: NodeStudioRemoteReferenceHttpRequester,
};
