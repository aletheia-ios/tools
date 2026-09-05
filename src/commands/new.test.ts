import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, cleanupRepos, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { CliError } from "@/lib/log";
import { create } from "./new";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

describe("create", () => {
  it("copies the template and substitutes the slug and name", async () => {
    // arrange
    const repo = await tempRepo();
    const captured = capture();

    // act
    await create(repo, "com.example.demo", "Demo Source");
    const manifest = JSON.parse(await readFile(join(repo.packages, "demo", "source.json"), "utf8"));
    const index = await readFile(join(repo.packages, "demo", "src", "index.ts"), "utf8");

    // assert
    expect(manifest.slug).toBe("com.example.demo");
    expect(manifest.name).toBe("Demo Source");
    expect(index).toContain('scanlator: "Demo Source"');
    expect(index).not.toContain("__NAME__");
    expect(existsSync(join(repo.packages, "demo", "icon.svg"))).toBe(true);
    expect(captured.out[0]).toMatch(/created packages\/demo/);
  });

  it("refuses a slug with uppercase or underscores", async () => {
    // arrange
    const repo = await tempRepo();

    // act
    const attempt = create(repo, "com.example.Bad_Slug", "Bad");

    // assert
    await expect(attempt).rejects.toThrow(CliError);
    await expect(attempt).rejects.toThrow(/"com.example.Bad_Slug" is not a slug/);
  });

  it("refuses a bare slug that is not namespaced", async () => {
    // arrange
    const repo = await tempRepo();

    // act
    const attempt = create(repo, "demo", "Demo");

    // assert
    await expect(attempt).rejects.toThrow(/reverse-dns, such as com.example.mysite/);
  });

  it("refuses to overwrite an existing package", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    await create(repo, "com.example.demo", "Demo");

    // act
    const attempt = create(repo, "com.example.demo", "Demo");

    // assert
    await expect(attempt).rejects.toThrow(/packages\/demo already exists/);
  });
});
