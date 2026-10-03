const fs = require('fs');
const { execSync } = require('child_process');

const file = 'app.js';
const backup = 'app.js.before-recap-final-fix';

let src = fs.readFileSync(file, 'utf8');

fs.copyFileSync(file, backup);

function requireText(text, label) {
  if (!src.includes(text)) {
    console.error(`PATCH FAILED: could not find ${label}`);
    process.exit(1);
  }
}

//
// 1. Add robust outgoing-message + recap guards
//
const anchor = `const botSentMessageIds = new Set();`;

requireText(anchor, 'botSentMessageIds declaration');

if (!src.includes('const recentNeroBotOutbound = new Map();')) {
  src = src.replace(
    anchor,
    anchor + String.raw`

const recentNeroBotOutbound = new Map();
const recapInFlightMessageIds = new Set();
const recapCompletedMessageIds = new Set();

function neroOutboundTextKey(jid, text) {
  return (
    String(jid || '') +
    '\u0000' +
    String(text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  );
}

function rememberNeroBotOutbound(jid, text) {
  const key = neroOutboundTextKey(jid, text);
  if (!key) return;

  const createdAt = Date.now();

  recentNeroBotOutbound.set(
    key,
    createdAt
  );

  setTimeout(() => {
    if (
      recentNeroBotOutbound.get(key) ===
      createdAt
    ) {
      recentNeroBotOutbound.delete(key);
    }
  }, 2 * 60 * 1000);
}

function isNeroGeneratedMessage(
  message,
  jid,
  text
) {
  if (!message?.key?.fromMe) {
    return false;
  }

  const id = message.key?.id;

  if (
    id &&
    botSentMessageIds.has(id)
  ) {
    return true;
  }

  const key =
    neroOutboundTextKey(
      jid,
      text
    );

  const sentAt =
    recentNeroBotOutbound.get(key);

  if (!sentAt) {
    return false;
  }

  return (
    Date.now() - sentAt <
    2 * 60 * 1000
  );
}
`
  );
}

//
// 2. Make control messages register BEFORE the network send.
//    This closes the race where WhatsApp can emit Nero's own
//    message before sendMessage() returns its message key.
//
const oldControl = String.raw`async function sendNeroControlMessage(sock, jid, text) {
  const sentMessage = await sock.sendMessage(jid, { text });`;

const newControl = String.raw`async function sendNeroControlMessage(sock, jid, text) {
  rememberNeroBotOutbound(jid, text);

  const sentMessage = await sock.sendMessage(jid, { text });`;

requireText(oldControl, 'sendNeroControlMessage send block');

src = src.replace(
  oldControl,
  newControl
);

//
// 3. Replace the message-entry guard.
//    Nero-generated messages are now ignored BEFORE history,
//    recap detection, games, or LLM processing.
//
const oldMessageGuard = String.raw`      try {
        if (!message?.message) continue;
        if (message.key?.fromMe && botSentMessageIds.has(message.key?.id)) continue;
        const jid = message.key.remoteJid;
        if (!jid || jid === 'status@broadcast') continue;

        const text = getText(message)?.trim();
        if (!text) continue;`;

const newMessageGuard = String.raw`      try {
        if (!message?.message) continue;

        const jid = message.key?.remoteJid;
        if (!jid || jid === 'status@broadcast') continue;

        const text = getText(message)?.trim();
        if (!text) continue;

        // Never let Nero's own outgoing messages re-enter
        // the recap detector or normal conversation pipeline.
        if (
          isNeroGeneratedMessage(
            message,
            jid,
            text
          )
        ) {
          continue;
        }`;

requireText(oldMessageGuard, 'messages.upsert entry guard');

src = src.replace(
  oldMessageGuard,
  newMessageGuard
);

//
// 4. Replace natural-language recap detection with a conservative,
//    deterministic parser. It supports:
//      recap
//      give me a summary
//      what did I miss?
//      what happened?
//      what happened in the last 2 hours?
//      summarize the last 500 messages
//      recap the last 20k messages
//      stats
//
const naturalStart =
  src.indexOf(
    'function parseNeroNaturalRecapRequest('
  );

const naturalEnd =
  src.indexOf(
    '\nfunction selectNeroRecapMessages(',
    naturalStart
  );

if (
  naturalStart === -1 ||
  naturalEnd === -1
) {
  console.error(
    'PATCH FAILED: could not locate natural recap parser.'
  );
  process.exit(1);
}

const newNaturalParser = String.raw`function parseNeroNaturalRecapRequest(
  text,
  historyLength
) {
  const clean =
    String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  if (
    !clean ||
    clean.startsWith('!')
  ) {
    return null;
  }

  // Allow natural addressing such as:
  // "Nero, give me a recap"
  // "Nero what happened?"
  const intentText =
    clean
      .replace(
        /^nero(?:\s*[,!:;-])?\s+/,
        ''
      )
      .trim();

  if (!intentText) {
    return null;
  }

  //
  // Natural statistics requests.
  //
  const wantsStats =
    intentText === 'stats' ||
    intentText === 'history stats' ||
    intentText === 'message stats' ||
    /^(?:show|give me|tell me)\s+(?:the\s+)?(?:history|message)\s+(?:stats?|statistics?)$/.test(intentText) ||
    /^(?:how many|how much)\s+(?:messages?|is stored|of the history)/.test(intentText);

  if (wantsStats) {
    return {
      stats: true
    };
  }

  //
  // Explicit recap/summary wording.
  //
  const hasRecapIntent =
    /^(?:please\s+)?(?:give me\s+(?:a\s+)?)?(?:recap|summary|summarize|summarise)(?:\s+.*)?$/.test(intentText) ||
    /^(?:please\s+)?(?:catch me up|fill me in|what did i miss|what have i missed)(?:\s+.*)?$/.test(intentText) ||
    /^(?:so\s+)?what happened(?:\s+.*)?\??$/.test(intentText) ||
    /^(?:so\s+)?what(?:'s| is| has)\s+(?:happened|been happening|going on)(?:\s+.*)?\??$/.test(intentText) ||
    /^anything important(?:\s+.*)?\??$/.test(intentText);

  if (!hasRecapIntent) {
    return null;
  }

  //
  // Today / yesterday.
  //
  if (/\b(?:today|yesterday)\b/.test(intentText)) {
    const day =
      intentText.includes('yesterday')
        ? 'yesterday'
        : 'today';

    return parseNeroRecapRequest(
      '!nero recap ' + day,
      historyLength
    );
  }

  //
  // Exact time-window parsing:
  // 2 hours = 7200 seconds
  // 30 minutes = 1800 seconds
  // 3 days = 259200 seconds
  //
  const timeMatch =
    intentText.match(
      /\b(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|d|h|m)\b/
    );

  if (timeMatch) {
    const amount =
      Number(timeMatch[1]);

    const rawUnit =
      timeMatch[2].toLowerCase();

    let unit;

    if (
      rawUnit === 'm' ||
      rawUnit.startsWith('min')
    ) {
      unit = 'm';
    } else if (
      rawUnit === 'h' ||
      rawUnit.startsWith('hr') ||
      rawUnit.startsWith('hour')
    ) {
      unit = 'h';
    } else {
      unit = 'd';
    }

    return parseNeroRecapRequest(
      '!nero recap ' +
      amount +
      unit,
      historyLength
    );
  }

  //
  // Message-count parsing:
  // 500 messages
  // last 500 messages
  // 20k messages
  // last 20k messages
  //
  const countMatch =
    intentText.match(
      /\b(?:last\s+)?(\d{1,5}(?:,\d{3})?)\s*(k|messages?|msgs?)\b/
    );

  if (countMatch) {
    const rawCount =
      countMatch[1]
        .replace(/,/g, '');

    const suffix =
      countMatch[2] === 'k'
        ? 'k'
        : '';

    return parseNeroRecapRequest(
      '!nero recap ' +
      rawCount +
      suffix,
      historyLength
    );
  }

  //
  // Plain recap request = last 6 hours.
  //
  return {
    seconds: 21600,
    label: 'the last 6 hours'
  };
}
`;

src =
  src.slice(0, naturalStart) +
  newNaturalParser +
  src.slice(naturalEnd);

//
// 5. Replace the entire recap handler with a guarded version.
//    Every WhatsApp message ID can enter this block only once.
//
const recapStart =
  src.indexOf(
    '        // NERO ON-DEMAND GROUP RECAP'
  );

const recapEnd =
  src.indexOf(
    '\nconst masterMentioned = mentionedJids.some(jid =>',
    recapStart
  );

if (
  recapStart === -1 ||
  recapEnd === -1
) {
  console.error(
    'PATCH FAILED: could not locate recap handler.'
  );
  process.exit(1);
}

const newRecapBlock = String.raw`        // NERO ON-DEMAND GROUP RECAP

        const groupHistory =
          isGroup
            ? getNeroGroupHistory(jid)
            : [];

        const recapRequest =
          isGroup
            ? (
                parseNeroRecapRequest(
                  text,
                  groupHistory.length
                ) ||
                parseNeroNaturalRecapRequest(
                  text,
                  groupHistory.length
                )
              )
            : null;

        if (
          isGroup &&
          recapRequest
        ) {
          const recapMessageId =
            message.key?.id ||
            (
              jid +
              ':' +
              messageTimestamp +
              ':' +
              text
            );

          // Hard one-message guard.
          // Even if Baileys delivers the same event again,
          // this message cannot start another recap.
          if (
            recapInFlightMessageIds.has(
              recapMessageId
            ) ||
            recapCompletedMessageIds.has(
              recapMessageId
            )
          ) {
            continue;
          }

          recapInFlightMessageIds.add(
            recapMessageId
          );

          console.log(
            '[NERO RECAP] Handling:',
            recapRequest.stats
              ? 'stats'
              : recapRequest.label
          );

          try {
            if (recapRequest.stats) {
              const count =
                groupHistory.length;

              const statsText =
                '🧠 Nero history: ' +
                count.toLocaleString() +
                ' stored messages for this group.\n' +
                'Ceiling: 20,000 messages.';

              rememberNeroBotOutbound(
                jid,
                statsText
              );

              await sock.sendMessage(
                jid,
                {
                  text: statsText
                }
              );

              continue;
            }

            const selected =
              selectNeroRecapMessages(
                groupHistory,
                recapRequest
              );

            if (!selected.length) {
              const emptyText =
                'I do not have stored messages for that period yet.';

              rememberNeroBotOutbound(
                jid,
                emptyText
              );

              await sock.sendMessage(
                jid,
                {
                  text: emptyText
                }
              );

              continue;
            }

            const thinkingText =
              'Give me a moment, Master. I am reading the stored conversation...';

            rememberNeroBotOutbound(
              jid,
              thinkingText
            );

            await sock.sendMessage(
              jid,
              {
                text: thinkingText
              }
            );

            const prompt =
              buildNeroRecapPrompt(
                selected,
                recapRequest.label ||
                  'the requested period'
              );

            const recap =
              await askNeroRecap(
                jid,
                prompt
              );

            const finalText =
              '📝 NERO RECAP — ' +
              (
                recapRequest.label ||
                'requested period'
              ) +
              '\n\n' +
              String(recap).trim();

            rememberNeroBotOutbound(
              jid,
              finalText
            );

            const sentMessage =
              await sock.sendMessage(
                jid,
                {
                  text: finalText
                }
              );

            if (
              sentMessage?.key?.id
            ) {
              botSentMessageIds.add(
                sentMessage.key.id
              );

              setTimeout(() => {
                botSentMessageIds.delete(
                  sentMessage.key.id
                );
              }, 5 * 60 * 1000);
            }
          } catch (err) {
            console.error(
              '[NERO RECAP] Failed:',
              err?.message || err
            );

            const errorText =
              'I could not prepare the recap right now. My stored history is safe; an AI provider failed to answer.';

            rememberNeroBotOutbound(
              jid,
              errorText
            );

            await sock.sendMessage(
              jid,
              {
                text: errorText
              }
            );
          } finally {
            recapInFlightMessageIds.delete(
              recapMessageId
            );

            recapCompletedMessageIds.add(
              recapMessageId
            );

            setTimeout(() => {
              recapCompletedMessageIds.delete(
                recapMessageId
              );
            }, 10 * 60 * 1000);
          }

          continue;
        }
`;

src =
  src.slice(0, recapStart) +
  newRecapBlock +
  src.slice(recapEnd);

//
// 6. Register normal AI replies BEFORE sending them.
//    This prevents a Baileys fromMe race from feeding Nero's own
//    response back into the recap detector.
//
const oldNormalSend = String.raw`        const sentMessage = await sock.sendMessage(
          jid,
          { text: reply },
          { quoted: message }
        );`;

const newNormalSend = String.raw`        rememberNeroBotOutbound(
          jid,
          reply
        );

        const sentMessage = await sock.sendMessage(
          jid,
          { text: reply },
          { quoted: message }
        );`;

requireText(
  oldNormalSend,
  'normal AI reply send'
);

src = src.replace(
  oldNormalSend,
  newNormalSend
);

//
// 7. Basic sanity checks.
//
fs.writeFileSync(
  file,
  src,
  'utf8'
);

try {
  execSync(
    `node --check ${file}`,
    { stdio: 'inherit' }
  );
} catch (_) {
  console.error(
    '\nSyntax check failed. Restoring backup...'
  );

  fs.copyFileSync(
    backup,
    file
  );

  process.exit(1);
}

//
// 8. Show what changed, then commit + push.
//
console.log('\n✅ Recap fix applied.');
console.log('✅ Natural recap parser replaced.');
console.log('✅ Nero-self-message guard added.');
console.log('✅ One-recap-per-message guard added.');
console.log('✅ Exact time windows preserved.');
console.log('✅ Syntax check passed.\n');

execSync(
  'git add app.js',
  { stdio: 'inherit' }
);

let hasChanges = true;

try {
  execSync(
    'git diff --cached --quiet',
    { stdio: 'ignore' }
  );
  hasChanges = false;
} catch (_) {}

if (hasChanges) {
  execSync(
    'git commit -m "Fix group recap duplicate triggering"',
    { stdio: 'inherit' }
  );

  execSync(
    'git push origin main',
    { stdio: 'inherit' }
  );

  console.log(
    '\n✅ Committed and pushed to GitHub.'
  );
} else {
  console.log(
    '\nℹ️ No Git changes were needed.'
  );
}

console.log(
  '\nYou can now start Nero with: npm start'
);
