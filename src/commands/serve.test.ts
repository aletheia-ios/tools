import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capture, cleanupRepos, scaffold, tempRepo } from "@test/repo";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type Serving, serve } from "./serve";

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(cleanupRepos);

const SAMPLE = { name: "Test", target: "sample", sources: ["com.example.demo"] };

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
    const icon = await fetch(local(serving, "/icons/com.example.demo.png"));
    const archive = await fetch(local(serving, "/packages/com.example.demo-v0.1.0.althsource"));
    const other = await fetch(local(serving, "/notes.txt"));
    const body = (await index.json()) as { sources: Array<{ slug: string }> };
    await serving.close();

    // assert
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("application/json");
    expect(index.headers.get("cache-control")).toBe("no-store");
    expect(body.sources[0]?.slug).toBe("com.example.demo");
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

  it("serves the generated page and resolves a directory to its index.html", async () => {
    // arrange
    const repo = await tempRepo({
      lists: { sample: { ...SAMPLE, url: "https://example.com/sample/index.json" } },
    });
    capture();
    await scaffold(repo, "demo");
    const serving = await serve(repo, 0);

    // act
    const page = await fetch(local(serving, "/sample/site/"));
    const html = await page.text();
    await serving.close();

    // assert
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(html).toContain("aletheia://add-list?url=");
  });

  it("names the port in one line when something already holds it", async () => {
    // arrange
    const repo = await tempRepo({ lists: { sample: SAMPLE } });
    capture();
    await scaffold(repo, "demo");
    const held = await serve(repo, 0);
    const port = Number(new URL(held.url).port);

    // act
    const attempt = serve(repo, port);

    // assert
    await expect(attempt).rejects.toThrow(`port ${port} is already in use`);
    await expect(attempt).rejects.toThrow(/--port <n>/);
    await held.close();
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

  // how many rebuilds a burst coalesces into is wall-clock dependent, so this asserts only
  // that a change is picked up and the index is written again
  it("rebuilds when a package changes", async () => {
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
    await vi.waitFor(() => expect(builds()).toBeGreaterThan(1), { timeout: 15_000, interval: 50 });
    await serving.close();

    // assert
    expect(captured.out).toContain("change detected, rebuilding");
  });
});
