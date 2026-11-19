/**
 * Every bound on a wait, in one place (`todo/PLAN_layout_check_bin.md` §9 item 3). A wait is a bound, never a pace: a
 * loaded machine is slow, but a browser or a page that never answers must end the run - exit 3 naming the wait - so that
 * the clean-up runs. Each bound can be lowered through one environment variable, which is how the tests cut a page that
 * never yields in seconds instead of a minute; a value that is not a whole number of milliseconds of at least 1 is ignored.
 */

const DEFAULTS = {
  /** Chrome writing its DevTools port after it was started. */
  startMs: 90_000,
  /** Opening the DevTools socket. */
  connectMs: 30_000,
  /** Any one DevTools command. */
  commandMs: 60_000,
  /** One navigation: the command and then the load event. */
  navigationMs: 90_000,
  /** One call of the probe in the page - a script that never yields is cut here. */
  probeMs: 60_000,
};

const VARIABLES = {
  startMs: 'KIT_LAYOUT_START_MS',
  connectMs: 'KIT_LAYOUT_CONNECT_MS',
  commandMs: 'KIT_LAYOUT_COMMAND_MS',
  navigationMs: 'KIT_LAYOUT_NAV_MS',
  probeMs: 'KIT_LAYOUT_PROBE_MS',
};

/** One bound: the variable's value when it is a whole number of at least 1, else the default. */
function bound(name, env) {
  const raw = env[VARIABLES[name]];

  return /^[1-9]\d*$/.test(raw ?? '') ? Number(raw) : DEFAULTS[name];
}

/** The bounds in force for `env`: `{ startMs, connectMs, commandMs, navigationMs, probeMs }`. */
export function deadlines(env = process.env) {
  return Object.fromEntries(Object.keys(DEFAULTS).map((name) => [name, bound(name, env)]));
}
