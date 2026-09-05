import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWN_ROOT } from "@/context";

/**
 * The shell inside `JavaScriptCore.framework` on macOS.
 *
 * It is the same engine the phone runs, which is the point: node has `fetch`, `atob` and
 * `TextEncoder`, and JavaScriptCore does not. A bundle that assumes one of them fails here
 * instead of on a device.
 */
const JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc";

/** Whether the jsc shell exists on this machine; false anywhere but macOS. */
export function hasJSC(): boolean {
  return existsSync(JSC);
}

/** One canned response from `fixtures/smoke.json`: the first whose `match` is in the URL answers. */
export interface Fixture {
  match: string;
  body: unknown;
}

/**
 * The html bridge, compiled to pure JavaScript at build time.
 *
 * jsc is a separate process, so tools cannot answer a parse call from Node. The parser is
 * bundled into the script instead, which is also why `check` and `live` cannot disagree
 * about what a selector matches: they run the same code.
 */
function htmlBridge(): string {
  return readFileSync(join(OWN_ROOT, "dist", "html-bridge.js"), "utf8");
}

/**
 * The stand-in host the bundle sees: a `__host.fetch` answered from fixtures, the real html
 * bridge, and a `console` that goes to jsc's `print`.
 *
 * A fixture body may be a string, which is served as-is for a source that parses HTML, or
 * anything else, which is serialised as JSON.
 */
const HARNESS = `
  var __calls = [];
  var __host = {
    fetch: function (request) {
      __calls.push(request.url);
      var fixture = __fixtures.find(function (f) { return request.url.indexOf(f.match) !== -1; });
      if (!fixture) return Promise.reject(new Error("no fixture for " + request.url));
      var body = typeof fixture.body === "string" ? fixture.body : JSON.stringify(fixture.body);
      return Promise.resolve({ status: 200, headers: {}, url: request.url, text: body });
    },
    html: __html,
  };
  var console = { log: print, warn: print, error: print };
`;

/** Prints the `typeof` of every contract method on the exported source. */
const EXPORTS = `
  print("RESULT " + JSON.stringify({
    search: typeof __source.search, details: typeof __source.details,
    chapters: typeof __source.chapters, content: typeof __source.content,
    comments: typeof __source.comments, replies: typeof __source.replies,
    chaptersChanged: typeof __source.chaptersChanged, isChallenge: typeof __source.isChallenge,
    pingURL: typeof __source.pingURL,
  }));
`;

/**
 * Calls search, details, chapters and content in turn and prints what came back.
 *
 * `drainMicrotasks` is jsc's way of running the promise chain to completion; there is no
 * event loop in the shell. JavaScriptCore's `Error.stack` omits the message, so it is
 * printed first along with a `SourceError` code when there is one.
 */
const SMOKE = `
  var __ctx = { settings: {} };
  var __out = {};
  __source.search({ text: "smoke", filters: [], sort: null, cursor: null, route: null }, __ctx)
    .then(function (s) { __out.search = s; return __source.details("series", __ctx); })
    .then(function (d) { __out.details = d; return __source.chapters("series", __ctx); })
    .then(function (c) { __out.chapters = c; return __source.content("series", "chapter", __ctx); })
    .then(function (p) { __out.content = p; print("RESULT " + JSON.stringify(__out)); })
    .catch(function (e) {
      if (!(e && e.message)) return print("ERROR " + e);
      print("ERROR " + (e.code ? e.code + ": " : "") + e.message + "\\n" + e.stack);
    });
  drainMicrotasks();
`;

/** The outcome of one jsc run: the parsed `RESULT` line when it succeeded, everything printed either way. */
export interface Run<T> {
  ok: boolean;
  result: T | null;
  output: string;
}

/**
 * Writes harness + fixtures + bundle + script to a temp file and runs it under jsc.
 *
 * The script reports through a single `RESULT ` or `ERROR ` line on stdout; a non-zero exit
 * (an uncaught throw while the bundle loads) counts as a failure too.
 */
function run<T>(bundle: string, fixtures: Fixture[], script: string): Run<T> {
  const file = join(mkdtempSync(join(tmpdir(), "aletheia-jsc-")), "run.js");
  writeFileSync(
    file,
    `${htmlBridge()}\n${HARNESS}\nvar __fixtures = ${JSON.stringify(fixtures)};\n${bundle}\n${script}`,
  );
  const child = spawnSync(JSC, [file], { encoding: "utf8" });
  const output = `${child.stdout}${child.stderr}`;
  const line = child.stdout
    .split("\n")
    .find((candidate) => candidate.startsWith("RESULT ") || candidate.startsWith("ERROR "));
  if (child.status !== 0 || !line || line.startsWith("ERROR ")) {
    return { ok: false, result: null, output };
  }
  return { ok: true, result: JSON.parse(line.slice("RESULT ".length)) as T, output };
}

/** Contract method name to its `typeof` on the exported source, `"undefined"` when absent. */
export type Exports = Record<string, string>;

/** Evaluates the bundle under jsc and reports which contract methods it exports. */
export function exportsOf(bundle: string): Run<Exports> {
  return run<Exports>(bundle, [], EXPORTS);
}

/** What the smoke script collected; only the fields `check` prints are typed. */
export interface SmokeResult {
  search: { items: unknown[]; next: string | null };
  details: { title: string };
  chapters: unknown[];
  content: unknown[];
}

/**
 * Evaluates the bundle under jsc and runs the four required calls against fixtures.
 *
 * The calls use the placeholder slugs `series` and `chapter` and the query text `smoke`;
 * fixtures answer whatever URLs the source builds from them.
 */
export function smoke(bundle: string, fixtures: Fixture[]): Run<SmokeResult> {
  return run<SmokeResult>(bundle, fixtures, SMOKE);
}
