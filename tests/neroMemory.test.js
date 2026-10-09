import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NeroMemoryService } from '../src/core/neroMemory.js';

function withMemory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nero-memory-test-'));
  const filePath = path.join(directory, 'nero_memory.json');
  try {
    run(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('plot memory keeps its structure after a save and reload', () => {
  withMemory(filePath => {
    const plot = 'Roy and Izzy\n- Roy is hiding a secret.\n\nIzzy suspects something.';
    const first = new NeroMemoryService({ filePath });
    first.add(plot, { type: 'plots', scope: 'person:2348000000000@s.whatsapp.net', importance: 1 });

    const reloaded = new NeroMemoryService({ filePath });
    const entries = reloaded.list({ scope: 'person:2348000000000@s.whatsapp.net', type: 'plots' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].text, plot);
  });
});

test('clearing plot memory does not clear facts in the same person scope', () => {
  withMemory(filePath => {
    const memory = new NeroMemoryService({ filePath });
    memory.add('Roy is in the Keter group.', { type: 'facts', scope: 'person:2348000000000@s.whatsapp.net' });
    memory.add('A private story for Roy.', { type: 'plots', scope: 'person:2348000000000@s.whatsapp.net' });

    assert.equal(memory.clearTypeScope('person:2348000000000@s.whatsapp.net', 'plots'), 1);
    assert.equal(memory.list({ scope: 'person:2348000000000@s.whatsapp.net', type: 'plots' }).length, 0);
    assert.equal(memory.list({ scope: 'person:2348000000000@s.whatsapp.net', type: 'facts' }).length, 1);
  });
});
