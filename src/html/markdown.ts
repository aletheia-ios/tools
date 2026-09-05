import type { HTMLElement, Node } from "node-html-parser";
import { NodeType } from "node-html-parser";

/** How each inline tag wraps its children. */
const WRAP: Record<string, string> = {
  b: "**",
  strong: "**",
  i: "_",
  em: "_",
  code: "`",
  s: "~~",
  del: "~~",
};

/** Tags whose content is not prose and never survives the conversion. */
const DROP = new Set(["script", "style", "head", "noscript", "img"]);

/** Heading level by tag, so `h3` becomes three hashes. */
const HEADING = /^h([1-6])$/;

/** Runs of whitespace, which collapse everywhere this converter goes. */
const SPACES = /\s+/g;

/** Three or more newlines, which no renderer needs. */
const GAPS = /\n{3,}/g;

/** Characters that would otherwise be read as markup. */
const SPECIAL = /([\\`*_[\]])/g;

/** Escapes text so a stray asterisk in a synopsis stays an asterisk. */
function escapeText(text: string): string {
  return text.replace(SPECIAL, "\\$1");
}

/** The text of a node and its descendants, with runs of whitespace collapsed. */
function flatten(node: Node): string {
  return node.text.replace(SPACES, " ").trim();
}

/** Whether a node is an element with this tag. */
function isTag(node: Node, tag: string): boolean {
  return node.nodeType === NodeType.ELEMENT_NODE && (node as HTMLElement).rawTagName === tag;
}

/** A list, numbered or bulleted, one item per line. */
function list(node: HTMLElement, ordered: boolean, depth: number): string {
  const lines = node.childNodes
    .filter((child) => isTag(child, "li"))
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      return `${"  ".repeat(depth)}${marker}${convert(item as HTMLElement, depth + 1).trim()}`;
    });
  return `\n${lines.join("\n")}\n`;
}

/** A link, or just its text when it has no destination. */
function link(node: HTMLElement): string {
  const href = node.getAttribute("href");
  const label = escapeText(flatten(node));
  return href === undefined || label === "" ? label : `[${label}](${href})`;
}

/** How each block tag renders. Anything absent falls through to its children. */
const BLOCKS: Record<string, (node: HTMLElement, depth: number) => string> = {
  br: () => "\n",
  hr: () => "\n\n---\n\n",
  a: (node) => link(node),
  pre: (node) => `\n\n\`\`\`\n${node.text.trim()}\n\`\`\`\n\n`,
  blockquote: (node, depth) => `\n\n> ${convert(node, depth).trim()}\n\n`,
  ul: (node, depth) => list(node, false, depth),
  ol: (node, depth) => list(node, true, depth),
  p: (node, depth) => `\n\n${convert(node, depth).trim()}\n\n`,
  div: (node, depth) => `\n\n${convert(node, depth).trim()}\n\n`,
};

/** One element, as the markdown its tag implies. */
function element(node: HTMLElement, depth: number): string {
  const tag = node.rawTagName.toLowerCase();
  if (DROP.has(tag)) return "";

  const block = BLOCKS[tag];
  if (block !== undefined) return block(node, depth);

  const heading = HEADING.exec(tag);
  if (heading !== null)
    return `\n\n${"#".repeat(Number(heading[1]))} ${escapeText(flatten(node))}\n\n`;

  const wrap = WRAP[tag];
  if (wrap === undefined) return convert(node, depth);
  const inner = convert(node, depth).trim();
  return inner === "" ? "" : `${wrap}${inner}${wrap}`;
}

/** Every child of a node, converted and concatenated. */
function convert(node: HTMLElement, depth: number): string {
  let out = "";
  for (const child of node.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) out += escapeText(child.text.replace(SPACES, " "));
    else if (child.nodeType === NodeType.ELEMENT_NODE) out += element(child as HTMLElement, depth);
  }
  return out;
}

/**
 * Converts an HTML fragment to the markdown subset the app renders.
 *
 * Deliberately small. This exists for synopses and chapter notes, which is where a source
 * meets author-written HTML, so it covers emphasis, links, headings, lists, quotes and code
 * and reduces everything else to its text. Anything it does not know becomes plain text
 * rather than markup, because a stray asterisk in a description is worse than a lost italic.
 */
export function toMarkdown(html: string, parse: (text: string) => HTMLElement): string {
  return convert(parse(html), 0).replace(GAPS, "\n\n").trim();
}
