# @aletheia-ios/tools

The `aletheia` command. Turns a repository of source packages into `.althsource` files and the
`index.json` a source list publishes. Runs on a Mac or in CI, never on a phone - the on-device
half is [`@aletheia-ios/sdk`](https://github.com/aletheia-ios/sdk).

```sh
pnpm add -D @aletheia-ios/tools
```

```
usage: aletheia <command> [options]

  build [--only <slug>]     bundle each package's src/index.ts to dist/build/<slug>/main.js
  check [--only <slug>]     typecheck, build, verify exports and run fixtures under JavaScriptCore
  pack  [--only <slug>]     build, rasterise the icon and zip to dist/packages/<slug>-v<version>.althsource
  index                     write dist/<target>/index.json for every list in lists/
  site                      write dist/<target>/site/ - the page a reader adds the list from
  serve [--port <n>]        pack, index, serve dist/ on the lan and rebuild on change
  new <slug> [--name <n>]   scaffold packages/<slug> from the template
  live <slug> <series|-> [query]
                            run a package against the live site in node and print what it returns
```

## A repository

```
my-sources/
  packages/
    mangadex/        source.json  filters.json  icon.svg  src/index.ts  fixtures/smoke.json
    ...
  lists/
    main.json        { "name": "My Sources", "target": "main", "sources": ["mangadex"] }
  dist/              generated
```

A list may also carry `"url"`, where that target's `index.json` will be served once deployed,
and `"adult": true`. Only `site` reads them: the first is what the deep link and QR point at,
the second puts an age gate in front of the page.

`aletheia` finds the nearest `packages/` above the working directory. Every package folder
name is its slug and must match `source.json`.

## What each command guarantees

**build** - one esbuild IIFE per package, ES2022, no Node or DOM assumptions, ending with the
source object on `globalThis.__source`. Fails if the bundle pulled in zod, which means a source
imported `@aletheia-ios/sdk/schemas`.

**check** - `tsc` per package when TypeScript is installed in the repository, then build, then
the bundle is evaluated in the `jsc` shell inside `JavaScriptCore.framework` - the engine the
phone runs, not Node. Verifies the four required exports, reports which optional ones exist,
and if `fixtures/smoke.json` is present runs search, details, chapters and content against
canned responses. A Web API the bundle assumed and the phone lacks fails here, not on a device.

Both `check` and `live` install a real `__host.html`, so a scraping source is exercised rather
than stubbed. It is one pure-JavaScript bundle compiled into the harness, because `jsc` is a
separate process and cannot call back into Node, and the same bundle is used by `live`, so the
two commands can never disagree about what a selector matches. The app's own bridge is SwiftSoup;
both follow the same CSS dialect, but they are different engines and will not agree on every
exotic selector.

**pack** - rasterises whichever of `icon.svg`, `icon.png`, `icon.jpg` is checked in (prefer
svg > png > jpg) to a 512x512 `icon.png`, then zips the five files with fixed timestamps. The
same content always produces the same bytes; the app treats one package published by two lists
as one package because of this.

**index** - for every `lists/*.json`, reads the packed files and writes
`dist/<target>/index.json` (validated against the sdk's `Index` schema, relative URLs, sha256,
size, the package folder's last commit date) plus `dist/<target>/manifest.json` naming the
package and icon files that target's deploy has to upload.

**site** - for every list that declares a `url`, writes `dist/<target>/site/`: a static page
with an `aletheia://add-list` deep link, the URL, and a QR inlined as SVG at build time, then
a card per source carrying its icon, version, languages and rating. Each source's `icon.png`
and `source.json` are copied in beside the page, so the folder deploys as-is and every card
can link to the manifest that says what that source contacts. Generated from the same data as
the index, so the two cannot disagree. A list marked `"adult": true` gets an age gate that
fails closed without script.

**serve** - runs pack and index, serves `dist/` on the LAN with `cache-control: no-store`, and
reruns both when anything under `packages/` or `lists/` changes. Point the app's developer list
at the printed URL.

**new** - copies the template: an offline source with `hosts: []` that passes `check` as-is,
so the first thing you see from a new package is green.

**live** - builds one package and runs it in Node with a real network behind `__host.fetch`,
honouring the manifest's `hosts` allowlist. For comparing a port against what the app shows
today. Never part of `check`.

## Fixtures

`fixtures/smoke.json` is an array of `{ "match": "<substring of a URL>", "body": <json or html> }`.
A string body is served as-is, which is what a scraping source needs; anything else is serialised
as JSON.
`check` answers each `__host.fetch` with the first fixture whose `match` appears in the URL,
and calls `search("smoke")`, `details("series")`, `chapters("series")`,
`content("series", "chapter")` in that order. Capture real responses from the site and trim
them; the point is that the mapping code runs over real shapes without a network.

MIT.
