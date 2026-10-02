/**
 * A message a page posted, read as DATA: a plain object's own members, and nothing it inherits.
 *
 * <p>The shared half of the two readers at the webview → host trust boundary — `display/press.ts` for
 * the ± text controls and `help/messages.ts` for the help page — so the rule that a member is an OWN
 * property, never one reached through the prototype, is written once (`common.security`: a measure on
 * the single road in). A `{"type":"__proto__"}` is just an unknown type; a `type` that lives on a
 * prototype is no type at all.</p>
 *
 * <p>Nothing here throws, whatever it is handed, and nothing here decides what a message MEANS — the
 * readers do.</p>
 */

/** A plain object with string keys, as `JSON.parse` or a structured clone produces one. */
export type PostedRecord = Readonly<Record<string, unknown>>;

/** The message as a record, or nothing: `null`, primitives and arrays are not messages. */
export function postedRecord(message: unknown): PostedRecord | undefined {
  return typeof message === 'object' && message !== null && !Array.isArray(message)
    ? (message as PostedRecord)
    : undefined;
}

/** The member as the page posted it — an OWN property, never one inherited from a prototype. */
export function ownMember(record: PostedRecord, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

/**
 * Whether a `field` member is what the kit's pages post: absent, or the empty string. No reader acts on
 * `field`, which is exactly why a value in it is refused — a member nobody reads is still a member a page
 * is asserting something with.
 */
export function isEmptyField(field: unknown): boolean {
  return field === undefined || field === '';
}
