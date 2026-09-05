import process from "node:process";
import { describe, expect, it } from "vitest";
import { exportsOf, hasJSC, smoke } from "./jsc";

const BASE = `
  globalThis.__source = {
    search: function () { return Promise.resolve({ items: [{ slug: "a" }], next: null }); },
    details: function () {
      return __host.fetch({ url: "https://example.com/api/series" })
        .then(function (r) { return { title: JSON.parse(r.text).title }; });
    },
    chapters: function () { return Promise.resolve([{ slug: "c" }]); },
    content: function () { return Promise.resolve([{ index: 0, url: "https://example.com/1.png" }]); },
    pingURL: function () { return "https://example.com/ping"; },
  };
`;

describe("hasJSC", () => {
  it("finds the jsc shell on macOS", () => {
    // arrange
    const macOS = process.platform === "darwin";

    // act
    const present = hasJSC();

    // assert
    expect(present).toBe(macOS);
  });
});

describe.skipIf(!hasJSC())("exportsOf", () => {
  it("reports the type of every contract method", () => {
    // arrange
    const bundle = BASE;

    // act
    const run = exportsOf(bundle);

    // assert
    expect(run.ok).toBe(true);
    expect(run.result).toMatchObject({
      search: "function",
      details: "function",
      chapters: "function",
      content: "function",
      comments: "undefined",
      pingURL: "function",
    });
  });

  it("fails when the bundle throws while loading", () => {
    // arrange
    const bundle = 'throw new Error("no TextEncoder here");';

    // act
    const run = exportsOf(bundle);

    // assert
    expect(run.ok).toBe(false);
    expect(run.result).toBeNull();
    expect(run.output).toMatch(/no TextEncoder here/);
  });
});

describe.skipIf(!hasJSC())("smoke", () => {
  it("answers fetches from fixtures and collects the four calls", () => {
    // arrange
    const fixtures = [{ match: "/api/series", body: { title: "Fixture Title" } }];

    // act
    const run = smoke(BASE, fixtures);

    // assert
    expect(run.ok).toBe(true);
    expect(run.result?.details.title).toBe("Fixture Title");
    expect(run.result?.search.items).toHaveLength(1);
    expect(run.result?.chapters).toHaveLength(1);
    expect(run.result?.content).toHaveLength(1);
  });

  it("fails with the rejection when no fixture matches", () => {
    // arrange
    const fixtures = [{ match: "/other", body: {} }];

    // act
    const run = smoke(BASE, fixtures);

    // assert
    expect(run.ok).toBe(false);
    expect(run.output).toMatch(/no fixture for https:\/\/example.com\/api\/series/);
  });
});
