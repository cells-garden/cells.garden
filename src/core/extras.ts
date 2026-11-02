/** Preview features run on the dev server and dev.cells.garden. See extrasFlag in vite.config.ts. */
declare const __CELLS_EXTRAS__: boolean;

export const EXTRAS: boolean = typeof __CELLS_EXTRAS__ === 'boolean' ? __CELLS_EXTRAS__ : false;
