import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pack } from "./pack";
import { site, sitePath } from "./site";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

const URL = "https://sources.aletheia.moe/main/index.json";
const LIST = { name: "Aletheia Sources", target: "main", url: URL, sources: ["com.example.demo"] };

describe("site", () => {
  it("writes a page carrying the deep link, the url and an inline qr", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    const captured = capture();
    const pkg = await scaffold(repo, "demo", "Demo Source");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg]);
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain(`href="aletheia://add-list?url=${encodeURIComponent(URL)}"`);
    expect(html).toContain(`data-copy="${URL}"`);
    expect(html).toContain("<svg");
    expect(html).toContain("Demo Source");
    expect(html).toContain("<title>Aletheia Sources</title>");
    expect(captured.out).toContain("main/site/index.html: 1 source(s)");
  });

  it("copies each source's icon and manifest next to the page", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg]);
    const out = sitePath(repo, "main");
    const manifest = JSON.parse(
      await readFile(join(out, "sources", "com.example.demo.json"), "utf8"),
    );

    // assert
    expect(existsSync(join(out, "icons", "com.example.demo.png"))).toBe(true);
    expect(manifest.slug).toBe("com.example.demo");
  });

  it("carries the no-affiliation and removal notice", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg]);
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain("not an official part of Aletheia");
    expect(html).toContain("not connected to, endorsed by,");
    expect(html).toContain("it will be removed");
  });

  it("puts an age gate in front of an adult list and hides the sources", async () => {
    // arrange
    const repo = await tempRepo({ lists: { adult: { ...LIST, target: "adult", adult: true } } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg]);
    const html = await readFile(join(sitePath(repo, "adult"), "index.html"), "utf8");

    // assert
    expect(html).toContain('id="gate"');
    expect(html).toContain("18 or older");
    expect(html).toContain('<div id="list" style="display:none">');
  });

  it("skips a list that has no url yet", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: { ...LIST, url: undefined } } });
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg]);

    // assert
    expect(captured.out).toContain("main: no url in the list, skipping the page");
    expect(existsSync(sitePath(repo, "main"))).toBe(false);
  });

  it("escapes a name that would otherwise inject markup", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    const manifest = JSON.parse(await readFile(join(pkg.dir, "source.json"), "utf8"));
    manifest.name = '<script>alert("x")</script>';
    await writeFile(join(pkg.dir, "source.json"), JSON.stringify(manifest));
    await pack(repo, [pkg]);
    const { loadPackage } = await import("@/context");

    // act
    await site(repo, [await loadPackage(repo, "demo")]);
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
  });

  it("counts several sources and badges an adult one", async () => {
    // arrange
    const repo = await tempRepo({
      lists: { main: { ...LIST, sources: ["com.example.alpha", "com.example.beta"] } },
    });
    capture();
    const alpha = await scaffold(repo, "alpha");
    const beta = await scaffold(repo, "beta");
    const manifest = JSON.parse(await readFile(join(beta.dir, "source.json"), "utf8"));
    manifest.contentRating = "adult";
    await writeFile(join(beta.dir, "source.json"), JSON.stringify(manifest));
    const { loadPackages } = await import("@/context");
    const packages = await loadPackages(repo);
    await pack(repo, packages);

    // act
    await site(repo, packages);
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain("2 sources");
    expect(html).toContain("18+");
    expect(html).toContain("Mixed ratings");
    expect(alpha.manifest.contentRating).toBe("mixed");
  });

  it("requires pack to have run first", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const attempt = site(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/demo: not packed - run pack first/);
  });

  it("rejects a list naming a package that does not exist", async () => {
    // arrange
    const repo = await tempRepo({
      lists: { main: { ...LIST, sources: ["com.example.demo", "ghost"] } },
    });
    capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const attempt = site(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/list "Aletheia Sources": no package "ghost"/);
  });
});
