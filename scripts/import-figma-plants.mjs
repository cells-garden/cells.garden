import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const FILE_KEY = 'WJgKfsKcxUpuNkDvxI9gEx';
const ROOT = process.cwd();

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(message); };
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * A PNG's pixels as RGBA, one byte each, for comparing two drawings rather
 * than two encodings of one: Figma does not promise the same bytes for the
 * same picture. Fully transparent pixels count as transparent black, whatever
 * colour they carry. Null for what this does not read (not 8 bits per
 * channel, interlaced, or broken); compare bytes then.
 */
export function pngPixels(bytes) {
    try {
        if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
        let pos = 8, width = 0, height = 0, depth = 0, type = -1, interlace = 0, palette = null, alphas = null;
        const data = [];
        while (pos + 8 <= bytes.length) {
            const length = bytes.readUInt32BE(pos);
            const kind = bytes.toString('ascii', pos + 4, pos + 8);
            const chunk = bytes.subarray(pos + 8, pos + 8 + length);
            pos += 12 + length;
            if (kind === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; type = chunk[9]; interlace = chunk[12]; }
            else if (kind === 'PLTE') palette = chunk;
            else if (kind === 'tRNS') alphas = chunk;
            else if (kind === 'IDAT') data.push(chunk);
            else if (kind === 'IEND') break;
        }
        const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
        if (depth !== 8 || interlace !== 0 || !channels || !width || !height || (type === 3 && !palette)) return null;
        const raw = inflateSync(Buffer.concat(data));
        const stride = width * channels;
        if (raw.length < height * (stride + 1)) return null;
        const rgba = new Uint8Array(width * height * 4);
        let previous = new Uint8Array(stride);
        for (let y = 0; y < height; y++) {
            const filter = raw[y * (stride + 1)];
            const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
            const row = new Uint8Array(stride);
            for (let x = 0; x < stride; x++) {
                const a = x >= channels ? row[x - channels] : 0;
                const b = previous[x];
                const c = x >= channels ? previous[x - channels] : 0;
                let value = line[x];
                if (filter === 1) value += a;
                else if (filter === 2) value += b;
                else if (filter === 3) value += (a + b) >> 1;
                else if (filter === 4) {
                    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                }
                row[x] = value & 255;
            }
            for (let x = 0; x < width; x++) {
                const i = x * channels;
                let r, g, b, alpha = 255;
                if (type === 6) [r, g, b, alpha] = [row[i], row[i + 1], row[i + 2], row[i + 3]];
                else if (type === 2) [r, g, b] = [row[i], row[i + 1], row[i + 2]];
                else if (type === 4) [r, g, b, alpha] = [row[i], row[i], row[i], row[i + 1]];
                else if (type === 0) r = g = b = row[i];
                else {
                    const k = row[i];
                    [r, g, b] = [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]];
                    alpha = alphas && k < alphas.length ? alphas[k] : 255;
                }
                const o = (y * width + x) * 4;
                if (alpha === 0) r = g = b = 0;
                rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = alpha;
            }
            previous = row;
        }
        return { width, height, rgba };
    } catch {
        return null;
    }
}

/**
 * Whether two PNGs show the same picture (pngPixels), else whether they are
 * the same bytes. Figma's renderer rounds the colour of a nearly transparent
 * pixel differently from one export to the next (a pixel at alpha 9 came back
 * 28 levels bluer), so pixels are compared as they look: alpha within one
 * level, and each colour times its alpha within one and a half levels. Any
 * change a person could see is still a change.
 */
export function samePicture(a, b) {
    const one = pngPixels(a);
    const other = pngPixels(b);
    if (!one || !other) return sha256(a) === sha256(b);
    if (one.width !== other.width || one.height !== other.height) return false;
    const x = one.rgba, y = other.rgba;
    for (let i = 0; i < x.length; i += 4) {
        if (Math.abs(x[i + 3] - y[i + 3]) > 1) return false;
        for (let k = 0; k < 3; k++) {
            if (Math.abs(x[i + k] * x[i + 3] - y[i + k] * y[i + 3]) > 255 * 1.5) return false;
        }
    }
    return true;
}

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
 * Given a `skipped` list, a family that cannot come in is noted there, with
 * why, instead of stopping every other family.
 */
export function discoverReadyPlants(file, index, existingFolders = [], wanted = new Set(), registry = {}, skipped = null) {
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
        try {
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
        } catch (error) {
            if (!skipped) throw error;
            skipped.push({ plant: family.name.slice('Source/Plants/'.length).trim(), reason: error.message });
        }
    }
    return plans;
}

/**
 * The sprites of the families looked at (marked Ready for dev, or `wanted`)
 * that the garden already has, each with the file it has them in. Their
 * pictures are compared with Figma's on every run, so a drawing changed in
 * place, in the same component, still reaches the garden.
 */
export function keptSprites(file, index, wanted = new Set()) {
    const page = (file.document?.children || []).find(node => node.id === '27:1966' || node.name === 'ASSETS');
    if (!page) return [];
    const bySource = new Map(index.assets.filter(asset => asset.sourceNodeId && typeOfPath(asset.path)).map(asset => [asset.sourceNodeId, asset]));
    const kept = [];
    for (const family of walk(page)) {
        if (!(family.type === 'FRAME' || family.type === 'COMPONENT_SET') || !/^Source\/Plants\//.test(family.name || '')) continue;
        const displayName = family.name.slice('Source/Plants/'.length).trim();
        if (family.devStatus?.type !== 'READY_FOR_DEV' && !wanted.has(plantKey(displayName))) continue;
        for (const { source, category, variant } of plantParts(family)) {
            const asset = bySource.get(source.id);
            if (!asset) continue;
            const size = nativeSize(source);
            if (!(Number.isInteger(size.width) && Number.isInteger(size.height) && size.width > 0 && size.height > 0)) continue;
            kept.push({ plantType: typeOfPath(asset.path), displayName, familyNodeId: family.id, path: asset.path, category, variant,
                replaces: true, sourceNodeId: source.id, sourceName: source.name, width: size.width, height: size.height,
                exportNodeId: source.id, exportName: source.name });
        }
    }
    return kept;
}

/**
 * Figma's PNGs of these sprites at their own size, checked, by exportNodeId.
 * Asked for a few dozen at a time. A sprite Figma does not draw at its
 * component's size (say, a drawing moved outside its frame) is left out and
 * noted in `skipped`, so the others still come in.
 */
async function renderSprites(sprites, { fileKey, headers, fetcher }, skipped) {
    const pictures = new Map();
    for (let start = 0; start < sprites.length; start += 50) {
        const batch = sprites.slice(start, start + 50);
        const ids = [...new Set(batch.map(sprite => sprite.exportNodeId))];
        const imageResponse = await fetcher(`https://api.figma.com/v1/images/${fileKey}?ids=${ids.map(id => encodeURIComponent(id)).join(',')}&format=png&scale=1`, { headers });
        need(imageResponse.ok, `Figma image export failed: HTTP ${imageResponse.status}`);
        const imageData = await imageResponse.json();
        for (const sprite of batch) {
            if (pictures.has(sprite.exportNodeId)) continue;
            try {
                const url = imageData.images?.[sprite.exportNodeId];
                need(url, 'Figma returned no PNG; is the component empty or hidden?');
                const pngResponse = await fetcher(url);
                need(pngResponse.ok, `PNG download failed: HTTP ${pngResponse.status}`);
                const bytes = Buffer.from(await pngResponse.arrayBuffer());
                need(bytes.length >= 45 && bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'Figma sent an invalid PNG');
                const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
                need(width === sprite.width && height === sprite.height,
                    `Figma draws it ${width}×${height} but its component is ${sprite.width}×${sprite.height}; keep the drawing inside the component's frame`);
                pictures.set(sprite.exportNodeId, bytes);
            } catch (error) {
                skipped.push({ plant: sprite.displayName, sprite: sprite.sourceName, path: sprite.path, reason: error.message });
            }
        }
    }
    return pictures;
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

/**
 * Import what Figma asks for (discoverReadyPlants), and any sprite the garden
 * has whose picture Figma now draws differently (keptSprites, compareKept).
 * With `dryRun` nothing is written: the result says what would change.
 */
export async function importReadyPlants({ token, fileKey = FILE_KEY, root = ROOT, fetcher = fetch, wanted = new Set(), compareKept = true, dryRun = false }) {
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
    const skipped = [];
    const report = (result) => (skipped.length ? { ...result, skipped } : result);
    let plans = discoverReadyPlants(file, index, folders, wanted, plantRegistry(source), skipped);

    // Drawings changed in place: the same components, other pixels.
    const kept = compareKept ? keptSprites(file, index, wanted) : [];
    const pictures = await renderSprites(kept, { fileKey, headers, fetcher }, skipped);
    for (const sprite of kept) {
        const current = resolve(root, sprite.path);
        const picture = pictures.get(sprite.exportNodeId);
        if (!picture || (existsSync(current) && samePicture(picture, readFileSync(current)))) continue;
        let plan = plans.find(candidate => candidate.plantType === sprite.plantType);
        if (!plan) {
            plan = { kind: 'update', plantType: sprite.plantType, displayName: sprite.displayName, familyNodeId: sprite.familyNodeId, parts: [], rename: null };
            plans.push(plan);
        }
        if (plan.parts.some(part => part.path === sprite.path)) continue;
        plan.parts.push({ ...sprite, bytes: picture });
    }

    const rendered = await renderSprites(plans.flatMap(plan => plan.parts.filter(part => !part.bytes).map(part => ({ ...part, displayName: plan.displayName }))),
        { fileKey, headers, fetcher }, skipped);
    plans = plans.map(plan => ({ ...plan, parts: plan.parts.filter(part => part.bytes || rendered.has(part.exportNodeId)) })).filter(plan => {
        if (plan.kind === 'new' && !(plan.parts.some(part => part.category === 'stem') && plan.parts.some(part => part.category === 'flowers'))) {
            skipped.push({ plant: plan.displayName, reason: 'Not added yet: it needs at least one stem and one flower that Figma can draw' });
            return false;
        }
        return plan.parts.length || plan.rename;
    });
    if (!plans.length) return report({ imported: [], updated: [], unchanged: true, checked: kept.length });

    const parts = plans.flatMap(plan => plan.parts);
    const sprites = [];
    if (parts.length) {
        for (const part of parts) {
            const bytes = part.bytes ?? rendered.get(part.exportNodeId);
            need(bytes, `Figma returned no PNG for ${part.path}`);
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

    const imported = added.map(plan => ({ plantType: plan.plantType, name: plan.displayName, sprites: plan.parts.length }));
    const updated = plans.filter(plan => plan.kind === 'update').map(plan => ({
        plantType: plan.plantType, name: plan.displayName,
        redrawn: plan.parts.filter(part => part.replaces).length,
        added: plan.parts.filter(part => !part.replaces).length,
        ...(plan.rename ? { renamedFrom: plan.rename.from } : {}),
    }));
    const changes = sprites.map(sprite => `${sprite.replaces ? 'redrawn' : 'new'} ${sprite.path}`);
    if (dryRun) return report({ dryRun: true, imported, updated, title: importTitle(imported, updated), changes, checked: kept.length });

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
    return report({ imported, updated, title: importTitle(imported, updated), changes, checked: kept.length });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        // FIGMA_PLANTS: the names typed into "Run workflow", imported even when not marked Ready for dev.
        // FIGMA_DRY_RUN: report what would change, write nothing.
        const result = await importReadyPlants({
            token: process.env.FIGMA_TOKEN,
            wanted: wantedPlants(process.env.FIGMA_PLANTS),
            dryRun: /^(1|true|yes)$/i.test(process.env.FIGMA_DRY_RUN ?? ''),
        });
        console.log(JSON.stringify(result));
        for (const { plant, sprite, reason } of result.skipped ?? []) {
            console.error(`::warning::${plant}${sprite ? ` (${sprite})` : ''} was not imported from Figma: ${reason}`);
        }
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

