const fs = require('fs');

const file = 'app.js';
const backup = 'app.js.before-imposter';

if (!fs.existsSync(file)) {
  console.error('app.js not found. Run this from ~/nero');
  process.exit(1);
}

const source = fs.readFileSync(file, 'utf8');

if (!fs.existsSync(backup)) {
  fs.copyFileSync(file, backup);
  console.log('Backup created: ' + backup);
}

let code = source;

/* ============================================================
   1. MAKE getText() UNDERSTAND WHATSAPP BUTTON RESPONSES
   ============================================================ */

const oldGetText = `function getText(message) {
  const msg = message?.message;
  if (!msg) return null;
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    null
  );
}`;

const newGetText = `function getInteractiveReplyId(message) {
  const msg = message?.message;
  if (!msg) return null;

  if (msg.buttonsResponseMessage?.selectedButtonId) {
    return msg.buttonsResponseMessage.selectedButtonId;
  }

  if (msg.templateButtonReplyMessage?.selectedId) {
    return msg.templateButtonReplyMessage.selectedId;
  }

  if (msg.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return msg.listResponseMessage.singleSelectReply.selectedRowId;
  }

  const native =
    msg.interactiveResponseMessage?.nativeFlowResponseMessage;

  if (native?.paramsJson) {
    try {
      const params = JSON.parse(native.paramsJson);

      return (
        params.id ||
        params.selected_id ||
        params.row_id ||
        params.selectedRowId ||
        null
      );
    } catch {}
  }

  return null;
}

function getText(message) {
  const msg = message?.message;
  if (!msg) return null;

  const interactiveReply = getInteractiveReplyId(message);

  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    interactiveReply ??
    null
  );
}`;

if (!code.includes(oldGetText)) {
  console.error('Could not find the existing getText() block.');
  console.error('Nothing was changed.');
  process.exit(1);
}

code = code.replace(oldGetText, newGetText);

/* ============================================================
   2. INSERT THE IMPOSTER GAME
   ============================================================ */

const marker = `async function handleNeroGameMessage({ sock, jid, message, text }) {`;

if (!code.includes(marker)) {
  console.error('Could not find handleNeroGameMessage().');
  console.error('Nothing was changed.');
  process.exit(1);
}

const imposterCode = String.raw`

/* ============================================================
   NERO IMPOSTER
   ============================================================ */

const neroImposterGames = new Map();

const NERO_IMPOSTER_FALLBACKS = [
  { category: 'Food', word: 'Pizza' },
  { category: 'Animals', word: 'Penguin' },
  { category: 'Everyday Things', word: 'Umbrella' },
  { category: 'Places', word: 'Beach' },
  { category: 'Technology', word: 'Headphones' },
  { category: 'School', word: 'Calculator' },
  { category: 'Sports', word: 'Basketball' },
  { category: 'Movies', word: 'Cinema' },
  { category: 'Nature', word: 'Volcano' },
  { category: 'Transport', word: 'Airplane' }
];

function neroImposterNormalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function neroImposterPlayersText(game) {
  return Array.from(game.players.values())
    .map((player, index) => {
      return (index + 1) + '. ' + player.name;
    })
    .join('\n');
}

function neroImposterWordMatches(guess, word) {
  const a = neroImposterNormalize(guess);
  const b = neroImposterNormalize(word);

  if (!a || !b) return false;
  if (a === b) return true;

  return (
    a.length >= 4 &&
    b.length >= 4 &&
    (a.includes(b) || b.includes(a))
  );
}

/* Modern WhatsApp native-flow button, with legacy fallback. */
async function neroImposterButton(sock, jid, text, id, displayText, footer) {
  try {
    const sent = await sock.sendMessage(jid, {
      interactiveMessage: {
        body: {
          text
        },
        footer: {
          text: footer || 'Nero'
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: displayText,
                id
              })
            }
          ],
          messageParamsJson: ''
        }
      }
    });

    if (sent?.key?.id) {
      botSentMessageIds.add(sent.key.id);
    }

    return sent;
  } catch (error) {
    console.log(
      '[IMPOSTER BUTTON] Native button failed, trying legacy:',
      error.message
    );

    const sent = await sock.sendMessage(jid, {
      text,
      footer: footer || 'Nero',
      buttons: [
        {
          buttonId: id,
          buttonText: {
            displayText
          },
          type: 1
        }
      ],
      headerType: 1
    });

    if (sent?.key?.id) {
      botSentMessageIds.add(sent.key.id);
    }

    return sent;
  }
}

/* ------------------------------------------------------------
   Generate the secret with the LLM.
   Falls back to a local word if generation fails.
   ------------------------------------------------------------ */

async function neroImposterGenerateSecret() {
  const fallback =
    NERO_IMPOSTER_FALLBACKS[
      Math.floor(Math.random() * NERO_IMPOSTER_FALLBACKS.length)
    ];

  if (!process.env.GROQ_API_KEY) {
    return fallback;
  }

  try {
    const randomSeed =
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: 'system',
              content: [
                'Generate ONE secret word for a WhatsApp social deduction game called Imposter.',
                'The word should be a familiar concrete thing, place, food, animal, activity, or object.',
                'It must be easy enough for players to describe with clues.',
                'Do not make it so obvious that one clue gives it away.',
                'Do not use politics, religion, sex, death, self-harm, slurs, or sensitive personal subjects.',
                'Return ONLY valid JSON.',
                '',
                '{"category":"Food","word":"Pizza"}',
                '',
                'The word should normally be one or two words.',
                'Random seed: ' + randomSeed
              ].join('\n')
            }
          ],
          temperature: 0.9,
          max_completion_tokens: 80,
          reasoning_effort: 'none',
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'imposter_secret',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  category: {
                    type: 'string'
                  },
                  word: {
                    type: 'string'
                  }
                },
                required: [
                  'category',
                  'word'
                ],
                additionalProperties: false
              }
            }
          },
          stream: false
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        'Groq API ' +
        response.status +
        ': ' +
        (data?.error?.message || JSON.stringify(data))
      );
    }

    const generated = JSON.parse(
      data?.choices?.[0]?.message?.content || '{}'
    );

    const category =
      String(generated.category || '').trim();

    const word =
      String(generated.word || '').trim();

    if (!category || !word || word.length > 60) {
      throw new Error('Invalid secret generated');
    }

    return {
      category,
      word
    };
  } catch (error) {
    console.log(
      '[IMPOSTER] LLM secret generation failed:',
      error.message
    );

    return fallback;
  }
}

/* ------------------------------------------------------------
   DM the secret role to every player.
   ------------------------------------------------------------ */

async function neroImposterSendSecret(sock, player, game) {
  const isImposter =
    player.id === game.imposterId;

  const text = isImposter
    ? [
        '🕵️ IMPOSTER',
        '',
        'You are the Imposter.',
        'You do NOT know the secret word.',
        '',
        'Listen carefully to everyone’s clues.',
        'Pretend you know the word.',
        'Blend in.',
        '',
        'Do NOT show anyone this message.'
      ].join('\n')
    : [
        '🤫 YOUR SECRET WORD',
        '',
        game.secretWord,
        '',
        'Give ONE clue about this word later.',
        'Do NOT say the word itself.',
        '',
        'Do NOT show anyone this message.'
      ].join('\n');

  await neroImposterButton(
    sock,
    player.id,
    text + '\n\nTap READY when you are set.',
    'imposter_ready',
    '✅ READY',
    'IMPOSTER'
  );
}

/* ------------------------------------------------------------
   Begin clues.
   ------------------------------------------------------------ */

async function neroImposterBeginClues(sock, groupJid, game) {
  game.phase = 'clues';
  game.clueIndex = 0;
  game.clues = new Map();

  const first =
    game.players.get(
      game.clueOrder[0]
    );

  await neroGameSend(
    sock,
    groupJid,
    [
      '🎭 CLUE PHASE',
      '',
      first.name + ' goes first.',
      '',
      'Give ONE short clue about the secret word.',
      'Do not say the word itself.'
    ].join('\n')
  );
}

/* ------------------------------------------------------------
   Reveal after voting.
   ------------------------------------------------------------ */

async function neroImposterReveal(
  sock,
  groupJid,
  game,
  caughtId
) {
  const caught =
    game.players.get(caughtId);

  const imposter =
    game.players.get(game.imposterId);

  if (caughtId !== game.imposterId) {
    await neroGameSend(
      sock,
      groupJid,
      [
        '🗳️ THE VOTE IS IN',
        '',
        caught.name + ' was voted out.',
        '',
        '❌ WRONG.',
        caught.name + ' was NOT the Imposter.',
        '',
        '🕵️ The actual Imposter was ' +
          imposter.name + '.',
        '',
        '🏆 IMPOSTER WINS'
      ].join('\n')
    );

    neroImposterGames.delete(groupJid);
    return;
  }

  game.phase = 'guess';

  await neroGameSend(
    sock,
    groupJid,
    [
      '🕵️ CAUGHT!',
      '',
      caught.name + ' is the Imposter.',
      '',
      'They get ONE final chance to guess',
      'the secret word privately.'
    ].join('\n')
  );

  await neroGameSend(
    sock,
    imposter.id,
    [
      '🕵️ YOU WERE CAUGHT',
      '',
      'Send me your ONE final guess.',
      '',
      'You only get one guess.'
    ].join('\n')
  );
}

/* ------------------------------------------------------------
   DM handler.
   ------------------------------------------------------------ */

async function handleNeroImposterDm({
  sock,
  jid,
  message,
  text
}) {
  const playerId =
    neroGameSenderId(message, sock);

  const raw =
    String(text || '').trim();

  for (const [groupJid, game] of neroImposterGames.entries()) {
    const player =
      game.players.get(playerId);

    if (!player) continue;

    /* READY button */
    if (game.phase === 'secrets') {
      const command =
        raw.toLowerCase();

      if (
        command !== 'imposter_ready' &&
        command !== 'ready'
      ) {
        return true;
      }

      if (game.ready.has(playerId)) {
        await neroGameSend(
          sock,
          jid,
          'You are already marked ready.'
        );

        return true;
      }

      game.ready.add(playerId);

      await neroGameSend(
        sock,
        jid,
        '✅ Ready. Keep your secret hidden.'
      );

      await neroGameSend(
        sock,
        groupJid,
        '✅ ' +
          player.name +
          ' is ready — ' +
          game.ready.size +
          '/' +
          game.players.size
      );

      if (
        game.ready.size ===
        game.players.size
      ) {
        game.phase = 'ready';

        await neroGameSend(
          sock,
          groupJid,
          [
            '🤫 EVERYONE IS READY.',
            '',
            'Players:',
            neroImposterPlayersText(game),
            '',
            'Type START when you want',
            'the clue phase to begin.'
          ].join('\n')
        );
      }

      return true;
    }

    /* Final Imposter guess */
    if (
      game.phase === 'guess' &&
      playerId === game.imposterId
    ) {
      if (!raw) return true;

      const correct =
        neroImposterWordMatches(
          raw,
          game.secretWord
        );

      await neroGameSend(
        sock,
        groupJid,
        [
          '🕵️ FINAL GUESS',
          '',
          player.name +
            ' guessed: ' +
            raw,
          '',
          'Secret word: ' +
            game.secretWord,
          'Category: ' +
            game.category,
          '',
          correct
            ? '✅ CORRECT.'
            : '❌ WRONG.',
          '',
          correct
            ? '🏆 IMPOSTER WINS'
            : '🏆 THE GROUP WINS'
        ].join('\n')
      );

      neroImposterGames.delete(
        groupJid
      );

      return true;
    }

    return true;
  }

  return false;
}

/* ------------------------------------------------------------
   Group handler.
   ------------------------------------------------------------ */

async function handleNeroImposterMessage({
  sock,
  jid,
  message,
  text
}) {
  if (!jid?.endsWith('@g.us')) {
    return false;
  }

  const raw =
    String(text || '').trim();

  const lower =
    raw.toLowerCase();

  const playerId =
    neroGameSenderId(message, sock);

  const playerName =
    neroGameSenderName(message);

  let game =
    neroImposterGames.get(jid);

  /* Start a new Imposter game */
  if (!game) {
    if (
      /\bnero\b.*\bplay\s+imposter\b/i.test(lower) ||
      /\bplay\s+imposter\b/i.test(lower)
    ) {
      game = {
        type: 'imposter',
        phase: 'joining',

        players: new Map(),
        ready: new Set(),

        clueOrder: [],
        clueIndex: 0,
        clues: new Map(),

        votes: new Map(),

        secretWord: '',
        category: '',
        imposterId: '',

        starterId: playerId
      };

      neroImposterGames.set(
        jid,
        game
      );

      await neroImposterButton(
        sock,
        jid,
        [
          '🎭 IMPOSTER',
          '',
          'One player secretly becomes the Imposter.',
          'Everyone else receives the same secret word.',
          '',
          'Everyone gives clues.',
          'Then you discuss and vote.',
          '',
          'If the Imposter is caught,',
          'they get ONE final guess.',
          '',
          'Tap JOIN if you want to play.',
          'You can also type join.'
        ].join('\n'),
        'imposter_join',
        '🎮 JOIN',
        'NERO GAME HALL'
      );

      return true;
    }

    return false;
  }

  /* Stop */
  if (
    lower === 'stop game' ||
    lower === 'stop imposter' ||
    lower === 'end imposter'
  ) {
    neroImposterGames.delete(jid);

    await neroGameSend(
      sock,
      jid,
      '🎭 Imposter stopped.'
    );

    return true;
  }

  /* Lobby */
  if (game.phase === 'joining') {

    if (
      lower === 'imposter_join' ||
      lower === 'join' ||
      lower === "i'm in" ||
      lower === 'im in'
    ) {
      const added =
        neroGameAddPlayer(
          game,
          playerId,
          playerName
        );

      if (added) {
        await neroGameSend(
          sock,
          jid,
          '🎮 ' +
            playerName +
            ' joined! (' +
            game.players.size +
            ' player' +
            (game.players.size === 1 ? '' : 's') +
            ')'
        );
      } else {
        await neroGameSend(
          sock,
          jid,
          playerName +
            ' is already in.'
        );
      }

      return true;
    }

    if (
      lower === 'start' ||
      lower === 'starts' ||
      lower === 'start game' ||
      lower === 'begin'
    ) {
      if (game.players.size < 3) {
        await neroGameSend(
          sock,
          jid,
          [
            'Not enough players.',
            '',
            'Imposter needs at least 3 players.',
            'Current players: ' +
              game.players.size
          ].join('\n')
        );

        return true;
      }

      game.phase = 'secrets';

      const secret =
        await neroImposterGenerateSecret();

      game.secretWord =
        secret.word;

      game.category =
        secret.category;

      game.clueOrder =
        Array.from(
          game.players.keys()
        );

      game.imposterId =
        game.clueOrder[
          Math.floor(
            Math.random() *
            game.clueOrder.length
          )
        ];

      game.ready = new Set();

      /* DM everyone one-by-one */
      for (const player of game.players.values()) {
        try {
          await neroImposterSendSecret(
            sock,
            player,
            game
          );
        } catch (error) {
          console.log(
            '[IMPOSTER] DM failed:',
            player.name,
            error.message
          );

          neroImposterGames.delete(
            jid
          );

          await neroGameSend(
            sock,
            jid,
            [
              '⚠️ Game cancelled.',
              '',
              'I could not privately message ' +
                player.name +
                '.',
              '',
              'Nobody gets a partial secret.'
            ].join('\n')
          );

          return true;
        }
      }

      await neroGameSend(
        sock,
        jid,
        [
          '🤫 SECRETS SENT',
          '',
          'Check your DM from Nero.',
          'Tap READY when you are set.',
          '',
          game.players.size +
            '/' +
            game.players.size +
            ' players have received their role.'
        ].join('\n')
      );

      return true;
    }

    return true;
  }

  /* Waiting for DMs to be ready */
  if (game.phase === 'secrets') {
    if (
      lower === 'start' ||
      lower === 'starts'
    ) {
      await neroGameSend(
        sock,
        jid,
        [
          'Not yet.',
          '',
          'Everyone must tap READY in their DM first.',
          '',
          'Ready: ' +
            game.ready.size +
            '/' +
            game.players.size
        ].join('\n')
      );
    }

    return true;
  }

  /* Ready -> start clues */
  if (game.phase === 'ready') {
    if (
      lower === 'start' ||
      lower === 'starts' ||
      lower === 'start game'
    ) {
      await neroImposterBeginClues(
        sock,
        jid,
        game
      );

      return true;
    }

    return true;
  }

  /* Clues */
  if (game.phase === 'clues') {
    const currentId =
      game.clueOrder[
        game.clueIndex
      ];

    if (
      lower === 'stop game' ||
      lower === 'stop imposter'
    ) {
      neroImposterGames.delete(jid);

      await neroGameSend(
        sock,
        jid,
        '🎭 Imposter stopped.'
      );

      return true;
    }

    /* Ignore everyone except the player whose turn it is */
    if (playerId !== currentId) {
      return true;
    }

    if (!raw) return true;

    game.clues.set(
      playerId,
      raw
    );

    const current =
      game.players.get(playerId);

    game.clueIndex++;

    if (
      game.clueIndex <
      game.clueOrder.length
    ) {
      const next =
        game.players.get(
          game.clueOrder[
            game.clueIndex
          ]
        );

      await neroGameSend(
        sock,
        jid,
        [
          '💬 ' +
            current.name +
            ': ' +
            raw,
          '',
          'Next: ' +
            next.name
        ].join('\n')
      );

      return true;
    }

    game.phase = 'discussion';

    await neroGameSend(
      sock,
      jid,
      [
        '🗣️ DISCUSSION TIME',
        '',
        'All clues are in.',
        '',
        'Discuss who you think is the Imposter.',
        '',
        'When you are ready to vote, type VOTE.'
      ].join('\n')
    );

    return true;
  }

  /* Discussion */
  if (game.phase === 'discussion') {
    if (
      lower === 'vote' ||
      lower === 'votes' ||
      lower === 'start vote' ||
      lower === 'voting'
    ) {
      game.phase = 'voting';
      game.votes = new Map();

      await neroGameSend(
        sock,
        jid,
        [
          '🗳️ VOTING TIME',
          '',
          'Who is the Imposter?',
          '',
          neroImposterPlayersText(game),
          '',
          'Reply with:',
          'vote 1',
          'vote 2',
          'vote 3',
          'etc.',
          '',
          'You can only vote once.'
        ].join('\n')
      );

      return true;
    }

    return false;
  }

  /* Voting */
  if (game.phase === 'voting') {

    if (
      game.votes.has(playerId)
    ) {
      await neroGameSend(
        sock,
        jid,
        'You already voted.'
      );

      return true;
    }

    const match =
      lower.match(
        /^vote\s+(\d+)$/
      );

    if (!match) {
      await neroGameSend(
        sock,
        jid,
        'Use vote 1, vote 2, vote 3, etc.'
      );

      return true;
    }

    const index =
      Number(match[1]) - 1;

    const ids =
      Array.from(
        game.players.keys()
      );

    if (
      index < 0 ||
      index >= ids.length
    ) {
      await neroGameSend(
        sock,
        jid,
        'That player number does not exist.'
      );

      return true;
    }

    const targetId =
      ids[index];

    game.votes.set(
      playerId,
      targetId
    );

    await neroGameSend(
      sock,
      jid,
      '🗳️ ' +
        playerName +
        ' voted — ' +
        game.votes.size +
        '/' +
        game.players.size
    );

    /* Everyone has voted */
    if (
      game.votes.size ===
      game.players.size
    ) {
      const counts =
        new Map();

      for (
        const targetId
        of game.votes.values()
      ) {
        counts.set(
          targetId,
          (counts.get(targetId) || 0) + 1
        );
      }

      const ranked =
        Array.from(
          counts.entries()
        ).sort((a, b) => {
          return b[1] - a[1];
        });

      const highest =
        ranked[0]?.[1] || 0;

      const leaders =
        ranked
          .filter(
            entry =>
              entry[1] === highest
          )
          .map(
            entry => entry[0]
          );

      /* Tie = Imposter survives */
      if (
        leaders.length !== 1
      ) {
        await neroGameSend(
          sock,
          jid,
          [
            '🗳️ TIE.',
            '',
            'Nobody was eliminated.',
            '',
            '🕵️ The Imposter escapes!',
            '',
            'Imposter: ' +
              game.players.get(
                game.imposterId
              ).name,
            '',
            'Secret word: ' +
              game.secretWord,
            '',
            '🏆 IMPOSTER WINS'
          ].join('\n')
        );

        neroImposterGames.delete(
          jid
        );

        return true;
      }

      await neroImposterReveal(
        sock,
        jid,
        game,
        leaders[0]
      );
    }

    return true;
  }

  /* Waiting for final guess */
  if (game.phase === 'guess') {
    await neroGameSend(
      sock,
      jid,
      '🕵️ The Imposter is making the final guess privately...'
    );

    return true;
  }

  return true;
}

`;

code = code.replace(
  marker,
  imposterCode + marker
);

/* ============================================================
   3. ROUTE DMs + GROUP IMPOSTER INTO THE NEW HANDLER
   ============================================================ */

const oldHandlerStart = `async function handleNeroGameMessage({ sock, jid, message, text }) {
  if (!jid?.endsWith('@g.us')) return false;
  if (!text?.trim()) return false;`;

const newHandlerStart = `async function handleNeroGameMessage({ sock, jid, message, text }) {

  /* Imposter uses private DMs for secret roles and final guesses. */
  if (!jid?.endsWith('@g.us')) {
    return await handleNeroImposterDm({
      sock,
      jid,
      message,
      text
    });
  }

  if (!text?.trim()) return false;

  const imposterHandled =
    await handleNeroImposterMessage({
      sock,
      jid,
      message,
      text
    });

  if (imposterHandled) return true;`;

if (!code.includes(oldHandlerStart)) {
  console.error(
    'Could not find the game-handler start.'
  );
  console.error(
    'Nothing was changed.'
  );

  fs.copyFileSync(
    backup,
    file
  );

  process.exit(1);
}

code = code.replace(
  oldHandlerStart,
  newHandlerStart
);

/* ============================================================
   WRITE + CHECK
   ============================================================ */

fs.writeFileSync(
  file,
  code,
  'utf8'
);

console.log('');
console.log('Imposter code installed.');
console.log('Checking JavaScript syntax...');
console.log('');

const { execFileSync } =
  require('child_process');

try {
  execFileSync(
    process.execPath,
    ['--check', file],
    { stdio: 'inherit' }
  );
} catch (error) {
  console.log('');
  console.log('Syntax check FAILED.');
  console.log('Restoring original app.js...');
  fs.copyFileSync(
    backup,
    file
  );
  process.exit(1);
}

console.log('');
console.log('✅ Syntax check passed.');
console.log('✅ Backup: ' + backup);
console.log('');
console.log('Start Nero with:');
console.log('npm start');
