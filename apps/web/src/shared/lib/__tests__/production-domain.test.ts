import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SITE_URL, siteUrl } from "../../../../../../packages/core/src/business";

const ROOT = process.cwd();
const CANONICAL_ORIGIN = "https://www.toonstudio.cloud";

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("toonstudio.cloud production domain", () => {
  it("uses the www origin as the single canonical URL source", () => {
    expect(SITE_URL).toBe(CANONICAL_ORIGIN);
    expect(siteUrl("/studio")).toBe(`${CANONICAL_ORIGIN}/studio`);
    expect(siteUrl("fortune")).toBe(`${CANONICAL_ORIGIN}/fortune`);
  });

  it("publishes canonical, OG, JSON-LD, robots and LLM links on the www origin", () => {
    const html = read("index.html");
    expect(html).toContain(`<link rel="canonical" href="${CANONICAL_ORIGIN}/"`);
    expect(html).toContain(`<meta property="og:url" content="${CANONICAL_ORIGIN}/"`);
    expect(html).toContain(`"@id": "${CANONICAL_ORIGIN}/#website"`);
    expect(html).toContain(`"urlTemplate": "${CANONICAL_ORIGIN}/search?q={search_term_string}"`);
    expect(read("apps/web/public/robots.txt")).toContain(
      `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`
    );
    expect(read("apps/web/public/llms.txt")).toContain(`${CANONICAL_ORIGIN}/studio`);
  });

  it("keeps host-scoped permanent redirects for apex and the legacy Vercel hostname", () => {
    const config = JSON.parse(read("vercel.json")) as {
      redirects?: Array<{
        destination?: string;
        permanent?: boolean;
        has?: Array<{ type?: string; value?: string }>;
      }>;
    };
    const redirects = config.redirects ?? [];

    for (const host of ["toonstudio.cloud", "toonspectrum.vercel.app"]) {
      expect(redirects).toContainEqual(
        expect.objectContaining({
          destination: `${CANONICAL_ORIGIN}/:path*`,
          permanent: true,
          has: [{ type: "host", value: host }],
        })
      );
    }
  });

  it("routes creator-market resource detail crawlers through the metadata handler", () => {
    const config = JSON.parse(read("vercel.json")) as {
      rewrites?: Array<{ source?: string; destination?: string }>;
    };

    expect(config.rewrites).toEqual(expect.arrayContaining([
      {
        source: "/market",
        destination: "/api/og?marketPage=home",
      },
      {
        source: "/market/browse",
        destination: "/api/og?marketPage=browse",
      },
      {
        source: "/market/resource/:resourceId",
        destination: "/api/og?marketResourceId=:resourceId",
      },
    ]));
  });

  it("keeps full API origins canonical while Render stays a least-privilege realtime host", () => {
    const deployment = read("deploy/oci/.env.example");
    const production = read(".env.production.example");
    const render = read("render.yaml");
    expect(deployment).toContain(
      "API_CORS_ALLOWED_ORIGINS=https://www.toonstudio.cloud,https://toonstudio.cloud"
    );
    expect(deployment).toContain(
      "OAUTH_REDIRECT_BASE_URL=https://www.toonstudio.cloud"
    );
    expect(deployment).toContain("WEB_APP_BASE_URL=https://www.toonstudio.cloud");
    expect(deployment).toContain("CANONICAL_HOST=www.toonstudio.cloud");

    expect(production).toContain(
      "API_CORS_ALLOWED_ORIGINS=https://www.toonstudio.cloud,https://toonstudio.cloud"
    );
    expect(production).toContain("OAUTH_REDIRECT_BASE_URL=https://www.toonstudio.cloud");
    expect(production).toContain("WEB_APP_BASE_URL=https://www.toonstudio.cloud");
    expect(production).toContain("CANONICAL_HOST=www.toonstudio.cloud");

    expect(render).toMatch(
      /key: API_CORS_ALLOWED_ORIGINS\s+value: https:\/\/www\.toonstudio\.cloud,https:\/\/toonstudio\.cloud/u
    );
    expect(render).toMatch(
      /key: API_RUNTIME_ROLE\s+value: studio-live/u
    );
    expect(render).toMatch(
      /key: AUTH_SESSION_SECRET\s+sync: false/u
    );
    expect(render).toMatch(
      /key: STUDIO_REALTIME_TICKET_ENABLED\s+value: "false"/u
    );
    expect(render).not.toMatch(
      /key: (?:AUTH_STATE_SECRET|OAUTH_REDIRECT_BASE_URL|WEB_APP_BASE_URL|CANONICAL_HOST|GOOGLE_OAUTH_CLIENT_ID|GOOGLE_OAUTH_CLIENT_SECRET)/u
    );
  });
});
