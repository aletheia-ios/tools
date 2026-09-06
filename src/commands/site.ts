import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
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
  --card: #ffffff; --accent: #4c5cff; --accent-fg: #ffffff; --warn: #b3341f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f0f12; --fg: #f2f2f5; --muted: #9a9aa5; --line: #26262e;
    --card: #17171c; --accent: #7c88ff; --accent-fg: #0f0f12; --warn: #ff8a73;
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
  padding: 1rem; margin-bottom: .75rem;
  background: var(--card); border: 1px solid var(--line); border-radius: .75rem;
}
/* wraps so a long name beside four language names drops the badges to their own line on a phone */
.head { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .7rem; margin-bottom: .55rem; }
.source img { width: 2.5rem; height: 2.5rem; border-radius: .55rem; flex: none; }
.source h3 { margin: 0; font-size: 1rem; line-height: 1.3; min-width: 0; flex: 1 1 auto; }
.badges { display: flex; align-items: center; gap: .4rem; flex: none; margin-left: auto; font-size: .75rem; color: var(--muted); }
.tag.adult { color: var(--warn); border-color: var(--warn); }
.langs { font-size: .75rem; color: var(--muted); margin-right: .2rem; }
.source p { margin: 0 0 .7rem; color: var(--muted); font-size: .9rem; }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: .45rem; font-size: .75rem; color: var(--muted); }
.tag {
  display: inline-block; padding: .2rem .55rem; border: 1px solid var(--line);
  border-radius: 100px; line-height: 1.4;
}
/* the default link colours are a blue that fights the page and a visited purple that reads as
   a different kind of link; the underline carries the affordance instead */
a { color: var(--fg); text-decoration: underline; text-decoration-thickness: 1px;
  text-underline-offset: .18em; text-decoration-color: var(--line); }
a:hover { color: var(--accent); text-decoration-color: var(--accent); }
a.tag { color: inherit; text-decoration: none; }
a.tag:hover { color: var(--fg); border-color: var(--accent); }
/* outranks .source p, which would otherwise win on specificity and render this as body text */
.source .reach { margin: .8rem 0 .35rem; font-size: .68rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); opacity: .75; }
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

/** What each code the app renders is called. */
const LANGUAGES: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};

/**
 * The languages a source carries, named in full.
 *
 * Deliberately neither flags nor codes. Windows and Android ship no flag glyphs, so a flag
 * renders there as the bare letter pair it is built from, and a language is not a country in the
 * first place; a code needs a label to say what it even is, where a name does not.
 */
function languages(codes: readonly string[]): string {
  if (codes.length === 0) return "";
  const names = codes.map((code) => LANGUAGES[code] ?? code.toUpperCase()).join(", ");
  return `<span class="langs">${escapeHTML(names)}</span>`;
}

/** One source's row: icon, name, description, and every host it is allowed to contact. */
function card(pkg: Package, icon: string): string {
  const { manifest } = pkg;
  // only an adult source is marked; a mixed one is the norm and saying so on every other card
  // spends a badge on nothing
  const rating = manifest.contentRating === "adult" ? '<span class="tag adult">18+</span>' : "";
  const hosts =
    manifest.hosts.length === 0
      ? '<span class="tag">contacts nothing</span>'
      : manifest.hosts
          .map((entry) => `<span class="tag">${escapeHTML(reach(entry))}</span>`)
          .join("\n            ");
  return `<article class="source">
        <div class="head">
          <img src="data:image/png;base64,${icon}" alt="" width="40" height="40">
          <h3>${escapeHTML(manifest.name)}</h3>
          <div class="badges">
            ${languages(manifest.languages)}
            ${rating}
            <span class="tag">v${escapeHTML(manifest.version)}</span>
          </div>
        </div>
        <p>${escapeHTML(manifest.description)}</p>
        <p class="reach">Contacts</p>
        <div class="meta">
          ${hosts}
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

/** The suffix a remote carries and a browser does not want. */
const GIT_SUFFIX = /\.git$/;

/** An scp-style remote, `git@host:owner/repo`, which is not a URL and cannot be parsed as one. */
const SSH_REMOTE = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/;

/** The scheme, dropped for display since the page shows the address rather than the link. */
const SCHEME = /^https:\/\//;

/**
 * The repository this list is generated from, as a browsable URL.
 *
 * Read from the checkout rather than configured, so the page cannot advertise a repository the
 * packages did not come from. Null when there is no git remote to read, which is the case in a
 * bare directory and in a tarball, and the page then simply omits the line.
 */
async function repository(repo: Repo): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("git", ["remote", "get-url", "origin"], {
      cwd: repo.root,
    });
    const origin = stdout.trim().replace(GIT_SUFFIX, "");
    if (origin === "") return null;
    const ssh = SSH_REMOTE.exec(origin);
    const url = ssh === null ? origin : `https://${ssh[1]}/${ssh[2]}`;
    return SCHEME.test(url) ? url : null;
  } catch {
    return null;
  }
}

/** The notice every published list carries. */
function notice(source: string | null): string {
  const code =
    source === null
      ? ""
      : `\n      <p>Source code at
      <a href="${escapeHTML(source)}">${escapeHTML(source.replace(SCHEME, ""))}</a>.</p>`;
  // an address beats "get in touch", and the repository already has the one channel this list
  // has; with no remote to name there is nothing specific to point a request at
  const removal =
    source === null
      ? "To have a source removed, get in touch."
      : `To have a source removed, open an issue at
      <a href="${escapeHTML(source)}/issues">${escapeHTML(source.replace(SCHEME, ""))}/issues</a>.`;
  return `<footer>
      <p>This list has no affiliation with the sites it points to. Their names and logos belong
      to them.</p>
      <p>Nothing is hosted here. A source only tells the app where to look.</p>${code}
      <p>${removal}</p>
    </footer>`;
}

/** The whole page for one list, with each source's icon already base64 encoded. */
function page(
  list: List,
  url: string,
  members: [Package, string][],
  source: string | null,
): string {
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
    <p class="lede">Adding this list to Aletheia includes the following below as installable
    sources.</p>
    ${list.adult === true ? gate() : ""}
    <div id="list"${list.adult === true ? ' style="display:none"' : ""}>
      ${actions(url)}
      <h2>${count}</h2>
      ${members.map(([pkg, icon]) => card(pkg, icon)).join("\n      ")}
    </div>
    ${notice(source)}
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
  const source = await repository(repo);
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
    await writeFile(join(out, "index.html"), page(list, list.url, withIcons, source));
    info(`${list.target}/site/index.html: ${members.length} source(s)`);
  }
}
