import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupRepos, tempRepo } from "@test/repo";
import { afterAll, describe, expect, it } from "vitest";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;

function aletheia(cwd: string, ...args: string[]) {
  const run = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

afterAll(cleanupRepos);

describe("aletheia", () => {
  it("prints usage with no command and with --help", async () => {
    // arrange
    const repo = await tempRepo();

    // act
    const bare = aletheia(repo.root);
    const help = aletheia(repo.root, "--help");

    // assert
    expect(bare.status).toBe(0);
    expect(bare.out).toMatch(/^usage: aletheia <command>/);
    expect(help.out).toBe(bare.out);
  });

  it("fails on an unknown command and on missing positionals", async () => {
    // arrange
    const repo = await tempRepo();

    // act
    const unknown = aletheia(repo.root, "frobnicate");
    const noSlug = aletheia(repo.root, "new");
    const noSeries = aletheia(repo.root, "live", "demo");

    // assert
    expect(unknown.status).toBe(1);
    expect(unknown.out).toMatch(/unknown command "frobnicate"/);
    expect(noSlug.out).toMatch(/usage: aletheia new <slug>/);
    expect(noSeries.out).toMatch(/usage: aletheia live <slug>/);
  });

  it("runs new, check, pack and index end to end from a nested directory", async () => {
    // arrange
    const repo = await tempRepo({
      lists: { sample: { name: "Test", target: "sample", sources: ["com.example.demo"] } },
    });

    // act
    const created = aletheia(repo.root, "new", "com.example.demo", "--name", "Demo Source");
    const checked = aletheia(join(repo.packages, "demo"), "check", "--only", "demo");
    const packed = aletheia(repo.root, "pack");
    const indexed = aletheia(repo.root, "index");
    const index = JSON.parse(await readFile(join(repo.dist, "sample", "index.json"), "utf8"));

    // assert
    expect(created.status).toBe(0);
    expect(checked.status).toBe(0);
    expect(checked.out).toMatch(/demo: ok \[base\] - "Example Series"/);
    expect(packed.status).toBe(0);
    const archive = join(repo.dist, "packages", "com.example.demo-v0.1.0.althsource");
    expect(existsSync(archive)).toBe(true);
    expect(indexed.status).toBe(0);
    expect(index.sources[0].slug).toBe("com.example.demo");
  });

  it("reports a broken manifest with its path and exits 1", async () => {
    // arrange
    const repo = await tempRepo();
    aletheia(repo.root, "new", "com.example.bad");
    const file = join(repo.packages, "bad", "source.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.sort.default = "nope";
    await writeFile(file, JSON.stringify(manifest));

    // act
    const run = aletheia(repo.root, "check");

    // assert
    expect(run.status).toBe(1);
    expect(run.out).toMatch(
      /bad\/source\.json sort\.default: default must be one of the option ids/,
    );
  });
});
