import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNeroQuotedMessage } from '../src/core/neroQuotedMessage.js';

test('extracts the text and sender from a WhatsApp reply', () => {
  const result = extractNeroQuotedMessage({
    message: {
      extendedTextMessage: {
        text: 'Nero, check this',
        contextInfo: {
          participant: '2348000000000@s.whatsapp.net',
          stanzaId: 'quoted-message-1',
          remoteJid: '120000000000000@g.us',
          quotedMessage: { conversation: 'This grant pays ₦500,000. Apply here.' }
        }
      }
    }
  });

  assert.equal(result.text, 'This grant pays ₦500,000. Apply here.');
  assert.equal(result.sender, '2348000000000@s.whatsapp.net');
  assert.equal(result.messageId, 'quoted-message-1');
  assert.equal(result.remoteJid, '120000000000000@g.us');
});

test('includes media captions and identifies quoted attachments', () => {
  const result = extractNeroQuotedMessage({
    message: {
      imageMessage: {
        caption: 'Urgent government grant',
        contextInfo: { quotedMessage: { imageMessage: { caption: 'Click this link now' } } }
      }
    }
  });

  assert.match(result.text, /Click this link now/);
  assert.match(result.text, /Image attachment/);
});

test('returns null when the incoming message is not a reply', () => {
  assert.equal(extractNeroQuotedMessage({ message: { conversation: 'hello' } }), null);
});

test('uses Baileys normalization for wrapped message content', () => {
  const normalize = content => content?.ephemeralMessage?.message || content;
  const result = extractNeroQuotedMessage({
    message: {
      ephemeralMessage: {
        message: {
          extendedTextMessage: {
            text: 'Nero, explain this',
            contextInfo: {
              quotedMessage: {
                ephemeralMessage: { message: { conversation: 'Original quoted text' } }
              }
            }
          }
        }
      }
    }
  }, normalize);

  assert.equal(result.text, 'Original quoted text');
});
