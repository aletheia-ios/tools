import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "@/lib/log";
import { indexes, loadLists } from "./indexes";
import { pack } from "./pack";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

const SAMPLE = { name: "Test", target: "sample", sources: ["demo"] };

describe("loadLists", () => {
  it("reads every list sorted by file name", async () => {
    // arrange
    const repo = await tempRepo({ lists: { b: { ...SAMPLE, target: "b" }, a: SAMPLE } });

    // act
    const lists = await loadLists(repo);

    // assert
    expect(lists.map((list) => list.target)).toEqual(["sample", "b"]);
  });

  it("requires a lists/ directory", async () => {
    // arrange
    const repo = await tempRepo();

    // act
    const attempt = loadLists(repo);

    // assert
    await expect(attempt).rejects.toThrow(CliError);
    await expect(attempt).rejects.toThrow(/no lists\/ directory/);
  });

  it("names the file and field of an invalid list", async () => {
    // arrange
    const repo = await tempRepo({ lists: { main: { name: "", target: "Main!", sources: [] } } });

    // act
    const attempt = loadLists(repo);

    // assert
    await expect(attempt).rejects.toThrow(/lists\/main\.json name:/);
    await expect(attempt).rejects.toThrow(/lists\/main\.json target:/);
    await expect(attempt).rejects.toThrow(/lists\/main\.json sources:/);
  });
});

describe("indexes", () => {
  it("writes index.json with relative urls and the deploy manifest", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    await pack(repo, [pkg]);

    // act
    await indexes(repo, [pkg]);
    const index = JSON.parse(await readFile(join(repo.dist, "sample", "index.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(repo.dist, "sample", "manifest.json"), "utf8"));
    const archive = await stat(join(repo.dist, "packages", "demo-v0.1.0.althsource"));

    // assert
    expect(index.name).toBe("Test");
    expect(index.sources).toHaveLength(1);
    expect(index.sources[0]).toMatchObject({
      slug: "demo",
      version: "0.1.0",
      downloadURL: "../packages/demo-v0.1.0.althsource",
      iconURL: "../icons/demo.png",
      size: archive.size,
    });
    expect(index.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest).toEqual({ packages: ["demo-v0.1.0.althsource"], icons: ["demo.png"] });
    expect(captured.out).toContain("sample/index.json: 1 source(s)");
  });

  it("dates an entry by the package folder's last commit", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(join(repo.root, ".gitignore"), "dist/\n");
    const env = { ...process.env };
    env.GIT_AUTHOR_DATE = "2024-05-06T07:08:09Z";
    env.GIT_COMMITTER_DATE = "2024-05-06T07:08:09Z";
    const git = (...args: string[]) =>
      spawnSync("git", args, { cwd: repo.root, encoding: "utf8", env });
    git("init", "-q");
    git("-c", "user.email=t@e.st", "-c", "user.name=t", "add", ".");
    git("-c", "user.email=t@e.st", "-c", "user.name=t", "commit", "-q", "-m", "init");
    await pack(repo, [pkg]);

    // act
    await indexes(repo, [pkg]);
    const index = JSON.parse(await readFile(join(repo.dist, "sample", "index.json"), "utf8"));

    // assert
    expect(index.sources[0].updatedDate).toBe("2024-05-06T07:08:09.000Z");
  });

  it("rejects a list naming a package that does not exist", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: { ...SAMPLE, sources: ["demo", "ghost"] } } });
    capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const attempt = indexes(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/list "Test": no package "ghost"/);
  });

  it("requires pack to have run first", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const attempt = indexes(repo, [pkg]);

    // assert
    await expect(attempt).rejects.toThrow(/demo: not packed - run pack first/);
  });
});
