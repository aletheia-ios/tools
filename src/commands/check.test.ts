import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { loadPackage } from "@/context";
import { hasJSC } from "@/lib/jsc";
import { CliError } from "@/lib/log";
import { check } from "./check";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

const NO_CONTENT = `
export default {
  search: async () => ({ items: [], next: null }),
  details: async () => ({}),
  chapters: async () => [],
};
`;

describe("check", () => {
  it("passes a fresh package and reports its capabilities and smoke counts", async () => {
    // arrange
    const repo = await tempRepo();
    const captured = capture();
    const pkg = await scaffold(repo, "demo");

    // act
    await check(repo, [pkg]);

    // assert
    expect(captured.err).toContainEqual(expect.stringMatching(/typescript is not installed/));
    expect(captured.out).toContainEqual(
      expect.stringMatching(
        /^demo: ok \[base\] - "Example Series", 0 results, 1 chapters, 2 pages$/,
      ),
    );
  });

  it("typechecks with the repository's tsc and fails on a type error", async () => {
    // arrange
    const repo = await tempRepo({ nodeModules: true });
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    await check(repo, [pkg]);
    await writeFile(
      join(pkg.dir, "src", "index.ts"),
      "const n: number = 'text';\nexport default n;\n",
    );

    // act
    const attempt = check(repo, [pkg]);

    // assert
    expect(captured.err).not.toContainEqual(expect.stringMatching(/typescript is not installed/));
    await expect(attempt).rejects.toThrow(CliError);
    await expect(attempt).rejects.toThrow(/TS2322/);
  });

  it("reports a missing icon", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    await rm(join(pkg.dir, "icon.svg"));

    // act
    const attempt = check(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/demo: no icon/);
  });

  it("skips the JavaScriptCore run when jsc is absent", async () => {
    // arrange
    const repo = await tempRepo();
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    vi.spyOn(process, "platform", "get");
    const jsc = await import("@/lib/jsc");
    vi.spyOn(jsc, "hasJSC").mockReturnValue(false);

    // act
    await check(repo, [pkg]);

    // assert
    expect(captured.err).toContainEqual(expect.stringMatching(/jsc shell not found/));
    expect(captured.out).not.toContainEqual(expect.stringMatching(/demo: ok/));
  });
});

describe.skipIf(!hasJSC())("check under JavaScriptCore", () => {
  it("names the missing required export", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(join(pkg.dir, "src", "index.ts"), NO_CONTENT);

    // act
    const attempt = check(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/demo: missing export content\(\)/);
  });

  it("reports a bundle that fails to evaluate", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(join(pkg.dir, "src", "index.ts"), "export default new TextEncoder();\n");

    // act
    const attempt = check(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/demo: main\.js failed to evaluate in JavaScriptCore/);
    await expect(attempt).rejects.toThrow(/TextEncoder/);
  });

  it("verifies exports only when there is no smoke fixture", async () => {
    // arrange
    const repo = await tempRepo();
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    await rm(join(pkg.dir, "fixtures", "smoke.json"));

    // act
    await check(repo, [pkg]);

    // assert
    expect(captured.err).toContainEqual(expect.stringMatching(/no fixtures\/smoke\.json/));
    expect(captured.out).toContainEqual("demo: ok [base]");
  });

  it("reports a smoke run that throws", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(join(pkg.dir, "fixtures", "catalogue.json"), JSON.stringify({ series: [] }));

    // act
    const attempt = check(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/demo: smoke failed in JavaScriptCore/);
    await expect(attempt).rejects.toThrow(/notFound: series/);
  });

  it("lists the optional exports and auth as capabilities", async () => {
    // arrange
    const repo = await tempRepo();
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(
      join(pkg.dir, "src", "index.ts"),
      `${NO_CONTENT.replace("chapters: async () => [],", 'chapters: async () => [],\n  content: async () => [],\n  pingURL: () => "https://example.com/ping",')}`,
    );
    await rm(join(pkg.dir, "fixtures", "smoke.json"));
    await writeFile(
      join(pkg.dir, "auth.json"),
      JSON.stringify({
        requirements: [{ cookie: "session" }],
        challengeURL: "https://example.com/login",
        userAgent: null,
        maneuver: "Log in, then come back",
        interactive: true,
      }),
    );

    // act
    await check(repo, [await loadPackage(repo, "demo")]);

    // assert
    expect(captured.out).toContainEqual("demo: ok [pingURL, auth]");
  });
});
