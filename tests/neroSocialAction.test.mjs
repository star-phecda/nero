import assert from 'node:assert/strict';
import { parseNeroSocialAction, buildNeroSocialActionInstructions, NERO_REACTION_EMOJIS } from '../src/core/neroSocialAction.js';

assert.deepEqual(parseNeroSocialAction('[NERO_REACT:🙄]'), { action: 'react', emoji: '🙄' });
assert.deepEqual(parseNeroSocialAction('[NERO_REACT:💅]'), { action: 'react', emoji: '💅' });
assert.deepEqual(parseNeroSocialAction('[NERO_REACT:🥱]'), { action: 'react', emoji: '🥱' });
assert.deepEqual(parseNeroSocialAction('[NERO_SILENT]'), { action: 'silent' });
assert.deepEqual(parseNeroSocialAction('A normal answer.'), { action: 'reply', text: 'A normal answer.' });
assert.equal(parseNeroSocialAction('[NERO_REACT:🚀]').action, 'reply');
assert.equal(parseNeroSocialAction('[NERO_REACT:🙄]\nmore text').action, 'reply');
assert.ok(NERO_REACTION_EMOJIS.has('🙄'));
assert.match(buildNeroSocialActionInstructions(), /REACT/);
assert.match(buildNeroSocialActionInstructions(), /SILENT/);
assert.ok(buildNeroSocialActionInstructions().includes('\n'));
assert.equal(buildNeroSocialActionInstructions().includes('\\n'), false);
console.log('Social reaction unit gate: PASS');
