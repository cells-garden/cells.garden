import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_KEY = 'WJgKfsKcxUpuNkDvxI9gEx';
const ROOT = process.cwd();
const MAP = resolve(ROOT, 'design/asset-map.json');
const ASSETS = resolve(ROOT, 'src/core/assets.ts');
const MAPPER = resolve(ROOT, 'scripts/map-design-assets.mjs');

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(message); };

function walk(node, result = []) {
    result.push(node);
    for (const child of node.children || []) walk(child, result);
    return result;
}

export function discoverReadyPlants(file, index, existingFolders = []) {
    const pages = file.document?.children || [];
    const page = pages.find(node => node.id === '27:1966' || node.name === 'ASSETS');
    need(page, 'Figma ASSETS page not found.');
    const exportSection = walk(page).find(node => node.id === '186:410' || node.name === 'EXPORTS');
    need(exportSection, 'Figma EXPORTS section not found.');
    const exports = new Map(walk(exportSection).map(node => [node.name, node]));
    const existing = new Set([...existingFolders, ...index.assets.map(asset => /^src\/assets\/pack\/(plant_\d+)\//.exec(asset.path)?.[1]).filter(Boolean)]);
    const nextNumber = Math.max(0, ...[...existing].map(name => Number(/^plant_(\d+)$/.exec(name)?.[1] || 0))) + 1;
    const registered = new Set(index.assets.map(asset => asset.sourceNodeId).filter(Boolean));
    const families = walk(page).filter(node => (node.type === 'FRAME' || node.type === 'COMPONENT_SET')
        && /^Source\/Plants\//.test(node.name || '') && node.devStatus?.type === 'READY_FOR_DEV').filter(family => {
        const components = (family.children || []).filter(node => node.type === 'COMPONENT');
        const count = components.filter(component => registered.has(component.id)).length;
        need(count === 0 || count === components.length, `Partially imported plant family: ${family.name}`);
        return count !== components.length || !components.length;
    });
    return families.map((family, offset) => {
        const displayName = family.name.slice('Source/Plants/'.length).trim();
        need(displayName && !/[\\/:*?"<>|]/.test(displayName), `Invalid plant family name: ${family.name}`);
        const components = (family.children || []).filter(node => node.type === 'COMPONENT');
        const parts = components.map(source => {
            const match = /^Part=(Stem|Flowers), Variant=(stem\d+|flower\d+)$/.exec(source.name || '');
            need(match, `Unexpected plant component name: ${source.name}`);
            const [, group, variant] = match;
            const category = group === 'Stem' ? 'stem' : 'flowers';
            const expectedPrefix = category === 'stem' ? 'stem' : 'flower';
            need(variant.startsWith(expectedPrefix), `Variant/category mismatch: ${source.name}`);
            const path = `src/assets/pack/plant_${nextNumber + offset}/${category}/${variant}.png`;
            const exported = exports.get(path);
            need(exported, `Missing linked EXPORTS instance: ${path}`);
            need(exported.type === 'INSTANCE' && exported.componentId === source.id, `EXPORTS instance does not reference ${source.name}: ${path}`);
            need(exported.width === source.width && exported.height === source.height && source.width > 0 && source.height > 0,
                `Native dimensions differ for ${path}`);
            return { path, category, variant, sourceNodeId: source.id, sourceName: source.name, width: source.width, height: source.height, exportNodeId: exported.id };
        });
        need(parts.some(part => part.category === 'stem') && parts.some(part => part.category === 'flowers'),
            `Plant family must contain at least one stem and one flower: ${displayName}`);
        need(new Set(parts.map(part => part.path)).size === parts.length, `Duplicate sprite path in ${displayName}`);
        for (const part of parts) need(!index.assets.some(asset => asset.path === part.path), `Asset path already registered: ${part.path}`);
        return { plantType: `plant_${nextNumber + offset}`, displayName, familyNodeId: family.id, parts };
    });
}

export async function importReadyPlants({ token, fileKey = FILE_KEY, root = ROOT, fetcher = fetch }) {
    need(token, 'FIGMA_TOKEN is required.');
    const headers = { 'X-Figma-Token': token };
    const response = await fetcher(`https://api.figma.com/v1/files/${fileKey}`, { headers });
    need(response.ok, `Figma file request failed: HTTP ${response.status}`);
    const file = await response.json();
    const indexPath = resolve(root, 'design/asset-map.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const folders = (await import('node:fs')).readdirSync(resolve(root, 'src/assets/pack'), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && /^plant_\d+$/.test(entry.name)).map(entry => entry.name);
    const families = discoverReadyPlants(file, index, folders);
    if (!families.length) return { imported: [], unchanged: true };
    const parts = families.flatMap(family => family.parts);
    const imageResponse = await fetcher(`https://api.figma.com/v1/images/${fileKey}?ids=${parts.map(part => encodeURIComponent(part.exportNodeId)).join(',')}&format=png&scale=1`, { headers });
    need(imageResponse.ok, `Figma image export failed: HTTP ${imageResponse.status}`);
    const imageData = await imageResponse.json();
    const additions = [];
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
            exportName: part.path, figmaSha256: null, evidence: null, figmaImageSha1: null,
        };
        additions.push({ ...part, bytes, entry });
    }
    const map = JSON.parse(JSON.stringify(index));
    map.assets.push(...additions.map(item => item.entry));
    map.assets.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
    const sourcePath = resolve(root, 'src/core/assets.ts');
    let source = readFileSync(sourcePath, 'utf8');
    const mapperPath = resolve(root, 'scripts/map-design-assets.mjs');
    let mapper = readFileSync(mapperPath, 'utf8');
    const names = families.map(family => {
        need(!source.includes(`${family.plantType}:`) && !mapper.includes(`${family.plantType}:`), `Plant type name already exists: ${family.plantType}`);
        return { ...family, escaped: family.displayName.replaceAll("'", "\\'") };
    });
    const sourcePattern = /(\r?\n)(};\r?\n\r?\n\/\*\* A plant type's name\.)/;
    const mapperPattern = /(const PLANTS = \{[^\r\n]*?)(\s*};)/;
    need(sourcePattern.test(source) && mapperPattern.test(mapper), 'Could not locate both plant-name registries.');
    source = source.replace(sourcePattern, (_, eol, tail) => `${eol}${names.map(family => `    ${family.plantType}: '${family.escaped}',`).join(eol)}${eol}${tail}`);
    mapper = mapper.replace(mapperPattern, (_, list, tail) => `${list}, ${names.map(family => `${family.plantType}: '${family.escaped}'`).join(', ')}${tail}`);
    for (const item of additions) {
        const target = resolve(root, item.path);
        mkdirSync(dirname(target), { recursive: true });
        need(!existsSync(target), `Refusing to overwrite existing asset: ${item.path}`);
        writeFileSync(target, item.bytes, { flag: 'wx' });
    }
    writeFileSync(indexPath, JSON.stringify(map, null, 2) + '\n');
    writeFileSync(sourcePath, source);
    writeFileSync(mapperPath, mapper);
    return { imported: families.map(family => ({ plantType: family.plantType, name: family.displayName, sprites: family.parts.length })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const result = await importReadyPlants({ token: process.env.FIGMA_TOKEN });
        console.log(JSON.stringify(result));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

