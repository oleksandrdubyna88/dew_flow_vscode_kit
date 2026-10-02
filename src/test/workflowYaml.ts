/**
 * A reader for the YAML SUBSET this repository's workflows are written in — enough to ask a workflow
 * structural questions (which job has `id-token`, what `publish` needs, which triggers exist) without a
 * dependency. Block mappings, block sequences (a mapping may start on the `- ` line), single-line plain
 * and quoted scalars, flow sequences of scalars, literal block scalars (`|`, `|-`), full-line and trailing
 * comments.
 *
 * It REFUSES everything else, naming the line — anchors and aliases, tags, flow mappings, folded scalars,
 * multi-line plain scalars, tabs, a second document, duplicate keys, an indentation it cannot place — so a
 * workflow written outside the subset fails the suite instead of being half-read. Scalars stay strings
 * (`true` is `'true'`); an empty value (`workflow_dispatch:`) is `null`.
 */

export type Yaml = string | null | readonly Yaml[] | { readonly [key: string]: Yaml };

interface Line {
  readonly no: number;
  readonly indent: number;
  readonly text: string;
}

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.\-/]*|'[^']*'|"[^"]*")[ \t]*:(?:[ \t]+(.*))?$/;

class Reader {
  private index = 0;

  constructor(private readonly lines: Line[], private readonly raw: readonly string[]) {}

  fail(line: Line | undefined, why: string): never {
    throw new Error(`workflow YAML, line ${line?.no ?? this.raw.length}: ${why}`);
  }

  /** The next line that carries content, skipping blank and comment-only lines. */
  peek(): Line | undefined {
    while (this.index < this.lines.length) {
      const line = this.lines[this.index] as Line;
      if (line.text !== '' && !line.text.startsWith('#')) {
        return line;
      }
      this.index += 1;
    }

    return undefined;
  }

  /** Replace the current line — how a mapping that starts on a `- ` line is read as a mapping. */
  rewrite(line: Line): void {
    this.lines[this.index] = line;
  }

  advance(): void {
    this.index += 1;
  }

  /** The node whose first line is indented at least `min`, or `null` when the next line is shallower. */
  node(min: number): Yaml {
    const line = this.peek();
    if (line === undefined || line.indent < min) {
      return null;
    }

    return isItem(line.text) ? this.sequence(line.indent) : this.mapping(line.indent);
  }

  sequence(indent: number): Yaml[] {
    const items: Yaml[] = [];
    for (let line = this.peek(); line !== undefined && line.indent === indent && isItem(line.text); line = this.peek()) {
      const rest = line.text.slice(1).replace(/^ +/, '');
      if (rest === '' || rest.startsWith('#')) {
        this.advance();
        items.push(this.node(indent + 1));
      } else if (KEY.test(stripComment(rest))) {
        this.rewrite({ no: line.no, indent: indent + (line.text.length - rest.length), text: rest });
        items.push(this.mapping(indent + (line.text.length - rest.length)));
      } else {
        this.advance();
        items.push(scalar(stripComment(rest), line, this));
      }
    }
    this.refuseDeeper(indent);

    return items;
  }

  mapping(indent: number): { [key: string]: Yaml } {
    const map: { [key: string]: Yaml } = {};
    for (let line = this.peek(); line !== undefined && line.indent === indent && !isItem(line.text); line = this.peek()) {
      const match = KEY.exec(stripComment(line.text)) ?? this.fail(line, `not a "key: value" line: ${line.text}`);
      const key = unquote(match[1] as string);
      if (Object.hasOwn(map, key)) {
        this.fail(line, `duplicate key "${key}"`);
      }
      this.advance();
      map[key] = this.value(match[2] ?? '', line, indent);
    }
    this.refuseDeeper(indent);

    return map;
  }

  /** A mapping value: a block scalar, an inline scalar, or a nested node (a sequence may sit at `indent`). */
  value(text: string, line: Line, indent: number): Yaml {
    if (text === '|' || text === '|-') {
      return this.literal(indent, text === '|');
    }
    if (text !== '') {
      return scalar(text, line, this);
    }
    const next = this.peek();
    if (next !== undefined && next.indent === indent && isItem(next.text)) {
      return this.sequence(indent);
    }

    return this.node(indent + 1);
  }

  /** The lines of a literal block scalar, indented deeper than its key; blank lines kept. */
  literal(indent: number, keepFinalNewline: boolean): string {
    const body: string[] = [];
    let blockIndent = -1;
    while (this.index < this.lines.length) {
      const line = this.lines[this.index] as Line;
      const rawLine = this.raw[line.no - 1] as string;
      if (rawLine.trim() !== '' && line.indent <= indent) {
        break;
      }
      blockIndent = blockIndent < 0 && rawLine.trim() !== '' ? line.indent : blockIndent;
      body.push(rawLine.slice(Math.max(blockIndent, 0)));
      this.advance();
    }
    const text = body.join('\n').replace(/\n+$/, '');

    return keepFinalNewline ? `${text}\n` : text;
  }

  /** A line deeper than the node just read belongs to nothing — refuse it rather than drop it. */
  refuseDeeper(indent: number): void {
    const line = this.peek();
    if (line !== undefined && line.indent > indent) {
      this.fail(line, `unexpected indentation: ${line.text}`);
    }
  }
}

const isItem = (text: string): boolean => text === '-' || text.startsWith('- ');

const unquote = (text: string): string =>
  (text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"')) ? text.slice(1, -1) : text;

/** The text without a trailing ` # comment`, leaving a `#` inside quotes alone. */
function stripComment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quote !== '') {
      quote = ch === quote ? '' : quote;
    } else if (ch === "'" || ch === '"') {
      quote = i === 0 || text[i - 1] === ' ' || text[i - 1] === '[' || text[i - 1] === ',' ? ch : '';
    } else if (ch === '#' && (i === 0 || text[i - 1] === ' ')) {
      return text.slice(0, i).trimEnd();
    }
  }

  return text.trimEnd();
}

function scalar(text: string, line: Line, reader: Reader): Yaml {
  const value = stripComment(text);
  if (/^[&*!{>|]/.test(value)) {
    reader.fail(line, `outside the subset this reader accepts (anchor, alias, tag, flow mapping or block scalar): ${value}`);
  }
  if (value.startsWith('[')) {
    if (!value.endsWith(']')) {
      reader.fail(line, `a flow sequence must close on its own line: ${value}`);
    }
    const inner = value.slice(1, -1).trim();

    return inner === '' ? [] : inner.split(',').map((item) => unquote(item.trim()));
  }

  return unquote(value);
}

/** Parse one workflow file's text. Throws, naming the line, on anything outside the subset. */
export function parseWorkflow(source: string): Yaml {
  const raw = source.split('\n').map((line) => line.replace(/\r$/, ''));
  const lines = raw.map((text, i): Line => {
    if (/^ *\t/.test(text)) {
      throw new Error(`workflow YAML, line ${i + 1}: a tab in the indentation`);
    }
    if (/^(---|\.\.\.)\s*$/.test(text)) {
      throw new Error(`workflow YAML, line ${i + 1}: more than one document`);
    }
    const trimmed = text.replace(/^ +/, '');

    return { no: i + 1, indent: text.length - trimmed.length, text: trimmed.trimEnd() };
  });
  const reader = new Reader(lines, raw);
  const root = reader.node(0);
  const rest = reader.peek();
  if (rest !== undefined) {
    reader.fail(rest, `not read — indentation the reader cannot place: ${rest.text}`);
  }

  return root;
}

/** The mapping at `value`, or a TypeError naming `what` — so a test's path through a workflow reads plainly. */
export function mapAt(value: Yaml | undefined, what: string): { readonly [key: string]: Yaml } {
  if (value === null || value === undefined || typeof value === 'string' || Array.isArray(value)) {
    throw new TypeError(`${what} is not a mapping: ${JSON.stringify(value)}`);
  }

  return value as { readonly [key: string]: Yaml };
}

/** The sequence at `value`, or a TypeError naming `what`. */
export function listAt(value: Yaml | undefined, what: string): readonly Yaml[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${what} is not a sequence: ${JSON.stringify(value)}`);
  }

  return value;
}
