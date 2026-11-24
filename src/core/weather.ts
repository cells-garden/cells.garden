export type Season = 'spring' | 'summer' | 'fall' | 'winter';

const SEASONS: readonly Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];

export function seasonOf(date: Date): Season {
    return SEASONS[date.getMonth()];
}

function dayRoll(date: Date): number {
    let hash = 2166136261;
    for (const char of `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`) {
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    return ((hash ^ (hash >>> 16)) >>> 0) / 2 ** 32;
}

export function snowsOn(date: Date): boolean {
    if (seasonOf(date) !== 'winter') return false;
    const december = date.getMonth() === 11;
    if (december && date.getDate() === 1) return true;
    return dayRoll(date) < (december ? 0.5 : 0.25);
}

export function snowing(date = new Date(), search = window.location.search): boolean {
    const asked = new URLSearchParams(search).get('snow');
    if (asked !== null) return asked !== '0';
    return snowsOn(date);
}
