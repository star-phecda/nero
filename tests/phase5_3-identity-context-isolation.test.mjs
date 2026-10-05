import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NeroIdentityService } from '../src/core/neroIdentity.js';
import { NeroMemoryService } from '../src/core/neroMemory.js';
import { NeroContextAssembler } from '../src/core/neroContextAssembler.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nero-phase5-3-'));
const peopleFile = path.join(tempDir, 'nero_people.json');
const memoryFile = path.join(tempDir, 'nero_memory.json');

try {
  const identity = new NeroIdentityService({ filePath: peopleFile });
  const personA1 = identity.resolve({
    chatId: '120000000000@g.us',
    senderId: '2347000000001@s.whatsapp.net',
    senderName: 'Person A',
    role: 'person'
  });
  const personB1 = identity.resolve({
    chatId: '120000000000@g.us',
    senderId: '2347000000002@s.whatsapp.net',
    senderName: 'Person B',
    role: 'person'
  });
  const personA2 = identity.resolve({
    chatId: '120000000001@g.us',
    senderId: '2347000000001@s.whatsapp.net',
    senderName: 'Person A',
    role: 'person'
  });
  const master = identity.resolve({
    chatId: '120000000000@g.us',
    senderId: '2349129074607@s.whatsapp.net',
    senderName: 'Master',
    role: 'master'
  });

  assert.equal(personA1.personId, '2347000000001@s.whatsapp.net');
  assert.equal(personA1.personScope, 'person:2347000000001@s.whatsapp.net');
  assert.notEqual(personA1.conversationKey, personB1.conversationKey);
  assert.equal(personA1.personId, personA2.personId);
  assert.equal(personA1.personScope, personA2.personScope);
  assert.notEqual(personA1.conversationKey, personA2.conversationKey);
  assert.equal(master.personId, 'master');
  assert.equal(master.personScope, 'master');

  const memory = new NeroMemoryService({ filePath: memoryFile });
  memory.add('Person A has an exam tomorrow.', {
    type: 'facts',
    scope: personA1.personScope,
    importance: 0.9
  });
  memory.add('Person B just bought a new phone.', {
    type: 'facts',
    scope: personB1.personScope,
    importance: 0.9
  });
  memory.add('This group is planning a meetup.', {
    type: 'facts',
    scope: 'group:120000000000@g.us',
    importance: 0.8
  });
  memory.add('Master prefers concise answers.', {
    type: 'preferences',
    scope: 'master',
    importance: 0.9
  });

  const aContext = memory.buildContext(
    'exam tomorrow phone meetup concise answers',
    {
      scopes: [
        'master',
        'group:120000000000@g.us',
        personA1.personScope
      ],
      limit: 20,
      maxChars: 4000
    }
  );

  const aTexts = aContext.items.map(item => item.entry.text);
  assert(aTexts.some(text => text.includes('Person A has an exam')));
  assert(aTexts.some(text => text.includes('This group is planning')));
  assert(aTexts.some(text => text.includes('Master prefers')));
  assert(!aTexts.some(text => text.includes('Person B just bought')));

  const assembler = new NeroContextAssembler({
    memory,
    defaultBudgetChars: 3000
  });
  const assembled = assembler.assemble({
    request: 'exam meetup',
    plan: { memory: true, tier: 'normal' },
    history: [{ sender: 'Person A', text: 'My exam is tomorrow.' }],
    memoryScopes: [
      'master',
      'group:120000000000@g.us',
      personA1.personScope
    ]
  });

  assert(
    assembled.items.some(
      item => item.kind === 'memory' && item.scope === personA1.personScope
    )
  );

  const appSource = fs.readFileSync(
    new URL('../app.js', import.meta.url),
    'utf8'
  );
  assert.match(appSource, /NeroIdentityService/);
  assert.match(appSource, /getNeroPersonConversationKey/);
  assert.match(appSource, /memoryScopes: getNeroMemoryScopes/);
  assert.match(
    appSource,
    /Person-specific memories belong ONLY to this speaker/
  );
  assert.match(appSource, /person\s*:\s*/);

  console.log('Phase 5.3 identity/context isolation gate: PASS');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
