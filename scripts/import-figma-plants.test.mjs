import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverReadyPlants } from './import-figma-plants.mjs';

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
    const sourceIds = ['30:1', '30:2', '30:3'];
    const published = { assets: sourceIds.map(sourceNodeId => ({ sourceNodeId })) };
    assert.deepEqual(discoverReadyPlants(looseFixture(), published, ['plant_10']), []);
    assert.throws(() => discoverReadyPlants(looseFixture(), { assets: [{ sourceNodeId: '30:1' }] }), /Partially registered/);
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
    const result = await importReadyPlants({ token: 'test-token', root, fetcher: async () => replies.shift() });
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
    const second = await importReadyPlants({ token: 'test-token', root, fetcher: async () => nextReplies.shift() });
    assert.deepEqual(second.imported, [{ plantType: 'plant_11', name: 'Birch', sprites: 2 }]);
    assert.match(readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8'), /plant_11: 'Birch'/);
    assert.match(readFileSync(resolve(root, 'scripts/map-design-assets.mjs'), 'utf8'), /plant_11: 'Birch'/);
    assert.equal(JSON.parse(readFileSync(resolve(root, 'design/asset-map.json'))).assets.length, 5);
    const third = await importReadyPlants({ token: 'test-token', root, fetcher: async () => ({ ok: true, json: async () => file }) });
    assert.deepEqual(third, { imported: [], unchanged: true });
});

test('ready families already published are not imported a second time', () => {
    const published = { assets: [
        { path: 'src/assets/pack/plant_10/stem/stem1.png', sourceNodeId: '10:1' },
        { path: 'src/assets/pack/plant_10/flowers/flower1.png', sourceNodeId: '10:2' },
    ] };
    assert.deepEqual(discoverReadyPlants(fixture(), published, ['plant_10']), []);
});

test('a partly registered family cannot be silently duplicated as another type', () => {
    const published = { assets: [
        { path: 'src/assets/pack/plant_10/stem/stem1.png', sourceNodeId: '10:1' },
    ] };
    assert.throws(() => discoverReadyPlants(fixture(), published, ['plant_10']), /Partially registered plant family/);
});
