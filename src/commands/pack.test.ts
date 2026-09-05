import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pack } from "./pack";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

describe("pack", () => {
  it("writes the archive and icon, and reports the hash of the bytes on disk", async () => {
    // arrange
    const repo = await tempRepo();
    const captured = capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const [packed] = await pack(repo, [pkg]);
    const archive = await readFile(packed?.path as string);
    const entries = unzipSync(archive);
    const icon = await sharp(packed?.icon).metadata();

    // assert
    expect(packed?.path).toBe(join(repo.dist, "packages", "com.example.demo-v0.1.0.althsource"));
    expect(Object.keys(entries).sort()).toEqual([
      "filters.json",
      "icon.png",
      "main.js",
      "source.json",
    ]);
    expect(packed?.sha256).toBe(createHash("sha256").update(archive).digest("hex"));
    expect(packed?.bytes).toBe(archive.byteLength);
    expect(icon.width).toBe(512);
    expect(captured.out).toContainEqual(
      expect.stringMatching(
        /^demo: dist\/packages\/com\.example\.demo-v0\.1\.0\.althsource \d+\.\d kB [0-9a-f]{12}$/,
      ),
    );
  });

  it("includes auth.json when the package has one", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");
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
    const [packed] = await pack(repo, [pkg]);
    const entries = unzipSync(await readFile(packed?.path as string));

    // assert
    expect(Object.keys(entries)).toContain("auth.json");
  });

  it("produces the same bytes on a second run", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    const pkg = await scaffold(repo, "demo");

    // act
    const [first] = await pack(repo, [pkg]);
    const bytes = await readFile(first?.path as string);
    const [second] = await pack(repo, [pkg]);

    // assert
    expect(second?.sha256).toBe(first?.sha256);
    expect((await readFile(second?.path as string)).equals(bytes)).toBe(true);
  });
});
