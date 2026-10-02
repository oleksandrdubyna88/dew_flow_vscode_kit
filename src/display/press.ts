/**
 * A message a page posted, read as a press on one of the two text controls — or refused, with a reason.
 *
 * <p>This is the webview → host trust boundary (plan §1, gate round 1). A webview can only post to its
 * own panel, so there is no foreign origin to check; what there IS is a page whose script may be stale,
 * forged, or simply wrong, and a host that would otherwise hand `delta` to arithmetic and `type` to a
 * lookup. So, before anything reaches a write: a known `type` only; a `delta` that is a finite NUMBER,
 * reduced to one step; a `field` that is absent or empty. Everything else comes back as a typed
 * rejection — never a throw, whatever was posted.</p>
 *
 * <p><b>One rule, where ConnectOtherAIs had three.</b> At `1056aed9` coai read a press in three parsers
 * that disagreed on a sub-step delta: `textControls.ts` truncated it to no press, `chatMessages.ts`
 * truncated it to a press of nothing (which still wrote the current value back), and
 * `bugzReviewMessages.ts` handed `0.5` to a `Math.sign` that made it a whole step. This module keeps the
 * unified parser's rule — `textControlFrom`, the one coai's pages were converging on: a finite number is
 * truncated, and a whole step in either direction is one press; anything below a whole step is no press
 * and writes nothing. Members are read as OWN properties only, so a key reached through the prototype is
 * never a type and `{"type":"__proto__"}` is just an unknown type.</p>
 *
 * <p>`field` is a member the kit's own pages post as `''` (coai's shape, kept byte for byte); no coai
 * parser ever read it. A consumer's own parser hands over `{ type, delta }` with no field at all, which
 * is accepted; a field carrying anything else is refused — a member nobody reads is still a member a
 * page is asserting something with.</p>
 *
 * <p>Reading a message as own members only is shared with the help page's reader through
 * `webview/posted.ts`, so the rule lives once.</p>
 */
import { isEmptyField, ownMember, postedRecord, type PostedRecord } from '../webview/posted';

/** Which control was pressed. */
export type PressKind = 'zoom' | 'tone';

/** One step, in one direction. The page reports the direction; the size of a step is the host's. */
export type Step = -1 | 1;

/** A validated press — the only shape that reaches a write. */
export interface Press {
  readonly kind: PressKind;
  readonly step: Step;
}

/** Why a message was not a press. Stable strings, for a consumer's log line. */
export type PressRejection =
  /** `null`, a primitive, an array. */
  | 'not-an-object'
  /** No own `type`, or one that is not `zoom` / `tone`. */
  | 'unknown-type'
  /** No own `delta`, or one that is not a finite number (a string, `NaN`, `±Infinity`, an object). */
  | 'delta-not-a-number'
  /** A finite `delta` below one whole step: `0`, `-0`, `0.5`. Nothing to write. */
  | 'no-step'
  /** A `field` that is present and not the empty string the kit's pages post. */
  | 'field';

/** The reading of one message: a press, or the reason it was not one. */
export type PressReading =
  | { readonly accepted: true; readonly press: Press }
  | { readonly accepted: false; readonly reason: PressRejection };

/** Read a posted message. Never throws. */
export function readPress(message: unknown): PressReading {
  const said = postedRecord(message);

  return said === undefined ? refused('not-an-object') : pressOf(said);
}

function pressOf(said: PostedRecord): PressReading {
  const kind = kindOf(ownMember(said, 'type'));
  const step = stepOf(ownMember(said, 'delta'));
  if (kind === undefined) {
    return refused('unknown-type');
  }
  if (typeof step === 'string') {
    return refused(step);
  }
  if (!isEmptyField(ownMember(said, 'field'))) {
    return refused('field');
  }

  return { accepted: true, press: { kind, step } };
}

function refused(reason: PressRejection): PressReading {
  return { accepted: false, reason };
}

function kindOf(type: unknown): PressKind | undefined {
  return type === 'zoom' || type === 'tone' ? type : undefined;
}

/** One step from a finite delta, or the reason there is none. */
function stepOf(delta: unknown): Step | 'delta-not-a-number' | 'no-step' {
  const whole = wholeDelta(delta);
  if (whole === undefined) {
    return 'delta-not-a-number';
  }
  if (whole === 0) {
    return 'no-step';
  }

  return whole > 0 ? 1 : -1;
}

/** The delta truncated to whole steps, or nothing when it is not a finite number. `-0.5` truncates to `-0`, which `=== 0`. */
function wholeDelta(delta: unknown): number | undefined {
  return typeof delta === 'number' && Number.isFinite(delta) ? Math.trunc(delta) : undefined;
}
