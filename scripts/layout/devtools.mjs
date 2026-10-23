/**
 * The DevTools protocol over Node's own `WebSocket` (no dependency), and the three things a check does with a page: open
 * it boxed in, visit it, ask it a question. Every wait is bounded by `deadlines.mjs` and an expired bound is an
 * `EnvironmentError` naming it (exit 3) - the run ends, the clean-up runs, nothing hangs.
 */
import { EnvironmentError, withTimeout } from './cleanup.mjs';
import { boxPage } from './netbox.mjs';

export class Devtools {
  #socket;
  #limits;
  #next = 1;
  #waiting = new Map();
  #listeners = [];

  static async connect(endpoint, limits) {
    const tools = new Devtools(new WebSocket(endpoint), limits);
    const opened = new Promise((done, fail) => {
      tools.#socket.onopen = done;
      tools.#socket.onerror = () => { fail(new EnvironmentError('the DevTools socket would not open.')); };
    });
    await withTimeout(opened, limits.connectMs, 'the DevTools socket opening', () => { tools.close(); });

    return tools;
  }

  constructor(socket, limits) {
    this.#socket = socket;
    this.#limits = limits;
    socket.onmessage = (event) => { this.#route(JSON.parse(String(event.data))); };
  }

  #route(message) {
    if (message.id !== undefined && this.#waiting.has(message.id)) {
      const { ok, fail } = this.#waiting.get(message.id);
      this.#waiting.delete(message.id);
      if (message.error) {
        fail(new Error(JSON.stringify(message.error)));
      } else {
        ok(message.result);
      }
    } else if (message.method) {
      this.#listeners.slice().forEach((listener) => { listener(message); });
    }
  }

  /** One command. A command Chrome never answers ends the run (the socket is closed at the bound) so the clean-up runs. */
  send(method, params = {}, sessionId = undefined, { ms = this.#limits.commandMs, what = `the DevTools command ${method}` } = {}) {
    const id = this.#next++;
    const answered = new Promise((ok, fail) => { this.#waiting.set(id, { ok, fail }); });
    this.#socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));

    return withTimeout(answered, ms, what, () => {
      this.#waiting.delete(id);
      this.close();
    });
  }

  /** Waits for ONE event of `method` in `sessionId`, for at most `ms`; register it BEFORE the call that causes it. */
  once(method, sessionId, { ms, what }) {
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.#listeners.splice(this.#listeners.indexOf(listener), 1);
        fail(new EnvironmentError(`${what} did not finish within ${ms / 1000} s.`));
      }, ms);
      const listener = (message) => {
        if (message.method === method && message.sessionId === sessionId) {
          clearTimeout(timer);
          this.#listeners.splice(this.#listeners.indexOf(listener), 1);
          ok(message.params);
        }
      };
      this.#listeners.push(listener);
    });
  }

  on(listener) {
    this.#listeners.push(listener);
  }

  close() {
    this.#socket.close();
  }
}

/** A page of its own, attached, with its script exceptions collected and every request it makes judged against `boundary`. */
export async function openPage(tools, boundary) {
  const { targetId } = await tools.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await tools.send('Target.attachToTarget', { targetId, flatten: true });
  await tools.send('Page.enable', {}, sessionId);
  await tools.send('Runtime.enable', {}, sessionId);
  const exceptions = [];
  tools.on((message) => {
    if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') {
      exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });
  const refused = await boxPage(tools, sessionId, boundary);

  return { sessionId, targetId, exceptions, refused };
}

/** Navigates and waits for the load. A hash-only change fires no load, so every visit goes through about:blank. */
export async function visit(tools, page, url, limits) {
  for (const target of ['about:blank', url]) {
    const what = `the page load of ${target === 'about:blank' ? target : 'the page'}`;
    const loaded = tools.once('Page.loadEventFired', page.sessionId, { ms: limits.navigationMs, what });
    // Registered above: a load that fires before the command's answer is still seen. The rejection of a load that never
    // comes is handled where it is awaited; a command that fails first must not leave it unhandled.
    loaded.catch(() => undefined);
    await tools.send('Page.navigate', { url: target }, page.sessionId, { ms: limits.navigationMs, what: `the navigation to ${target === 'about:blank' ? target : 'the page'}` });
    await loaded;
  }
}

/** Evaluates `expression` in the page, bounded by the probe's deadline; a throw in the page is an Error carrying its text. */
export async function evaluate(tools, page, expression, limits) {
  const { result, exceptionDetails } = await tools.send('Runtime.evaluate', { expression, returnByValue: true }, page.sessionId, { ms: limits.probeMs, what: 'the page\'s probe' });
  if (exceptionDetails) {
    throw new Error(`the page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }

  return result.value;
}
