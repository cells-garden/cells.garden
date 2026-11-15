import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverReadyPlants } from './import-figma-plants.mjs';

function fixture({ status = 'READY_FOR_DEV', flower = true, linked = true, plantNo = 10 } = {}) {
    const stem = { id: '10:1', type: 'COMPONENT', name: 'Part=Stem, Variant=stem1', width: 12, height: 8 };
    const bloom = { id: '10:2', type: 'COMPONENT', name: 'Part=Flowers, Variant=flower1', width: 10, height: 9 };
    const family = { id: '10:0', type: 'COMPONENT_SET', name: 'Source/Plants/Fern', devStatus: status ? { type: status } : null, children: flower ? [stem, bloom] : [stem] };
    const exports = [
        { id: '20:1', type: 'INSTANCE', name: `src/assets/pack/plant_${plantNo}/stem/stem1.png`, componentId: linked ? stem.id : '99:99', width: 12, height: 8 },
        ...(flower ? [{ id: '20:2', type: 'INSTANCE', name: `src/assets/pack/plant_${plantNo}/flowers/flower1.png`, componentId: bloom.id, width: 10, height: 9 }] : []),
    ];
    return {
        document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family, { id: '186:410', name: 'EXPORTS', children: exports }] }] },
    };
}

const index = { assets: [] };

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
    for (const path of ['src/core/assets.ts', 'scripts/map-design-assets.mjs']) writeFileSync(resolve(root, path), readFileSync(resolve(sourceRoot, path)));
    const stemBytes = readFileSync(resolve(sourceRoot, 'src/assets/pack/plant_9/stem/Stem_1.png'));
    const flowerBytes = readFileSync(resolve(sourceRoot, 'src/assets/pack/plant_9/flowers/flower_1.png'));
    const stem = { id: '10:1', type: 'COMPONENT', name: 'Part=Stem, Variant=stem1', width: stemBytes.readUInt32BE(16), height: stemBytes.readUInt32BE(20) };
    const flower = { id: '10:2', type: 'COMPONENT', name: 'Part=Flowers, Variant=flower1', width: flowerBytes.readUInt32BE(16), height: flowerBytes.readUInt32BE(20) };
    const family = { id: '10:0', type: 'COMPONENT_SET', name: 'Source/Plants/Fern', devStatus: { type: 'READY_FOR_DEV' }, children: [stem, flower] };
    const file = { document: { children: [{ id: '27:1966', name: 'ASSETS', children: [family, { id: '186:410', name: 'EXPORTS', children: [
        { id: '20:1', type: 'INSTANCE', name: 'src/assets/pack/plant_10/stem/stem1.png', componentId: stem.id, width: stem.width, height: stem.height },
        { id: '20:2', type: 'INSTANCE', name: 'src/assets/pack/plant_10/flowers/flower1.png', componentId: flower.id, width: flower.width, height: flower.height },
    ] }] }] } };
    writeFileSync(resolve(root, 'design/asset-map.json'), JSON.stringify({ assets: [] }));
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
    assert.equal(index.assets.length, 2);
    assert.match(readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8'), /plant_10: 'Fern'/);
    assert.match(readFileSync(resolve(root, 'scripts/map-design-assets.mjs'), 'utf8'), /plant_10: 'Fern'/);
    const second = structuredClone(file);
    const oak = structuredClone(family);
    oak.name = 'Source/Plants/Oak';
    oak.id = '11:0';
    oak.children[0].id = '11:1';
    oak.children[1].id = '11:2';
    second.document.children[0].children.unshift(oak);
    second.document.children[0].children.at(-1).children.push(
        { id: '21:1', type: 'INSTANCE', name: 'src/assets/pack/plant_11/stem/stem1.png', componentId: '11:1', width: stem.width, height: stem.height },
        { id: '21:2', type: 'INSTANCE', name: 'src/assets/pack/plant_11/flowers/flower1.png', componentId: '11:2', width: flower.width, height: flower.height }
    );
    const png = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const nextReplies = [
        { ok: true, json: async () => second },
        { ok: true, json: async () => ({ images: { '21:1': 'https://img/3', '21:2': 'https://img/4' } }) },
        { ok: true, arrayBuffer: async () => png(stemBytes) },
        { ok: true, arrayBuffer: async () => png(flowerBytes) },
    ];
    const nextResult = await importReadyPlants({ token: 'test-token', root, fetcher: async () => nextReplies.shift() });
    assert.deepEqual(nextResult.imported, [{ plantType: 'plant_11', name: 'Oak', sprites: 2 }]);
    assert.match(readFileSync(resolve(root, 'src/core/assets.ts'), 'utf8'), /plant_11: 'Oak'/);
    assert.match(readFileSync(resolve(root, 'scripts/map-design-assets.mjs'), 'utf8'), /plant_11: 'Oak'/);
    const retry = await importReadyPlants({ token: 'test-token', root, fetcher: async () => ({ ok: true, json: async () => second }) });
    assert.deepEqual(retry, { imported: [], unchanged: true });
});

test('a Ready-for-dev component set already fully registered is skipped', () => {
    const registered = { assets: [
        { path: 'src/assets/pack/plant_10/stem/stem1.png', sourceNodeId: '10:1' },
        { path: 'src/assets/pack/plant_10/flowers/flower1.png', sourceNodeId: '10:2' },
    ] };
    assert.deepEqual(discoverReadyPlants(fixture(), registered, ['plant_9', 'plant_10']), []);
});

test('a partially registered Ready-for-dev component set is rejected', () => {
    const registered = { assets: [{ path: 'src/assets/pack/plant_10/stem/stem1.png', sourceNodeId: '10:1' }] };
    assert.throws(() => discoverReadyPlants(fixture(), registered, ['plant_10']), /Partially imported plant family/);
});
