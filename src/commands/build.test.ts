import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "@/lib/log";
import { build, buildOne } from "./build";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

describe("buildOne", () => {
  it("bundles src/index.ts to an iife that sets the source global", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const built = await buildOne(repo, pkg);
    const bundle = await readFile(built.path, "utf8");

    // assert
    expect(built.path).toBe(join(repo.dist, "build", "demo", "main.js"));
    expect(built.bytes).toBeGreaterThan(0);
    expect(bundle).toContain("globalThis.__source = __bundle.default;");
    expect(bundle).toContain("Example Series");
  });

  it("refuses a bundle that pulled in zod", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(
      join(pkg.dir, "src", "index.ts"),
      'import { SourceManifest } from "@aletheia-ios/sdk/schemas";\nexport default { SourceManifest };\n',
    );

    // act
    const attempt = buildOne(repo, pkg);

    // assert
    await expect(attempt).rejects.toThrow(CliError);
    await expect(attempt).rejects.toThrow(/demo: main\.js bundles zod/);
  });
});

describe("build", () => {
  it("builds every package and logs each size", async () => {
    // arrange
    const repo = await tempRepo();
    const captured = capture();
    const packages = [await scaffold(repo, "alpha"), await scaffold(repo, "beta")];

    // act
    const built = await build(repo, packages);

    // assert
    expect(built.map((one) => one.pkg.folder)).toEqual(["alpha", "beta"]);
    expect(built.every((one) => existsSync(one.path))).toBe(true);
    expect(captured.out).toEqual(
      expect.arrayContaining([expect.stringMatching(/^alpha: main\.js \d+\.\d kB$/)]),
    );
  });
});
