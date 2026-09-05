import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OWN_ROOT } from "@/context";
import { hasJSC } from "@/lib/jsc";

const JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc";

const DOC = `<div class="wrap" data-id="7">
  <h2 id="t">Title <b>bold</b></h2>
  <p>para <i>em</i></p>
  <script>var q = 1;</script>
</div>`;

/**
 * Runs a snippet against the bridge inside JavaScriptCore and returns what it printed.
 *
 * Exercised through jsc rather than in-process because that is the engine the bridge has to
 * survive, and a Node-only test would not prove it.
 */
function inJSC(snippet: string): string {
  const bridge = readFileSync(join(OWN_ROOT, "dist", "html-bridge.js"), "utf8");
  const file = join(mkdtempSync(join(tmpdir(), "aletheia-html-")), "run.js");
  writeFileSync(file, `${bridge}\nvar __doc = ${JSON.stringify(DOC)};\n${snippet}`);
  return execFileSync(JSC, [file], { encoding: "utf8" }).trim();
}

// the bridge installs itself on the global; importing it here is what makes it testable
// in-process, while the JavaScriptCore suite below proves it survives the engine it ships to
await import("./inject");
const html = (globalThis as unknown as { __html: Bridge }).__html;

interface Bridge {
  parse: (text: string) => number;
  select: (handle: number, selector: string) => number[];
  attr: (handle: number, name: string) => string;
  text: (handle: number) => string;
  ownText: (handle: number) => string;
  wholeText: (handle: number) => string;
  data: (handle: number) => string;
  className: (handle: number) => string;
  tagName: (handle: number) => string;
  childNodes: (handle: number) => Array<{ kind: string; text?: string; handle?: number }>;
  parent: (handle: number) => number | null;
  markdown: (fragment: string) => string;
}

describe("the html bridge in process", () => {
  it("reads tags, attributes and both kinds of text", () => {
    // arrange
    const doc = html.parse(DOC);

    // act
    const [heading] = html.select(doc, "div.wrap > h2#t");

    // assert
    expect(html.tagName(heading as number)).toBe("h2");
    expect(html.attr(heading as number, "id")).toBe("t");
    expect(html.attr(heading as number, "absent")).toBe("");
    expect(html.text(heading as number)).toBe("Title bold");
    expect(html.ownText(heading as number)).toBe("Title");
    expect(html.wholeText(heading as number)).toContain("Title");
  });

  it("reports class, parent, children and script contents", () => {
    // arrange
    const doc = html.parse(DOC);
    const [wrap] = html.select(doc, "div");
    const [heading] = html.select(doc, "h2");

    // act
    const children = html.childNodes(heading as number);

    // assert
    expect(html.className(wrap as number)).toBe("wrap");
    expect(html.tagName(html.parent(heading as number) as number)).toBe("div");
    expect(children.map((child) => child.kind)).toEqual(["text", "element"]);
    expect(html.data(html.select(doc, "script")[0] as number)).toBe("var q = 1;");
  });

  it("answers emptily for a handle that names nothing", () => {
    // arrange
    const absent = 9999;

    // act
    const results = {
      select: html.select(absent, "div"),
      attr: html.attr(absent, "id"),
      text: html.text(absent),
      own: html.ownText(absent),
      whole: html.wholeText(absent),
      data: html.data(absent),
      cls: html.className(absent),
      tag: html.tagName(absent),
      children: html.childNodes(absent),
      parent: html.parent(absent),
    };

    // assert
    expect(results).toEqual({
      select: [],
      attr: "",
      text: "",
      own: "",
      whole: "",
      data: "",
      cls: "",
      tag: "",
      children: [],
      parent: null,
    });
  });

  it("converts the markdown subset and drops what it does not render", () => {
    // arrange
    const fragment = `<h3>Head</h3><p>a <b>b</b> <i>c</i> <code>d</code> <s>e</s></p>
      <blockquote>quoted</blockquote><pre>kept  spacing</pre><hr><ol><li>one</li><li>two</li></ol>
      <a href="https://x.test">link</a><a>bare</a><img src="x.png"><script>drop()</script>`;

    // act
    const markdown = html.markdown(fragment);

    // assert
    expect(markdown).toContain("### Head");
    expect(markdown).toContain("**b**");
    expect(markdown).toContain("_c_");
    expect(markdown).toContain("`d`");
    expect(markdown).toContain("~~e~~");
    expect(markdown).toContain("> quoted");
    expect(markdown).toContain("kept  spacing");
    expect(markdown).toContain("---");
    expect(markdown).toContain("1. one");
    expect(markdown).toContain("2. two");
    expect(markdown).toContain("[link](https://x.test)");
    expect(markdown).toContain("bare");
    expect(markdown).not.toContain("drop()");
    expect(markdown).not.toContain("x.png");
  });

  it("escapes characters that would otherwise be markup", () => {
    // arrange
    const fragment = "<p>a * b _ c [d] `e`</p>";

    // act
    const markdown = html.markdown(fragment);

    // assert
    expect(markdown).toBe("a \\* b \\_ c \\[d\\] \\`e\\`");
  });

  it("keeps a line break and a div as separate blocks", () => {
    // arrange
    const fragment = "<div>first</div><p>a<br>b</p>";

    // act
    const markdown = html.markdown(fragment);

    // assert
    expect(markdown).toBe("first\n\na\nb");
  });

  it("nests a list inside a list item", () => {
    // arrange
    const fragment = "<ul><li>one<ul><li>deep</li></ul></li></ul>";

    // act
    const markdown = html.markdown(fragment);

    // assert
    expect(markdown).toContain("- one");
    expect(markdown).toContain("- deep");
  });
});

describe.skipIf(!hasJSC())("the html bridge under JavaScriptCore", () => {
  it("selects, and reads tags, attributes and text", () => {
    // arrange
    const snippet = `
      var doc = __html.parse(__doc);
      var h2 = __html.select(doc, "div.wrap > h2#t")[0];
      print(JSON.stringify({
        tag: __html.tagName(h2),
        attr: __html.attr(h2, "id"),
        missing: __html.attr(h2, "nope"),
        text: __html.text(h2),
        own: __html.ownText(h2),
        cls: __html.className(__html.select(doc, "div")[0]),
        parent: __html.tagName(__html.parent(h2)),
        data: __html.data(__html.select(doc, "script")[0]),
      }));`;

    // act
    const result = JSON.parse(inJSC(snippet));

    // assert
    expect(result).toEqual({
      tag: "h2",
      attr: "t",
      missing: "",
      text: "Title bold",
      own: "Title",
      cls: "wrap",
      parent: "div",
      data: "var q = 1;",
    });
  });

  it("reports child nodes as text and elements", () => {
    // arrange
    const snippet = `
      var h2 = __html.select(__html.parse(__doc), "h2")[0];
      print(JSON.stringify(__html.childNodes(h2).map(function (c) { return c.kind; })));`;

    // act
    const kinds = JSON.parse(inJSC(snippet));

    // assert
    expect(kinds).toEqual(["text", "element"]);
  });

  it("returns nothing for a selector that matches nothing, and null at the root", () => {
    // arrange
    const snippet = `
      var doc = __html.parse(__doc);
      print(JSON.stringify({
        none: __html.select(doc, ".absent").length,
        root: __html.parent(doc),
      }));`;

    // act
    const result = JSON.parse(inJSC(snippet));

    // assert
    expect(result).toEqual({ none: 0, root: null });
  });

  it("converts a fragment to the markdown subset", () => {
    // arrange
    const snippet = `
      print(JSON.stringify(__html.markdown(
        "<p>Hello <b>world</b> and <a href='https://x.test'>a link</a></p><ul><li>one</li><li>two</li></ul>"
      )));`;

    // act
    const markdown = JSON.parse(inJSC(snippet));

    // assert
    expect(markdown).toBe("Hello **world** and [a link](https://x.test)\n\n- one\n- two");
  });
});
