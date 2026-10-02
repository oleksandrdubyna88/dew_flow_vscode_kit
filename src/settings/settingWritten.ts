import { asText } from '../text/asText';

/** What a host is told when a view setting could not be saved — the reporter decides how to show it. */
export interface SettingNotSaved {
  /** Which surface asked: `help`, `chat`, … — so the notice says where it came from. */
  readonly source: string;
  /** Stable machine code: `view-setting-not-saved`. */
  readonly code: 'view-setting-not-saved';
  readonly title: string;
  readonly detail: string;
}

/** A consumer's own notification funnel (ConnectOtherAIs passes its `notify`). */
export type SettingReporter = (notice: SettingNotSaved) => Promise<void>;

/**
 * A view setting that could not be written says so — once, in one place, for every page.
 *
 * <p>Extracted from ConnectOtherAIs (`src_vs_code/src/settingWrite.ts` at `1056aed9`), where it had
 * existed twice before being unified. The reporter is INJECTED so the kit carries no notification policy
 * of its own: the consumer's funnel stays the one place a notice is counted and suppressed.</p>
 *
 * <p>It never waits for a person — the reporter is expected to return once the notice is recorded, not
 * once it is dismissed.</p>
 *
 * @param writing the settings write already in flight
 * @param source which surface asked
 * @param report the consumer's reporter
 */
export async function settingWritten(
  writing: Promise<void>,
  source: string,
  report: SettingReporter,
): Promise<void> {
  try {
    await writing;
  } catch (reason: unknown) {
    await report({
      source,
      code: 'view-setting-not-saved',
      title: `That view setting could not be saved: ${asText(reason)}`,
      detail: asText(reason),
    });
  }
}
