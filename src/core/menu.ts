/**
 * The one floating menu. The pill's menu, a plant's menu and a cell's menu were
 * three copies of the same builder, each with its styles written into the
 * elements; they are all this now, and the look lives in styles.css.
 */
import './shim';

export interface MenuItem {
    label: string;
    /** Smaller text after the label. */
    sub?: string;
    /** Shows a check mark. */
    active?: boolean;
    danger?: boolean;
    /** A non-clickable heading. */
    heading?: boolean;
    /** Shown, but greyed out and inert. */
    disabled?: boolean;
    onClick?: () => unknown;
    /**
     * Makes the row open a panel right under itself, inside the menu, instead of
     * acting and closing the menu. One panel is open at a time.
     */
    panel?: MenuPanel;
    /**
     * More things to do with what the row stands for (a garden: rename it,
     * share it, delete it), behind a ⋯ button at the row's far end. The ⋯
     * opens them in a panel right under the row, as a row with a panel does,
     * and a tap on the row itself still does what the row does. The two are
     * buttons side by side, never one inside the other, so each is a button of
     * its own to a screen reader and to a finger. For a row that acts: a row
     * with a panel already has its chevron at that end, and keeps it.
     */
    actions?: MenuItem[];
    /** What a screen reader calls the ⋯ button. "More for" and the row's label unless given. */
    actionsLabel?: string;
    /** On a heading: one small button at its far end, such as the + that makes a new garden space. */
    button?: MenuButton;
}

/** A small button that shows a glyph (`text`) and is named by `label` for a screen reader and a tooltip. */
export interface MenuButton {
    text: string;
    label: string;
    onClick: () => unknown;
}

/**
 * Fills a row's panel, once, as the menu opens. What it returns runs as the
 * menu closes, told whether Escape closed it (a change of mind) or not.
 */
export type MenuPanel = (panel: HTMLElement, menu: MenuControls) => void | ((cancelled: boolean) => void);

/** What a panel can do to the menu it is in. */
export interface MenuControls {
    /** Close the menu, as choosing a row does. */
    close(): void;
    /** Change the smaller text on the panel's row, to show the value being picked. */
    setSub(text: string): void;
    /** The panel's contents changed after it opened (they came from the network): fit the menu to them. */
    refit(): void;
}

type Point = { x: number; y: number };

/** Where the menu opens: a point (a right-click) or under an element (the pill). */
export type MenuAnchor = Point | HTMLElement;

const MARGIN = 10;

/** How to close the menu open in a document, so the next one closes it properly. */
const openMenus = new WeakMap<Document, () => void>();

let panelCount = 0;

/**
 * The point a menu opens at: the anchor itself, or just under an element. Taken
 * once, so a menu whose element is drawn again while it is open stays put.
 */
function pointOf(anchor: MenuAnchor): Point {
    if (!(anchor instanceof HTMLElement)) return anchor;
    const rect = anchor.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
}

/** Put the menu as near its point as it fits inside the window. Again whenever a panel changes its size. */
function place(menu: HTMLElement, { x, y }: Point, win: Window) {
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(MARGIN, Math.min(x, win.innerWidth - width - MARGIN))}px`;
    menu.style.top = `${Math.max(MARGIN, Math.min(y, win.innerHeight - height - MARGIN))}px`;
}

/**
 * One row in the menu's look: a check column when `active` is given, the
 * label, the smaller text. Panels build their choices with it so they line up
 * with the rows around them; `media` fills a slot before the label (a sprite).
 */
export function menuRow(
    parent: HTMLElement,
    item: Pick<MenuItem, 'label' | 'sub' | 'active' | 'danger'>,
    media?: (slot: HTMLElement) => void,
): HTMLButtonElement {
    const row = parent.createEl('button', { cls: 'garden-menu-item', attr: { type: 'button' } });
    row.toggleClass('is-danger', !!item.danger);
    row.toggleClass('is-active', !!item.active);
    if (item.active) row.setAttribute('aria-current', 'true');
    if (item.active !== undefined) row.createSpan({ cls: 'garden-menu-check', text: item.active ? '✓' : '' });
    if (media) media(row.createSpan({ cls: 'garden-menu-media' }));
    row.createSpan({ cls: 'garden-menu-label', text: item.label });
    if (item.sub) row.createSpan({ cls: 'garden-menu-sub', text: item.sub });
    return row;
}

/**
 * Open a menu, replacing any other. It closes on the next click outside it, on
 * a row that acts, or on Escape. A row with a panel opens it in place instead,
 * and so does a row's ⋯ with the row's actions.
 */
export function openMenu(
    items: MenuItem[],
    anchor: MenuAnchor,
    doc: Document = document,
    build?: (menu: HTMLElement) => void,
): HTMLElement {
    const win = doc.defaultView ?? window;
    const at = pointOf(anchor);
    openMenus.get(doc)?.();
    doc.querySelector('.garden-context-menu')?.remove();

    const menu = doc.body.createDiv('garden-context-menu');
    // Focus goes back here when the menu closes with the focus inside it.
    const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const endings: ((cancelled: boolean) => void)[] = [];
    /** Every panel and the button that opens it: its row, or a row's ⋯. */
    const panels: { control: HTMLElement; panel: HTMLElement }[] = [];
    let closed = false;

    const close = (cancelled = false) => {
        if (closed) return;
        closed = true;
        win.removeEventListener('pointerdown', onOutside, true);
        win.removeEventListener('keydown', onEscape, true);
        if (openMenus.get(doc) === close) openMenus.delete(doc);
        const hadFocus = menu.contains(doc.activeElement);
        try {
            // Before the menu goes, so a field in a panel still holds what was typed.
            for (const end of endings) end(cancelled);
        } finally {
            menu.remove();
            if (hadFocus && opener?.isConnected) opener.focus({ preventScroll: true });
        }
    };
    const onOutside = (e: Event) => {
        if (!menu.contains(e.target as Node)) close();
    };
    // Escape closes the menu and nothing under it: not the chip or the pan view
    // it was opened over, nor a modal.
    const onEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        close(true);
    };

    const toggle = (open: { control: HTMLElement; panel: HTMLElement }, e: MouseEvent) => {
        const opening = !open.panel.hasClass('is-open');
        for (const p of panels) {
            const on = opening && p === open;
            p.panel.toggleClass('is-open', on);
            p.control.toggleClass('is-open', on);
            p.control.setAttribute('aria-expanded', String(on));
        }
        place(menu, at, win);
        if (!opening) return;
        // The current choice sits in the middle of a panel that scrolls.
        const current = open.panel.querySelector<HTMLElement>('.is-active');
        if (current && open.panel.scrollHeight > open.panel.clientHeight) {
            open.panel.scrollTop = current.offsetTop - (open.panel.clientHeight - current.offsetHeight) / 2;
        }
        // Keys and the mouse move into the panel, onto the current choice or the
        // first control. A finger does not: on a phone a focused field would
        // raise the keyboard over the menu.
        const finger = e.detail > 0 && win.matchMedia('(pointer: coarse)').matches;
        if (finger) return;
        const target = current ?? open.panel.querySelector<HTMLElement>('input, button');
        target?.focus({ preventScroll: true });
        if (target instanceof HTMLInputElement && target.type === 'number') target.select();
    };

    /** A button that acts and closes the menu: a row, a row's action, a heading's button. */
    const acts = (button: HTMLElement, run?: () => unknown) => {
        button.onclick = (e) => {
            e.stopPropagation();
            close();
            run?.();
        };
    };

    for (const item of items) {
        if (item.heading) {
            const heading = menu.createDiv({ cls: 'garden-menu-heading' });
            if (!item.button) {
                heading.setText(item.label);
                continue;
            }
            // The heading's text and its button side by side; the button is
            // the only part of a heading that does anything.
            heading.addClass('has-button');
            heading.createSpan({ cls: 'garden-menu-heading-text', text: item.label });
            const { text, label, onClick } = item.button;
            const button = heading.createEl('button', {
                cls: 'garden-menu-heading-button',
                text,
                attr: { type: 'button', 'aria-label': label, title: label },
            });
            acts(button, onClick);
            continue;
        }
        const actions = !item.panel && !item.disabled && item.actions?.length ? item.actions : null;
        // A row with actions shares its line with its ⋯, in a box that holds both.
        const line = actions ? menu.createDiv('garden-menu-split') : menu;
        const row = menuRow(line, item);
        if (item.disabled) {
            row.disabled = true;
            continue;
        }
        if (actions) {
            const name = item.actionsLabel ?? `More for ${item.label}`;
            const more = line.createEl('button', {
                cls: 'garden-menu-more',
                text: '⋯',
                attr: { type: 'button', 'aria-label': name, title: name, 'aria-expanded': 'false' },
            });
            const panel = menu.createDiv({
                cls: 'garden-menu-panel garden-menu-actions',
                attr: { id: `garden-menu-panel-${++panelCount}` },
            });
            more.setAttribute('aria-controls', panel.id);
            for (const action of actions) {
                const choice = menuRow(panel, action);
                if (action.disabled) choice.disabled = true;
                else acts(choice, action.onClick);
            }
            const entry = { control: more, panel };
            panels.push(entry);
            more.onclick = (e) => {
                e.stopPropagation();
                toggle(entry, e);
            };
        }
        if (item.panel) {
            const panel = menu.createDiv({ cls: 'garden-menu-panel', attr: { id: `garden-menu-panel-${++panelCount}` } });
            row.addClass('has-panel');
            row.setAttribute('aria-expanded', 'false');
            row.setAttribute('aria-controls', panel.id);
            const entry = { control: row, panel };
            panels.push(entry);
            const end = item.panel(panel, {
                close: () => close(),
                setSub: (text) => {
                    const sub = row.querySelector('.garden-menu-sub') ?? row.createSpan({ cls: 'garden-menu-sub' });
                    sub.setText(text);
                },
                refit: () => {
                    if (!closed) place(menu, at, win);
                },
            });
            if (end) endings.push(end);
            row.onclick = (e) => {
                e.stopPropagation();
                toggle(entry, e);
            };
            continue;
        }
        acts(row, item.onClick);
    }

    // Up and down walk the rows and whatever an open panel shows, a row's ⋯
    // and a heading's button among them, in the order they are on screen; a
    // field keeps its own arrows.
    menu.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if (e.target instanceof HTMLInputElement) return;
        const rows = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
            .filter((b) => !b.closest('.garden-menu-panel:not(.is-open)'));
        if (!rows.length) return;
        e.preventDefault();
        const from = rows.indexOf(doc.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = from === -1 ? (step > 0 ? 0 : rows.length - 1) : (from + step + rows.length) % rows.length;
        rows[next].focus();
    });

    build?.(menu);
    place(menu, at, win);
    openMenus.set(doc, close);
    // Escape closes it from the start: a key pressed right after the click
    // that opened it can reach the page before any timer does.
    win.addEventListener('keydown', onEscape, true);

    // After this click has finished, or it would close the menu it opened. A
    // pointer, not a mouse: the garden keeps a finger's touches from ever
    // becoming mouse events, and a tap there must close the menu too.
    window.setTimeout(() => {
        if (closed) return;
        win.addEventListener('pointerdown', onOutside, true);
    }, 0);

    return menu;
}
