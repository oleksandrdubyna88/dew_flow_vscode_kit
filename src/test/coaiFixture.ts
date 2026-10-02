import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TextToneMessage, UiScaleMessage } from '../display/port';
import type { HelpArticle, HelpBody, HelpLanguage, TranslatedLanguage } from '../help/types';

/**
 * What ConnectOtherAIs' own modules computed at `1056aed9`, read once for every byte-compat test.
 *
 * <p>The files are written by `scripts/record-coai-display.mjs` and `scripts/record-coai-help.mjs` and
 * never edited by hand; this module is the one reader of them, so the pure-half tests
 * (`displayByteCompat.test.ts`), the host tests (`displayHost.test.ts`) and the help catalog tests
 * (`helpCatalog.test.ts`) hold the kit against the same recordings.</p>
 */

export interface ZoomRecord { scalePx: number; offsetLabel: string; zoomControlHtml: string; zoomStyle: string }
export interface ToneRecord { toneLabel: string; toneColour: string; toneColourEditor: string; toneStyle: string; toneControlHtml: string }

/** One press coai's hosts applied: the stored value before it, the delta the page sent, what each host wrote. */
export interface WriteRecord {
  current: unknown;
  delta: number;
  uiScale: number;
  textTone: number;
  /** The `ConfigurationTarget` both hosts wrote to, by name. */
  scope: string;
}

export interface HostRecord {
  section: string;
  keys: { uiScale: string; textTone: string };
  /** The message `pushUiScaleTo` posted on attach, per stored offset. */
  uiScale: Record<string, UiScaleMessage>;
  /** The message `pushTextToneTo` posted on attach, per stored offset. */
  textTone: Record<string, TextToneMessage>;
  writes: WriteRecord[];
}

export interface Recorded {
  source: string;
  zoom: Record<string, ZoomRecord>;
  tone: Record<string, ToneRecord>;
  zoomScript: string;
  ZOOM_CSS: string;
  toneScript: string;
  TONE_CSS: string;
  clamp: { scale: number[]; tone: number[] };
  host: HostRecord;
}

/** The recording, parsed. The cast is the one place the JSON meets a type; `recordedIsWhole` checks its shape. */
export const RECORDED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'coai-display-1056aed9.json'), 'utf8'),
) as Recorded;

/** The offsets every recording walks, ascending — the tests iterate the recording, this names what to expect of it. */
export const RECORDED_OFFSETS: readonly number[] = [-7, -5, -3, -1, 0, 1, 2, 3, 5, 9];

/** One answer of coai's `bodyFor`. `bodyType` is `typeof body`; `body` is `null` when that is not `object`. */
export interface BodyForRecord {
  article: string;
  language: HelpLanguage;
  fallback: boolean;
  bodyType: string;
  body: HelpBody | null;
}

/** What `scripts/record-coai-help.mjs` recorded from coai's own `helpContent.ts` at `1056aed9`. */
export interface RecordedHelp {
  source: string;
  languages: HelpLanguage[];
  labels: Record<HelpLanguage, string>;
  /** coai's engine over small partial translation modules: the input beside coai's answers. */
  synthetic: {
    articles: HelpArticle[];
    translations: Record<TranslatedLanguage, Record<string, HelpBody>>;
    bodyFor: BodyForRecord[];
  };
  /** coai's engine over its own translation modules: ids in, `fallback` out. */
  real: {
    articleIds: string[];
    translatedIds: Record<TranslatedLanguage, string[]>;
    fallback: { article: string; language: HelpLanguage; fallback: boolean }[];
  };
}

/** The help recording, parsed — the same one-place cast as `RECORDED`. */
export const RECORDED_HELP = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'coai-help-1056aed9.json'), 'utf8'),
) as RecordedHelp;
