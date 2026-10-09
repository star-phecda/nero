import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NeroIdentityService } from '../src/core/neroIdentity.js';

function withIdentity(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nero-identity-test-'));
  const filePath = path.join(directory, 'nero_people.json');
  try {
    run(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('an explicitly named contact keeps that name across aliases, profile changes, and restart', () => {
  withIdentity(filePath => {
    let identity = new NeroIdentityService({ filePath, clock: () => 1000 });
    identity.resolve({
      chatId: '2348012345678@s.whatsapp.net',
      senderId: '2348012345678@s.whatsapp.net',
      aliases: ['4815162342@lid'],
      senderName: 'Old WhatsApp Name'
    });

    const named = identity.nameContact('2348012345678', 'Roy');
    assert.equal(named.displayName, 'Roy');
    assert.equal(named.nameConfirmed, true);
    assert.ok(named.aliases.includes('4815162342@lid'));

    const resolved = identity.resolve({
      chatId: '4815162342@lid',
      senderId: '4815162342@lid',
      aliases: ['2348012345678@s.whatsapp.net'],
      senderName: 'A New Profile Name'
    });
    assert.equal(resolved.personId, '2348012345678@s.whatsapp.net');
    assert.equal(resolved.displayName, 'Roy');
    assert.equal(resolved.profile.suggestedName, 'A New Profile Name');

    identity = new NeroIdentityService({ filePath, clock: () => 2000 });
    assert.equal(identity.getProfile('4815162342@lid').displayName, 'Roy');
    assert.equal(identity.getProfile('2348012345678').nameConfirmed, true);
  });
});

test('observed profile names remain unconfirmed and can be updated without becoming trusted names', () => {
  withIdentity(filePath => {
    const identity = new NeroIdentityService({ filePath });
    const first = identity.observeContact('2348098765432', 'Likely Name');
    assert.equal(first.nameConfirmed, false);
    assert.equal(first.suggestedName, 'Likely Name');

    const updated = identity.observeContact('2348098765432@s.whatsapp.net', 'Changed Profile');
    assert.equal(updated.displayName, 'Changed Profile');
    assert.equal(updated.nameConfirmed, false);
    assert.equal(updated.suggestedName, 'Changed Profile');
  });
});

test('contact lookup by name resolves only one confirmed, unambiguous name', () => {
  withIdentity(filePath => {
    const identity = new NeroIdentityService({ filePath });
    identity.nameContact('2348011111111', 'Roy');
    identity.nameContact('2348022222222', 'Roy');
    assert.deepEqual(identity.findContactsByName('Roy'), []);
    identity.nameContact('2348022222222', 'Roya');
    assert.equal(identity.findContactsByName('Roy').length, 1);
    assert.equal(identity.findContactsByName('Roy')[0].id, '2348011111111@s.whatsapp.net');
  });
});

test('forgetting a contact removes its alias mapping from the identity store', () => {
  withIdentity(filePath => {
    const identity = new NeroIdentityService({ filePath });
    identity.resolve({ senderId: '2348012345678@s.whatsapp.net', aliases: ['4815162342@lid'], senderName: 'Roy' });
    assert.equal(identity.forgetContact('4815162342@lid'), true);
    assert.equal(identity.getProfile('2348012345678@s.whatsapp.net'), null);
    assert.equal(identity.getProfiles().some(profile => profile.id === '2348012345678@s.whatsapp.net'), false);
  });
});

test('contact naming rejects invalid targets, blank names, and system identities', () => {
  withIdentity(filePath => {
    const identity = new NeroIdentityService({ filePath });
    assert.throws(() => identity.nameContact('not-a-number', 'Roy'), /valid WhatsApp/i);
    assert.throws(() => identity.nameContact('2348012345678', '  '), /name/i);
    identity.resolve({ senderId: '2347066350574@s.whatsapp.net', aliases: ['4815162342@lid'], senderName: 'Dawn', role: 'dawn' });
    const aliasMessage = identity.resolve({ senderId: '4815162342@lid', aliases: ['2347066350574@s.whatsapp.net'], senderName: 'Changed Profile', role: 'person' });
    assert.equal(aliasMessage.profile.role, 'dawn');
    assert.throws(() => identity.nameContact('2347066350574', 'Someone'), /system identity/i);
    assert.throws(() => identity.nameContact('4815162342@lid', 'Someone'), /system identity/i);
  });
});


test('legacy saved profiles load as unconfirmed names and can be explicitly confirmed', () => {
  withIdentity(filePath => {
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      people: {
        '2348012345678@s.whatsapp.net': {
          id: '2348012345678@s.whatsapp.net',
          displayName: 'Roy',
          role: 'person',
          firstSeenAt: 10,
          lastSeenAt: 20,
          chats: []
        }
      }
    }));
    const identity = new NeroIdentityService({ filePath });
    const legacy = identity.getContact('2348012345678');
    assert.equal(legacy.displayName, 'Roy');
    assert.equal(legacy.nameConfirmed, false);
    assert.equal(legacy.suggestedName, 'Roy');

    identity.nameContact('2348012345678', 'Roy');
    assert.equal(identity.getContact('2348012345678').nameConfirmed, true);
  });
});
