import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNeroPlotShareRecipients } from '../src/core/neroPlotSharing.js';

function normalizeId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  return raw.replace(/\D/g, '') + '@s.whatsapp.net';
}

test('shared plot recipients retain both phone and LID aliases', () => {
  const recipients = buildNeroPlotShareRecipients([
    {
      id: '24680@lid',
      phoneNumber: '2348012345678@s.whatsapp.net',
      lid: '24680@lid'
    }
  ], normalizeId);

  assert.deepEqual(recipients, [{
    ids: ['2348012345678@s.whatsapp.net', '24680@lid']
  }]);
});

test('excluding a member by any alias excludes all of their aliases', () => {
  const recipients = buildNeroPlotShareRecipients([
    { id: '24680@lid', phoneNumber: '2348012345678@s.whatsapp.net' },
    { id: '34567@lid', phoneNumber: '2348098765432@s.whatsapp.net' }
  ], normalizeId, ['2348012345678@s.whatsapp.net']);

  assert.deepEqual(recipients, [{
    ids: ['2348098765432@s.whatsapp.net', '34567@lid']
  }]);
});

test('handles missing or duplicate participant IDs safely', () => {
  const recipients = buildNeroPlotShareRecipients([
    {},
    { id: '12345@lid', phoneNumber: '2348011111111@s.whatsapp.net' },
    { id: '12345@lid', phoneNumber: '2348011111111@s.whatsapp.net' }
  ], normalizeId);

  assert.deepEqual(recipients, [{
    ids: ['2348011111111@s.whatsapp.net', '12345@lid']
  }]);
});
