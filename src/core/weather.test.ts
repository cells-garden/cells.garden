import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seasonOf, snowing, snowsOn } from './weather';

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12);

test('the year turns through the four seasons of the wheel', () => {
    assert.deepEqual([12, 1, 2, 3, 6, 9, 11].map(month => seasonOf(day(2026, month, 15))), ['winter', 'winter', 'winter', 'spring', 'summer', 'fall', 'fall']);
});

test('it snows only in winter, always on the first of December, less often after December', () => {
    assert.equal(snowsOn(day(2026, 12, 1)), true);
    for (const month of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
        for (let date = 1; date <= 28; date++) assert.equal(snowsOn(day(2026, month, date)), false);
    }
    let december = 0, later = 0;
    for (let year = 2026; year < 2036; year++) {
        for (let date = 2; date <= 31; date++) december += Number(snowsOn(day(year, 12, date)));
        for (let date = 1; date <= 28; date++) later += Number(snowsOn(day(year + 1, 1, date))) + Number(snowsOn(day(year + 1, 2, date)));
    }
    const decemberShare = december / 300, laterShare = later / 560;
    assert(decemberShare > 0.35 && decemberShare < 0.65, `December ${decemberShare}`);
    assert(laterShare > 0.12 && laterShare < 0.38, `January and February ${laterShare}`);
    assert(decemberShare > laterShare);
});

test('everyone sees the same weather on a day, and ?snow shows it any day', () => {
    assert.equal(snowsOn(day(2027, 1, 9)), snowsOn(new Date(2027, 0, 9, 23, 59)));
    assert.equal(snowing(day(2026, 7, 1), '?snow'), true);
    assert.equal(snowing(day(2026, 7, 1), '?snow=1'), true);
    assert.equal(snowing(day(2026, 12, 1), '?snow=0'), false);
    assert.equal(snowing(day(2026, 12, 1), ''), true);
    assert.equal(snowing(day(2026, 7, 1), ''), false);
});
