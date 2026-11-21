import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GIT_FORMAT, cleanCommits, collectChangelog, parseGitHubCommits, parseGitLog } from './changelog.mjs';

const commit = (sha, title, extra = {}) => ({ sha, date: '2026-11-21T20:00:00Z', title, merge: false, ...extra });

test('keeps real changes, newest first, without merges, noise or repeats', () => {
    const entries = cleanCommits([
        commit('a', 'Read Figma plant variants in either property order\n\nBody text'),
        commit('b', "Merge branch 'main' of https://github.com/lukketsvane/cells.garden"),
        commit('c', 'Merge verified routes and original tutorial into main'),
        commit('d', 'Release the pumpkin', { merge: true }),
        commit('e', 'df'),
        commit('f', 'Update live Figma artwork'),
        commit('g', 'Update live Figma artwork'),
        commit('h', 'Build the Obsidian plugin'),
        commit('i', 'build the obsidian plugin'),
    ]);
    assert.deepEqual(entries.map(e => [e.sha, e.title]), [
        ['a', 'Read Figma plant variants in either property order'],
        ['f', 'Update live Figma artwork'],
        ['h', 'Build the Obsidian plugin'],
    ]);
});

test('caps the list and long titles', () => {
    const many = Array.from({ length: 50 }, (_, i) => commit(`s${i}`, `Change number ${i}`));
    assert.equal(cleanCommits(many).length, 30);
    assert.equal(cleanCommits([commit('x', 'Long '.repeat(60))])[0].title.length, 140);
});

test('parses git log and GitHub records alike', () => {
    const log = ['aaa', '2026-11-21T22:00:00+01:00', 'p1', 'First'].join('\x1f') + '\x1e\n'
        + ['bbb', '2026-11-20T10:00:00+01:00', 'p1 p2', 'Merge dev'].join('\x1f') + '\x1e\n';
    assert.deepEqual(parseGitLog(log), [
        { sha: 'aaa', date: '2026-11-21T22:00:00+01:00', title: 'First', merge: false },
        { sha: 'bbb', date: '2026-11-20T10:00:00+01:00', title: 'Merge dev', merge: true },
    ]);
    assert.equal(GIT_FORMAT, '%H%x1f%cI%x1f%P%x1f%s%x1e');
    assert.deepEqual(parseGitHubCommits([
        { sha: 'ccc', commit: { message: 'New plant: Leafy\n\nbody', committer: { date: '2026-11-22T00:00:00Z' } }, parents: [{}] },
        { sha: 'ddd', commit: { message: 'Merge', author: { date: '2026-11-21T00:00:00Z' } }, parents: [{}, {}] },
        { nope: true },
    ]), [
        { sha: 'ccc', date: '2026-11-22T00:00:00Z', title: 'New plant: Leafy\n\nbody', merge: false },
        { sha: 'ddd', date: '2026-11-21T00:00:00Z', title: 'Merge', merge: true },
    ]);
    assert.deepEqual(parseGitHubCommits({ message: 'API rate limit exceeded' }), []);
});

const gitLog = (...titles) => titles.map((t, i) => [`sha${i}`, '2026-11-21T20:00:00Z', 'p', t].join('\x1f') + '\x1e').join('\n');

test('a full local history comes from git, and GitHub is never asked', async () => {
    let asked = false;
    const run = (_cmd, args) => {
        if (args[0] !== 'rev-parse') return gitLog('One change', 'Two change');
        return args[1] === '--is-shallow-repository' ? 'false\n' : 'dev\n';
    };
    const fetcher = async () => { asked = true; return { ok: false }; };
    const result = await collectChangelog({ cwd: '.', env: { VERCEL: '1' }, run, fetcher });
    assert.equal(result.source, 'git');
    assert.equal(result.branch, 'dev');
    assert.equal(result.url, 'https://github.com/cells-garden/cells.garden/commits/dev');
    assert.deepEqual(result.entries.map(e => e.title), ['One change', 'Two change']);
    assert.equal(asked, false);
});

test('a Vercel build without history asks GitHub for the built commit', async () => {
    const env = {
        VERCEL: '1', VERCEL_GIT_COMMIT_SHA: 'abc123', VERCEL_GIT_COMMIT_REF: 'main',
        VERCEL_GIT_REPO_OWNER: 'lukketsvane', VERCEL_GIT_REPO_SLUG: 'cells.garden',
    };
    let url = '';
    const run = () => { throw new Error('fatal: not a git repository'); };
    const fetcher = async (u) => {
        url = u;
        return {
            ok: true,
            json: async () => [
                { sha: 'abc123', commit: { message: 'New plant: Leafy', committer: { date: '2026-11-22T00:00:00Z' } }, parents: [{}] },
                { sha: 'def', commit: { message: 'Older change' } },
            ],
        };
    };
    const result = await collectChangelog({ env, run, fetcher });
    assert.equal(url, 'https://api.github.com/repos/lukketsvane/cells.garden/commits?sha=abc123&per_page=100');
    assert.equal(result.source, 'github');
    assert.equal(result.branch, 'main');
    assert.deepEqual(result.entries.map(e => e.title), ['New plant: Leafy', 'Older change']);
});

test('with GitHub unreachable the built commit alone is shown, and nothing ever throws', async () => {
    const env = { VERCEL: '1', VERCEL_GIT_COMMIT_SHA: 'abc123', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_MESSAGE: 'Show what is new\n\nbody' };
    const run = () => { throw new Error('no git'); };
    const now = new Date('2026-11-22T12:00:00Z');
    const limited = await collectChangelog({ env, run, now, fetcher: async () => ({ ok: false, status: 403 }) });
    assert.equal(limited.source, 'vercel');
    assert.deepEqual(limited.entries, [{ sha: 'abc123', date: '2026-11-22T12:00:00.000Z', title: 'Show what is new' }]);
    const offline = await collectChangelog({ env, run, now, fetcher: async () => { throw new TypeError('fetch failed'); } });
    assert.equal(offline.source, 'vercel');
    const nothing = await collectChangelog({ env: {}, run, fetcher: undefined });
    assert.deepEqual(nothing.entries, []);
    assert.equal(nothing.url, 'https://github.com/cells-garden/cells.garden/commits/main');
});
