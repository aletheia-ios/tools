import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
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

  it("is one self-contained file with the icon inlined and no assets beside it", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg]);
    const out = sitePath(repo, "main");
    const html = await readFile(join(out, "index.html"), "utf8");
    const beside = await readdir(out);

    // assert
    expect(beside).toEqual(["index.html"]);
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).not.toContain('src="icons/');
    expect(html).not.toContain('href="sources/');
  });

  it("shows every host a source may reach, as its effective shape", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    const manifest = JSON.parse(await readFile(join(pkg.dir, "source.json"), "utf8"));
    manifest.hosts = ["api.example.com", "${serverURL}"];
    manifest.settings = [{ type: "text", id: "serverURL", name: "Server" }];
    manifest.baseURL = "${serverURL}";
    await writeFile(join(pkg.dir, "source.json"), JSON.stringify(manifest));
    const { loadPackage } = await import("@/context");
    const loaded = await loadPackage(repo, "demo");
    await pack(repo, [loaded]);

    // act
    await site(repo, [loaded]);
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain("*.api.example.com");
    expect(html).toContain("your own server");
    expect(html).not.toContain("${serverURL}");
  });

  it("says so when a source contacts nothing", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg]);
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain("contacts nothing");
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
    expect(html).toContain("no affiliation with the sites it points to");
    expect(html).toContain("Nothing is hosted here");
    expect(html).toContain("To have a source removed, get in touch");
    // a temp directory has no git remote, so the repository line has nothing to point at
    expect(html).not.toContain("Source code at");
  });

  it("links the repository the packages came from, taking it from the git remote", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);
    const git = promisify(execFile);
    await git("git", ["init"], { cwd: repo.root });
    // the scp-style form, which is not a URL and has to be rewritten rather than parsed
    await git("git", ["remote", "add", "origin", "git@github.com:someone/sources.git"], {
      cwd: repo.root,
    });

    // act
    await site(repo, [pkg]);
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain('href="https://github.com/someone/sources"');
    expect(html).toContain(">github.com/someone/sources</a>");
    expect(html).toContain("Source code at");
    expect(html).toContain('href="https://github.com/someone/sources/issues"');
  });

  it("addresses each list under a base when the deploy passes one", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: LIST } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg], "https://someone.github.io/sources/");
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    const expected = "https://someone.github.io/sources/main/index.json";
    expect(html).toContain(`data-copy="${expected}"`);
    expect(html).toContain(`href="aletheia://add-list?url=${encodeURIComponent(expected)}"`);
    expect(html).not.toContain(URL);
  });

  it("writes a page for a list with no url once a base supplies one", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: { ...LIST, url: undefined } } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await site(repo, [pkg], "https://someone.github.io/sources");
    const html = await readFile(join(sitePath(repo, "main"), "index.html"), "utf8");

    // assert
    expect(html).toContain("https://someone.github.io/sources/main/index.json");
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
    // only the adult one is marked, so the mark appears once across two cards
    expect(html.split("18+").length - 1).toBe(1);
    expect(html).not.toContain("Mixed ratings");
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
