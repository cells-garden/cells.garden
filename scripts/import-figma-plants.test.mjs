import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverReadyPlants, importReadyPlants, importTitle, keptSprites, nativeSize, plantRegistry, pngPixels, samePicture, wantedPlants } from './import-figma-plants.mjs';
import { deflateSync } from 'node:zlib';

function fixture({ status = 'READY_FOR_DEV', flower = true, linked = true, plantNo = 10 } = {}) {
    const stem = { id: '10:1', type: 'COMPONENT', name: 'Part=Stem, Variant=stem1', width: 12, height: 8 };
    const bloom = { id: '10:2', type: 'COMPONENT', name: 'Part=Flowers, Variant=flower1', width: 10, height: 9 };
    const family = { id: '10:0', type: 'FRAME', name: 'Source/Plants/Fern', devStatus: status ? { type: status } : null, children: flower ? [stem, bloom] : [stem] };
    const exports = [
        { id: '20:1', type: 'INSTANCE', name: `src/assets/pack/plant_${plantNo}/stem/stem1.png`, componentId: linked ? stem.id : '99:99', width: 12, height: 8 },
        ...(flower ? [{ id: '20:2', type: 'INSTANCE', name: `src/assets/pack/plant_${plantNo}/flowers/flower1.png`, componentId: bloom.id, width: 10, height: 9 }] : []),
    ];
    return {
        document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family, { id: '186:410', name: 'EXPORTS', children: exports }] }] },
    };
}

const index = { assets: [] };

function looseFixture({ status = 'READY_FOR_DEV', flowers = true } = {}) {
    const stem1 = { id: '30:1', type: 'RECTANGLE', name: 'stem4 1', width: 37, height: 14 };
    const stem2 = { id: '30:2', type: 'RECTANGLE', name: 'stem3 1', width: 37, height: 14 };
    const flower = { id: '30:3', type: 'RECTANGLE', name: 'flower2 1', width: 21, height: 11 };
    const family = {
        id: '30:0', type: 'FRAME', name: 'Source/Plants/Leafy', devStatus: status ? { type: status } : null,
        children: [
            { id: '30:4', type: 'COMPONENT', name: 'Stem', children: [stem1, stem2] },
            ...(flowers ? [{ id: '30:5', type: 'COMPONENT', name: 'Flowers', children: [flower] }] : []),
        ],
    };
    return { document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family] }] } };
}

test('finds individual Figma image layers without EXPORTS copies', () => {
    const file = looseFixture();
    const parts = discoverReadyPlants(file, index, ['plant_9'])[0].parts;
    assert.deepEqual(parts.map(p => [p.path, p.sourceNodeId, p.exportNodeId]), [
        ['src/assets/pack/plant_10/stem/stem4.png', '30:1', '30:1'],
        ['src/assets/pack/plant_10/stem/stem3.png', '30:2', '30:2'],
        ['src/assets/pack/plant_10/flowers/flower2.png', '30:3', '30:3'],
    ]);
});

test('does not import incomplete or already imported loose artwork', () => {
    assert.deepEqual(discoverReadyPlants(looseFixture({ status: null, flowers: false }), index), []);
    assert.throws(() => discoverReadyPlants(looseFixture({ flowers: false }), index), /stem and one flower/);
    const published = { assets: [
        { path: 'src/assets/pack/plant_10/stem/stem4.png', sourceNodeId: '30:1' },
        { path: 'src/assets/pack/plant_10/stem/stem3.png', sourceNodeId: '30:2' },
        { path: 'src/assets/pack/plant_10/flowers/flower2.png', sourceNodeId: '30:3' },
    ] };
    assert.deepEqual(discoverReadyPlants(looseFixture(), published, ['plant_10'], new Set(), { plant_10: 'Leafy' }), []);
    // One sprite already in the garden: the rest join that plant instead of making another.
    const [more] = discoverReadyPlants(looseFixture(), { assets: [published.assets[0]] }, ['plant_10'], new Set(), { plant_10: 'Leafy' });
    assert.equal(more.kind, 'update');
    assert.deepEqual(more.parts.map(p => [p.path, p.replaces]), [
        ['src/assets/pack/plant_10/stem/stem3.png', false],
        ['src/assets/pack/plant_10/flowers/flower2.png', false],
    ]);
});

test('recognizes component sets and rejects duplicate sprite variants', () => {
    const file = looseFixture();
    const family = file.document.children[0].children[0];
    family.type = 'COMPONENT_SET';
    assert.equal(discoverReadyPlants(file, index, ['plant_9'])[0].displayName, 'Leafy');
    family.children[0].children.push({ id: '30:6', type: 'RECTANGLE', name: 'stem4 2', width: 37, height: 14 });
    assert.throws(() => discoverReadyPlants(file, index, ['plant_9']), /Duplicate sprite path/);
});

test('discovers only complete families marked Ready for dev', () => {
    const found = discoverReadyPlants(fixture(), index, ['plant_9']);
    assert.equal(found.length, 1);
    assert.equal(found[0].plantType, 'plant_10');
    assert.equal(found[0].displayName, 'Fern');
    assert.deepEqual(found[0].parts.map(part => part.path), [
        'src/assets/pack/plant_10/stem/stem1.png',
        'src/assets/pack/plant_10/flowers/flower1.png',
    ]);
});

test('discovers Ready-for-dev component set families', () => {
    const file = fixture();
    file.document.children[0].children[0].type = 'COMPONENT_SET';
    assert.equal(discoverReadyPlants(file, index, ['plant_9'])[0]?.plantType, 'plant_10');
});

test('reads component-set variants whatever the property order', () => {
    const variant = (id, name) => ({ id, type: 'COMPONENT', name, width: 37, height: 14 });
    const family = { id: '471:446', type: 'COMPONENT_SET', name: 'Source/Plants/Leafy', devStatus: { type: 'READY_FOR_DEV' }, children: [
        variant('469:441', 'Variant=stem2, Part=Stem'),
        variant('471:442', 'Variant=stem1, Part=Stem'),
        variant('471:466', 'Variant=flower1, Part=Flowers'),
        variant('471:467', 'Part=Flowers, Variant=flower2'),
    ] };
    const file = { document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family] }] } };
    const [found] = discoverReadyPlants(file, index, ['plant_9']);
    assert.equal(found.displayName, 'Leafy');
    assert.deepEqual(found.parts.map(part => [part.path, part.sourceNodeId]), [
        ['src/assets/pack/plant_10/stem/stem2.png', '469:441'],
        ['src/assets/pack/plant_10/stem/stem1.png', '471:442'],
        ['src/assets/pack/plant_10/flowers/flower1.png', '471:466'],
        ['src/assets/pack/plant_10/flowers/flower2.png', '471:467'],
    ]);
    family.devStatus = null;
    assert.deepEqual(discoverReadyPlants(file, index, ['plant_9']), []);
});

test('an already imported family with Stem_1/flower_1 variants is recognized, not rejected', () => {
    const variant = (id, name) => ({ id, type: 'COMPONENT', name, width: 39, height: 10 });
    const family = { id: '296:415', type: 'COMPONENT_SET', name: 'Source/Plants/Plume', devStatus: { type: 'READY_FOR_DEV' }, children: [
        variant('296:410', 'Part=Flowers, Variant=flower_1'),
        variant('296:412', 'Part=Stem, Variant=Stem_1'),
    ] };
    const file = { document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family] }] } };
    const published = { assets: [
        { path: 'src/assets/pack/plant_9/flowers/flower_1.png', sourceNodeId: '296:410' },
        { path: 'src/assets/pack/plant_9/stem/Stem_1.png', sourceNodeId: '296:412' },
    ] };
    assert.deepEqual(discoverReadyPlants(file, published, ['plant_9']), []);
});

test('ignores families without Ready for dev status', () => {
    assert.deepEqual(discoverReadyPlants(fixture({ status: null }), index, ['plant_9']), []);
});

test('reads sizes the way Figma\'s file API gives them', () => {
    assert.deepEqual(nativeSize({ absoluteBoundingBox: { x: 1, y: 2, width: 37.00000762939453, height: 14 } }), { width: 37, height: 14 });
    assert.deepEqual(nativeSize({ size: { x: 21, y: 11 } }), { width: 21, height: 11 });
    assert.deepEqual(nativeSize({ width: 12, height: 8 }), { width: 12, height: 8 });
    assert.equal(nativeSize({ absoluteBoundingBox: { width: 36.5, height: 14 } }).width, 36.5);
    assert.deepEqual(nativeSize({}), { width: undefined, height: undefined });
    // A family as the file API sends it: no width or height on the nodes themselves.
    const box = (id, name, width, height) => ({ id, type: 'COMPONENT', name, absoluteBoundingBox: { x: 0, y: 0, width, height } });
    const family = { id: '471:446', type: 'COMPONENT_SET', name: 'Source/Plants/Leafy', devStatus: null, children: [
        box('469:441', 'Variant=stem2, Part=Stem', 37, 14), box('471:466', 'Variant=flower1, Part=Flowers', 37.000003, 14),
    ] };
    const file = { document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family] }] } };
    const [found] = discoverReadyPlants(file, index, ['plant_9'], wantedPlants('Leafy'));
    assert.deepEqual(found.parts.map(p => [p.path, p.width, p.height]), [
        ['src/assets/pack/plant_10/stem/stem2.png', 37, 14],
        ['src/assets/pack/plant_10/flowers/flower1.png', 37, 14],
    ]);
});

test('a plant named by hand comes in without Ready for dev; others still need it', () => {
    assert.deepEqual([...wantedPlants(' fern,  Leafy  Two ,,')], ['fern', 'leafy two']);
    assert.deepEqual([...wantedPlants(undefined)], []);
    const found = discoverReadyPlants(fixture({ status: null }), index, ['plant_9'], wantedPlants('FERN'));
    assert.equal(found[0]?.displayName, 'Fern');
    assert.equal(found[0]?.plantType, 'plant_10');
    assert.deepEqual(discoverReadyPlants(fixture({ status: null }), index, ['plant_9'], wantedPlants('Birch')), []);
    // Already imported, it is not imported again however it is asked for.
    const published = { assets: [{ path: 'src/assets/pack/plant_10/stem/stem1.png', sourceNodeId: '10:1' }, { path: 'src/assets/pack/plant_10/flowers/flower1.png', sourceNodeId: '10:2' }] };
    assert.deepEqual(discoverReadyPlants(fixture({ status: null }), published, ['plant_10'], wantedPlants('Fern')), []);
});

test('rejects incomplete plant families', () => {
    assert.throws(() => discoverReadyPlants(fixture({ flower: false }), index, ['plant_9']), /stem and one flower/);
});

test('rejects export instances that point to another component', () => {
    assert.throws(() => discoverReadyPlants(fixture({ linked: false }), index, ['plant_9']), /does not reference/);
});

test('allocates the next unused plant number', () => {
    const next = discoverReadyPlants(fixture(), index, ['plant_1', 'plant_9']);
    assert.equal(next[0].plantType, 'plant_10');
});

test('allocates above the highest plant number in the asset index', () => {
    const prior = { assets: [{ path: 'src/assets/pack/plant_10/stem/stem1.png' }] };
    assert.equal(discoverReadyPlants(fixture({ plantNo: 11 }), prior)[0].plantType, 'plant_11');
});

test('imports a Ready-for-dev family, exports exact PNG bytes and updates both registries', async t => {
    const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { resolve, dirname } = await import('node:path');
    const { importReadyPlants } = await import('./import-figma-plants.mjs');
    const root = mkdtempSync(resolve(tmpdir(), 'garden-figma-import-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const sourceRoot = process.cwd();
    for (const path of ['design', 'src/core', 'scripts', 'src/assets/pack/plant_9/stem', 'src/assets/pack/plant_9/flowers']) mkdirSync(resolve(root, path), { recursive: true });
    // Pin the copied registries to plant_1–plant_9, so plants imported into the real repo later
    // (plant_10 Leafy onwards) do not collide with this fixture's plant_10 and plant_11.
    const pinRegistry = text => text
        .replace(/^[ \t]*plant_(\d+): '(?:[^'\\]|\\.)*',\r?\n/gm, (line, n) => Number(n) > 9 ? '' : line)
        .replace(/, plant_(\d+): '(?:[^'\\]|\\.)*'/g, (entry, n) => Number(n) > 9 ? '' : entry);
    for (const path of ['src/core/assets.ts', 'scripts/map-design-assets.mjs']) writeFileSync(resolve(root, path), pinRegistry(readFileSync(resolve(sourceRoot, path), 'utf8')));
    const stemBytes = readFileSync(resolve(sourceRoot, 'src/assets/pack/plant_9/stem/Stem_1.png'));
    const flowerBytes = readFileSync(resolve(sourceRoot, 'src/assets/pack/plant_9/flowers/flower_1.png'));
    const stem = { id: '10:1', type: 'COMPONENT', name: 'Part=Stem, Variant=stem1', width: stemBytes.readUInt32BE(16), height: stemBytes.readUInt32BE(20) };
    const flower = { id: '10:2', type: 'COMPONENT', name: 'Part=Flowers, Variant=flower1', width: flowerBytes.readUInt32BE(16), height: flowerBytes.readUInt32BE(20) };
    const family = { id: '10:0', type: 'FRAME', name: 'Source/Plants/Fern', devStatus: { type: 'READY_FOR_DEV' }, children: [stem, flower] };
    const file = { document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family, { id: '186:410', name: 'EXPORTS', children: [
        { id: '20:1', type: 'INSTANCE', name: 'src/assets/pack/plant_10/stem/stem1.png', componentId: stem.id, width: stem.width, height: stem.height },
        { id: '20:2', type: 'INSTANCE', name: 'src/assets/pack/plant_10/flowers/flower1.png', componentId: flower.id, width: flower.width, height: flower.height },
    ] }] }] } };
    const existing = { path: 'src/assets/pack/plant_9/stem/Stem_1.png', format: 'png', width: 39, height: 12, sha256: 'unchanged' };
    const existingRow = '    ' + JSON.stringify(existing);
    writeFileSync(resolve(root, 'design/asset-map.json'), '{\n  "assets": [\n' + existingRow + '\n  ]\n}\n');
    const replies = [
        { ok: true, json: async () => file },
        { ok: true, json: async () => ({ images: { '20:1': 'https://img/1', '20:2': 'https://img/2' } }) },
        { ok: true, arrayBuffer: async () => stemBytes.buffer.slice(stemBytes.byteOffset, stemBytes.byteOffset + stemBytes.byteLength) },
        { ok: true, arrayBuffer: async () => flowerBytes.buffer.slice(flowerBytes.byteOffset, flowerBytes.byteOffset + flowerBytes.byteLength) },
    ];
    const result = await importReadyPlants({ token: 'test-token', root, compareKept: false, fetcher: async () => replies.shift() });
    assert.deepEqual(result.imported, [{ plantType: 'plant_10', name: 'Fern', sprites: 2 }]);
    assert(existsSync(resolve(root, 'src/assets/pack/plant_10/stem/stem1.png')));
    assert.deepEqual(readFileSync(resolve(root, 'src/assets/pack/plant_10/stem/stem1.png')), stemBytes);
    const index = JSON.parse(readFileSync(resolve(root, 'design/asset-map.json')));
    assert.equal(index.assets.length, 3);
    assert(readFileSync(resolve(root, 'design/asset-map.json'), 'utf8').includes(existingRow));
    assert.match(readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8'), /plant_10: 'Fern'/);
    assert.match(readFileSync(resolve(root, 'scripts/map-design-assets.mjs'), 'utf8'), /plant_10: 'Fern'/);
    const nextFamily = { ...family, id: '11:0', name: 'Source/Plants/Birch', children: family.children.map(part => ({ ...part, id: part.id.replace('10:', '11:') })) };
    const page = file.document.children[0];
    page.children.push(nextFamily);
    page.children[1].children.push(
        { id: '21:1', type: 'INSTANCE', name: 'src/assets/pack/plant_11/stem/stem1.png', componentId: '11:1', width: stem.width, height: stem.height },
        { id: '21:2', type: 'INSTANCE', name: 'src/assets/pack/plant_11/flowers/flower1.png', componentId: '11:2', width: flower.width, height: flower.height },
    );
    const nextReplies = [
        { ok: true, json: async () => file },
        { ok: true, json: async () => ({ images: { '21:1': 'https://img/3', '21:2': 'https://img/4' } }) },
        { ok: true, arrayBuffer: async () => stemBytes.buffer.slice(stemBytes.byteOffset, stemBytes.byteOffset + stemBytes.byteLength) },
        { ok: true, arrayBuffer: async () => flowerBytes.buffer.slice(flowerBytes.byteOffset, flowerBytes.byteOffset + flowerBytes.byteLength) },
    ];
    const second = await importReadyPlants({ token: 'test-token', root, compareKept: false, fetcher: async () => nextReplies.shift() });
    assert.deepEqual(second.imported, [{ plantType: 'plant_11', name: 'Birch', sprites: 2 }]);
    assert.match(readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8'), /plant_11: 'Birch'/);
    assert.match(readFileSync(resolve(root, 'scripts/map-design-assets.mjs'), 'utf8'), /plant_11: 'Birch'/);
    assert.equal(JSON.parse(readFileSync(resolve(root, 'design/asset-map.json'))).assets.length, 5);
    const third = await importReadyPlants({ token: 'test-token', root, compareKept: false, fetcher: async () => ({ ok: true, json: async () => file }) });
    assert.deepEqual(third, { imported: [], updated: [], unchanged: true, checked: 0 });

    // Fern drawn again in Figma, in the same family with new components: its
    // files are drawn over where they are, and nothing is added to the registries.
    const redrawn = { ...family, children: family.children.map(part => ({ ...part, id: part.id.replace('10:', '12:'), name: part.name.replace('stem1', 'stem_1') })) };
    page.children[0] = redrawn;
    const before = readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8');
    const flowerAsStem = flowerBytes.buffer.slice(flowerBytes.byteOffset, flowerBytes.byteOffset + flowerBytes.byteLength);
    redrawn.children[0] = { ...redrawn.children[0], width: flower.width, height: flower.height };
    const redrawReplies = [
        { ok: true, json: async () => file },
        { ok: true, json: async () => ({ images: { '12:1': 'https://img/5', '12:2': 'https://img/6' } }) },
        { ok: true, arrayBuffer: async () => flowerAsStem },
        { ok: true, arrayBuffer: async () => flowerBytes.buffer.slice(flowerBytes.byteOffset, flowerBytes.byteOffset + flowerBytes.byteLength) },
    ];
    const fourth = await importReadyPlants({ token: 'test-token', root, compareKept: false, fetcher: async () => redrawReplies.shift() });
    assert.deepEqual(fourth.imported, []);
    assert.deepEqual(fourth.updated, [{ plantType: 'plant_10', name: 'Fern', redrawn: 2, added: 0 }]);
    assert.equal(fourth.title, 'New drawing for Fern');
    assert.deepEqual(readFileSync(resolve(root, 'src/assets/pack/plant_10/stem/stem1.png')), flowerBytes, 'the stem file is drawn over, under its old name');
    assert.equal(readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8'), before);
    const rows = JSON.parse(readFileSync(resolve(root, 'design/asset-map.json'))).assets;
    assert.equal(rows.length, 5);
    assert.equal(rows.find(row => row.path.endsWith('plant_10/stem/stem1.png')).sourceNodeId, '12:1');
});

test('ready families already published are not imported a second time', () => {
    const published = { assets: [
        { path: 'src/assets/pack/plant_10/stem/stem1.png', sourceNodeId: '10:1' },
        { path: 'src/assets/pack/plant_10/flowers/flower1.png', sourceNodeId: '10:2' },
    ] };
    assert.deepEqual(discoverReadyPlants(fixture(), published, ['plant_10']), []);
});

test('a partly registered family adds its new sprites to the same plant, never a second plant', () => {
    const published = { assets: [
        { path: 'src/assets/pack/plant_10/stem/stem1.png', sourceNodeId: '10:1' },
    ] };
    const plans = discoverReadyPlants(fixture(), published, ['plant_10'], new Set(), { plant_10: 'Fern' });
    assert.deepEqual(plans.map(p => [p.kind, p.plantType, p.parts.map(part => part.path)]), [
        ['update', 'plant_10', ['src/assets/pack/plant_10/flowers/flower1.png']],
    ]);
});

test('a family found by name is drawn over; a renamed one renames the plant; two of one plant are refused', () => {
    const variant = (id, name) => ({ id, type: 'COMPONENT', name, width: 39, height: 13 });
    const plume = (name, ids) => ({ id: '296:415', type: 'COMPONENT_SET', name, devStatus: { type: 'READY_FOR_DEV' }, children: [
        variant(ids[0], 'Part=Flowers, Variant=flower1'), variant(ids[1], 'Part=Stem, Variant=Stem1'), variant(ids[2], 'Part=Stem, Variant=Stem4'),
    ] });
    const file = (...families) => ({ document: { children: [{ id: '27:1966', name: 'ASSETS', children: families }] } });
    const old = { assets: [
        { path: 'src/assets/pack/plant_9/flowers/flower_1.png', sourceNodeId: '296:410' },
        { path: 'src/assets/pack/plant_9/stem/Stem_1.png', sourceNodeId: '296:412' },
    ] };
    const registry = { plant_9: 'Plume', plant_10: 'Leafy' };
    const [redraw] = discoverReadyPlants(file(plume('Source/Plants/Plume', ['476:1', '476:2', '476:3'])), old, ['plant_9', 'plant_10'], new Set(), registry);
    assert.equal(redraw.kind, 'update');
    assert.equal(redraw.plantType, 'plant_9');
    assert.deepEqual(redraw.parts.map(p => [p.path, p.replaces]), [
        ['src/assets/pack/plant_9/flowers/flower_1.png', true],
        ['src/assets/pack/plant_9/stem/Stem_1.png', true],
        ['src/assets/pack/plant_9/stem/stem4.png', false],
    ]);
    // Renamed in Figma, its sprites all known: only the name changes.
    const mapped = { assets: [...old.assets, { path: 'src/assets/pack/plant_9/stem/Stem4.png', sourceNodeId: '296:499' }] };
    const [renamed] = discoverReadyPlants(file(plume('Source/Plants/Feather', ['296:410', '296:412', '296:499'])), mapped, ['plant_9', 'plant_10'], new Set(), registry);
    assert.deepEqual([renamed.kind, renamed.plantType, renamed.parts.length, renamed.rename], ['update', 'plant_9', 0, { from: 'Plume', to: 'Feather' }]);
    assert.throws(() => discoverReadyPlants(file(plume('Source/Plants/Plume', ['1:1', '1:2', '1:3']), plume('Source/Plants/Plume', ['2:1', '2:2', '2:3'])), old, ['plant_9'], new Set(), registry), /Two plant families/);
});

test('reads the plant names and words commit titles for what came in', () => {
    assert.deepEqual(plantRegistry("export const PLANT_TYPE_NAMES = {\n    plant_1: 'Bell',\n    plant_12: 'Rosa\\'s',\n};\n"), { plant_1: 'Bell', plant_12: "Rosa's" });
    assert.deepEqual(plantRegistry('nothing here'), {});
    assert.equal(importTitle([{ name: 'Parasol' }]), 'New plant: Parasol');
    assert.equal(importTitle([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'New plants: A, B and C');
    assert.equal(importTitle([{ name: 'Parasol' }], [{ name: 'Plume', redrawn: 5, added: 0 }]), 'New plant: Parasol; new drawing for Plume');
    assert.equal(importTitle([], [{ name: 'Leafy', redrawn: 0, added: 1 }]), 'More of Leafy');
    assert.equal(importTitle([], [{ name: 'Feather', renamedFrom: 'Plume', redrawn: 0, added: 0 }]), 'Plume is now Feather');
    assert.equal(importTitle(), 'Import Figma plants marked Ready for dev');
});

// --- Drawings changed in place ---

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, tail]);
};
/** An RGBA PNG of `pixels` ([r,g,b,a] per pixel, row by row), every row with `filter` (0 none, 1 sub). */
function png(width, height, pixels, { filter = 0, level = 9 } = {}) {
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    const raw = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = filter;
        for (let x = 0; x < width * 4; x++) {
            const value = pixels[y * width + Math.floor(x / 4)][x % 4];
            const left = x >= 4 ? pixels[y * width + Math.floor(x / 4) - 1][x % 4] : 0;
            raw[y * (width * 4 + 1) + 1 + x] = filter === 1 ? (value - left) & 255 : value;
        }
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}
const picture = (colour, width = 3, height = 2) => Array.from({ length: width * height }, (_, i) => (i === 0 ? [0, 0, 0, 0] : colour));

test('a picture is compared by its pixels, not by how it was written', () => {
    const red = png(3, 2, picture([200, 30, 40, 255]));
    const sameRedOtherBytes = png(3, 2, picture([200, 30, 40, 255]), { filter: 1, level: 1 });
    assert.notEqual(red.toString('hex'), sameRedOtherBytes.toString('hex'));
    assert.equal(samePicture(red, sameRedOtherBytes), true);
    assert.equal(samePicture(red, png(3, 2, picture([201, 30, 40, 255]))), false);
    assert.equal(samePicture(red, png(2, 3, picture([200, 30, 40, 255], 2, 3))), false);
    // A fully transparent pixel is transparent, whatever colour it carries.
    const clearRed = picture([200, 30, 40, 255]); clearRed[0] = [9, 9, 9, 0];
    assert.equal(samePicture(red, png(3, 2, clearRed)), true);
    assert.deepEqual(Array.from(pngPixels(red).rgba.slice(0, 8)), [0, 0, 0, 0, 200, 30, 40, 255]);
    assert.equal(pngPixels(Buffer.from('not a png')), null);
});

test('a sprite redrawn in the same component replaces its file; an unchanged one is left; a dry run writes nothing', async t => {
    const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { resolve } = await import('node:path');
    const root = mkdtempSync(resolve(tmpdir(), 'garden-figma-kept-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const oldStem = png(3, 2, picture([90, 30, 60, 255]));
    const oldFlower = png(3, 2, picture([80, 140, 230, 255]));
    for (const dir of ['design', 'src/core', 'scripts', 'src/assets/pack/plant_10/stem', 'src/assets/pack/plant_10/flowers']) mkdirSync(resolve(root, dir), { recursive: true });
    writeFileSync(resolve(root, 'src/assets/pack/plant_10/stem/stem1.png'), oldStem);
    writeFileSync(resolve(root, 'src/assets/pack/plant_10/flowers/flower1.png'), oldFlower);
    writeFileSync(resolve(root, 'src/core/assets.ts'), "export const PLANT_TYPE_NAMES: Readonly<Record<string, string>> = {\n    plant_10: 'Parasol',\n};\n");
    writeFileSync(resolve(root, 'scripts/map-design-assets.mjs'), "const PLANTS = { plant_10: 'Parasol' };\n");
    const row = (path, sourceNodeId, bytes) => '    ' + JSON.stringify({ path, format: 'png', width: 3, height: 2, sha256: 'old', sourceNodeId });
    writeFileSync(resolve(root, 'design/asset-map.json'), '{\n  "assets": [\n'
        + [row('src/assets/pack/plant_10/flowers/flower1.png', '7:2'), row('src/assets/pack/plant_10/stem/stem1.png', '7:1')].join(',\n') + '\n  ]\n}\n');
    const family = { id: '7:0', type: 'COMPONENT_SET', name: 'Source/Plants/Parasol', devStatus: { type: 'READY_FOR_DEV' }, children: [
        { id: '7:1', type: 'COMPONENT', name: 'Variant=stem1, Part=Stem', absoluteBoundingBox: { width: 3, height: 2 } },
        { id: '7:2', type: 'COMPONENT', name: 'Variant=flower1, Part=Flowers', absoluteBoundingBox: { width: 3, height: 2 } },
    ] };
    const file = { document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family] }] } };
    assert.deepEqual(keptSprites(file, JSON.parse(readFileSync(resolve(root, 'design/asset-map.json'), 'utf8'))).map(s => [s.path, s.exportNodeId]), [
        ['src/assets/pack/plant_10/stem/stem1.png', '7:1'],
        ['src/assets/pack/plant_10/flowers/flower1.png', '7:2'],
    ]);
    // Figma now draws the stem in basic colours; the flower is the same picture, written differently.
    const newStem = png(3, 2, picture([120, 40, 40, 255]));
    const sameFlower = png(3, 2, picture([80, 140, 230, 255]), { filter: 1, level: 1 });
    const figma = (url) => {
        if (url.includes('/v1/files/')) return { ok: true, json: async () => file };
        if (url.includes('/v1/images/')) return { ok: true, json: async () => ({ images: { '7:1': 'https://img/stem', '7:2': 'https://img/flower' } }) };
        const bytes = url.endsWith('stem') ? newStem : sameFlower;
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    };
    const before = readFileSync(resolve(root, 'design/asset-map.json'), 'utf8');
    const dry = await importReadyPlants({ token: 't', root, fetcher: async (url) => figma(url), dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.deepEqual(dry.changes, ['redrawn src/assets/pack/plant_10/stem/stem1.png']);
    assert.equal(dry.title, 'New drawing for Parasol');
    assert.deepEqual(readFileSync(resolve(root, 'src/assets/pack/plant_10/stem/stem1.png')), oldStem, 'a dry run writes nothing');
    assert.equal(readFileSync(resolve(root, 'design/asset-map.json'), 'utf8'), before);

    const result = await importReadyPlants({ token: 't', root, fetcher: async (url) => figma(url) });
    assert.deepEqual(result.updated, [{ plantType: 'plant_10', name: 'Parasol', redrawn: 1, added: 0 }]);
    assert.equal(result.checked, 2);
    assert.deepEqual(readFileSync(resolve(root, 'src/assets/pack/plant_10/stem/stem1.png')), newStem);
    assert.deepEqual(readFileSync(resolve(root, 'src/assets/pack/plant_10/flowers/flower1.png')), oldFlower, 'the same picture is not rewritten');
    const rows = JSON.parse(readFileSync(resolve(root, 'design/asset-map.json'), 'utf8')).assets;
    assert.equal(rows.find(r => r.path.endsWith('stem1.png')).sha256.length, 64);
    assert.equal(rows.find(r => r.path.endsWith('flower1.png')).sha256, 'old');
    assert.match(readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8'), /plant_10: 'Parasol'/);

    // Run again: Figma and the garden agree, nothing to do.
    const again = await importReadyPlants({ token: 't', root, fetcher: async (url) => figma(url) });
    assert.deepEqual(again, { imported: [], updated: [], unchanged: true, checked: 2 });
});
