import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadNeroConversationHistory,
  saveNeroConversationHistory
} from '../src/core/neroConversationHistoryStore.js';

function withStore(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nero-conversation-history-'));
  const filePath = path.join(directory, 'nero_conversation_history.json');
  try {
    run(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('recent DM and per-person conversation buffers survive save and reload', () => {
  withStore(filePath => {
    const beforeRestart = {
      conversations: new Map([
        ['123@s.whatsapp.net', [
          { sender: 'Master', text: 'Remember the plan.' },
          { sender: 'Nero', text: 'Naturally. I remember.' }
        ]]
      ]),
      personConversations: new Map([
        ['123@s.whatsapp.net|123@s.whatsapp.net', [
          { sender: 'Master', text: 'Remember the plan.', chatId: '123@s.whatsapp.net' },
          { sender: 'Nero', text: 'Naturally. I remember.', chatId: '123@s.whatsapp.net' }
        ]]
      ])
    };

    assert.equal(saveNeroConversationHistory(filePath, beforeRestart), true);
    const afterRestart = loadNeroConversationHistory(filePath);
    assert.deepEqual(afterRestart.conversations.get('123@s.whatsapp.net'), [
      { sender: 'Master', text: 'Remember the plan.' },
      { sender: 'Nero', text: 'Naturally. I remember.' }
    ]);
    assert.deepEqual(afterRestart.personConversations.get('123@s.whatsapp.net|123@s.whatsapp.net'), [
      { sender: 'Master', text: 'Remember the plan.', chatId: '123@s.whatsapp.net' },
      { sender: 'Nero', text: 'Naturally. I remember.', chatId: '123@s.whatsapp.net' }
    ]);
  });
});

test('missing conversation file starts with empty histories', () => {
  withStore(filePath => {
    const state = loadNeroConversationHistory(filePath);
    assert.equal(state.conversations.size, 0);
    assert.equal(state.personConversations.size, 0);
  });
});

test('malformed stored entries are ignored safely', () => {
  withStore(filePath => {
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      conversations: { valid: [{ sender: 'Nero', text: 'hello' }, null, { sender: 'broken' }] },
      personConversations: []
    }), 'utf8');

    const state = loadNeroConversationHistory(filePath);
    assert.deepEqual(state.conversations.get('valid'), [{ sender: 'Nero', text: 'hello' }]);
    assert.equal(state.personConversations.size, 0);
  });
});
