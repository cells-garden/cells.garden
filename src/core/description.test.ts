import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDescription, descriptionOf, MAX_DESCRIPTION_LENGTH, setDescription } from './description';

test('a description is kept on one line, trimmed, with single spaces', () => {
    assert.equal(cleanDescription('  Grow   the\n garden \t'), 'Grow the garden');
    assert.equal(cleanDescription(' \n '), '');
});

test('a description longer than the limit is cut, and never ends in a space or half an emoji', () => {
    assert.equal(MAX_DESCRIPTION_LENGTH, 75);
    assert.equal(cleanDescription('x'.repeat(100)), 'x'.repeat(MAX_DESCRIPTION_LENGTH));
    assert.equal(cleanDescription(`${'a'.repeat(MAX_DESCRIPTION_LENGTH - 1)} b`), 'a'.repeat(MAX_DESCRIPTION_LENGTH - 1));
    // The emoji's two halves would sit at 75 and 76: the first half alone is dropped.
    const cut = cleanDescription(`${'a'.repeat(MAX_DESCRIPTION_LENGTH - 1)}🌱 more`);
    assert.equal(cut, 'a'.repeat(MAX_DESCRIPTION_LENGTH - 1));
    assert.equal(cleanDescription(`${'a'.repeat(MAX_DESCRIPTION_LENGTH - 2)}🌱`), `${'a'.repeat(MAX_DESCRIPTION_LENGTH - 2)}🌱`);
});

test('a plant\'s description is read clean, and anything but text in the field is none', () => {
    assert.equal(descriptionOf({ description: '  A   plant ' }), 'A plant');
    assert.equal(descriptionOf({}), '');
    assert.equal(descriptionOf({ description: 42 as unknown as string }), '');
    assert.equal(descriptionOf({ description: ['a'] as unknown as string }), '');
    assert.equal(descriptionOf({ description: null as unknown as string }), '');
});

test('setting a description stores it clean, an empty one leaves no field, and only a change says so', () => {
    const project: { description?: string } = {};
    assert.equal(setDescription(project, '  For   the spring '), true);
    assert.equal(project.description, 'For the spring');
    assert.equal(setDescription(project, 'For the spring'), false, 'the same text is no change');
    assert.equal(setDescription(project, 'For  the spring  '), false, 'nor is the same text spaced out');
    assert.equal(setDescription(project, '   '), true);
    assert.equal('description' in project, false);
    assert.equal(setDescription(project, ''), false, 'clearing what is not there is no change');
    assert.equal('description' in project, false);
    const junk = { description: 7 as unknown as string };
    assert.equal(setDescription(junk, ''), true, 'junk in the field is cleared away');
    assert.equal('description' in junk, false);
});
