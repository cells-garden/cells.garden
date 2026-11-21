/**
 * What changed since a visitor last opened the site. The entries are the
 * commits of the deployed branch, newest first, read at build time
 * (scripts/changelog.mjs, served as `virtual:changelog`).
 */

export interface ChangelogEntry {
    sha: string;
    /** ISO 8601, or null where the source had none. */
    date: string | null;
    title: string;
}

export interface Changelog {
    /** The branch the site was built from, "" where unknown. */
    branch: string;
    /** Every commit of that branch on GitHub. */
    url: string;
    entries: ChangelogEntry[];
}

/** The newest entry this browser has been shown (or was too new to need). */
export const CHANGELOG_SEEN_KEY = 'cells.garden/changelog-seen';

/** At most this many entries in one popup. */
export const CHANGELOG_SHOWN = 6;

/**
 * The entries to show a visitor, newest first.
 *
 * - `seen` is the newest sha shown before, null if never.
 * - `returning` says the browser already held a garden before this visit. A
 *   first visit shows nothing: there is no "since" yet, and the garden's own
 *   tutorial comes first. A garden from before the changelog existed gets the
 *   few newest changes once.
 * - A `seen` sha no longer in the list (away a long time, or history rewritten)
 *   gets the newest `max`.
 */
export function entriesToShow(entries: readonly ChangelogEntry[], seen: string | null, returning: boolean, max = CHANGELOG_SHOWN): ChangelogEntry[] {
    if (!entries.length || seen === entries[0].sha) return [];
    if (seen === null) return returning ? entries.slice(0, Math.min(3, max)) : [];
    const index = entries.findIndex(entry => entry.sha === seen);
    return entries.slice(0, index === -1 ? max : Math.min(index, max));
}

/** How many newer entries did not fit in the popup. */
export function entriesNotShown(entries: readonly ChangelogEntry[], seen: string | null, shown: number): number {
    if (seen === null) return 0;
    const index = entries.findIndex(entry => entry.sha === seen);
    return index === -1 ? 0 : Math.max(0, index - shown);
}

/** "21 Nov", or "21 Nov 2025" outside the current year; "" when unknown. */
export function changelogDate(iso: string | null, now = new Date()): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = `${date.getDate()} ${months[date.getMonth()]}`;
    return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
}
