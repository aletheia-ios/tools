import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type Serving, serve } from "./serve";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

const SAMPLE = { name: "Test", target: "sample", sources: ["demo"] };

// the server binds every interface and prints the lan address; loopback reaches the same socket
function local(serving: Serving, path: string): string {
  return `http://127.0.0.1:${new URL(serving.url).port}${path}`;
}

describe("serve", () => {
  it("packs, indexes and serves dist/ with no-store caching", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    const captured = capture();
    await scaffold(repo, "demo");
    const serving = await serve(repo, 0);
    await writeFile(join(repo.dist, "notes.txt"), "hello");

    // act
    const index = await fetch(local(serving, "/sample/index.json"));
    const icon = await fetch(local(serving, "/icons/demo.png"));
    const archive = await fetch(local(serving, "/packages/demo-v0.1.0.althsource"));
    const other = await fetch(local(serving, "/notes.txt"));
    const body = (await index.json()) as { sources: Array<{ slug: string }> };
    await serving.close();

    // assert
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("application/json");
    expect(index.headers.get("cache-control")).toBe("no-store");
    expect(body.sources[0]?.slug).toBe("demo");
    expect(icon.headers.get("content-type")).toBe("image/png");
    expect(archive.headers.get("content-type")).toBe("application/zip");
    expect(other.headers.get("content-type")).toBe("application/octet-stream");
    expect(captured.out).toContainEqual(expect.stringMatching(/^serving .* on http:\/\/.+\/$/));
    expect(captured.out).toContainEqual(
      expect.stringMatching(/Test: http:\/\/.+\/sample\/index\.json$/),
    );
  });

  it("answers 404 for missing files, directories, traversal and malformed urls", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    capture();
    await scaffold(repo, "demo");
    const serving = await serve(repo, 0);

    // act
    const statuses = await Promise.all(
      ["/nope.json", "/sample", "/../../etc/passwd", "/%E0%A4%A", "/..%2F..%2Fetc%2Fpasswd"].map(
        async (path) => (await fetch(local(serving, path))).status,
      ),
    );
    await serving.close();

    // assert
    expect(statuses).toEqual([404, 404, 404, 404, 404]);
  });

  it("keeps serving when the initial build fails and reports why", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    await writeFile(join(pkg.dir, "filters.json"), "[1]");

    // act
    const serving = await serve(repo, 0);
    const { status } = await fetch(local(serving, "/sample/index.json"));
    await serving.close();

    // assert
    expect(status).toBe(404);
    expect(captured.err).toContainEqual(expect.stringMatching(/demo\/filters\.json/));
  });

  it("requires a lists/ directory before it binds a port", async () => {
    // arrange
    const repo = await tempRepo();
    capture();
    await scaffold(repo, "demo");

    // act
    const attempt = serve(repo, 0);

    // assert
    await expect(attempt).rejects.toThrow(/no lists\/ directory/);
  });

  it("rebuilds once after a burst of changes", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    const captured = capture();
    const pkg = await scaffold(repo, "demo");
    const serving = await serve(repo, 0);
    const builds = () => captured.out.filter((line) => line.startsWith("sample/index.json")).length;
    const index = join(pkg.dir, "src", "index.ts");
    const original = await readFile(index, "utf8");

    // act
    await writeFile(index, `${original}\n// touched\n`);
    await writeFile(index, `${original}\n// touched twice\n`);
    await vi.waitFor(() => expect(builds()).toBe(2), { timeout: 5000, interval: 50 });
    await serving.close();

    // assert
    expect(captured.out.filter((line) => line === "change detected, rebuilding")).toHaveLength(1);
  });
});
