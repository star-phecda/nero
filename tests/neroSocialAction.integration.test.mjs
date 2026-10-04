import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

assert.match(source, /buildNeroSocialActionInstructions/);
assert.match(source, /parseNeroSocialAction/);
assert.match(source, /socialAction\.action === 'react'/);
assert.match(source, /react:\s*\{\s*text: response\.emoji,\s*key: message\.key/s);
assert.match(source, /socialActionInstructions,/);
assert.match(source, /return \{\s*action: 'reply',\s*text: answer\s*\};/s);
assert.match(source, /response\?\.action === 'silent'/);
assert.ok(source.indexOf('parseNeroSocialAction(reply)') < source.indexOf('neroVerifier.verify({'));
assert.ok(source.indexOf("response?.action === 'react'") < source.indexOf("sock.sendMessage(\n          jid,\n          { text: reply }"));

console.log('Social reaction integration contract: PASS');
