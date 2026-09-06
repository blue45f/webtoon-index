import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthorLine } from "./author-line";

describe("AuthorLine", () => {
  it("links writer and artist names to internal author pages", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AuthorLine author="손제호, LICO" artist="제나" year={2024} />
      </MemoryRouter>
    );

    expect(html).toContain(`href="/author/${encodeURIComponent("손제호")}"`);
    expect(html).toContain(`href="/author/${encodeURIComponent("LICO")}"`);
    expect(html).toContain(`href="/author/${encodeURIComponent("제나")}"`);
    expect(html).not.toContain("google.com");
    expect(html).not.toContain(`target="_blank"`);
  });
});
