import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import type { Request, Response, Revalidating, Source } from "@aletheia-ios/sdk/types";
import { buildOne } from "@/commands/build";
import { OWN_ROOT, type Package, type Repo } from "@/context";
import { CliError, info } from "@/lib/log";

/** The exported source as `live` calls it: the contract plus revalidation when present. */
type LiveSource = Source & Partial<Revalidating>;

/** How many search results are listed before the walk moves on. */
const PREVIEW = 5;

/**
 * Evaluates the bundle in a node vm with a real network behind `__host.fetch`.
 *
 * The manifest's `hosts` allowlist is enforced the way the app enforces it, so a source
 * that reaches somewhere it did not declare fails here too. The html bridge is the same
 * bundle `check` runs, so a selector cannot behave differently between the two.
 */
function evaluate(bundle: string, hosts: string[]): LiveSource {
  const context = vm.createContext({ console });
  // the same bundle `check` runs under JavaScriptCore, so a selector behaves identically here
  vm.runInContext(readFileSync(join(OWN_ROOT, "dist", "html-bridge.js"), "utf8"), context);
  Object.assign(context, {
    __host: {
      async fetch(request: Request): Promise<Response> {
        const { host } = new URL(request.url);
        // subdomains of a declared host are allowed, matching what the app enforces
        const allowed = hosts.some((name) => host === name || host.endsWith(`.${name}`));
        if (!allowed) throw new Error(`host not allowed by source.json: ${host}`);
        const response = await fetch(request.url, {
          method: request.method ?? "GET",
          headers: { "user-agent": "aletheia-tools live", ...(request.headers ?? {}) },
          ...(request.body === undefined ? {} : { body: request.body }),
        });
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          url: response.url,
          text: await response.text(),
        };
      },
      html: context.__html,
    },
  });
  vm.runInContext(bundle, context);
  return context.__source as LiveSource;
}

/**
 * The `live` command: builds one package and walks it against the live site in node.
 *
 * Searches for `text`, opens `series` (or the first result when it is `-`), lists its
 * chapters, revalidates when the source can, and fetches the first chapter's pages,
 * printing a summary of each step. This is how a port is compared with what the app shows
 * today; it is never part of `check`.
 *
 * @throws `CliError` when the search returns nothing to open.
 */
export async function live(repo: Repo, pkg: Package, series: string, text: string): Promise<void> {
  const { path } = await buildOne(repo, pkg);
  const source = evaluate(await readFile(path, "utf8"), pkg.manifest.hosts);
  const ctx = { settings: {} };
  const started = Date.now();

  const search = await source.search(
    { text, filters: [], sort: null, cursor: null, route: null },
    ctx,
  );
  info(`search "${text}": ${search.items.length} results, next=${search.next}`);
  for (const item of search.items.slice(0, PREVIEW)) info(`  ${item.slug}  ${item.title}`);

  const slug = series === "-" ? search.items[0]?.slug : series;
  if (slug === undefined) throw new CliError(["nothing to open - no results"]);

  const details = await source.details(slug, ctx);
  info(`details: ${details.title} [${details.classification}, ${details.publication}]`);
  info(
    `  ${details.covers.length} covers, ${details.tags.length} tags, authors ${details.authors.join(", ")}`,
  );

  const chapters = await source.chapters(slug, ctx);
  info(`chapters: ${chapters.length}`);
  const [first] = chapters;
  if (first !== undefined) {
    info(`  first: #${first.number} "${first.title}" ${first.language} by ${first.scanlator}`);
    if (source.chaptersChanged) {
      const revalidation = await source.chaptersChanged(slug, chapters.length, ctx);
      info(`revalidate with stored=${chapters.length}: ${revalidation.kind}`);
    }
    const pages = await source.content(slug, first.slug, ctx);
    info(`content: ${pages.length} pages, first ${pages[0]?.url ?? "-"}`);
  }
  info(`done in ${Date.now() - started} ms`);
}
