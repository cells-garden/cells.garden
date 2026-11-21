// The "What's new" list, read at build time from the commits of the branch
// being built, so the site can show a visitor what changed since their last
// visit (src/web/changelog.ts). vite.config.ts serves it as `virtual:changelog`.
//
// Where the commits come from, first that works:
//   1. git log, in a checkout with its history (local builds, CI);
//   2. GitHub's API for this public repository, where the build has no usable
//      history (Vercel builds without .git, or with a shallow clone);
//   3. the single commit Vercel names in VERCEL_GIT_COMMIT_*.
// Nothing here may fail a build: every source falls through to the next, and
// with none the list is empty and the site shows nothing.
//
//   node scripts/changelog.mjs   prints what a build here would show

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = { owner: 'cells-garden', repo: 'cells.garden' };
/** Entries kept in the bundle; a visitor away longer sees the newest of them. */
export const LIMIT = 30;
const SCAN = 120;

/** "Merge branch 'main' of …", "Merge pull request #4 …", "Merge dev into main". */
const MERGE_TITLE = /^Merge (branch|pull request|remote-tracking branch|.+ into )/i;

/**
 * The commits worth telling a visitor about, newest first: no merges, no
 * titles without a word in them ("df"), and each title once (the newest), so
 * a run of "Update live Figma artwork" reads as one change.
 */
export function cleanCommits(commits, limit = LIMIT) {
    const seen = new Set();
    const entries = [];
    for (const commit of commits) {
        const title = String(commit.title ?? '').split(/\r?\n/)[0].trim();
        if (!commit.sha || !title || commit.merge || MERGE_TITLE.test(title)) continue;
        if (!/\p{L}{3,}/u.test(title)) continue;
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ sha: commit.sha, date: commit.date, title: title.length > 140 ? `${title.slice(0, 139)}…` : title });
        if (entries.length >= limit) break;
    }
    return entries;
}

const FIELD = '\x1f';
const RECORD = '\x1e';
export const GIT_FORMAT = ['%H', '%cI', '%P', '%s'].join('%x1f') + '%x1e';

/** Parses `git log --format=GIT_FORMAT`. */
export function parseGitLog(text) {
    return text.split(RECORD).map(record => record.trim()).filter(Boolean).map(record => {
        const [sha, date, parents, title] = record.split(FIELD);
        return { sha, date, title, merge: parents.trim().split(/\s+/).filter(Boolean).length > 1 };
    });
}

/** Parses GitHub's list-commits response. */
export function parseGitHubCommits(json) {
    if (!Array.isArray(json)) return [];
    return json.map(item => ({
        sha: item?.sha,
        date: item?.commit?.committer?.date ?? item?.commit?.author?.date ?? null,
        title: item?.commit?.message ?? '',
        merge: Array.isArray(item?.parents) && item.parents.length > 1,
    })).filter(commit => typeof commit.sha === 'string');
}

function fromGit({ cwd, run }) {
    try {
        const shallow = run('git', ['rev-parse', '--is-shallow-repository'], cwd).trim() === 'true';
        const commits = parseGitLog(run('git', ['log', `-n${SCAN}`, `--format=${GIT_FORMAT}`, 'HEAD'], cwd));
        return { commits, shallow };
    } catch {
        return { commits: [], shallow: true };
    }
}

async function fromGitHub({ env, fetcher }) {
    const owner = env.VERCEL_GIT_REPO_OWNER || REPOSITORY.owner;
    const repo = env.VERCEL_GIT_REPO_SLUG || REPOSITORY.repo;
    const ref = env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_GIT_COMMIT_REF;
    if (!ref) return [];
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(ref)}&per_page=100`;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'cells.garden-build' };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    try {
        const response = await fetcher(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!response.ok) return [];
        return parseGitHubCommits(await response.json());
    } catch {
        return [];
    }
}

function fromVercel(env, now) {
    const sha = env.VERCEL_GIT_COMMIT_SHA;
    const title = env.VERCEL_GIT_COMMIT_MESSAGE;
    return sha && title ? [{ sha, date: now.toISOString(), title, merge: false }] : [];
}

const runGit = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * The changelog for the commit being built: `{ branch, url, entries }`, where
 * `url` lists every commit on GitHub and `entries` is `cleanCommits` of the
 * best source available.
 */
export async function collectChangelog({ cwd = process.cwd(), env = process.env, run = runGit, fetcher = globalThis.fetch, now = new Date() } = {}) {
    let commits = [];
    let source = 'none';
    try {
        const git = fromGit({ cwd, run });
        commits = git.commits;
        if (commits.length) source = 'git';
        // A shallow or missing history on a build server: ask GitHub instead.
        if ((git.shallow || commits.length < 2) && (env.VERCEL || env.CI) && fetcher) {
            const remote = await fromGitHub({ env, fetcher });
            if (remote.length > commits.length) {
                commits = remote;
                source = 'github';
            }
        }
        if (!commits.length) {
            commits = fromVercel(env, now);
            if (commits.length) source = 'vercel';
        }
    } catch {
        commits = [];
        source = 'none';
    }
    let branch = env.VERCEL_GIT_COMMIT_REF || '';
    if (!branch) {
        try { branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim(); } catch { branch = ''; }
    }
    if (branch === 'HEAD') branch = '';
    const url = `https://github.com/${REPOSITORY.owner}/${REPOSITORY.repo}/commits/${encodeURIComponent(branch || 'main')}`;
    return { branch, url, source, entries: cleanCommits(commits) };
}

/** A Vite plugin serving the changelog as `virtual:changelog`. */
export function changelogPlugin(options = {}) {
    const id = 'virtual:changelog';
    const resolved = '\0' + id;
    return {
        name: 'cells-changelog',
        resolveId(source) {
            return source === id ? resolved : null;
        },
        async load(source) {
            if (source !== resolved) return null;
            const { branch, url, entries } = await collectChangelog(options);
            return `export default ${JSON.stringify({ branch, url, entries })};`;
        },
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const changelog = await collectChangelog();
    console.log(JSON.stringify({ ...changelog, entries: changelog.entries.slice(0, 10), total: changelog.entries.length }, null, 2));
}
