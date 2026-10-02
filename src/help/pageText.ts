import { asText } from '../text/asText';
import { escapeHtml } from '../webview/escape';
import type { HelpBody, HelpLanguage, ShownBody } from './types';

/**
 * The help page's own words and the markup of a body — the text half of `page.ts`.
 *
 * <p>Extracted from ConnectOtherAIs' `helpPage.ts` at `1056aed9`: the five section labels and the
 * page chrome (search placeholder, Back, Home, the fallback note, "nothing matches") in each language,
 * and `bodyHtml`, the three-construct body markup. This is the one surface besides the article bodies
 * that exists in five languages (`.agents/PROJECT.md`): the help's own chrome, in the help's language.</p>
 *
 * <p>One string is new: the <b>stale note</b>, shown when `bodyFor` answers a translation that was not
 * made from the current English — `stale` (its `from` is an older digest) or `unknown` (it records no
 * `from`). Its wording covers both, because to a reader the fact is the same: this translation has not
 * been checked against the English text now shown to English readers. It wears the fallback note's
 * class, so the stylesheet is unchanged and a fresh catalog renders byte for byte what coai rendered.</p>
 */

/** The five sections under a title, in the order the article shows them. */
export type SectionKey = Exclude<keyof HelpBody, 'title'>;
export const SECTION_ORDER: readonly SectionKey[] = ['whatItIs', 'why', 'setup', 'usage', 'whatCanGoWrong'];

export const SECTION_LABELS: Readonly<Record<HelpLanguage, Readonly<Record<SectionKey, string>>>> = {
  en: { whatItIs: 'What it is', why: 'Why', setup: 'How to set it up', usage: 'How to use it', whatCanGoWrong: 'What can go wrong' },
  ru: { whatItIs: 'Что это', why: 'Зачем', setup: 'Как настроить', usage: 'Как пользоваться', whatCanGoWrong: 'Что может пойти не так' },
  uk: { whatItIs: 'Що це', why: 'Навіщо', setup: 'Як налаштувати', usage: 'Як користуватися', whatCanGoWrong: 'Що може піти не так' },
  de: { whatItIs: 'Was es ist', why: 'Warum', setup: 'Einrichtung', usage: 'Verwendung', whatCanGoWrong: 'Was schiefgehen kann' },
  es: { whatItIs: 'Qué es', why: 'Por qué', setup: 'Cómo configurarlo', usage: 'Cómo usarlo', whatCanGoWrong: 'Qué puede salir mal' },
};

/** The page's own words, per language. */
export interface HelpChrome {
  readonly search: string;
  readonly back: string;
  readonly home: string;
  /** Shown over an English body a language does not translate. */
  readonly fallback: string;
  readonly noHits: string;
  /** Shown over a translation that was not made from the current English (`stale` or `unknown`). */
  readonly stale: string;
}

export const HELP_CHROME: Readonly<Record<HelpLanguage, HelpChrome>> = {
  en: {
    search: 'Search the help…', back: '← Back', home: 'Help', fallback: 'Not translated yet — showing English.', noHits: 'Nothing matches.',
    stale: 'This translation has not been checked against the current English text.',
  },
  ru: {
    search: 'Поиск по справке…', back: '← Назад', home: 'Справка', fallback: 'Ещё не переведено — показан английский.', noHits: 'Ничего не найдено.',
    stale: 'Этот перевод не сверялся с текущим английским текстом.',
  },
  uk: {
    search: 'Пошук у довідці…', back: '← Назад', home: 'Довідка', fallback: 'Ще не перекладено — показано англійську.', noHits: 'Нічого не знайдено.',
    stale: 'Цей переклад не звірено з поточним англійським текстом.',
  },
  de: {
    search: 'Hilfe durchsuchen…', back: '← Zurück', home: 'Hilfe', fallback: 'Noch nicht übersetzt — Englisch wird angezeigt.', noHits: 'Keine Treffer.',
    stale: 'Diese Übersetzung wurde nicht mit dem aktuellen englischen Text abgeglichen.',
  },
  es: {
    search: 'Buscar en la ayuda…', back: '← Atrás', home: 'Ayuda', fallback: 'Aún sin traducir — se muestra en inglés.', noHits: 'Sin resultados.',
    stale: 'Esta traducción no se ha cotejado con el texto en inglés actual.',
  },
};

/**
 * One section's text, as paragraphs, bullets and emphasis.
 *
 * <p><b>Escaped first, marked up second, and the order is the whole safety of it.</b> Every character
 * that could open a tag is gone before any tag of ours is added, so the markup below can only ever
 * produce the four elements it names. Three constructs, deliberately: a blank line starts a paragraph,
 * a line beginning "- " is a bullet, and `**text**` is emphasis. Anything more would be a markdown
 * parser, and this is a help page.</p>
 */
export function bodyHtml(text: string): string {
  return blocks(asText(text))
    .map((block) => (block.bullets ? list(block.lines) : `<p>${inline(block.lines.join(' '))}</p>`))
    .join('\n');
}

interface Block {
  readonly bullets: boolean;
  readonly lines: readonly string[];
}

/** Blank lines separate blocks; a block of "- " lines is a list, anything else a paragraph. */
function blocks(text: string): readonly Block[] {
  return text.split(/\n\s*\n/).flatMap((raw) => {
    const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);

    return lines.length === 0 ? [] : [{ bullets: lines.every((line) => line.startsWith('- ')), lines }];
  });
}

function list(lines: readonly string[]): string {
  return `<ul>${lines.map((line) => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
}

/** Escaped, then the one inline construct. Nothing here can widen what the escape allowed. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * The note over an article's body, or nothing: the fallback note over English shown in a language's
 * place (coai's), the stale note over a translation that was not made from the current English (the
 * kit's — `stale` and `unknown` alike; `bodyFor` never answers both, because a fallback IS the current
 * English). The stale note wears the fallback note's class and adds its own, so the stylesheet does not
 * change and a fresh catalog renders exactly what coai rendered.
 */
export function noteHtml(shown: ShownBody, language: HelpLanguage): string {
  if (shown.fallback) {
    return `<p class="fallback">${escapeHtml(HELP_CHROME[language].fallback)}</p>`;
  }
  if (shown.stale !== 'fresh') {
    return `<p class="fallback stale">${escapeHtml(HELP_CHROME[language].stale)}</p>`;
  }

  return '';
}
