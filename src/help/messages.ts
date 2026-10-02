import { readPress, type Press, type PressRejection } from '../display/press';
import { isEmptyField, ownMember, postedRecord, type PostedRecord } from '../webview/posted';
import type { HelpLanguage } from './types';

/**
 * A message the help page posted, read as one of the two things it may ask for — a press on a text
 * control, or a language — or refused, with a reason.
 *
 * <p>The help page's half of the webview → host trust boundary (plan §1, gate round 1). A press is read
 * by the display rule, unchanged (`display/press.ts`). A language is accepted only when it is a STRING
 * the catalog offers — `catalog.languages`, which a consumer's partial catalog makes shorter than the
 * five the help knows — so what reaches the setting is always a value the page could have shown; a
 * `field` that is present and not empty is refused as it is for a press. Members are own properties
 * only (`webview/posted.ts`). Never a throw, whatever was posted.</p>
 *
 * <p>ConnectOtherAIs' `helpPanel.ts` at `1056aed9` checked the language against `HELP_LANGUAGES` — all
 * five — and silently did nothing for a message of any other type; here an unknown type and a refused
 * language both come back as a typed reason, so a consumer can log what its page sent.</p>
 */

/** What an accepted message asks the host to do. */
export type HelpAction =
  | { readonly kind: 'press'; readonly press: Press }
  | { readonly kind: 'language'; readonly language: HelpLanguage };

/** Why a message was refused: the press reasons, plus a `language` that is not a string the catalog offers. */
export type HelpMessageRejection = PressRejection | 'language-not-offered';

export type HelpMessageReading =
  | { readonly accepted: true; readonly action: HelpAction }
  | { readonly accepted: false; readonly reason: HelpMessageRejection };

/** Read a posted message against the languages the catalog offers. Never throws. */
export function readHelpMessage(message: unknown, offered: readonly HelpLanguage[]): HelpMessageReading {
  const said = postedRecord(message);
  if (said === undefined) {
    return refused('not-an-object');
  }

  return byType(said, ownMember(said, 'type'), message, offered);
}

/** The reader for the posted `type`: a language, a press, or no type the help page has. */
function byType(said: PostedRecord, type: unknown, message: unknown, offered: readonly HelpLanguage[]): HelpMessageReading {
  if (type === 'language') {
    return languageOf(said, offered);
  }

  return isPressType(type) ? pressOf(message) : refused('unknown-type');
}

function isPressType(type: unknown): boolean {
  return type === 'zoom' || type === 'tone';
}

function pressOf(message: unknown): HelpMessageReading {
  const reading = readPress(message);

  return reading.accepted ? { accepted: true, action: { kind: 'press', press: reading.press } } : refused(reading.reason);
}

/** A language message: the posted `language` must be one the catalog offers — `includes` over the list, so `constructor` and `__proto__` are just strings nobody offers. */
function languageOf(said: PostedRecord, offered: readonly HelpLanguage[]): HelpMessageReading {
  const language = offeredLanguage(ownMember(said, 'language'), offered);
  if (language === undefined) {
    return refused('language-not-offered');
  }
  if (!isEmptyField(ownMember(said, 'field'))) {
    return refused('field');
  }

  return { accepted: true, action: { kind: 'language', language } };
}

function offeredLanguage(value: unknown, offered: readonly HelpLanguage[]): HelpLanguage | undefined {
  return offered.find((language) => language === value);
}

function refused(reason: HelpMessageRejection): HelpMessageReading {
  return { accepted: false, reason };
}
