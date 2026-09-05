import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type List, loadLists } from "@/commands/indexes";
import { iconPath, type Package, type Repo } from "@/context";
import { escapeHTML, qrSVG } from "@/lib/html";
import { CliError, info } from "@/lib/log";

/** Where a target's generated page and its assets are written. */
export function sitePath(repo: Repo, target: string): string {
  return join(repo.dist, target, "site");
}

const STYLE = `
:root {
  --bg: #fbfbfd; --fg: #16161a; --muted: #6b6b76; --line: #e4e4ea;
  --card: #ffffff; --accent: #4c5cff; --accent-fg: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f0f12; --fg: #f2f2f5; --muted: #9a9aa5; --line: #26262e;
    --card: #17171c; --accent: #7c88ff; --accent-fg: #0f0f12;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 3rem 1.25rem 5rem; background: var(--bg); color: var(--fg);
  font: 16px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
}
main { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.9rem; margin: 0 0 .35rem; letter-spacing: -.02em; }
.lede { color: var(--muted); margin: 0 0 2rem; }
.add { display: flex; align-items: flex-start; gap: 1.75rem; flex-wrap: wrap; margin-bottom: 2.75rem; }
.add-main { flex: 1 1 20rem; min-width: 0; }
.actions { display: flex; flex-wrap: wrap; gap: .75rem; margin-bottom: 1rem; }
.button {
  display: inline-block; padding: .7rem 1.15rem; border-radius: .6rem; border: 1px solid var(--line);
  background: var(--card); color: var(--fg); font: inherit; font-weight: 600; cursor: pointer;
  text-decoration: none; line-height: 1.2;
}
.button.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
.url {
  font: .8rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
  word-break: break-all; margin: 0;
}
.qr { width: 7.25rem; height: 7.25rem; padding: .45rem; background: #fff; border-radius: .6rem; flex: none; }
.qr svg { display: block; width: 100%; height: 100%; }
.qr rect:first-of-type { fill: #fff; }
h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 .85rem; }
.source {
  display: flex; align-items: flex-start; gap: 1rem; padding: 1rem; margin-bottom: .75rem;
  background: var(--card); border: 1px solid var(--line); border-radius: .75rem;
}
.source img { width: 3rem; height: 3rem; border-radius: .55rem; flex: none; }
.source div { min-width: 0; }
.source h3 { margin: 0 0 .3rem; font-size: 1rem; line-height: 1.3; }
.source p { margin: 0 0 .7rem; color: var(--muted); font-size: .9rem; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; font-size: .75rem; color: var(--muted); }
.tag {
  display: inline-block; padding: .2rem .55rem; border: 1px solid var(--line);
  border-radius: 100px; line-height: 1.4;
}
a.tag { color: inherit; text-decoration: none; }
a.tag:hover { color: var(--fg); border-color: var(--accent); }
.reach { margin: .75rem 0 .4rem; font-size: .7rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
footer { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .85rem; }
footer p { margin: 0 0 .7rem; max-width: 38rem; }
footer p:last-child { margin-bottom: 0; }
#gate { text-align: center; padding: 4rem 0; }
#gate + * { display: none; }
`;

const SCRIPT = `
document.querySelectorAll("[data-copy]").forEach(function (button) {
  button.addEventListener("click", function () {
    navigator.clipboard.writeText(button.dataset.copy).then(function () {
      var previous = button.textContent;
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = previous; }, 1500);
    });
  });
});
var gate = document.getElementById("gate");
if (gate) {
  gate.querySelector("button").addEventListener("click", function () {
    gate.remove();
    document.getElementById("list").style.display = "block";
  });
}
`;

/** The age gate shown ahead of an adult list; without script the list stays hidden. */
function gate(): string {
  return `<section id="gate">
      <h2>Adults only</h2>
      <p class="lede">This list contains explicit material. Confirm you are 18 or older.</p>
      <button class="button primary" type="button">I am 18 or older</button>
    </section>`;
}

/**
 * How a declared host reads to someone deciding whether to trust it.
 *
 * A host matches its own subdomains, so `co.uk` really means everything under it. Showing the
 * literal string would understate that; showing the effective shape does not. A placeholder
 * resolves to an address the reader typed, so it is named as such rather than shown raw.
 */
function reach(entry: string): string {
  if (entry.startsWith("${")) return "your own server";
  return `*.${entry}`;
}

/** One source's row: icon, name, description, and every host it is allowed to contact. */
function card(pkg: Package, icon: string): string {
  const { manifest } = pkg;
  const languages = manifest.languages.map((code) => code.toUpperCase()).join(", ");
  const rating = manifest.contentRating === "adult" ? "18+" : "Mixed ratings";
  const hosts =
    manifest.hosts.length === 0
      ? '<span class="tag">contacts nothing</span>'
      : manifest.hosts
          .map((entry) => `<span class="tag">${escapeHTML(reach(entry))}</span>`)
          .join("\n            ");
  return `<article class="source">
        <img src="data:image/png;base64,${icon}" alt="" width="48" height="48">
        <div>
          <h3>${escapeHTML(manifest.name)}</h3>
          <p>${escapeHTML(manifest.description)}</p>
          <div class="meta">
            <span class="tag">v${escapeHTML(manifest.version)}</span>
            <span class="tag">${escapeHTML(languages)}</span>
            <span class="tag">${rating}</span>
          </div>
          <p class="reach">Contacts</p>
          <div class="meta">
            ${hosts}
          </div>
        </div>
      </article>`;
}

/** The add buttons: a deep link for a phone, the URL and a QR for a desktop browser. */
function actions(url: string): string {
  const link = `aletheia://add-list?url=${encodeURIComponent(url)}`;
  return `<div class="add">
      <div class="add-main">
        <div class="actions">
          <a class="button primary" href="${escapeHTML(link)}">Open in Aletheia</a>
          <button class="button" type="button" data-copy="${escapeHTML(url)}">Copy URL</button>
        </div>
        <p class="url">${escapeHTML(url)}</p>
      </div>
      <div class="qr">${qrSVG(url)}</div>
    </div>`;
}

/** The notice every published list carries. */
function notice(): string {
  return `<footer>
      <p>This list is not an official part of Aletheia, and it is not connected to, endorsed by,
      or approved by any of the sites named above. Their names and logos belong to them.</p>
      <p>No comics, images or accounts are stored or shared here. An entry only tells the app
      where to go looking, and every site each one may contact is listed above.</p>
      <p>If you would like something taken off this list, get in touch and it will be removed.</p>
    </footer>`;
}

/** The whole page for one list, with each source's icon already base64 encoded. */
function page(list: List, url: string, members: [Package, string][]): string {
  const heading = escapeHTML(list.name);
  const count = members.length === 1 ? "1 source" : `${members.length} sources`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>${STYLE}</style>
</head>
<body>
  <main>
    <h1>${heading}</h1>
    <p class="lede">Opens in Aletheia with this address filled in. You confirm before anything
    is added, and the app keeps the list up to date afterwards.</p>
    ${list.adult === true ? gate() : ""}
    <div id="list"${list.adult === true ? ' style="display:none"' : ""}>
      ${actions(url)}
      <h2>${count}</h2>
      ${members.map(([pkg, icon]) => card(pkg, icon)).join("\n      ")}
    </div>
    ${notice()}
  </main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Reads each source's packed icon as base64, to be inlined in the page.
 *
 * @throws `CliError` when a package has not been packed, since the icon is a pack output.
 */
async function icons(repo: Repo, members: Package[]): Promise<[Package, string][]> {
  const pairs: [Package, string][] = [];
  for (const pkg of members) {
    const path = iconPath(repo, pkg.slug);
    if (!existsSync(path)) throw new CliError([`${pkg.folder}: not packed - run pack first`]);
    pairs.push([pkg, (await readFile(path)).toString("base64")]);
  }
  return pairs;
}

/**
 * The `site` command: writes `dist/<target>/site/index.html` for every list that declares a
 * `url`.
 *
 * One file, no assets. Icons are inlined as data URIs and the QR is inlined as SVG, so the page
 * can be served from a single object key with nothing beside it, and cannot half-load. It is
 * generated from the same `lists/` and `source.json` data as the index it advertises, so the
 * two cannot disagree.
 *
 * A list with no `url` is skipped with a note, since the deep link and QR have nothing to
 * point at until that target's zone exists.
 *
 * @throws `CliError` when a list names a package that does not exist or is not packed.
 */
export async function site(repo: Repo, packages: Package[]): Promise<void> {
  const bySlug = new Map(packages.map((pkg) => [pkg.slug, pkg]));
  for (const list of await loadLists(repo)) {
    const missing = list.sources.filter((slug) => !bySlug.has(slug));
    if (missing.length > 0) {
      throw new CliError(missing.map((slug) => `list "${list.name}": no package "${slug}"`));
    }
    if (list.url === undefined) {
      info(`${list.target}: no url in the list, skipping the page`);
      continue;
    }
    const members = list.sources.map((slug) => bySlug.get(slug) as Package);
    const withIcons = await icons(repo, members);
    const out = sitePath(repo, list.target);
    await mkdir(out, { recursive: true });
    await writeFile(join(out, "index.html"), page(list, list.url, withIcons));
    info(`${list.target}/site/index.html: ${members.length} source(s)`);
  }
}
