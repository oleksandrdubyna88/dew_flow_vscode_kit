import { createCatalog, type HelpArticle, type Translation } from '@oleksandrdubyna88/vscode-webview-kit';

/**
 * The fixture's help catalog, written the way a consumer writes one: English in the articles, one module per
 * translated language, each `from` a LITERAL digest of the English it was made from (README "The help
 * catalog"). `pack-and-consume` bundles this module on its own and hands it to the installed
 * `vscode-webview-kit-help-digests` bin, which must answer "every translation was made from the current
 * English" — so editing an English body here without its `from` turns the `bin` step red, and the bin's
 * own output names the line to paste.
 */

export const ARTICLES: readonly HelpArticle[] = [
  {
    id: 'install-the-fixture',
    en: {
      title: 'Install the fixture',
      whatItIs: 'A consumer of the kit that exists only to be packed against.',
      why: 'The tarball is what ships, so the tarball is what is installed.',
      setup: 'Nothing: pack-and-consume does it.',
      usage: 'Run npm run pack-and-consume.',
      whatCanGoWrong: 'A misspelled import fails the typecheck.',
    },
  },
  {
    id: 'text-size',
    en: {
      title: 'Text size and tone',
      whatItIs: 'The two controls every page carries.',
      why: 'Reading comfort.',
      setup: 'None.',
      usage: 'Press the buttons.',
      whatCanGoWrong: 'A setting that cannot be saved is reported once.',
    },
  },
];

export const UK: Translation = {
  bodies: {
    'install-the-fixture': {
      title: 'Встановлення фікстури',
      whatItIs: 'Споживач набору, який існує лише для перевірки пакета.',
      why: 'Постачається архів, тож встановлюється саме архів.',
      setup: 'Нічого: це робить pack-and-consume.',
      usage: 'Запустіть npm run pack-and-consume.',
      whatCanGoWrong: 'Помилка в імені імпорту зупиняє перевірку типів.',
    },
  },
  from: { 'install-the-fixture': 'f5f3e59c' },
};

export const catalog = createCatalog({ articles: ARTICLES, translations: { uk: UK } });
