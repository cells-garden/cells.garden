/** Help and project information shared by the web, extension and Obsidian. */
import { menuRow, type MenuItem } from './menu';
import { Modal } from './ui';

export const ISSUE_URL = 'https://github.com/lukketsvane/cells.garden/issues/new';
export const SUPPORT_EMAIL = 'cells.garden@proton.me';
export const ABOUT_URL = 'https://cells.garden/about/';
export const SUPPORT_URL = 'https://buymeacoffee.com/cells.garden';

export function helpItem(openAbout: () => void): MenuItem {
    return {
        label: 'Help',
        panel: (panel, menu) => {
            for (const [label, open] of [
                ['About cells.garden', openAbout],
                ['Open a GitHub issue', () => window.open(ISSUE_URL, '_blank', 'noopener,noreferrer')],
                [SUPPORT_EMAIL, () => window.open(`mailto:${SUPPORT_EMAIL}`, '_blank', 'noopener,noreferrer')],
            ] as const) {
                menuRow(panel, { label }).onclick = () => {
                    menu.close();
                    open();
                };
            }
        },
    };
}

/** Available offline in every distribution; the full project page is a normal link. */
export class AboutModal extends Modal {
    onOpen() {
        this.modalEl.addClass('share-modal');
        const content = this.contentEl;
        content.createEl('h2', { text: 'About cells.garden' });
        content.createEl('p', { text: 'Give your projects a place to grow. A project board and pixel-art garden, available on the web, in Chrome and in Obsidian.' });
        content.createEl('p', { text: "Based on Max’s Garden Cells, whose garden design, pixel art and original plugin made this project possible." });
        content.createEl('p', { text: 'Free and open source under Apache-2.0. No ads or analytics. An account is optional; support is optional too and does not unlock extra features.' });
        for (const [text, href] of [
            ['About the project', ABOUT_URL],
            ['Support cells.garden', SUPPORT_URL],
            ['Source code', 'https://github.com/lukketsvane/cells.garden'],
            ['Privacy', 'https://cells.garden/privacy.html'],
            [SUPPORT_EMAIL, `mailto:${SUPPORT_EMAIL}`],
        ]) {
            content.createEl('p').createEl('a', { text, attr: { href, target: '_blank', rel: 'noopener noreferrer' } });
        }
    }
}
