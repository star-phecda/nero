const fs = require('fs');

const file = 'app.js';
const backup = 'app.js.before-imposter';

let code = fs.readFileSync(file, 'utf8');

if (!fs.existsSync(backup)) {
  fs.copyFileSync(file, backup);
}

/* ============================================================
   1. ADD proto + generateWAMessageFromContent TO BAILEYS IMPORT
   ============================================================ */

const oldImport = `import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';`;

const newImport = `import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  proto,
  generateWAMessageFromContent,
} from '@whiskeysockets/baileys';`;

if (code.includes(oldImport)) {
  code = code.replace(oldImport, newImport);
} else {
  console.log('Baileys import already appears modified; checking exports...');
}

/* ============================================================
   2. FIND THE CURRENT BUTTON FUNCTION
   ============================================================ */

const start = code.indexOf(
  'async function neroImposterButton('
);

if (start === -1) {
  console.error(
    'Could not find neroImposterButton().'
  );
  process.exit(1);
}

const endMarker =
`\n}\n\n/* ------------------------------------------------------------
   Generate the secret with the LLM.`;

const end =
  code.indexOf(endMarker, start);

if (end === -1) {
  console.error(
    'Could not find the end of neroImposterButton().'
  );
  process.exit(1);
}

/* ============================================================
   3. REPLACE BUTTON FUNCTION WITH REAL BAILEYS RELAY VERSION
   ============================================================ */

const replacement = String.raw`
function neroImposterBizNode() {
  return {
    tag: 'biz',
    attrs: {
      actual_actors: '2',
      host_storage: '2',
      privacy_mode_ts:
        (
          Math.floor(Date.now() / 1000) -
          77980457
        ).toString()
    },
    content: [
      {
        tag: 'interactive',
        attrs: {
          type: 'native_flow',
          v: '1'
        },
        content: [
          {
            tag: 'native_flow',
            attrs: {
              v: '9',
              name: 'mixed'
            }
          }
        ]
      },
      {
        tag: 'quality_control',
        attrs: {
          source_type: 'third_party'
        }
      }
    ]
  };
}

async function neroImposterButton(
  sock,
  jid,
  text,
  id,
  displayText,
  footer
) {
  const nativeButton = {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
      id
    })
  };

  const interactiveMessage =
    proto.Message.InteractiveMessage.create({
      body:
        proto.Message.InteractiveMessage.Body.create({
          text
        }),

      footer:
        proto.Message.InteractiveMessage.Footer.create({
          text: footer || 'Nero'
        }),

      nativeFlowMessage:
        proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: [
            proto.Message.InteractiveMessage.NativeFlowMessage.NativeFlowButton.create(
              nativeButton
            )
          ],

          messageParamsJson: '{}',
          messageVersion: 1
        })
    });

  const waMessage =
    generateWAMessageFromContent(
      jid,
      {
        interactiveMessage
      },
      {
        userJid: sock.user?.id
      }
    );

  const bizNode =
    neroImposterBizNode();

  const additionalNodes =
    jid.endsWith('@g.us')
      ? [bizNode]
      : [
          {
            tag: 'bot',
            attrs: {
              biz_bot: '1'
            }
          },
          bizNode
        ];

  await sock.relayMessage(
    jid,
    waMessage.message,
    {
      messageId: waMessage.key.id,
      additionalNodes
    }
  );

  if (waMessage?.key?.id) {
    botSentMessageIds.add(
      waMessage.key.id
    );
  }

  console.log(
    '[IMPOSTER BUTTON] Sent:',
    displayText,
    'to',
    jid
  );

  return waMessage;
}`;

code =
  code.slice(0, start) +
  replacement +
  code.slice(end + 2);

/* ============================================================
   4. WRITE
   ============================================================ */

fs.writeFileSync(
  file,
  code,
  'utf8'
);

console.log(
  'Patched Imposter native-flow buttons.'
);

/* ============================================================
   5. SYNTAX CHECK
   ============================================================ */

const {
  execFileSync
} = require('child_process');

try {
  execFileSync(
    process.execPath,
    ['--check', file],
    {
      stdio: 'inherit'
    }
  );
} catch {
  console.error(
    'Syntax check failed.'
  );

  fs.copyFileSync(
    backup,
    file
  );

  console.error(
    'Original app.js restored.'
  );

  process.exit(1);
}

console.log('');
console.log(
  '✅ Syntax check passed.'
);
console.log(
  '✅ Native-flow button relay installed.'
);
