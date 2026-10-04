import assert from 'node:assert/strict';
import { NeroVerifier } from '../src/core/neroVerifier.js';

const verifier = new NeroVerifier();
const base = {
  plan: { verification: true },
  context: {}
};

const reactVerdict = verifier.verify({
  request: 'That comeback was terrible.',
  answer: '',
  ...base,
  context: { socialAction: { action: 'react', emoji: '🥱' }, senderRole: 'Group member', socialActionAllowed: true }
});
assert.equal(reactVerdict.pass, true);
assert.equal(reactVerdict.reason, 'verified-social-action');

const silentVerdict = verifier.verify({
  request: 'okay then',
  answer: '',
  ...base,
  context: { socialAction: { action: 'silent' }, senderRole: 'Group member', socialActionAllowed: true }
});
assert.equal(silentVerdict.pass, true);
assert.equal(silentVerdict.reason, 'verified-social-action');

const masterVerdict = verifier.verify({
  request: 'Master says something casual.',
  answer: '',
  ...base,
  context: { socialAction: { action: 'react', emoji: '🙄' }, senderRole: 'Master', socialActionAllowed: false }
});
assert.equal(masterVerdict.pass, false);
assert.ok(masterVerdict.issues.some(x => x.code === 'social-action-prohibited'));
assert.equal(verifier.recoveryActions(masterVerdict)[0], 'force_reply');

const invalidEmojiVerdict = verifier.verify({
  request: 'Bad comeback.',
  answer: '',
  ...base,
  context: { socialAction: { action: 'react', emoji: '🚀' }, senderRole: 'Group member', socialActionAllowed: true }
});
assert.equal(invalidEmojiVerdict.pass, false);
assert.ok(invalidEmojiVerdict.issues.some(x => x.code === 'invalid-social-action'));

console.log('Social action verifier gate: PASS');
