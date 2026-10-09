import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNeroContactCommand, parseNeroNamedDmCommand } from '../src/core/neroContactCommands.js';

test('parses explicit contact-name command', () => {
  assert.deepEqual(
    parseNeroContactCommand('!nero contact name +234 801 234 5678 as Roy A.'),
    { action: 'name', target: '+234 801 234 5678', name: 'Roy A.' }
  );
});

test('parses lookup, list, and forget contact commands', () => {
  assert.deepEqual(parseNeroContactCommand('!nero contact show 2348012345678'), {
    action: 'show', target: '2348012345678'
  });
  assert.deepEqual(parseNeroContactCommand('!nero contact list'), { action: 'list' });
  assert.deepEqual(parseNeroContactCommand('!nero contact forget 2348012345678'), {
    action: 'forget', target: '2348012345678'
  });
});

test('does not consume unrelated messages and safely flags malformed contact commands', () => {
  assert.equal(parseNeroContactCommand('Nero, hello there'), null);
  assert.deepEqual(parseNeroContactCommand('!nero contact name'), { action: 'invalid' });
});


test('parses named-contact DMs only when target and message are clearly separated', () => {
  assert.deepEqual(parseNeroNamedDmCommand('dm Roy: Are you coming?'), {
    target: 'Roy', instruction: 'Are you coming?'
  });
  assert.deepEqual(parseNeroNamedDmCommand('message Roy saying Are you coming?'), {
    target: 'Roy', instruction: 'Are you coming?'
  });
  assert.equal(parseNeroNamedDmCommand('dm Roy are you coming?'), null);
});
