/**
 * The box around the page (`todo/PLAN_layout_check_bin.md` §1.4, §9 items 1, 2 and 4). The page is the consumer's OWN file
 * from its own repository - trusted input - so this stops ACCIDENTAL reach, it is not a sandbox for a hostile page: every
 * request the page makes is paused through the DevTools `Fetch` domain and continues only when it is a `file:` URL whose
 * REAL path lies under the real path of the page's own folder, or a `data:` / `about:` URL. Everything else is failed and
 * recorded, and the run reports each as a defect ("the page asked for <url>"). Chrome's own flags (a dead proxy, WebRTC
 * limited to proxied UDP, no background networking - `browser.mjs`) are the second wall behind it.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The URL schemes that carry nothing from outside the page. */
const INLINE = new Set(['data:', 'about:']);

/** The real path of `path`, or - for a file that does not exist yet - of its nearest existing folder plus the rest. */
function realOf(path, realpath) {
  try {
    return realpath(path);
  } catch (error) {
    const parent = dirname(path);
    if (error.code !== 'ENOENT' || parent === path) {
      return path;
    }

    return join(realOf(parent, realpath), basename(path));
  }
}

/** `candidate` is `folder` itself or lies below it. `relative` is case-insensitive and drive-letter aware on Windows. */
function within(folder, candidate) {
  const path = relative(folder, candidate);

  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

/** The real folder of a page file: the boundary its requests are judged against. */
export function boundaryOf(file, realpath = realpathSync.native) {
  return realpath(dirname(resolve(file)));
}

function parsedOrNothing(url) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * A `file:` URL whose decoded, resolved, REAL path is under `boundary`. One with a host (`file://server/share/x`, a UNC
 * path on Windows - a network share, and the file system would be asked to reach it before the answer) is refused
 * before the file system is touched; so is one that cannot be decoded (an encoded separator).
 */
function fileWithin(parsed, boundary, realpath) {
  if (parsed.hostname !== '' && parsed.hostname !== 'localhost') {
    return false;
  }
  try {
    return within(boundary, realOf(resolve(fileURLToPath(parsed)), realpath));
  } catch {
    return false;
  }
}

/**
 * Whether the page may load `url`: `data:` and `about:` always; a `file:` URL when its real path is under `boundary` (a
 * symlink or junction pointing out of the folder is refused); nothing else, and nothing that does not parse.
 */
export function mayLoad(url, boundary, realpath = realpathSync.native) {
  const parsed = parsedOrNothing(url);
  if (parsed === undefined) {
    return false;
  }

  return INLINE.has(parsed.protocol) || (parsed.protocol === 'file:' && fileWithin(parsed, boundary, realpath));
}

/** Answers one paused request: continued or failed. A request that has already gone is not an error of the check. */
function answer(tools, sessionId, requestId, allowed) {
  const [method, params] = allowed ? ['Fetch.continueRequest', { requestId }] : ['Fetch.failRequest', { requestId, errorReason: 'AccessDenied' }];

  return tools.send(method, params, sessionId).catch(() => undefined);
}

/**
 * Boxes `sessionId`'s page in: pauses every request and judges it against `boundary`. Answers the Set of URLs that were
 * refused, filled as the page runs.
 */
export async function boxPage(tools, sessionId, boundary) {
  const refused = new Set();
  tools.on((message) => {
    if (message.sessionId !== sessionId || message.method !== 'Fetch.requestPaused') {
      return;
    }
    const { requestId, request } = message.params;
    const allowed = mayLoad(request.url, boundary);
    if (!allowed) {
      refused.add(request.url);
    }
    void answer(tools, sessionId, requestId, allowed);
  });
  await tools.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);

  return refused;
}
