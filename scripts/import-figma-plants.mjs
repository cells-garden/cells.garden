import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_KEY = 'WJgKfsKcxUpuNkDvxI9gEx';
const ROOT = process.cwd();

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(message); };

function walk(node, result = []) {
    result.push(node);
    for (const child of node.children || []) walk(child, result);
    return result;
}

/** "Part=Stem, Variant=stem1" in either property order, as Figma names variants after the set's property order. */
function variantProps(name) {
    const pairs = name.split(',').map(pair => /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(pair));
    if (pairs.some(pair => !pair)) return null;
    const props = Object.fromEntries(pairs.map(pair => [pair[1], pair[2]]));
    const part = /^(Stem|Flowers?)$/i.exec(props.Part || '');
    const variant = /^(stem|flower)_?(\d+)$/i.exec(props.Variant || '');
    return part && variant ? {
        category: /^Stem$/i.test(part[1]) ? 'stem' : 'flowers',
        variant: `${variant[1].toLowerCase()}${Number(variant[2])}`,
    } : null;
}

function plantParts(family) {
    const parts = [];
    for (const child of family.children || []) {
        const named = child.type === 'COMPONENT' ? variantProps(child.name || '') : null;
        if (named) {
            parts.push({ source: child, ...named });
            continue;
        }
        const group = /^(Stem|Flowers?)$/i.exec(child.name || '');
        if (!group) continue;
        const category = /^Stem$/i.test(group[1]) ? 'stem' : 'flowers';
        for (const source of walk(child).slice(1)) {
            const match = /^(stem|flower)(\d+)(?: \d+)?$/i.exec(source.name || '');
            if (!match) continue;
            const variantCategory = match[1].toLowerCase() === 'stem' ? 'stem' : 'flowers';
            need(variantCategory === category, `Sprite ${source.name} is in the wrong group: ${family.name}`);
            parts.push({ source, category, variant: `${match[1].toLowerCase()}${Number(match[2])}` });
        }
    }
    return parts;
}

/**
 * A node's size in Figma's pixels. Figma's file API gives it as the node's
 * absoluteBoundingBox (or its size, with geometry asked for); the plugin API,
 * and this script's tests, as width and height. A float a hair off a whole
 * pixel (37.00000762939453) is that pixel.
 */
export function nativeSize(node) {
    const pick = (...values) => values.find(value => typeof value === 'number' && Number.isFinite(value));
    const whole = (value) => (value !== undefined && Math.abs(value - Math.round(value)) < 0.01 ? Math.round(value) : value);
    return {
        width: whole(pick(node?.width, node?.size?.x, node?.absoluteBoundingBox?.width)),
        height: whole(pick(node?.height, node?.size?.y, node?.absoluteBoundingBox?.height)),
    };
}

/** A plant's name as names are compared: one space between words, any case. */
const plantKey = (name) => String(name).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The plant names asked for by hand ("Leafy, Fern"): a family named
 * Source/Plants/<one of these> is imported whether it is marked Ready for dev
 * in Figma or not. Case and extra spaces do not matter.
 */
export function wantedPlants(text = '') {
    return new Set(String(text ?? '').split(',').map(plantKey).filter(Boolean));
}

/** A sprite's variant as variants are compared: "Stem_1", "stem1" and "STEM 1" are one. */
const variantKey = (name) => String(name).toLowerCase().replace(/\.png$/, '').replace(/[^a-z0-9]/g, '');

/** The plant type a pack path belongs to: "src/assets/pack/plant_9/stem/Stem_1.png" -> "plant_9". */
const typeOfPath = (path) => /^src\/assets\/pack\/(plant_\d+)\//.exec(path)?.[1];

/**
 * The plant names the app shows, read from src/core/assets.ts's
 * PLANT_TYPE_NAMES: { plant_9: 'Plume', ... }.
 */
export function plantRegistry(source) {
    const start = source.indexOf('export const PLANT_TYPE_NAMES');
    const end = source.indexOf('\n};', start);
    if (start === -1 || end === -1) return {};
    const registry = {};
    for (const [, type, name] of source.slice(start, end).matchAll(/^\s*(plant_\d+): '((?:[^'\\]|\\.)*)',/gm)) {
        registry[type] = name.replace(/\\(.)/g, '$1');
    }
    return registry;
}

/**
 * What the plant families on the ASSETS page ask of the garden. A family is
 * looked at when it is marked Ready for dev in Figma, or named in `wanted`
 * (wantedPlants) by whoever ran the import by hand. Each gives one plan:
 *
 * - `new`: no sprite of it is in the garden and no plant has its name. It
 *   becomes the next plant type, with every sprite it has.
 * - `update`: it is a plant the garden has, found by a sprite already taken
 *   from it or, failing that, by its name (`registry`, from plantRegistry).
 *   Its sprites the garden does not have yet come in: a sprite drawn again in
 *   place of an old one (same part, same variant, "Stem1" for "Stem_1")
 *   replaces that file, so every plant already showing it shows the new
 *   drawing; any other is added. A family renamed in Figma renames the plant.
 *
 * A family whose sprites are all in the garden under its own name asks
 * nothing. Removing a variant in Figma removes nothing from the garden.
 */
export function discoverReadyPlants(file, index, existingFolders = [], wanted = new Set(), registry = {}) {
    const pages = file.document?.children || [];
    const page = pages.find(node => node.id === '27:1966' || node.name === 'ASSETS');
    need(page, 'Figma ASSETS page not found.');
    const exportSection = walk(page).find(node => node.id === '186:410' || node.name === 'EXPORTS');
    const exports = new Map(exportSection ? walk(exportSection).map(node => [node.name, node]) : []);
    const existing = new Set([...existingFolders, ...index.assets.map(asset => typeOfPath(asset.path)).filter(Boolean), ...Object.keys(registry)]);
    let nextNumber = Math.max(0, ...[...existing].map(name => Number(/^plant_(\d+)$/.exec(name)?.[1] || 0))) + 1;
    const sourceType = new Map(index.assets.filter(asset => asset.sourceNodeId && typeOfPath(asset.path)).map(asset => [asset.sourceNodeId, typeOfPath(asset.path)]));
    const typeByName = new Map(Object.entries(registry).map(([type, name]) => [plantKey(name), type]));
    const families = walk(page).filter(node => (node.type === 'FRAME' || node.type === 'COMPONENT_SET')
        && /^Source\/Plants\//.test(node.name || '')
        && (node.devStatus?.type === 'READY_FOR_DEV' || wanted.has(plantKey(node.name.slice('Source/Plants/'.length)))));

    const plans = [];
    const claimed = new Set();
    for (const family of families) {
        const displayName = family.name.slice('Source/Plants/'.length).trim();
        need(displayName && !/[\\/:*?"<>|]/.test(displayName), `Invalid plant family name: ${family.name}`);
        const sources = plantParts(family);
        const mappedTypes = new Set(sources.map(part => sourceType.get(part.source.id)).filter(Boolean));
        need(mappedTypes.size <= 1, `Plant family ${family.name} has sprites in more than one plant type: ${[...mappedTypes].join(', ')}`);
        const known = [...mappedTypes][0] ?? typeByName.get(plantKey(displayName));
        const plantType = known ?? `plant_${nextNumber}`;
        need(!claimed.has(plantType), `Two plant families in Figma are both ${registry[plantType] ?? displayName} (${plantType})`);
        const fresh = sources.filter(part => !sourceType.has(part.source.id));
        const rename = known && registry[known] !== undefined && registry[known] !== displayName ? { from: registry[known], to: displayName } : null;
        if (known && !fresh.length && !rename) continue;
        claimed.add(plantType);

        // An update draws over the plant's own files where a variant matches, so cells keep their paths.
        const own = known ? index.assets.filter(asset => typeOfPath(asset.path) === known) : [];
        const parts = fresh.map(({ source, category, variant }) => {
            const folder = `src/assets/pack/${plantType}/${category}/`;
            const match = own.find(asset => asset.path.startsWith(folder) && variantKey(asset.path.slice(folder.length)) === variantKey(variant));
            const path = match ? match.path : `${folder}${variant}.png`;
            // A drawing replaced in Figma leaves its EXPORTS copy on the old component: that copy is passed over.
            const listed = exports.get(path);
            const exported = match && listed?.componentId !== source.id ? undefined : listed;
            const size = nativeSize(source);
            if (exported) {
                const exportedSize = nativeSize(exported);
                need(exported.type === 'INSTANCE' && exported.componentId === source.id
                    && exportedSize.width === size.width && exportedSize.height === size.height,
                    `EXPORTS instance does not reference ${source.name} at its native size: ${path}`);
            }
            need(Number.isInteger(size.width) && Number.isInteger(size.height) && size.width > 0 && size.height > 0,
                `Invalid native dimensions for ${path}`);
            return { path, category, variant, replaces: Boolean(match), sourceNodeId: source.id, sourceName: source.name,
                width: size.width, height: size.height, exportNodeId: exported?.id ?? source.id,
                exportName: exported ? path : source.name };
        });
        need(new Set(parts.map(part => part.path)).size === parts.length, `Duplicate sprite path in ${displayName}`);
        if (known) {
            plans.push({ kind: 'update', plantType, displayName, familyNodeId: family.id, parts, rename });
            continue;
        }
        need(parts.some(part => part.category === 'stem') && parts.some(part => part.category === 'flowers'),
            `Plant family must contain at least one stem and one flower: ${displayName}`);
        for (const part of parts) need(!index.assets.some(asset => asset.path === part.path), `Asset path already registered: ${part.path}`);
        plans.push({ kind: 'new', plantType, displayName, familyNodeId: family.id, parts, rename: null });
        nextNumber++;
    }
    return plans;
}

/** "A", "A and B", "A, B and C". */
const listed = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/**
 * The commit title for what an import did, which the site's "What's new"
 * shows: "New plant: Parasol", "New drawing for Plume", "More of Leafy",
 * "Leafy is now Leaf", joined when one import does several.
 */
export function importTitle(imported = [], updated = []) {
    const phrases = [];
    const fresh = imported.map(plant => plant.name);
    if (fresh.length) phrases.push(fresh.length === 1 ? `New plant: ${fresh[0]}` : `New plants: ${listed(fresh)}`);
    for (const plant of updated) {
        if (plant.renamedFrom) phrases.push(`${plant.renamedFrom} is now ${plant.name}`);
        if (plant.redrawn) phrases.push(`New drawing for ${plant.name}`);
        else if (plant.added) phrases.push(`More of ${plant.name}`);
    }
    if (!phrases.length) return 'Import Figma plants marked Ready for dev';
    return phrases.map((phrase, i) => (i ? phrase[0].toLowerCase() + phrase.slice(1) : phrase)).join('; ');
}

export async function importReadyPlants({ token, fileKey = FILE_KEY, root = ROOT, fetcher = fetch, wanted = new Set() }) {
    need(token, 'FIGMA_TOKEN is required.');
    const headers = { 'X-Figma-Token': token };
    const response = await fetcher(`https://api.figma.com/v1/files/${fileKey}`, { headers });
    need(response.ok, `Figma file request failed: HTTP ${response.status}`);
    const file = await response.json();
    const indexPath = resolve(root, 'design/asset-map.json');
    const indexText = readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexText);
    const sourcePath = resolve(root, 'src/core/assets.ts');
    let source = readFileSync(sourcePath, 'utf8');
    const mapperPath = resolve(root, 'scripts/map-design-assets.mjs');
    let mapper = readFileSync(mapperPath, 'utf8');
    const folders = (await import('node:fs')).readdirSync(resolve(root, 'src/assets/pack'), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^plant_\d+$/.test(entry.name)).map(entry => entry.name);
    const plans = discoverReadyPlants(file, index, folders, wanted, plantRegistry(source));
    if (!plans.length) return { imported: [], updated: [], unchanged: true };

    const parts = plans.flatMap(plan => plan.parts);
    const sprites = [];
    if (parts.length) {
        const imageResponse = await fetcher(`https://api.figma.com/v1/images/${fileKey}?ids=${parts.map(part => encodeURIComponent(part.exportNodeId)).join(',')}&format=png&scale=1`, { headers });
        need(imageResponse.ok, `Figma image export failed: HTTP ${imageResponse.status}`);
        const imageData = await imageResponse.json();
        for (const part of parts) {
            const url = imageData.images?.[part.exportNodeId];
            need(url, `Figma returned no PNG for ${part.path}`);
            const pngResponse = await fetcher(url);
            need(pngResponse.ok, `PNG download failed for ${part.path}: HTTP ${pngResponse.status}`);
            const bytes = Buffer.from(await pngResponse.arrayBuffer());
            need(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), `Invalid PNG: ${part.path}`);
            need(bytes.readUInt32BE(16) === part.width && bytes.readUInt32BE(20) === part.height, `PNG dimensions mismatch: ${part.path}`);
            const entry = {
                path: part.path, format: 'png', width: part.width, height: part.height, sha256: sha256(bytes),
                status: 'unverified', sourceNodeId: part.sourceNodeId, sourceName: part.sourceName,
                sourceWidth: part.width, sourceHeight: part.height, exportNodeId: part.exportNodeId,
                exportName: part.exportName, figmaSha256: null, evidence: null, figmaImageSha1: null,
            };
            sprites.push({ ...part, bytes, entry });
        }
    }

    const map = JSON.parse(JSON.stringify(index));
    const replaced = new Map(sprites.filter(sprite => sprite.replaces).map(sprite => [sprite.path, sprite.entry]));
    map.assets = map.assets.map(asset => replaced.get(asset.path) ?? asset);
    map.assets.push(...sprites.filter(sprite => !sprite.replaces).map(sprite => sprite.entry));
    map.assets.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
    const sections = /^([\s\S]*?"assets": \[\r?\n)[\s\S]*?(  \]\r?\n\}\r?\n?)$/.exec(indexText);
    need(sections, 'Unexpected asset index format.');
    const newline = indexText.includes('\r\n') ? '\r\n' : '\n';
    const updatedIndex = sections[1] + map.assets.map(asset => '    ' + JSON.stringify(asset)).join(',' + newline) + newline + sections[2];

    const escape = (name) => name.replaceAll("'", "\\'");
    const added = plans.filter(plan => plan.kind === 'new');
    for (const plan of added) {
        need(!source.includes(`${plan.plantType}:`) && !mapper.includes(`${plan.plantType}:`), `Plant type name already exists: ${plan.plantType}`);
    }
    const registryStart = source.indexOf('export const PLANT_TYPE_NAMES');
    const registryEnd = source.indexOf('\n};', registryStart);
    const mapperLine = mapper.split(/\r?\n/).find(line => line.startsWith('const PLANTS = {'));
    need(registryStart !== -1 && registryEnd > registryStart && mapperLine?.endsWith(' };'), 'Could not find both plant-name registries.');
    let line = mapperLine;
    for (const plan of plans.filter(plan => plan.rename)) {
        const from = `${plan.plantType}: '${escape(plan.rename.from)}'`;
        const to = `${plan.plantType}: '${escape(plan.rename.to)}'`;
        need(source.includes(from) && line.includes(from), `Could not rename ${plan.plantType} in both plant-name registries.`);
        source = source.replace(from, to);
        line = line.replace(from, to);
    }
    if (added.length) {
        const end = source.indexOf('\n};', source.indexOf('export const PLANT_TYPE_NAMES'));
        const sourceNewline = source.includes('\r\n') ? '\r\n' : '\n';
        source = source.slice(0, end + 1) + added.map(plan => `    ${plan.plantType}: '${escape(plan.displayName)}',`).join(sourceNewline) + sourceNewline + source.slice(end + 1);
        const closing = line.lastIndexOf(' }');
        line = line.slice(0, closing) + ', ' + added.map(plan => `${plan.plantType}: '${escape(plan.displayName)}'`).join(', ') + line.slice(closing);
    }
    mapper = mapper.replace(mapperLine, line);

    for (const sprite of sprites) {
        const target = resolve(root, sprite.path);
        mkdirSync(dirname(target), { recursive: true });
        if (sprite.replaces) {
            need(existsSync(target), `A redrawn sprite has no file to replace: ${sprite.path}`);
            writeFileSync(target, sprite.bytes);
        } else {
            need(!existsSync(target), `Refusing to overwrite existing asset: ${sprite.path}`);
            writeFileSync(target, sprite.bytes, { flag: 'wx' });
        }
    }
    writeFileSync(indexPath, updatedIndex);
    writeFileSync(sourcePath, source);
    writeFileSync(mapperPath, mapper);
    const imported = added.map(plan => ({ plantType: plan.plantType, name: plan.displayName, sprites: plan.parts.length }));
    const updated = plans.filter(plan => plan.kind === 'update').map(plan => ({
        plantType: plan.plantType, name: plan.displayName,
        redrawn: plan.parts.filter(part => part.replaces).length,
        added: plan.parts.filter(part => !part.replaces).length,
        ...(plan.rename ? { renamedFrom: plan.rename.from } : {}),
    }));
    return { imported, updated, title: importTitle(imported, updated) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        // FIGMA_PLANTS: the names typed into "Run workflow", imported even when not marked Ready for dev.
        const result = await importReadyPlants({ token: process.env.FIGMA_TOKEN, wanted: wantedPlants(process.env.FIGMA_PLANTS) });
        console.log(JSON.stringify(result));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

