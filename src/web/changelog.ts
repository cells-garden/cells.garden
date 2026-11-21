import changelog from 'virtual:changelog';
import { CHANGELOG_SEEN_KEY, changelogDate, entriesNotShown, entriesToShow, type ChangelogEntry } from '../core/changelog';
import { Modal } from '../core/ui';

function read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* private mode: shown again next time */ }
}

/** "What's new": the commits deployed since this browser last looked. */
class ChangelogModal extends Modal {
    constructor(private entries: ChangelogEntry[], private hidden: number) {
        super();
    }

    onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass('garden-changelog-modal');
        contentEl.createEl('h2', { text: "What's new" });
        const list = contentEl.createEl('ul', { cls: 'garden-changelog' });
        for (const entry of this.entries) {
            const item = list.createEl('li');
            const date = changelogDate(entry.date);
            if (date) item.createEl('time', { text: date, attr: { datetime: entry.date ?? '' } });
            item.createSpan({ text: entry.title });
        }
        const footer = contentEl.createDiv('garden-changelog-footer');
        const all = footer.createEl('a', {
            text: this.hidden ? `${this.hidden} more on GitHub` : 'All changes on GitHub',
            attr: { href: changelog.url, target: '_blank', rel: 'noopener noreferrer' },
        });
        all.addClass('garden-changelog-all');
        const ok = footer.createEl('button', { text: 'Nice', cls: 'mod-cta' });
        ok.addEventListener('click', () => this.close());
    }
}

/**
 * Shows what changed since the last visit, once per new deploy. `returning`
 * is whether this browser held a garden before the app booted.
 */
export function showChangelog(returning: boolean) {
    const { entries } = changelog;
    if (!entries.length) return;
    const seen = read(CHANGELOG_SEEN_KEY);
    const fresh = entriesToShow(entries, seen, returning);
    // Something else is already asking for attention: try again next visit.
    if (fresh.length && document.querySelector('.modal-container')) return;
    // Remember the newest either way, so a first visit starts counting from now.
    write(CHANGELOG_SEEN_KEY, entries[0].sha);
    if (fresh.length) new ChangelogModal(fresh, entriesNotShown(entries, seen, fresh.length)).open();
}

/** Whether this browser held a garden before this visit; read before the app boots. */
export function hadGardenBefore(): boolean {
    return read('cells.garden/v1') !== null;
}
