/**
 * jsdom's constructor, declared here rather than taken from `@types/jsdom`: those types pull the DOM library into the
 * whole program, and `tsconfig.json` keeps it out so a pure module cannot compile against browser globals it will
 * not have (`todo/PLAN_kit_components_storybook.md` §4.11). The window is typed where it is used —
 * `src/test/domDrivers.ts` names the members the tests call — because an ambient module may not import the kit's
 * own types.
 */
declare module 'jsdom' {
  export interface JsdomOptions {
    readonly runScripts?: 'outside-only' | 'dangerously';
    readonly pretendToBeVisual?: boolean;
  }

  export class JSDOM {
    constructor(html?: string, options?: JsdomOptions);
    readonly window: object;
  }
}
