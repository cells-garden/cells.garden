import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changelogDate, entriesNotShown, entriesToShow, type ChangelogEntry } from './changelog';

const entries: ChangelogEntry[] = Array.from({ length: 10 }, (_, i) => ({ sha: `s${i}`, date: '2026-11-21T20:00:00Z', title: `Change ${i}` }));
const shas = (list: ChangelogEntry[]) => list.map(entry => entry.sha);

test('shows only what is newer than the last entry this browser saw', () => {
    assert.deepEqual(shas(entriesToShow(entries, 's3', true)), ['s0', 's1', 's2']);
    assert.deepEqual(entriesToShow(entries, 's0', true), []);
    assert.equal(entriesNotShown(entries, 's3', 3), 0);
});

test('a long absence shows the newest few and counts the rest', () => {
    assert.deepEqual(shas(entriesToShow(entries, 's9', true)), ['s0', 's1', 's2', 's3', 's4', 's5']);
    assert.equal(entriesNotShown(entries, 's9', 6), 3);
    assert.deepEqual(shas(entriesToShow(entries, 'gone', true)), ['s0', 's1', 's2', 's3', 's4', 's5']);
    assert.equal(entriesNotShown(entries, 'gone', 6), 0);
});

test('a first visit shows nothing; a garden from before the changelog gets the newest three', () => {
    assert.deepEqual(entriesToShow(entries, null, false), []);
    assert.deepEqual(shas(entriesToShow(entries, null, true)), ['s0', 's1', 's2']);
    assert.deepEqual(entriesToShow([], null, true), []);
});

test('dates read short, with the year only when it is not this one', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    assert.equal(changelogDate('2026-11-21T20:00:00Z', now), '21 Nov');
    assert.equal(changelogDate('2025-03-02T12:00:00Z', now), '2 Mar 2025');
    assert.equal(changelogDate(null, now), '');
    assert.equal(changelogDate('not a date', now), '');
});
