const fs = require('fs');

const file = 'app.js';
const source = fs.readFileSync(file, 'utf8');

const start = source.indexOf(
  'async function neroImposterButton('
);

const endMarker = '\n}\n\n/* ------------------------------------------------------------\n   Generate the secret with the LLM.'
;
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  console.error('Could not find neroImposterButton().');
  process.exit(1);
}

const newFunction = `async function neroImposterButton(
  sock,
  jid,
  text,
  id,
  displayText,
  footer
) {
  const sent = await sock.sendMessage(jid, {
    text,
    footer: footer || 'Nero',
    interactiveButtons: [
      {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({
          display_text: displayText,
          id
        })
      }
    ]
  });

  if (sent?.key?.id) {
    botSentMessageIds.add(sent.key.id);
  }

  return sent;
}`;

const patched =
  source.slice(0, start) +
  newFunction +
  source.slice(end + 2);

fs.writeFileSync(file, patched, 'utf8');

console.log('Imposter button sender patched.');
