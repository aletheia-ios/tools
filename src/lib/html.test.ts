import { describe, expect, it } from "vitest";
import { escapeHTML, qrSVG } from "./html";

describe("escapeHTML", () => {
  it("escapes the characters that would close a tag or an attribute", () => {
    // arrange
    const hostile = `<img src=x onerror="alert('1')">&`;

    // act
    const escaped = escapeHTML(hostile);

    // assert
    expect(escaped).toBe("&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;");
    expect(escaped).not.toContain("<");
  });

  it("leaves ordinary text untouched", () => {
    // arrange
    const text = "MangaDex 1.0.0 (EN, JA)";

    // act
    const escaped = escapeHTML(text);

    // assert
    expect(escaped).toBe(text);
  });
});

describe("qrSVG", () => {
  it("returns a scalable svg for the url", () => {
    // arrange
    const url = "https://sources.aletheia.moe/main/index.json";

    // act
    const svg = qrSVG(url);

    // assert
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("encodes different urls differently", () => {
    // arrange
    const first = "https://sources.aletheia.moe/main/index.json";
    const second = "https://sources.aletheia.moe/adult/index.json";

    // act
    const svg = qrSVG(first);
    const other = qrSVG(second);

    // assert
    expect(svg).not.toBe(other);
  });
});
