import type { HTMLElement, Node } from "node-html-parser";
import { NodeType, parse } from "node-html-parser";
import { toMarkdown } from "./markdown";

/**
 * One child of an element as the bridge reports it, matching the sdk's `ChildNode`.
 *
 * Declared here rather than imported because this module is bundled for JavaScriptCore and
 * must not pull the sdk in behind it.
 */
type ChildNode = { kind: "text"; text: string } | { kind: "element"; handle: number };

/**
 * Every node handed out this run, indexed by the handle a source holds.
 *
 * The parsed document never crosses into the source's JavaScript; it asks with a handle and
 * gets a string or more handles back. The table only grows, which is correct for a process
 * that packs one repository and exits.
 */
const nodes: Node[] = [];

/** Files a node in the table and returns its handle. */
function keep(node: Node): number {
  nodes.push(node);
  return nodes.length - 1;
}

/** The element a handle names, or null when it names a text node or nothing. */
function element(handle: number): HTMLElement | null {
  const node = nodes[handle];
  if (node === undefined || node.nodeType !== NodeType.ELEMENT_NODE) return null;
  return node as HTMLElement;
}

/** Runs of whitespace, which `text` collapses and `wholeText` does not. */
const SPACES = /\s+/g;

/**
 * The `__host.html` implementation, in pure JavaScript so the same code can run inside
 * JavaScriptCore for `check` and inside a Node vm for `live`.
 *
 * The app's own bridge is SwiftSoup. The two will not agree on every exotic selector, but
 * both follow the CSS dialect these sources use, and running one implementation in both
 * commands means `check` and `live` can never disagree with each other.
 */
const html = {
  parse: (text: string): number => keep(parse(text)),

  select: (handle: number, selector: string): number[] => {
    const node = element(handle);
    if (node === null) return [];
    return node.querySelectorAll(selector).map(keep);
  },

  attr: (handle: number, name: string): string => element(handle)?.getAttribute(name) ?? "",

  text: (handle: number): string => (element(handle)?.text ?? "").replace(SPACES, " ").trim(),

  ownText: (handle: number): string => {
    const node = element(handle);
    if (node === null) return "";
    return node.childNodes
      .filter((child) => child.nodeType === NodeType.TEXT_NODE)
      .map((child) => child.text)
      .join("")
      .replace(SPACES, " ")
      .trim();
  },

  wholeText: (handle: number): string => element(handle)?.text ?? "",

  data: (handle: number): string => element(handle)?.text ?? "",

  className: (handle: number): string => element(handle)?.getAttribute("class") ?? "",

  tagName: (handle: number): string => (element(handle)?.rawTagName ?? "").toLowerCase(),

  childNodes: (handle: number): ChildNode[] => {
    const node = element(handle);
    if (node === null) return [];
    const children: ChildNode[] = [];
    for (const child of node.childNodes) {
      if (child.nodeType === NodeType.TEXT_NODE) children.push({ kind: "text", text: child.text });
      else if (child.nodeType === NodeType.ELEMENT_NODE) {
        children.push({ kind: "element", handle: keep(child) });
      }
    }
    return children;
  },

  parent: (handle: number): number | null => {
    const node = element(handle);
    const owner = node?.parentNode;
    return owner === null || owner === undefined ? null : keep(owner);
  },

  markdown: (fragment: string): string => toMarkdown(fragment, parse),
};

// the harness reads this off the global; it is not an es module once bundled
(globalThis as { __html?: typeof html }).__html = html;
