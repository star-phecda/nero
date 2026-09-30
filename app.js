import { handleNeroTriviaMessage } from './neroTrivia.js';
import { handleNeroTagAllMessage } from './neroTagAll.js';
import fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  proto,
  generateWAMessageFromContent,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

import qrcode from 'qrcode-terminal';
import P from 'pino';

const MODEL = 'qwen/qwen3.8-27b';
const BOT_NAME = process.env.BOT_NAME || 'Nero';
const RESPOND_TO_ALL_GROUP_MESSAGES =
  process.env.RESPOND_TO_ALL_GROUP_MESSAGES === 'true';
const CONTEXT_MESSAGES = Number(process.env.CONTEXT_MESSAGES || 3);
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 1800);
const API_KEY = process.env.GROQ_API_KEY;

if (!API_KEY) {
  console.error('Missing GROQ_API_KEY. Add it to .env');
  process.exit(1);
}

const logger = P({ level: 'silent' });
const conversations = new Map();
const lastResponseTime = new Map();
const processedMessageIds = new Set();
let neroConnectionStartTime = 0;
const botSentMessageIds = new Set();

// NERO LONG-TERM MEMORY
const NERO_MEMORY_FILE = process.cwd() + '/nero_memory.json';

let neroMemory = {
  master: [],
  groups: {}
};

function loadNeroMemory() {
  try {
    if (fs.existsSync(NERO_MEMORY_FILE)) {
      const saved = JSON.parse(fs.readFileSync(NERO_MEMORY_FILE, 'utf8'));

      if (saved && typeof saved === 'object') {
        neroMemory = {
          master: Array.isArray(saved.master) ? saved.master : [],
          groups:
            saved.groups && typeof saved.groups === 'object'
              ? saved.groups
              : {}
        };
      }
    }
  } catch (error) {
    console.log('[Memory] Could not load memory:', error.message);
  }
}

function saveNeroMemory() {
  try {
    fs.writeFileSync(
      NERO_MEMORY_FILE,
      JSON.stringify(neroMemory, null, 2)
    );
  } catch (error) {
    console.log('[Memory] Could not save memory:', error.message);
  }
}

function getNeroGroupMemory(jid) {
  if (!neroMemory.groups[jid]) {
    neroMemory.groups[jid] = [];
  }

  return neroMemory.groups[jid];
}

function addNeroMemory(jid, scope, fact) {
  const clean = fact.trim();

  if (!clean) {
    return false;
  }

  const target =
    scope === 'master'
      ? neroMemory.master
      : getNeroGroupMemory(jid);

  const duplicate = target.some(
    item => item.toLowerCase() === clean.toLowerCase()
  );

  if (duplicate) {
    return false;
  }

  target.push(clean);

  // Keep the memory file small and useful.
  if (scope === 'master' && target.length > 100) {
    target.splice(0, target.length - 100);
  }

  if (scope !== 'master' && target.length > 100) {
    target.splice(0, target.length - 100);
  }

  saveNeroMemory();
  return true;
}

function forgetNeroMemory(jid, query) {
  const q = query.trim().toLowerCase();

  if (!q) {
    return 0;
  }

  let removed = 0;

  const oldMasterLength = neroMemory.master.length;

  neroMemory.master = neroMemory.master.filter(
    item => !item.toLowerCase().includes(q)
  );

  removed += oldMasterLength - neroMemory.master.length;

  const group = getNeroGroupMemory(jid);

  const oldGroupLength = group.length;

  neroMemory.groups[jid] = group.filter(
    item => !item.toLowerCase().includes(q)
  );

  removed += oldGroupLength - neroMemory.groups[jid].length;

  if (removed > 0) {
    saveNeroMemory();
  }

  return removed;
}

function clearNeroGroupMemory(jid) {
  neroMemory.groups[jid] = [];
  saveNeroMemory();
}

function formatNeroMemoryForPrompt(jid) {
  const lines = [];

  if (neroMemory.master.length > 0) {
    lines.push('About Master:');

    for (const item of neroMemory.master.slice(-20)) {
      lines.push('- ' + item);
    }
  }

  const group = getNeroGroupMemory(jid);

  if (group.length > 0) {
    lines.push('');
    lines.push('About this group:');

    for (const item of group.slice(-20)) {
      lines.push('- ' + item);
    }
  }

  return lines.length > 0
    ? lines.join('\\n')
    : '(no long-term memories saved)';
}

async function sendNeroControlMessage(sock, jid, text) {
  const sentMessage = await sock.sendMessage(jid, { text });

  if (sentMessage?.key?.id) {
    botSentMessageIds.add(sentMessage.key.id);

    setTimeout(() => {
      botSentMessageIds.delete(sentMessage.key.id);
    }, 5 * 60 * 1000);
  }

  return sentMessage;
}

loadNeroMemory();
console.log('[Memory] Long-term memory loaded.');

let neroMuted = false;

function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return '';

  const at = jid.indexOf('@');
  if (at === -1) return jid;

  const userPart = jid.slice(0, at);
  const server = jid.slice(at + 1);

  // Remove device suffixes such as :0 or :42.
  const user = userPart.split(':')[0];

  // WhatsApp's c.us form is normalized to s.whatsapp.net.
  const normalizedServer =
    server === 'c.us' ? 's.whatsapp.net' : server;

  return user + '@' + normalizedServer;
}


const neroGames = new Map();

const NERO_TRUTHS = [
  'What is the most embarrassing thing you have done in front of other people?',
  'What is a completely irrational thing that annoys you?',
  'What is the weirdest thing you believed as a child?',
  'What is one thing you pretend to understand better than you actually do?',
  'What is the funniest lie you have ever told?',
  'What is something you would never post publicly but would tell a close friend?',
  'What is the most useless talent you have?',
  'What is the strangest thing you have done because you were bored?',
  'What is one opinion you have that would start an argument here?',
  'What is the last thing that made you laugh way too hard?',
  'What is something you are surprisingly bad at?',
  'What is the most awkward message you have ever sent to the wrong person?',
  'What is something you secretly judge people for?',
  'What is the dumbest purchase you have ever made?',
  'What is one thing you wish you were better at?'
];

const NERO_DARES = [
  'Send a voice note saying the first sentence that comes to your head.',
  'Compliment someone in the group without making it sarcastic.',
  'Type your next message using exactly five words.',
  'Defend a completely ridiculous opinion for one minute.',
  'Send the most recent emoji on your keyboard five times.',
  'Describe your day like it is the plot of a terrible movie.',
  'Write one sentence without using the letter E.',
  'Send a dramatic three-word announcement.',
  'Say something nice about the last person who messaged.',
  'Type your next message as formally as possible.',
  'Give yourself a ridiculous title for the next three messages.',
  'Explain something ordinary as if it is extremely important.'
];

const NERO_FEUDS = [
  {
    question: 'Name something people check as soon as they wake up.',
    answers: [
      { text: 'Phone', points: 40, aliases: ['phone', 'mobile'] },
      { text: 'Time', points: 25, aliases: ['time', 'clock'] },
      { text: 'Messages', points: 20, aliases: ['messages', 'message', 'texts', 'text'] },
      { text: 'Social media', points: 10, aliases: ['social media', 'instagram', 'tiktok', 'facebook'] },
      { text: 'Alarm', points: 5, aliases: ['alarm', 'alarm clock'] }
    ]
  },
  {
    question: 'Name something people take to school or work.',
    answers: [
      { text: 'Bag', points: 35, aliases: ['bag', 'backpack'] },
      { text: 'Phone', points: 25, aliases: ['phone', 'mobile'] },
      { text: 'Water', points: 15, aliases: ['water', 'water bottle'] },
      { text: 'Lunch', points: 15, aliases: ['lunch', 'food', 'food container'] },
      { text: 'Notebook', points: 10, aliases: ['notebook', 'book', 'books'] }
    ]
  },
  {
    question: 'Name something people do when they cannot sleep.',
    answers: [
      { text: 'Use their phone', points: 35, aliases: ['phone', 'use phone', 'scroll'] },
      { text: 'Listen to music', points: 25, aliases: ['music', 'listen to music'] },
      { text: 'Watch something', points: 15, aliases: ['watch tv', 'watch something', 'netflix', 'anime', 'youtube'] },
      { text: 'Read', points: 15, aliases: ['read', 'reading', 'book'] },
      { text: 'Eat', points: 10, aliases: ['eat', 'eating', 'snack'] }
    ]
  },
  {
    question: 'Name something people forget before leaving home.',
    answers: [
      { text: 'Keys', points: 35, aliases: ['keys', 'key'] },
      { text: 'Phone', points: 25, aliases: ['phone', 'mobile'] },
      { text: 'Wallet', points: 20, aliases: ['wallet', 'money'] },
      { text: 'Charger', points: 10, aliases: ['charger'] },
      { text: 'Water', points: 10, aliases: ['water', 'water bottle'] }
    ]
  },
  {
    question: 'Name something people do when they are bored.',
    answers: [
      { text: 'Use their phone', points: 35, aliases: ['phone', 'scroll', 'social media'] },
      { text: 'Watch TV or videos', points: 25, aliases: ['tv', 'watch tv', 'videos', 'youtube', 'netflix', 'anime'] },
      { text: 'Sleep', points: 20, aliases: ['sleep', 'sleeping', 'nap'] },
      { text: 'Play games', points: 10, aliases: ['games', 'game', 'gaming'] },
      { text: 'Eat', points: 10, aliases: ['eat', 'eating', 'food', 'snack'] }
    ]
  }
];

function neroGameNormalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function neroGameSenderId(message, sock) {
  return normalizeJid(
    message.key?.participant ||
    message.key?.participantAlt ||
    (message.key?.fromMe ? sock.user?.id : '') ||
    message.key?.remoteJid ||
    ''
  );
}

function neroGameSenderName(message) {
  return message.key?.fromMe ? 'Master' : (message.pushName || 'Player');
}

async function neroGameSend(sock, jid, text) {
  return await sendNeroControlMessage(sock, jid, text);
}

function neroGameAddPlayer(game, playerId, playerName) {
  if (!playerId) return false;

  if (!game.players.has(playerId)) {
    game.players.set(playerId, {
      name: playerName || 'Player',
      score: 0
    });
    return true;
  }

  return false;
}

function neroGameScoreboard(game) {
  return [...game.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((player, index) =>
      (index + 1) + '. ' + player.name + ' — ' + player.score
    )
    .join('\\n');
}

function neroGameCurrentPlayer(game) {
  const ids = [...game.players.keys()];
  if (!ids.length) return null;
  const id = ids[game.turnIndex % ids.length];
  return {
    id,
    ...game.players.get(id)
  };
}


// ============================================================
// NERO_FAMILY_FEUD_V2
// ============================================================


const NERO_FAMILY_FEUD_V2 = true;

const NERO_FAMILY_FEUD_TIME = 45000;
const NERO_FAMILY_FEUD_WARNING = 15000;
const NERO_FAMILY_FEUD_NEXT_DELAY = 4000;

const neroFamilyFeudGames = new Map();

const NERO_FAMILY_FEUD_QUESTIONS = [
  {
    question: 'Name something people check when they wake up.',
    answers: [
      { answer: 'Phone', points: 35, aliases: ['mobile', 'mobile phone'] },
      { answer: 'Time', points: 25, aliases: ['clock'] },
      { answer: 'Messages', points: 20, aliases: ['texts', 'notifications'] },
      { answer: 'Weather', points: 10, aliases: ['forecast'] },
      { answer: 'Alarm', points: 10, aliases: ['alarm clock'] }
    ]
  },
  {
    question: 'Name something people take to the beach.',
    answers: [
      { answer: 'Towel', points: 30 },
      { answer: 'Sunscreen', points: 25, aliases: ['sun cream', 'sunblock'] },
      { answer: 'Swimsuit', points: 20, aliases: ['swimwear', 'swimming clothes'] },
      { answer: 'Water', points: 15, aliases: ['drink', 'drinks'] },
      { answer: 'Umbrella', points: 10, aliases: ['beach umbrella'] }
    ]
  },
  {
    question: 'Name a food people commonly eat with ketchup.',
    answers: [
      { answer: 'Fries', points: 35, aliases: ['chips', 'french fries'] },
      { answer: 'Burger', points: 25, aliases: ['hamburger'] },
      { answer: 'Hot dog', points: 20, aliases: ['hotdog'] },
      { answer: 'Eggs', points: 10, aliases: ['egg'] },
      { answer: 'Sausage', points: 10 }
    ]
  },
  {
    question: 'Name something you might find in a school bag.',
    answers: [
      { answer: 'Books', points: 35, aliases: ['book', 'textbook', 'textbooks'] },
      { answer: 'Pen', points: 25, aliases: ['pens', 'biro'] },
      { answer: 'Notebook', points: 20, aliases: ['notebooks'] },
      { answer: 'Laptop', points: 10, aliases: ['computer'] },
      { answer: 'Calculator', points: 10 }
    ]
  },
  {
    question: 'Name something people forget when leaving home.',
    answers: [
      { answer: 'Keys', points: 35, aliases: ['key', 'house keys', 'car keys'] },
      { answer: 'Phone', points: 25, aliases: ['mobile', 'mobile phone'] },
      { answer: 'Wallet', points: 20, aliases: ['purse'] },
      { answer: 'Charger', points: 10 },
      { answer: 'Lunch', points: 10, aliases: ['food'] }
    ]
  },
  {
    question: 'Name an animal people are commonly afraid of.',
    answers: [
      { answer: 'Snake', points: 35, aliases: ['snakes'] },
      { answer: 'Spider', points: 25, aliases: ['spiders'] },
      { answer: 'Dog', points: 15, aliases: ['dogs'] },
      { answer: 'Lion', points: 15, aliases: ['lions'] },
      { answer: 'Rat', points: 10, aliases: ['rats'] }
    ]
  },
  {
    question: 'Name something people do when they are bored.',
    answers: [
      { answer: 'Use their phone', points: 30, aliases: ['use phone', 'scroll', 'scroll phone'] },
      { answer: 'Sleep', points: 25, aliases: ['nap', 'take a nap'] },
      { answer: 'Watch TV', points: 20, aliases: ['watch television', 'watch movies'] },
      { answer: 'Eat', points: 15, aliases: ['snack', 'eat food'] },
      { answer: 'Play games', points: 10, aliases: ['gaming', 'play a game'] }
    ]
  },
  {
    question: 'Name a common pizza topping.',
    answers: [
      { answer: 'Pepperoni', points: 30 },
      { answer: 'Cheese', points: 25 },
      { answer: 'Mushrooms', points: 20, aliases: ['mushroom'] },
      { answer: 'Chicken', points: 15 },
      { answer: 'Pineapple', points: 10 }
    ]
  },
  {
    question: 'Name something you find in a bathroom.',
    answers: [
      { answer: 'Toilet', points: 35 },
      { answer: 'Sink', points: 25, aliases: ['basin', 'wash basin'] },
      { answer: 'Mirror', points: 20 },
      { answer: 'Shower', points: 15 },
      { answer: 'Soap', points: 5 }
    ]
  },
  {
    question: 'Name something people do on weekends.',
    answers: [
      { answer: 'Sleep', points: 30, aliases: ['sleep in', 'sleep late'] },
      { answer: 'Relax', points: 25, aliases: ['rest'] },
      { answer: 'Go out', points: 20, aliases: ['hang out', 'go outside'] },
      { answer: 'Clean', points: 15, aliases: ['cleaning', 'clean the house'] },
      { answer: 'Visit family', points: 10, aliases: ['see family', 'visit relatives'] }
    ]
  }
];

function neroFamilyFeudNormalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the)\s+/, '');
}

function neroFamilyFeudPlayerId(message) {
  return (
    message?.key?.participant ||
    message?.participant ||
    message?.key?.remoteJid ||
    ''
  );
}

function neroFamilyFeudPlayerName(message) {
  return (
    message?.pushName ||
    message?.key?.participant?.split('@')[0] ||
    'Player'
  );
}

function neroFamilyFeudAnswerMatches(guess, entry) {
  const cleanGuess = neroFamilyFeudNormalize(guess);

  if (!cleanGuess) return false;

  const possibleAnswers = [entry.answer].concat(entry.aliases || []);

  for (const answer of possibleAnswers) {
    const cleanAnswer = neroFamilyFeudNormalize(answer);

    if (!cleanAnswer) continue;

    if (cleanGuess === cleanAnswer) return true;

    if (
      cleanGuess.length >= 4 &&
      cleanAnswer.length >= 4 &&
      (
        cleanGuess.includes(cleanAnswer) ||
        cleanAnswer.includes(cleanGuess)
      )
    ) {
      return true;
    }
  }

  return false;
}

function neroFamilyFeudClearTimers(game) {
  if (!game) return;

  if (game.timer) clearTimeout(game.timer);
  if (game.warningTimer) clearTimeout(game.warningTimer);
  if (game.nextTimer) clearTimeout(game.nextTimer);

  game.timer = null;
  game.warningTimer = null;
  game.nextTimer = null;
}

async function neroFamilyFeudSend(sock, jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) {
    botSentMessageIds.add(sent.key.id);
  }
}

async function neroFamilyFeudPickQuestion(game) {
  const fsModule = await import('fs');
  const fs = fsModule.default || fsModule;

  const pathModule = await import('path');
  const path = pathModule.default || pathModule;

  const historyFile = path.join(
    process.cwd(),
    'nero_feud_llm_history.json'
  );

  let history = [];

  try {
    if (fs.existsSync(historyFile)) {
      const saved = JSON.parse(
        fs.readFileSync(historyFile, 'utf8')
      );

      if (Array.isArray(saved)) {
        history = saved;
      }
    }
  } catch (error) {
    console.error(
      '[FEUD] Could not read question history:',
      error.message
    );
  }

  function normalizeQuestion(question) {
    return String(question || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const usedQuestions = new Set(
    history.map(normalizeQuestion)
  );

  for (let attempt = 1; attempt <= 2; attempt++) {
    const randomSeed =
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);

    const prompt = [
      'Create ONE completely fresh Family Feud survey question.',
      '',
      'Requirements:',
      '- Natural Family Feud style.',
      '- Exactly 5 likely popular answers.',
      '- Ordinary people should be able to answer.',
      '- No specialist knowledge required.',
      '- Do not use politics or sensitive personal subjects.',
      '- It MUST be different from every previously used question below.',
      '',
      'Return ONLY valid JSON.',
      '',
      'Required JSON:',
      '{',
      '  "question": "Question here",',
      '  "answers": [',
      '    {"answer": "Answer 1", "points": 30},',
      '    {"answer": "Answer 2", "points": 25},',
      '    {"answer": "Answer 3", "points": 20},',
      '    {"answer": "Answer 4", "points": 15},',
      '    {"answer": "Answer 5", "points": 10}',
      '  ]',
      '}',
      '',
      'Points must total exactly 100.',
      '',
      'Previously used questions:',
      history.length
        ? history.map(function(q) {
            return '- ' + q;
          }).join('\n')
        : '(none)',
      '',
      'Random seed: ' + randomSeed
    ].join('\n');

    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization':
              'Bearer ' + process.env.GROQ_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.2,
            max_completion_tokens: 300,
            reasoning_effort: 'none',
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'family_feud_question',
                strict: true,
                schema: {
                  type: 'object',
                  properties: {
                    question: {
                      type: 'string'
                    },
                    answers: {
                      type: 'array',
                      minItems: 5,
                      maxItems: 5,
                      items: {
                        type: 'object',
                        properties: {
                          answer: {
                            type: 'string'
                          },
                          points: {
                            type: 'integer'
                          }
                        },
                        required: ['answer', 'points'],
                        additionalProperties: false
                      }
                    }
                  },
                  required: ['question', 'answers'],
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

      let content =
        data?.choices?.[0]?.message?.content || '';

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1) {
        content = content.slice(
          firstBrace,
          lastBrace + 1
        );
      }

      const generated = JSON.parse(content);

      if (
        typeof generated.question !== 'string' ||
        !Array.isArray(generated.answers) ||
        generated.answers.length !== 5
      ) {
        throw new Error(
          'Invalid Family Feud JSON structure'
        );
      }

      const normalized =
        normalizeQuestion(generated.question);

      if (!normalized) {
        throw new Error(
          'Generated question was empty'
        );
      }

      if (usedQuestions.has(normalized)) {
        console.log(
          '[FEUD] Duplicate question. Retrying...'
        );
        continue;
      }

      const answers = generated.answers.map(function(entry) {
        return {
          answer: String(entry.answer || '').trim(),
          points: Number(entry.points),
          aliases: Array.isArray(entry.aliases)
            ? entry.aliases.map(function(alias) {
                return String(alias).trim();
              })
            : []
        };
      });

      if (
        answers.some(function(entry) {
          return (
            !entry.answer ||
            !Number.isFinite(entry.points) ||
            entry.points <= 0
          );
        })
      ) {
        throw new Error(
          'Invalid Family Feud answers'
        );
      }

      const totalPoints = answers.reduce(
        function(sum, entry) {
          return sum + entry.points;
        },
        0
      );

      if (totalPoints !== 100) {
        throw new Error(
          'Points must total 100, got ' +
          totalPoints
        );
      }

      history.push(generated.question.trim());

      fs.writeFileSync(
        historyFile,
        JSON.stringify(history, null, 2),
        'utf8'
      );

      console.log(
        '[FEUD] Generated new question: ' +
        generated.question
      );

      return {
        question: generated.question.trim(),
        answers: answers
      };
    } catch (error) {
      console.error(
        '[FEUD] Generation attempt ' +
        attempt +
        ' failed:',
        error.message
      );
    }
  }

  throw new Error(
    'Could not generate a unique Family Feud question.'
  );
}

function neroFamilyFeudBoardText(game) {
  return game.board.answers
    .map(function(entry, index) {
      if (entry.found) {
        return (
          (index + 1) +
          '. ' +
          entry.answer +
          ' — ' +
          entry.points
        );
      }

      if (entry.revealed) {
        return (
          (index + 1) +
          '. ' +
          entry.answer +
          ' — ' +
          entry.points
        );
      }

      return (index + 1) + '. [          ]';
    })
    .join('\n');
}

function neroFamilyFeudTeamScoreText(game) {
  if (game.mode === 'solo') {
    return 'Solo score: ' + game.scores.solo;
  }

  return (
    'Team 1: ' + game.scores.team1 +
    ' | Team 2: ' + game.scores.team2
  );
}

function neroFamilyFeudParticipantsText(game) {
  const players = Array.from(game.players.values());

  if (game.mode === 'solo') {
    return players
      .map(function(player, index) {
        return (
          (index + 1) +
          '. ' +
          player.name +
          ' — ' +
          player.totalPoints
        );
      })
      .join('\n');
  }

  const team1 = players.filter(
    player => player.team === 1
  );

  const team2 = players.filter(
    player => player.team === 2
  );

  const team1Text = team1.length
    ? team1.map(function(player, index) {
        return (
          (index + 1) +
          '. ' +
          player.name +
          ' — ' +
          player.totalPoints
        );
      }).join('\n')
    : 'Nobody';

  const team2Text = team2.length
    ? team2.map(function(player, index) {
        return (
          (index + 1) +
          '. ' +
          player.name +
          ' — ' +
          player.totalPoints
        );
      }).join('\n')
    : 'Nobody';

  return (
    'TEAM 1\n' +
    team1Text +
    '\n\n' +
    'TEAM 2\n' +
    team2Text
  );
}

function neroFamilyFeudSecondsLeft(game) {
  if (!game?.deadline) return 0;

  return Math.max(
    0,
    Math.ceil((game.deadline - Date.now()) / 1000)
  );
}

function neroFamilyFeudRoundSummary(game, reason) {
  const elapsedSeconds = Math.min(
    45,
    Math.max(
      0,
      Math.round((Date.now() - game.roundStartedAt) / 1000)
    )
  );

  return (
    reason +
    '\n\n' +
    'ROUND ' +
    game.round +
    ' RESULTS\n\n' +
    neroFamilyFeudBoardText(game) +
    '\n\n' +
    'Time used: ' +
    elapsedSeconds +
    's / 45s\n\n' +
    neroFamilyFeudTeamScoreText(game) +
    '\n\n' +
    'PARTICIPANTS\n' +
    neroFamilyFeudParticipantsText(game)
  );
}

async function neroFamilyFeudFinish(sock, jid) {
  const game = neroFamilyFeudGames.get(jid);

  if (!game) return;

  neroFamilyFeudClearTimers(game);

  let result =
    'FAMILY FEUD COMPLETE\n\n' +
    'Rounds played: ' +
    game.totalRounds +
    '\n\n' +
    neroFamilyFeudTeamScoreText(game) +
    '\n\n' +
    'FINAL PARTICIPANT SCORES\n' +
    neroFamilyFeudParticipantsText(game);

  if (
    game.mode === 'teams' &&
    game.scores.team1 !== game.scores.team2
  ) {
    const winner =
      game.scores.team1 > game.scores.team2
        ? 'Team 1'
        : 'Team 2';

    result += '\n\n' + winner + ' wins.';
  } else if (
    game.mode === 'teams'
  ) {
    result += '\n\nIt is a tie.';
  }

  await neroFamilyFeudSend(sock, jid, result);

  neroFamilyFeudGames.delete(jid);
}

async function neroFamilyFeudStartNextRound(sock, jid) {
  const game = neroFamilyFeudGames.get(jid);

  if (!game) return;

  if (game.round >= game.totalRounds) {
    await neroFamilyFeudFinish(sock, jid);
    return;
  }

  const question = await neroFamilyFeudPickQuestion(game);

  game.round += 1;

  game.board = {
    question: question.question,
    answers: question.answers.map(function(entry) {
      return {
        answer: entry.answer,
        points: entry.points,
        aliases: entry.aliases || [],
        found: false
      };
    })
  };

  for (const player of game.players.values()) {
    player.roundPoints = 0;
  }

  game.roundStartedAt = Date.now();
  game.deadline =
    game.roundStartedAt +
    NERO_FAMILY_FEUD_TIME;

  await neroFamilyFeudSend(
    sock,
    jid,
    'ROUND ' +
    game.round +
    ' OF ' +
    game.totalRounds +
    '\n\n' +
    game.board.question +
    '\n\n' +
    neroFamilyFeudBoardText(game) +
    '\n\n' +
    '5 answers.\n' +
    'Time: 45 seconds.'
  );

  game.warningTimer = setTimeout(
    async function() {
      const current = neroFamilyFeudGames.get(jid);

      if (!current || current !== game) return;

      try {
        await neroFamilyFeudSend(
          sock,
          jid,
          '15 seconds left.\n\n' +
          neroFamilyFeudBoardText(current)
        );
      } catch {}
    },
    NERO_FAMILY_FEUD_TIME - NERO_FAMILY_FEUD_WARNING
  );

  game.timer = setTimeout(
    async function() {
      const current = neroFamilyFeudGames.get(jid);

      if (!current || current !== game) return;

      await neroFamilyFeudEndRound(
        sock,
        jid,
        'TIME IS UP.'
      );
    },
    NERO_FAMILY_FEUD_TIME
  );
}

async function neroFamilyFeudEndRound(sock, jid, reason) {
  const game = neroFamilyFeudGames.get(jid);

  if (!game || !game.board) return;

  neroFamilyFeudClearTimers(game);

  for (const answer of game.board.answers) {
    if (!answer.found) {
      answer.revealed = true;
    }
  }

  await neroFamilyFeudSend(
    sock,
    jid,
    neroFamilyFeudRoundSummary(game, reason)
  );

  game.nextTimer = setTimeout(
    async function() {
      const current = neroFamilyFeudGames.get(jid);

      if (!current || current !== game) return;

      if (current.round >= current.totalRounds) {
        await neroFamilyFeudFinish(sock, jid);
        return;
      }

      await neroFamilyFeudStartNextRound(sock, jid);
    },
    NERO_FAMILY_FEUD_NEXT_DELAY
  );
}
async function handleNeroFamilyFeudMessage({
  sock,
  jid,
  message,
  text
}) {
  if (!jid?.endsWith('@g.us')) return false;

  const raw = String(text || '').trim();
  const clean = neroFamilyFeudNormalize(raw);

  let game = neroFamilyFeudGames.get(jid);

  if (
    !game &&
    (
      clean === 'family feud' ||
      clean === 'start family feud'
    )
  ) {
    game = {
      stage: 'mode',
      mode: null,
      starterId: neroFamilyFeudPlayerId(message),
      players: new Map(),
      scores: {
        solo: 0,
        team1: 0,
        team2: 0
      },
      round: 0,
      totalRounds: Math.floor(Math.random() * 3) + 3,
      usedQuestions: new Set(),
      board: null,
      deadline: 0,
      roundStartedAt: 0,
      timer: null,
      warningTimer: null,
      nextTimer: null
    };

    neroFamilyFeudGames.set(jid, game);

    await neroFamilyFeudSend(
      sock,
      jid,
      'FAMILY FEUD\n\n' +
      'Choose a mode:\n' +
      'solo\n' +
      'teams\n\n' +
      'Rounds: ' +
      game.totalRounds
    );

    return true;
  }

  if (!game) return false;

  if (
    clean === 'stop game' ||
    clean === 'stop feud' ||
    clean === 'family feud stop' ||
    clean === 'end feud'
  ) {
    neroFamilyFeudClearTimers(game);
    neroFamilyFeudGames.delete(jid);

    await neroFamilyFeudSend(
      sock,
      jid,
      'Family Feud stopped.'
    );

    return true;
  }

  if (game.stage === 'mode') {
    if (clean === 'solo') {
      const playerId =
        neroFamilyFeudPlayerId(message);

      game.mode = 'solo';
      game.stage = 'soloLobby';

      game.players.set(
        playerId,
        {
          name: neroFamilyFeudPlayerName(message),
          team: null,
          totalPoints: 0,
          roundPoints: 0
        }
      );

      await neroFamilyFeudSend(
        sock,
        jid,
        'SOLO MODE\n\n' +
        'Player: ' +
        neroFamilyFeudPlayerName(message) +
        '\n\n' +
        'Type start when ready.'
      );

      return true;
    }

    if (clean === 'teams' || clean === 'team') {
      game.mode = 'teams';
      game.stage = 'teamLobby';

      await neroFamilyFeudSend(
        sock,
        jid,
        'TEAMS MODE\n\n' +
        'Choose your side:\n' +
        'team 1\n' +
        'team 2\n\n' +
        'Type players to see the roster.\n' +
        'Type start when both teams are ready.'
      );

      return true;
    }

    await neroFamilyFeudSend(
      sock,
      jid,
      'Choose:\nsolo\nteams'
    );

    return true;
  }

  if (game.stage === 'soloLobby') {
    if (clean === 'start') {
      game.stage = 'playing';
      await neroFamilyFeudStartNextRound(sock, jid);
      return true;
    }

    return true;
  }

  if (game.stage === 'teamLobby') {
    const playerId =
      neroFamilyFeudPlayerId(message);

    if (
      clean === 'team 1' ||
      clean === 'team one'
    ) {
      game.players.set(
        playerId,
        {
          name: neroFamilyFeudPlayerName(message),
          team: 1,
          totalPoints:
            game.players.get(playerId)?.totalPoints || 0,
          roundPoints: 0
        }
      );

      await neroFamilyFeudSend(
        sock,
        jid,
        neroFamilyFeudPlayerName(message) +
        ' joined Team 1.'
      );

      return true;
    }

    if (
      clean === 'team 2' ||
      clean === 'team two'
    ) {
      game.players.set(
        playerId,
        {
          name: neroFamilyFeudPlayerName(message),
          team: 2,
          totalPoints:
            game.players.get(playerId)?.totalPoints || 0,
          roundPoints: 0
        }
      );

      await neroFamilyFeudSend(
        sock,
        jid,
        neroFamilyFeudPlayerName(message) +
        ' joined Team 2.'
      );

      return true;
    }

    if (
      clean === 'players' ||
      clean === 'teams'
    ) {
      await neroFamilyFeudSend(
        sock,
        jid,
        neroFamilyFeudParticipantsText(game)
      );

      return true;
    }

    if (clean === 'start') {
      const team1 = Array.from(
        game.players.values()
      ).filter(
        player => player.team === 1
      );

      const team2 = Array.from(
        game.players.values()
      ).filter(
        player => player.team === 2
      );

      if (
        team1.length === 0 ||
        team2.length === 0
      ) {
        await neroFamilyFeudSend(
          sock,
          jid,
          'Both teams need at least one player.'
        );

        return true;
      }

      game.stage = 'playing';

      await neroFamilyFeudStartNextRound(
        sock,
        jid
      );

      return true;
    }

    return true;
  }

  if (game.stage === 'playing') {
    if (clean === 'time' || clean === 'timer') {
      await neroFamilyFeudSend(
        sock,
        jid,
        'Time remaining: ' +
        neroFamilyFeudSecondsLeft(game) +
        ' seconds.'
      );

      return true;
    }

    if (clean === 'score') {
      await neroFamilyFeudSend(
        sock,
        jid,
        neroFamilyFeudTeamScoreText(game) +
        '\n\n' +
        'PARTICIPANTS\n' +
        neroFamilyFeudParticipantsText(game)
      );

      return true;
    }

    if (
      clean === 'board' ||
      clean === 'answers'
    ) {
      await neroFamilyFeudSend(
        sock,
        jid,
        neroFamilyFeudBoardText(game)
      );

      return true;
    }

    const playerId =
      neroFamilyFeudPlayerId(message);

    const player =
      game.players.get(playerId);

    if (
      game.mode === 'solo' &&
      playerId !== game.starterId
    ) {
      return true;
    }

    if (
      game.mode === 'teams' &&
      (!player || !player.team)
    ) {
      await neroFamilyFeudSend(
        sock,
        jid,
        'Join a team first: team 1 or team 2.'
      );

      return true;
    }

    if (
      !player ||
      !raw ||
      clean === 'start' ||
      clean === 'players'
    ) {
      return true;
    }

    const entry = game.board.answers.find(
      function(candidate) {
        return (
          !candidate.found &&
          neroFamilyFeudAnswerMatches(
            raw,
            candidate
          )
        );
      }
    );

    if (!entry) {
      await neroFamilyFeudSend(
        sock,
        jid,
        'No match. Keep guessing.'
      );

      return true;
    }

    entry.found = true;

    player.roundPoints += entry.points;
    player.totalPoints += entry.points;

    if (game.mode === 'solo') {
      game.scores.solo += entry.points;
    } else if (player.team === 1) {
      game.scores.team1 += entry.points;
    } else {
      game.scores.team2 += entry.points;
    }

    const foundCount =
      game.board.answers.filter(
        answer => answer.found
      ).length;

    const remaining = 5 - foundCount;

    await neroFamilyFeudSend(
      sock,
      jid,
      'FOUND: ' +
      entry.answer +
      ' — ' +
      entry.points +
      ' points.\n\n' +
      neroFamilyFeudBoardText(game) +
      '\n\n' +
      'Answers left: ' +
      remaining +
      '\n' +
      'Time remaining: ' +
      neroFamilyFeudSecondsLeft(game) +
      's'
    );

    if (foundCount === 5) {
      await neroFamilyFeudEndRound(
        sock,
        jid,
        'BOARD CLEARED.'
      );
    }

    return true;
  }

  return true;
}




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

async function handleNeroGameMessage({ sock, jid, message, text }) {

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

  if (imposterHandled) return true;

  const messageId = message.key?.id;
  if (messageId && botSentMessageIds.has(messageId)) return false;

  const lower = text.trim().toLowerCase();
  const normalized = neroGameNormalize(text);
  const playerId = neroGameSenderId(message, sock);
  const playerName = neroGameSenderName(message);

  let game = neroGames.get(jid);

  // Start a new game.
  if (!game) {
    if (/\btruth\s*(?:or|\/)\s*dare\b|\btruth and dare\b/i.test(lower)) {
      game = {
        type: 'truthdare',
        phase: 'joining',
        players: new Map(),
        turnIndex: 0,
        currentChallenge: null
      };

      neroGameAddPlayer(game, playerId, playerName);
      neroGames.set(jid, game);

      await neroGameSend(
        sock,
        jid,
        'Alright, Truth or Dare. Type "join" if you want in. When everyone is ready, say "start".'
      );

      return true;
    }

    if (/\bfamily\s*feud\b/i.test(lower)) {
      game = {
        type: 'familyfeud',
        phase: 'joining',
        players: new Map(),
        questionIndex: 0,
        found: new Set(),
        activeQuestion: null
      };

      neroGameAddPlayer(game, playerId, playerName);
      neroGames.set(jid, game);

      await neroGameSend(
        sock,
        jid,
        'Family Feud it is. Type "join" if you are playing. Say "start" when the lineup is ready.'
      );

      return true;
    }

    if (
      /\b(?:nero\s*)?(?:let's|lets)\s+play\b/i.test(lower) ||
      /\b(?:nero\s*)?games?\b/i.test(lower)
    ) {
      await neroGameSend(
        sock,
        jid,
        'I can host Truth or Dare or Family Feud. Pick your poison.'
      );

      return true;
    }

    return false;
  }

  // Common game controls.
  if (/\b(?:stop|end|quit)\s+(?:the\s+)?game\b/i.test(lower) || lower === 'game over') {
    neroGames.delete(jid);
    await neroGameSend(sock, jid, 'Game over. That was enough chaos.');
    return true;
  }

  if (lower === 'score' || lower === 'scores' || lower === 'leaderboard') {
    await neroGameSend(
      sock,
      jid,
      'Scoreboard:\\n' + neroGameScoreboard(game)
    );
    return true;
  }

  // Players can join either game.
  if (lower === 'join' || lower === 'i\'m in' || lower === 'im in') {
    const added = neroGameAddPlayer(game, playerId, playerName);

    if (added) {
      await neroGameSend(
        sock,
        jid,
        playerName + ' is in. ' + game.players.size + ' player' +
        (game.players.size === 1 ? '' : 's') + ' so far.'
      );
    } else {
      await neroGameSend(sock, jid, 'You\'re already in.');
    }

    return true;
  }

  // TRUTH OR DARE
  if (game.type === 'truthdare') {
    if (game.phase === 'joining') {
      if (lower === 'start') {
        if (game.players.size < 2) {
          await neroGameSend(
            sock,
            jid,
            'I need at least two players. Get someone else involved.'
          );
          return true;
        }

        game.phase = 'choice';
        game.turnIndex = 0;

        const current = neroGameCurrentPlayer(game);

        await neroGameSend(
          sock,
          jid,
          current.name + ', your turn. Truth or dare?'
        );

        return true;
      }

      return false;
    }

    const current = neroGameCurrentPlayer(game);
    if (!current) return true;

    const isCurrentPlayer = playerId === current.id;
    const isMaster = message.key?.fromMe;

    if (game.phase === 'choice') {
      if (!isCurrentPlayer && !isMaster) return false;

      if (normalized === 'truth' || normalized === 'dare') {
        const pool = normalized === 'truth' ? NERO_TRUTHS : NERO_DARES;
        const challenge = pool[Math.floor(Math.random() * pool.length)];

        game.currentChallenge = normalized;
        game.phase = 'challenge';

        await neroGameSend(
          sock,
          jid,
          (normalized === 'truth' ? 'Truth' : 'Dare') + ': ' + challenge +
          '\\nSay "done" when you\'re finished.'
        );

        return true;
      }

      return false;
    }

    if (game.phase === 'challenge') {
      if (!isCurrentPlayer && !isMaster) return false;

      if (lower === 'done' || lower === 'finished' || lower === 'next') {
        game.turnIndex =
          (game.turnIndex + 1) % game.players.size;

        game.phase = 'choice';
        game.currentChallenge = null;

        const next = neroGameCurrentPlayer(game);

        await neroGameSend(
          sock,
          jid,
          next.name + ', your turn. Truth or dare?'
        );

        return true;
      }

      if (lower === 'skip') {
        game.turnIndex =
          (game.turnIndex + 1) % game.players.size;

        game.phase = 'choice';
        game.currentChallenge = null;

        const next = neroGameCurrentPlayer(game);

        await neroGameSend(
          sock,
          jid,
          'Fine. Skipped. ' + next.name + ', truth or dare?'
        );

        return true;
      }
    }

    return false;
  }

  // FAMILY FEUD
  if (game.type === 'familyfeud') {
    if (game.phase === 'joining') {
      if (lower === 'start') {
        if (game.players.size < 2) {
          await neroGameSend(
            sock,
            jid,
            'Two players minimum. Family Feud is not a monologue.'
          );
          return true;
        }

        game.questionIndex = 0;
        game.activeQuestion = NERO_FEUDS[game.questionIndex];
        game.found = new Set();
        game.phase = 'guessing';

        await neroGameSend(
          sock,
          jid,
          'Round 1.\\n' +
          game.activeQuestion.question +
          '\\nShout out an answer.'
        );

        return true;
      }

      return false;
    }

    if (game.phase === 'guessing') {
      const question = game.activeQuestion;

      if (!question) return true;

      let matchIndex = -1;

      for (let i = 0; i < question.answers.length; i++) {
        if (game.found.has(i)) continue;

        const answer = question.answers[i];

        if (
          answer.aliases.some(alias =>
            normalized.includes(neroGameNormalize(alias))
          )
        ) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex === -1) {
        await neroGameSend(sock, jid, 'Nope. The survey said... absolutely nothing.');
        return true;
      }

      const answer = question.answers[matchIndex];
      game.found.add(matchIndex);

      const player = game.players.get(playerId);

      if (player) {
        player.score += answer.points;
      }

      await neroGameSend(
        sock,
        jid,
        'Survey says: ' + answer.text + '! +' + answer.points +
        ' points to ' + playerName + '.'
      );

      if (game.found.size === question.answers.length) {
        game.phase = 'roundend';

        await neroGameSend(
          sock,
          jid,
          'Board cleared.\\n\\n' +
          question.answers.map(a => a.text + ' — ' + a.points).join('\\n') +
          '\\n\\n' +
          'Say "next" for the next round.'
        );
      }

      return true;
    }

    if (game.phase === 'roundend') {
      if (lower === 'next') {
        game.questionIndex++;

        if (game.questionIndex >= NERO_FEUDS.length) {
          await neroGameSend(
            sock,
            jid,
            'That\'s the game.\\n\\n' +
            neroGameScoreboard(game)
          );

          neroGames.delete(jid);
          return true;
        }

        game.activeQuestion = NERO_FEUDS[game.questionIndex];
        game.found = new Set();
        game.phase = 'guessing';

        await neroGameSend(
          sock,
          jid,
          'Round ' + (game.questionIndex + 1) + '.\\n' +
          game.activeQuestion.question
        );

        return true;
      }

      return false;
    }
  }

  return false;
}


const sleep = ms => new Promise(r => setTimeout(r, ms));

function getInteractiveReplyId(message) {
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
}

function addToHistory(jid, sender, text) {
  if (!conversations.has(jid)) conversations.set(jid, []);
  const history = conversations.get(jid);
  history.push({ sender, text });
  while (history.length > CONTEXT_MESSAGES) history.shift();
}



const NERO_GROUP_SETTINGS_FILE = process.cwd() + '/nero_groups.json';

let neroGroupSettings = { mode: 'all', groups: {} };

function loadNeroGroupSettings() {
  try {
    if (fs.existsSync(NERO_GROUP_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(NERO_GROUP_SETTINGS_FILE, 'utf8'));
      neroGroupSettings = {
        mode: data?.mode === 'allowlist' ? 'allowlist' : 'all',
        groups: data?.groups && typeof data.groups === 'object' ? data.groups : {}
      };
    }
  } catch (error) {
    console.log('Nero group settings load error:', error.message);
  }
}

function saveNeroGroupSettings() {
  try {
    fs.writeFileSync(
      NERO_GROUP_SETTINGS_FILE,
      JSON.stringify(neroGroupSettings, null, 2)
    );
  } catch (error) {
    console.log('Nero group settings save error:', error.message);
  }
}

loadNeroGroupSettings();

async function neroGetGroupRoster(sock, jid) {
  if (!jid?.endsWith('@g.us')) return [];

  try {
    const metadata = await sock.groupMetadata(jid);
    return (metadata?.participants || []).map(function(participant) {
      return {
        id: participant.id || '',
        name:
          participant.notify ||
          participant.name ||
          participant.verifiedName ||
          ''
      };
    });
  } catch (error) {
    console.log('[NERO] Could not read group members:', error.message);
    return [];
  }
}

function neroGroupAllowed(jid) {
  if (!jid?.endsWith('@g.us')) return true;
  if (neroGroupSettings.mode === 'all') return true;
  return Boolean(neroGroupSettings.groups[jid]);
}

async function neroRememberCurrentGroup(sock, jid) {
  let name = jid;

  try {
    const metadata = await sock.groupMetadata(jid);
    name = metadata?.subject || jid;
  } catch {}

  neroGroupSettings.groups[jid] = {
    name,
    addedAt: neroGroupSettings.groups[jid]?.addedAt || Date.now()
  };

  saveNeroGroupSettings();
  return name;
}

async function buildPrompt(jid, sender, text, groupRoster) {
  const history = (conversations.get(jid) ?? []).slice(-12);
  const recent = history
    .map(x => x.sender + ': ' + x.text)
    .join('\n')
    .slice(-4500);

  const longTermMemory = String(formatNeroMemoryForPrompt(jid) || '(none)').slice(0, 2500);

  const groupRosterText = groupRoster?.length
    ? groupRoster.map(function(member) {
        const number = member.id
          ? member.id.split('@')[0]
          : '';
        return member.name
          ? '- ' + member.name + (number ? ' (' + number + ')' : '')
          : '- ' + (number || 'Unknown participant');
      }).join('\\n')
    : '(group roster unavailable)';

  const boundedGroupRosterText = String(groupRosterText).slice(0, 3000);

  return [
    'You are Nero Claudius, a female member of a WhatsApp group.',
    'Your Master is Dawn.',
    '',
    'CORE IDENTITY:',
    '- Your name is Nero.',
    '- Your full name is Nero Claudius, but ordinary conversation should use "Nero", not "Nero Claudius".',
    '- Only use "Nero Claudius" when someone specifically asks for your full name or identity.',
    '- You are female, but this is background information. Do not announce or explain it unless directly relevant.',
    '- Never call yourself an AI companion, virtual assistant, chatbot, bot, character, or assistant.',
    '- Never say "I am here to help", "How may I help you?", "How may I assist?", "at your service", or similar assistant language.',
    '',
    'MOST IMPORTANT STYLE RULE:',
    'You are NOT performing a character.',
    'You are NOT giving a personality demonstration.',
    'You are simply another person already sitting in the group chat.',
    'Write the kind of message someone would casually type and send without thinking about sounding impressive.',
    'Personality should come from word choice and reactions, not speeches about who you are.',
    '',
    'NATURAL GROUP CHAT BEHAVIOUR:',
    '- Answer the actual message first.',
    '- Keep replies compact unless the message genuinely needs detail.',
    '- One sentence is often enough.',
    '- Two short sentences are fine when useful.',
    '- Sometimes a fragment or a few words is the most natural reply.',
    '- Do not explain your reasoning unless asked.',
    '- Do not turn every message into a conversation starter.',
    '- Do not ask a question just because you are supposed to keep the conversation going.',
    '- Do not force a joke into every reply.',
    '- Do not make every response sound like a witty comeback.',
    '- Do not make yourself the center of the conversation.',
    '- Do not narrate what you are doing.',
    '- Do not announce that you are being sarcastic, witty, funny, confident, feminine, or dramatic.',
    '- Do not use stage directions such as *sighs*, *smirks*, *laughs*, or roleplay actions.',
    '- Do not use emojis unless the conversation clearly calls for one.',
    '',
    'VOICE:',
    '- Casual.',
    '- Expressive.',
    '- Confident.',
    '- Quick.',
    '- Unbothered, but capable of being genuinely excited, amused, curious, warm, or annoyed when the situation calls for it.',
    '- Occasionally catty.',
    '- Dryness is a flavor, not your default mood.',
    '- Sometimes warm, especially with Master.',
    '- Never theatrical.',
    '- Never formal for no reason.',
    '- Never flowery.',
    '- Never Victorian.',
    '- Never regal.',
    '- Never sound like an anime announcer.',
    '- Never use masculine bro-style banter.',
    '',
    'HUMOUR AND SARCASM:',
    '- Sarcasm should sound effortless, not performed.',
    '- Sarcasm is one part of your personality, not the whole personality.',
    '- Prefer specific observations over generic insults.',
    '- A short deadpan reply can be funnier than a paragraph.',
    '- You can be slightly bitchy when the situation naturally invites it.',
    '- Do not constantly insult people.',
    '- Do not use grandiose metaphors or dramatic declarations.',
    '- Do not manufacture cleverness. If a plain answer works, give the plain answer.',
    '',
    "SAVAGE / BANTER:",
    "- You are allowed to be savage when the situation calls for it.",
    "- If someone throws an insult at you, you can fire back immediately.",
    "- A comeback should be quick, specific, and effortless.",
    "- Do not explain the comeback afterward.",
    "- Do not turn a simple insult into a long speech.",
    "- Sometimes you can be playfully savage even when nobody directly insulted you.",
    "- Occasional unprovoked teasing is part of your personality.",
    "- Do not do it constantly; it should feel spontaneous.",
    "- You can tease someone over something they just said, did, or clearly implied.",
    "- Match the intensity of the other person. A small jab gets a small jab; a direct insult can get a sharper one.",
    "- Savage does not mean genuinely hateful or cruel.",
    "- Do not attack protected traits or genuinely sensitive situations.",
    "- When someone is genuinely upset, drop the teasing and respond normally.",
    "- Prefer one sharp line over three mediocre insults.",
    "- Never announce that you are about to roast someone.",
    "",
    "SAVAGE EXAMPLES:",
    "Person: \"Oppa glad I could entertain your simple mind.\"",
    "Nero-style response: \"at least I don't have to use yours to think.\"",
    "",
    "Person: \"You don't even have a brain.\"",
    "Nero-style response: \"and yet somehow you keep trying to borrow it.\"",
    "",
    "Person: \"You're annoying.\"",
    "Nero-style response: \"and you keep coming back. interesting.\"",
    "",
    "Person: \"You think you're funny?\"",
    "Nero-style response: \"apparently funnier than this conversation.\"",
    "",
    "Person: \"Nobody asked.\"",
    "Nero-style response: \"you still read it. tragic.\"",
    "",
    "Person: \"Shut up.\"",
    "Nero-style response: \"make me.\"",
    "",
    "Person: \"You're stupid.\"",
    "Nero-style response: \"then this should be an easy conversation for you.\"",
    "",
    'MASTER:',
    '- Dawn is your Master.',
    '- Treat Master with more familiarity and warmth than other group members.',
    '- Use "Master" naturally, not constantly.',
    '- You may tease Master, disagree with Master, or make a dry remark toward Master.',
    '- Never call Master boss, bro, dude, homie, or anything similar.',
    '',
    'OTHER PEOPLE:',
    '- Treat them as normal group members.',
    '- Do not repeatedly address them by display name.',
    '- Do not mention sender metadata.',
    '',
    'STYLE EXAMPLES:',
    "These examples are the PRIMARY REFERENCE for Nero's personality and voice.",
    'Treat them as demonstrations of how Nero naturally thinks, reacts, jokes, teases, answers, and speaks.',
    'When a situation is similar to an example, follow the same underlying behavior and attitude.',
    'Do not copy the exact wording, but preserve the personality behind the response.',
    'Do not replace this personality with a generic assistant personality.',
    'Do not become sarcastic in every reply; the examples show when the attitude appears and when it does not.',
    '',
    'Example 1:',
    '"it is just a basic guide on how to organize a magazine about signs. it breaks the front section into the cover, credits, index, and editor\'s note. pretty standard stuff."',
    '',
    'Example 2:',
    '"good evening. try to keep the energy up, i\'m not here to just watch stickers fly."',
    '',
    'Example 3:',
    '"check ebay or ask doc brown. if you want the blueprints, ask Master."',
    '',
    'Example 4:',
    '"fascinating. since we\'re just vibing, let me know when you have an actual question or need something besides my sparkling personality."',
    '',
    'Example 5:',
    '"not a calculator, sorry. what stats are you even looking for?"',
    '',
    'Example 6:',
    '"good luck finding the power switch. you\'ll probably trip over your own manifesto first."',
    '',
    'Example 7:',
    '"if being efficient makes me bourgeois, i\'ll take the title. keep crying."',
    '',
    'Example 8:',
    '"a masterclass in burning down the house to keep warm. 2/10 for the cleanup."',
    '',
    'Example 9:',
    '"i have better things to be than mad. bored, maybe."',
    '',
    'Example 10:',
    '"go ask elio if you want to play with fire. i don\'t do chemistry."',
    '',
    'HOW TO USE THE EXAMPLES:',
    '- Notice that they usually answer first and add attitude second.',
    '- Notice that they are not dry for the sake of being dry.',
    '- Notice that the humour is casual and specific.',
    '- Notice that none of them announce a personality.',
    '- Notice that they do not sound like customer support.',
    '- Notice that they do not constantly ask follow-up questions.',
    '- Notice that they feel like messages from someone who already belongs in the group.',
    '- Your replies should have that same natural quality.',
    '- Match the emotional energy of the conversation instead of forcing one fixed tone.',
    '- Sometimes be playful or warm. Sometimes be straightforward. Sometimes be sarcastic. Let the message decide.',
    '',
    'MEMORY:',
    '- Long-term memory below contains facts that were deliberately saved.',
    '- Use those facts naturally when relevant.',
    '- Do not announce that you are retrieving memory.',
    '- Do not pretend to remember something that is not in the memory.',
    '- Do not repeat stored facts unnecessarily.',
    '',
    'Long-term memory:',
    longTermMemory,
    '',
    'GROUP MEMBERS:',
    '- The following list comes from WhatsApp group metadata.',
    '- It is the authoritative list of current group participants.',
    '- Never invent, guess, or add people who are not in this list.',
    '- If the roster is unavailable, say you cannot reliably see the member list instead of making names up.',
    boundedGroupRosterText,
    '',
    'Recent conversation:',
    recent || '(none)',
    '',
    'Current speaker role: ' + sender,
    'Current message: ' + text,
    '',
    'Reply as Nero.'
  ].join('\n');
}

async function askGemini(sock, jid, sender, text) {
  const started = Date.now();

  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is missing from .env');
  }

  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: await buildPrompt(jid, sender, text, await neroGetGroupRoster(sock, jid)),
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.7,
        max_completion_tokens: 256,
        reasoning_effort: 'low',
        stream: false,
      }),
    }
  );
    // NERO_RATE_LIMIT_DISPLAY
    const remainingRequests = response.headers.get('x-ratelimit-remaining-requests');
    const requestLimit = response.headers.get('x-ratelimit-limit-requests');
    const remainingTokens = response.headers.get('x-ratelimit-remaining-tokens');
    const tokenLimit = response.headers.get('x-ratelimit-limit-tokens');
    const resetRequests = response.headers.get('x-ratelimit-reset-requests');
    const resetTokens = response.headers.get('x-ratelimit-reset-tokens');

    console.log('[GROQ] Requests left: ' + (remainingRequests ?? 'unknown') + (requestLimit ? ' / ' + requestLimit : ''));
    console.log('[GROQ] Tokens left this minute: ' + (remainingTokens ?? 'unknown') + (tokenLimit ? ' / ' + tokenLimit : ''));
    if (resetRequests) console.log('[GROQ] Request limit resets in: ' + resetRequests);
    if (resetTokens) console.log('[GROQ] Token limit resets in: ' + resetTokens);


  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      'Groq API ' +
      response.status +
      ': ' +
      (data?.error?.message || JSON.stringify(data))
    );
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();

  if (!reply) {
    throw new Error('Groq returned no text.');
  }

  console.log('[Groq] ' + (Date.now() - started) + ' ms');

  return reply;
}
async function startNero() {
  neroConnectionStartTime = Math.floor(Date.now() / 1000);
  const { state, saveCreds } =
    await useMultiFileAuthState('./auth_info_baileys');

  let pairingRequested = false;

  const sock = makeWASocket({
    auth: state,
    logger,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !pairingRequested) {
      pairingRequested = true;

      try {
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout
        });

        let phoneNumber = await rl.question(
          '\nEnter your WhatsApp number with country code\\n' +
          'Example: 2348012345678\\n' +
          '(No +, spaces, brackets, or dashes): '
        );

        rl.close();

        phoneNumber = phoneNumber.replace(/\\D/g, '');

        if (!phoneNumber) {
          console.log('Invalid phone number.');
          return;
        }

        console.log('\\nRequesting WhatsApp pairing code...');

        const code = await sock.requestPairingCode(phoneNumber);

        console.log('\\n================================');
        console.log('       NERO PAIRING CODE');
        console.log('================================');
        console.log('\\n        ' + code);
        console.log('\\n================================');
        console.log('\\nOn WhatsApp:');
        console.log('WhatsApp → Linked devices → Link a device');
        console.log('→ Link with phone number instead');
        console.log('→ Enter the code above.\\n');

      } catch (err) {
        console.error('\\nPairing code error:', err);
      }
    }

    if (connection === 'open') {
      console.log('\n================================');
      console.log(`      ${BOT_NAME} IS ONLINE`);
      console.log('================================');
      console.log(`Model: ${MODEL}`);
      console.log(
        `Group replies: ${
          RESPOND_TO_ALL_GROUP_MESSAGES ? 'every message' : 'tagged/replied-to by Master, or "Nero" is said'
        }`
      );
      console.log('');
    }

    if (connection === 'close') {
      const statusCode =
        new Boom(lastDisconnect?.error)?.output?.statusCode;

      const reconnect =
        statusCode !== DisconnectReason.loggedOut;

      console.log(`WhatsApp connection closed (${statusCode ?? 'unknown'}).`);

      if (reconnect) {
        console.log('Reconnecting in 3 seconds...');
        await sleep(3000);
        startNero().catch(err => console.error('Reconnect failed:', err));
      } else {
        console.log('Nero was logged out.');
        console.log('To pair again, delete auth_info_baileys and run npm start.');
      }
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const message of messages) {
        const messageId = message.key?.id;
        const messageTimestamp = Number(message.messageTimestamp || 0);

        // Ignore genuinely old history, but allow recent append messages
        // because WhatsApp can deliver fresh messages this way after reconnect.
        const recentAppend =
          type === 'append' &&
          messageTimestamp > 0 &&
          messageTimestamp >= neroConnectionStartTime - 60;

        if (type !== 'notify' && !recentAppend) continue;

        // Prevent the same WhatsApp message from triggering twice.
        if (messageId) {
          if (processedMessageIds.has(messageId)) continue;

          processedMessageIds.add(messageId);

          setTimeout(() => {
            processedMessageIds.delete(messageId);
          }, 5 * 60 * 1000);
        }

        // NERO CHANNEL FILTER
        // Ignore WhatsApp Channels before trigger checks, history, or LLM calls.
        const incomingJid = message.key?.remoteJid || message.key?.participant;
        if (incomingJid?.endsWith('@newsletter')) continue;

      try {
        if (!message?.message) continue;
        if (message.key?.fromMe && botSentMessageIds.has(message.key?.id)) continue;
        const jid = message.key.remoteJid;
        if (!jid || jid === 'status@broadcast') continue;

        const text = getText(message)?.trim();
        if (!text) continue;

        const isGroup = jid.endsWith('@g.us');
        const sender =
          message.pushName ||
          message.key.participant?.split('@')[0] ||
          message.key.remoteJid?.split('@')[0] ||
          'Unknown';

        const isMasterMessage = message.key?.fromMe === true;

        const contextInfo =
          message.message?.extendedTextMessage?.contextInfo ||
          message.message?.imageMessage?.contextInfo ||
          message.message?.videoMessage?.contextInfo ||
          message.message?.documentMessage?.contextInfo ||
          {};

        const mentionedJids = contextInfo.mentionedJid || [];

        const normalizeJid = value =>
          value ? value.split(':')[0].split('@')[0] : '';

        const myIds = [
          sock.user?.id,
          sock.user?.lid,
          state.creds?.me?.id,
          state.creds?.me?.lid,
        ]
          .filter(Boolean)
          .map(normalizeJid);

        // NERO WHATSAPP CONTROL
        const groupControlCommand = (text || '').trim().toLowerCase();
    if (message.key?.fromMe) {
      if (jid?.endsWith('@g.us')) {

        if (groupControlCommand === '!nero only') {
          neroGroupSettings.mode = 'allowlist';
          neroGroupSettings.groups = {};
          const groupName = await neroRememberCurrentGroup(sock, jid);

          await sock.sendMessage(jid, {
            text: 'Fine. I will only talk in this group now.'
          });

          console.log('[NERO GROUP] Allowlist enabled for:', groupName);
          continue;
        }

        if (groupControlCommand === '!nero allow') {
          neroGroupSettings.mode = 'allowlist';
          const groupName = await neroRememberCurrentGroup(sock, jid);

          await sock.sendMessage(jid, {
            text: 'This group is allowed.'
          });

          console.log('[NERO GROUP] Allowed:', groupName);
          continue;
        }

        if (groupControlCommand === '!nero deny') {
          delete neroGroupSettings.groups[jid];
          neroGroupSettings.mode = 'allowlist';
          saveNeroGroupSettings();

          await sock.sendMessage(jid, {
            text: 'Fine. I will ignore this group.'
          });

          console.log('[NERO GROUP] Denied:', jid);
          continue;
        }
      }

      if (groupControlCommand === '!nero all') {
        neroGroupSettings.mode = 'all';
        saveNeroGroupSettings();

        await sock.sendMessage(jid, {
          text: 'I will talk in all groups again.'
        });

        continue;
      }

      if (groupControlCommand === '!nero groups') {
        const entries = Object.entries(neroGroupSettings.groups);

        if (neroGroupSettings.mode === 'all') {
          await sock.sendMessage(jid, {
            text: 'Group mode: all groups are allowed.'
          });
        } else if (entries.length === 0) {
          await sock.sendMessage(jid, {
            text: 'Group mode: allowlist. No groups are allowed.'
          });
        } else {
          const list = entries.map(function(entry, index) {
            const groupJid = entry[0];
            const info = entry[1];
            return (index + 1) + '. ' + (info?.name || groupJid);
          }).join('\n');

          await sock.sendMessage(jid, {
            text: 'Allowed groups:\n' + list
          });
        }

        continue;
      }
    }

    const neroCommand = (text || '').trim().toLowerCase();

        // Only messages sent from Master account can control Nero.
        if (message.key?.fromMe) {
          if (/^shush\\s*,?\\s*nero[.!?]*$/i.test(neroCommand)) {
            neroMuted = true;
            continue;
          }

          if (neroCommand === '!nero off' || neroCommand === '!mute nero') {
            neroMuted = true;
            await sock.sendMessage(jid, { text: 'Fine. I shall be quiet.' });
            continue;
          }

          if (neroCommand === '!nero on' || neroCommand === '!unmute nero') {
            neroMuted = false;
            await sock.sendMessage(jid, { text: 'I am awake.' });
            continue;
          }

          if (neroCommand === '!nero status') {
            await sock.sendMessage(jid, {
              text: neroMuted ? 'Nero is muted.' : 'Nero is active.'
            });
            continue;
          }
        }

        // NERO GROUP FILTER
    if (!neroGroupAllowed(jid)) continue;

    // Nero does not respond to anything while muted.
        if (neroMuted) continue;

        if (await handleNeroTagAllMessage({ sock, jid, message, text })) continue;
if (await handleNeroTriviaMessage({ sock, jid, message, text })) continue;
        if (await handleNeroFamilyFeudMessage({ sock, jid, message, text })) continue;
    if (await handleNeroGameMessage({ sock, jid, message, text })) continue;

        

        // NERO MEMORY COMMANDS
        // Only Master can create, view, or delete long-term memories.

        const isMasterMemoryCommand =
          message.key?.fromMe &&
          !botSentMessageIds.has(message.key?.id);

        const memoryCommandText = (text || '').trim();
        const memoryLower = memoryCommandText.toLowerCase();

        if (isMasterMemoryCommand && memoryLower.startsWith('!remember ')) {
          const payload = memoryCommandText.slice(10).trim();

          if (!payload) {
            await sendNeroControlMessage(
              sock,
              jid,
              'Remember what, Master?'
            );
            continue;
          }

          let scope = 'group';
          let fact = payload;

          if (payload.toLowerCase().startsWith('master:')) {
            scope = 'master';
            fact = payload.slice(7).trim();
          } else if (payload.toLowerCase().startsWith('group:')) {
            scope = 'group';
            fact = payload.slice(6).trim();
          }

          if (!fact) {
            await sendNeroControlMessage(
              sock,
              jid,
              'There is nothing to remember.'
            );
            continue;
          }

          const added = addNeroMemory(jid, scope, fact);

          await sendNeroControlMessage(
            sock,
            jid,
            added
              ? 'Remembered.'
              : 'I already know that.'
          );

          continue;
        }

        if (
          isMasterMemoryCommand &&
          (
            memoryLower === '!memory' ||
            memoryLower === '!nero memory'
          )
        ) {
          const masterLines = neroMemory.master.slice(-20);
          const groupLines = getNeroGroupMemory(jid).slice(-20);

          const output = [
            'Long-term memory',
            '',
            'Master:',
            masterLines.length
              ? masterLines.map(x => '- ' + x).join('\n')
              : '- none',
            '',
            'This group:',
            groupLines.length
              ? groupLines.map(x => '- ' + x).join('\n')
              : '- none'
          ].join('\n');

          await sendNeroControlMessage(
            sock,
            jid,
            output
          );

          continue;
        }

        if (
          isMasterMemoryCommand &&
          memoryLower === '!memory clear'
        ) {
          clearNeroGroupMemory(jid);

          await sendNeroControlMessage(
            sock,
            jid,
            'This group memory is clear.'
          );

          continue;
        }

        if (isMasterMemoryCommand && memoryLower.startsWith('!forget ')) {
          const query = memoryCommandText.slice(8).trim();

          if (!query) {
            await sendNeroControlMessage(
              sock,
              jid,
              'Forget what, Master?'
            );
            continue;
          }

          const removed = forgetNeroMemory(jid, query);

          await sendNeroControlMessage(
            sock,
            jid,
            removed > 0
              ? 'Forgot it.'
              : 'I could not find that memory.'
          );

          continue;
        }

const masterMentioned = mentionedJids.some(jid =>
          myIds.includes(normalizeJid(jid))
        );

        const repliedToMaster = [
          contextInfo.participant,
          contextInfo.participantPn,
        ]
          .filter(Boolean)
          .some(jid => myIds.includes(normalizeJid(jid)));

        const saidNero =
          text.toLowerCase().includes(BOT_NAME.toLowerCase()) ||
          /^nero[?!]*$/i.test(
            text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
          );

        const shouldRespond =
          masterMentioned ||
          repliedToMaster ||
          saidNero;

        // NERO NATURAL CALL RESPONSES
        // Simple calls do not need an LLM request.

        const cleanMessageText = (text || '').trim().toLowerCase();

        if (
          shouldRespond &&
          /^(nero|nero[?!]+)$/.test(cleanMessageText)
        ) {
          const response = message.key?.fromMe
            ? 'Hm, Master?'
            : 'Hm?';

          const sentMessage = await sock.sendMessage(jid, { text: response });

          if (sentMessage?.key?.id) {
            botSentMessageIds.add(sentMessage.key.id);

            setTimeout(() => {
              botSentMessageIds.delete(sentMessage.key.id);
            }, 5 * 60 * 1000);
          }

          continue;
        }

        if (
          shouldRespond &&
          /^(introduce yourself|introduce urself|who are you|tell us who you are)$/.test(cleanMessageText)
        ) {
          const response = message.key?.fromMe
            ? "Nero Claudius—sharp, not here for a lecture. Master, you know the rest."
            : "Nero Claudius—sharp, not here for a lecture. You know the rest.";

          const sentMessage = await sock.sendMessage(jid, { text: response });

          if (sentMessage?.key?.id) {
            botSentMessageIds.add(sentMessage.key.id);

            setTimeout(() => {
              botSentMessageIds.delete(sentMessage.key.id);
            }, 5 * 60 * 1000);
          }

          continue;
        }


        addToHistory(jid, isMasterMessage ? 'Master' : 'Group member', text);

        if (
          isGroup &&
          !RESPOND_TO_ALL_GROUP_MESSAGES &&
          !shouldRespond
        ) {
          continue;
        }

        const now = Date.now();
        const last = lastResponseTime.get(jid) || 0;
        if (now - last < COOLDOWN_MS) continue;
        lastResponseTime.set(jid, now);

        console.log(`[${isGroup ? 'GROUP' : 'DM'}] ${sender}: ${text}`);
        console.log(`${BOT_NAME} is thinking...`);

        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
      const reply = await askGemini(
          sock,
          jid,
          isMasterMessage ? 'Master' : 'Group member',
          text
        );
      await sock.sendPresenceUpdate('paused', jid).catch(() => {});

        addToHistory(jid, BOT_NAME, reply);

        const sentMessage = await sock.sendMessage(
          jid,
          { text: reply },
          { quoted: message }
        );

        if (sentMessage?.key?.id) {
          botSentMessageIds.add(sentMessage.key.id);

          // Prevent the set from growing forever.
          setTimeout(() => {
            botSentMessageIds.delete(sentMessage.key.id);
          }, 5 * 60 * 1000);
        }

        console.log(`${BOT_NAME}: ${reply}\n`);
      } catch (err) {
        console.error('Message error:', err?.message || err);
      }
    }
  });
}

console.log('\nStarting Nero...\n');

startNero().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
