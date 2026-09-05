import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  bundlePath,
  findRepo,
  iconPath,
  loadPackage,
  loadPackages,
  OWN_ROOT,
  packagePath,
} from "./context";
import { CliError } from "./lib/log";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

const AUTH = {
  requirements: [{ cookie: "session" }],
  challengeURL: "https://example.com/login",
  userAgent: null,
  maneuver: "Log in, then come back",
  interactive: true,
};

describe("OWN_ROOT", () => {
  it("is the folder holding the template", () => {
    // arrange
    const expected = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

    // act
    const root = OWN_ROOT;

    // assert
    expect(root).toBe(expected);
  });
});

describe("findRepo", () => {
  it("walks up from a nested folder to the one holding packages/", async () => {
    // arrange
    const repo = await tempRepo();
    const nested = join(repo.packages, "demo", "src");
    await mkdir(nested, { recursive: true });

    // act
    const found = findRepo(nested);

    // assert
    expect(found).toEqual(repo);
    expect(found.dist).toBe(join(repo.root, "dist"));
  });

  it("defaults to the working directory", async () => {
    // arrange
    const repo = await tempRepo();
    const previous = process.cwd();
    process.chdir(repo.packages);

    // act
    const found = findRepo();
    process.chdir(previous);

    // assert
    expect(found.root).toBe(realpathSync(repo.root));
  });

  it("throws when nothing above holds packages/", () => {
    // arrange
    const cwd = "/";

    // act
    const attempt = () => findRepo(cwd);

    // assert
    expect(attempt).toThrow(CliError);
    expect(attempt).toThrow(/no packages\/ directory found above/);
  });
});

describe("loadPackage", () => {
  it("loads a scaffolded package without auth", async () => {
    // arrange
    const repo = await tempRepo();
    capture();

    // act
    const pkg = await scaffold(repo, "demo", "Demo Source");

    // assert
    expect(pkg.slug).toBe("demo");
    expect(pkg.dir).toBe(join(repo.packages, "demo"));
    expect(pkg.manifest.name).toBe("Demo Source");
    expect(pkg.filters).toHaveLength(1);
    expect(pkg.auth).toBeNull();
  });

  it("loads auth.json when present", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(join(pkg.dir, "auth.json"), JSON.stringify(AUTH));

    // act
    const loaded = await loadPackage(repo, "demo");

    // assert
    expect(loaded.auth?.requirements).toEqual([{ cookie: "session" }]);
  });

  it("reports every problem across the three files at once", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    const manifest = JSON.parse(await readFile(join(pkg.dir, "source.json"), "utf8"));
    manifest.slug = "other";
    await writeFile(join(pkg.dir, "source.json"), JSON.stringify(manifest));
    await writeFile(join(pkg.dir, "filters.json"), JSON.stringify([{ kind: "nope" }]));
    await writeFile(join(pkg.dir, "auth.json"), JSON.stringify({}));
    await rm(join(pkg.dir, "src", "index.ts"));

    // act
    const attempt = loadPackage(repo, "demo");

    // assert
    await expect(attempt).rejects.toThrow(CliError);
    await expect(attempt).rejects.toThrow(
      /demo\/source\.json slug: "other" must match the folder name/,
    );
    await expect(attempt).rejects.toThrow(/demo\/filters\.json/);
    await expect(attempt).rejects.toThrow(/demo\/auth\.json/);
    await expect(attempt).rejects.toThrow(/demo\/src\/index\.ts is missing/);
  });

  it("names the file when json is missing or malformed", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(join(pkg.dir, "filters.json"), "{");

    // act
    const attempt = loadPackage(repo, "demo");

    // assert
    await expect(attempt).rejects.toThrow(/filters\.json: /);
    await expect(attempt).rejects.toHaveProperty("cause");
  });
});

describe("loadPackages", () => {
  it("returns every package folder sorted, ignoring dotfolders", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    await scaffold(repo, "zeta");
    await scaffold(repo, "alpha");
    await mkdir(join(repo.packages, ".hidden"));

    // act
    const packages = await loadPackages(repo);

    // assert
    expect(packages.map((pkg) => pkg.slug)).toEqual(["alpha", "zeta"]);
  });

  it("narrows to --only and rejects names that do not exist", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    await scaffold(repo, "alpha");
    await scaffold(repo, "beta");

    // act
    const only = await loadPackages(repo, ["beta"]);
    const attempt = loadPackages(repo, ["beta", "gamma"]);

    // assert
    expect(only.map((pkg) => pkg.slug)).toEqual(["beta"]);
    await expect(attempt).rejects.toThrow(/no package "gamma"/);
  });

  it("collects problems from every broken package before failing", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const a = await scaffold(repo, "alpha");
    const b = await scaffold(repo, "beta");
    await writeFile(join(a.dir, "filters.json"), "[1]");
    await writeFile(join(b.dir, "filters.json"), "[2]");

    // act
    const attempt = loadPackages(repo);

    // assert
    await expect(attempt).rejects.toThrow(/alpha\/filters\.json/);
    await expect(attempt).rejects.toThrow(/beta\/filters\.json/);
  });
});

describe("paths", () => {
  it("place build output, packages and icons under dist/", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const bundle = bundlePath(repo, "demo");
    const archive = packagePath(repo, pkg);
    const icon = iconPath(repo, "demo");

    // assert
    expect(bundle).toBe(join(repo.dist, "build", "demo", "main.js"));
    expect(archive).toBe(join(repo.dist, "packages", "demo-v0.1.0.althsource"));
    expect(icon).toBe(join(repo.dist, "icons", "demo.png"));
  });
});
