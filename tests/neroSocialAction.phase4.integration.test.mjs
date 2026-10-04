import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const verifier = fs.readFileSync(new URL('../src/core/neroVerifier.js', import.meta.url), 'utf8');

assert.match(app, /getNeroSocialActionGuard/);
assert.match(app, /socialAction,\s*senderRole,\s*socialActionAllowed/s);
assert.match(app, /socialVerdict\.pass/);
assert.match(app, /forceReply: actions\.includes\('force_reply'\)/);
assert.match(app, /SOCIAL ACTION OVERRIDE/);
assert.match(verifier, /verified-social-action/);
assert.match(verifier, /social-action-prohibited/);
assert.match(verifier, /force_reply/);

console.log('Social action Phase 4 integration gate: PASS');
