/**
 * A plant's description: one short line under its name on the board, saying
 * what the plant is about. It is the plant's own (ProjectData.description):
 * it syncs, merges and travels with it like its name and its tags.
 *
 * A plant without one stores no field at all, so a plant nobody described
 * stores exactly what it did before descriptions. Pure, no DOM, covered by
 * description.test.ts; the board writes it (garden.ts, the seed cell).
 */
import type { ProjectData } from './model';

/** The longest a description gets; the rest of a longer one is cut. */
export const MAX_DESCRIPTION_LENGTH = 75;

/**
 * A description as it is kept: one line, one space between words, trimmed,
 * at most MAX_DESCRIPTION_LENGTH long. '' is none.
 *
 * The limit counts what a text field's maxlength counts (UTF-16 code units),
 * so the field and the stored text agree. A cut that would split an emoji in
 * two drops the stray half rather than keep half a character.
 */
export function cleanDescription(text: string): string {
    let clean = String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION_LENGTH);
    if (/[\uD800-\uDBFF]$/.test(clean)) clean = clean.slice(0, -1);
    return clean.trim();
}

/** A plant's description as stored, clean; '' when it has none or the field holds anything but text. */
export function descriptionOf(project: Pick<ProjectData, 'description'>): string {
    const stored: unknown = project.description;
    return typeof stored === 'string' ? cleanDescription(stored) : '';
}

/**
 * Give a plant a description, in place: cleaned, and an empty one removes the
 * field. Says whether anything changed, so a caller saves only when it did.
 */
export function setDescription(project: Pick<ProjectData, 'description'>, text: string): boolean {
    const before: unknown = project.description;
    const clean = cleanDescription(text);
    if (clean) project.description = clean;
    else delete project.description;
    return project.description !== before;
}
