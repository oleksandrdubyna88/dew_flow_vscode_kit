/**
 * The slice of `@types/vscode` this fixture's adapters touch, declared here so the fixture type-checks with
 * no download (the run is offline). Each member keeps the real declaration's shape, narrowed only where the
 * real one says `any`; `run.mjs` stubs exactly these members at run time and refuses any other.
 */
declare module 'vscode' {
  export type Thenable<T> = PromiseLike<T>;

  export interface Disposable {
    dispose(): unknown;
  }

  export type Event<T> = (listener: (event: T) => unknown) => Disposable;

  export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
  }

  export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    update(section: string, value: unknown, configurationTarget?: ConfigurationTarget | boolean | null): Thenable<void>;
  }

  export interface ConfigurationChangeEvent {
    affectsConfiguration(section: string): boolean;
  }

  export interface Webview {
    html: string;
    postMessage(message: unknown): Thenable<boolean>;
    readonly onDidReceiveMessage: Event<unknown>;
  }

  export interface WebviewPanel {
    readonly webview: Webview;
    readonly onDidDispose: Event<void>;
    reveal(): void;
    dispose(): unknown;
  }

  export interface WebviewPanelOptions {
    readonly enableScripts?: boolean;
    readonly enableFindWidget?: boolean;
    readonly localResourceRoots?: readonly unknown[];
  }

  export interface ExtensionContext {
    readonly subscriptions: { dispose(): unknown }[];
  }

  export namespace workspace {
    export function getConfiguration(section?: string): WorkspaceConfiguration;
    export const onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
  }

  export namespace window {
    export function createWebviewPanel(viewType: string, title: string, showOptions: ViewColumn, options?: WebviewPanelOptions): WebviewPanel;
  }

  export namespace commands {
    export function registerCommand(command: string, callback: (...args: unknown[]) => unknown): Disposable;
  }
}
