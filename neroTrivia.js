import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PICTURE_QUESTIONS } from './pictureTriviaBank.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

const HISTORY_FILE = path.join(__dirname, 'nero_trivia_history.json');

const games = new Map();
const botSentMessageIds = new Set();

const CATEGORIES = [
  'Anime',
  'Science',
  'Comics',
  'History',
  'Animals',
  'Gaming',
  'Movies',
  'Geography',
  'Technology',
  'Sports',
  'Music',
  'Literature',
  'General Knowledge',
  'Medicine',
  'Space',
  'Mythology',
  'Business',
  'Random'
];

const DIFFICULTY_POINTS = {
  easy: 100,
  intermediate: 150,
  hard: 200
};

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify(history.slice(-500), null, 2)
    );
  } catch (err) {
    console.error('[TRIVIA] Could not save history:', err.message);
  }
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizeAnswer(value) {
  let result = normalize(value);

  for (const prefix of ['the', 'a', 'an']) {
    if (result.startsWith(prefix) && result.length > prefix.length + 2) {
      result = result.slice(prefix.length);
      break;
    }
  }

  return result;
}

function getSenderId(message) {
  return (
    message?.key?.participant ||
    message?.key?.remoteJid ||
    'unknown'
  );
}

function getDisplayName(message) {
  return (
    message?.pushName ||
    message?.verifiedBizName ||
    getSenderId(message).split('@')[0]
  );
}

async function sendTriviaMessage(sock, jid, text) {
  const sent = await sock.sendMessage(jid, { text });

  if (sent?.key?.id) {
    botSentMessageIds.add(sent.key.id);

    if (botSentMessageIds.size > 500) {
      const first = botSentMessageIds.values().next().value;
      botSentMessageIds.delete(first);
    }
  }

  return sent;
}

function isBotMessage(message) {
  const id = message?.key?.id;
  return id && botSentMessageIds.has(id);
}

function clearGameTimer(game) {
  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function clearCategoryTimer(game) {
  if (game.categoryTimer) {
    clearTimeout(game.categoryTimer);
    game.categoryTimer = null;
  }
}

function clearAllTimers(game) {
  clearGameTimer(game);
  clearCategoryTimer(game);
}

function scoreBoard(game) {
  const players = [...game.players.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });

  if (!players.length) {
    return 'No points yet.';
  }

  return players
    .map((player, index) => {
      const medal =
        index === 0 ? '🥇' :
        index === 1 ? '🥈' :
        index === 2 ? '🥉' :
        `${index + 1}.`;

      return `${medal} ${player.name} — ${player.score} pts`;
    })
    .join('\n');
}

function categoryListText() {
  return CATEGORIES
    .map((category, index) => `${index + 1}. ${category}`)
    .join('\n');
}

function resolveCategory(text) {
  const trimmed = String(text || '').trim();

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    return CATEGORIES[index] || null;
  }

  const normalized = normalize(trimmed);

  return (
    CATEGORIES.find(
      category => normalize(category) === normalized
    ) || null
  );
}

function extractJsonObject(text) {
  const source = String(text || '').trim();

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (char === '}') {
      depth--;

      if (depth === 0 && start !== -1) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function validateGeneratedQuestion(data, category, history) {
  if (!data || typeof data !== 'object') return null;

  if (typeof data.question !== 'string' || !data.question.trim()) {
    return null;
  }

  if (typeof data.answer !== 'string' || !data.answer.trim()) {
    return null;
  }

  if (!Array.isArray(data.acceptableAnswers)) {
    data.acceptableAnswers = [];
  }

  const difficulty = String(data.difficulty || 'intermediate')
    .trim()
    .toLowerCase();

  if (!['easy', 'intermediate', 'hard'].includes(difficulty)) {
    data.difficulty = 'intermediate';
  } else {
    data.difficulty = difficulty;
  }

  const questionKey = normalize(data.question);

  if (
    history.some(
      item => normalize(item.question) === questionKey
    )
  ) {
    return null;
  }

  const acceptableAnswers = [
    data.answer,
    ...data.acceptableAnswers
  ]
    .filter(answer => typeof answer === 'string' && answer.trim())
    .map(answer => answer.trim())
    .filter(
      (answer, index, array) =>
        array.findIndex(
          other => normalizeAnswer(other) === normalizeAnswer(answer)
        ) === index
    );

  data.acceptableAnswers = acceptableAnswers;

  return {
    category,
    question: data.question.trim(),
    answer: data.answer.trim(),
    acceptableAnswers,
    explanation:
      typeof data.explanation === 'string'
        ? data.explanation.trim()
        : '',
    difficulty: data.difficulty,
    points: DIFFICULTY_POINTS[data.difficulty]
  };
}

async function generateTriviaQuestion(category, history) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is missing');
  }

  const recentHistory = history
    .slice(-40)
    .map(item => `- ${item.category}: ${item.question}`)
    .join('\n');

  const difficultyInstruction = `
Choose a difficulty:
- easy = common knowledge
- intermediate = requires some knowledge or recall
- hard = challenging but still objectively answerable
`;

  const prompt = [
    'You generate questions for a WhatsApp group trivia game.',
    '',
    `CATEGORY: ${category}`,
    difficultyInstruction,
    'Create exactly ONE trivia question.',
    '',
    'Rules:',
    '- The question must have one objectively correct answer.',
    '- It must be suitable for a group chat.',
    '- No multiple choice.',
    '- Do not make the wording ambiguous.',
    '- Do not require opinions or personal experiences.',
    '- Do not ask current political questions.',
    '- Avoid obscure trick questions unless difficulty is hard.',
    '- Do not repeat any previous question.',
    '- Include a few genuinely acceptable alternate answers when appropriate.',
    '',
    'Return ONLY this JSON object:',
    '{',
    '  "question": "Question text",',
    '  "answer": "Exact correct answer",',
    '  "acceptableAnswers": ["alternate answer"],',
    '  "difficulty": "easy",',
    '  "explanation": "Brief explanation of the answer"',
    '}',
    '',
    'Previously used questions:',
    recentHistory || '(none)'
  ].join('\n');

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
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
            temperature: 0.5,
            max_completion_tokens: 350,
            stream: false
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error?.message ||
          `Groq HTTP ${response.status}`
        );
      }

      const raw = data?.choices?.[0]?.message?.content || '';
      const jsonText = extractJsonObject(raw);

      if (!jsonText) {
        throw new Error('No JSON object found');
      }

      const parsed = JSON.parse(jsonText);
      const question = validateGeneratedQuestion(
        parsed,
        category,
        history
      );

      if (!question) {
        throw new Error('Generated question failed validation');
      }

      return question;
    } catch (err) {
      console.error(
        `[TRIVIA] Generation attempt ${attempt} failed:`,
        err.message
      );

      if (attempt === 3) {
        throw new Error('Could not generate a trivia question.');
      }
    }
  }

  throw new Error('Could not generate a trivia question.');
}

async function askForCategory(sock, jid, game) {
  game.phase = 'category';

  await sendTriviaMessage(
    sock,
    jid,
    `📚 **Choose the next category**

${categoryListText()}

Type the number or category name.`
  );

  clearCategoryTimer(game);

  game.categoryTimer = setTimeout(async () => {
    if (game.phase !== 'category') return;

    const randomCategory =
      CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

    game.category = randomCategory;

    await sendTriviaMessage(
      sock,
      jid,
      `⏱️ Nobody chose a category.

Random category: **${randomCategory}**`
    );

    await startQuestion(sock, jid, game);
  }, 15000);
}

async function startQuestion(sock, jid, game) {
  clearCategoryTimer(game);

  if (game.questionNumber > game.totalQuestions) {
    await finishGame(sock, jid, game);
    return;
  }

  game.phase = 'generating';
  game.answerAttempts = new Set();

  await sendTriviaMessage(
    sock,
    jid,
    `🧠 Generating **Question ${game.questionNumber}/${game.totalQuestions}**…`
  );

  let question;

  try {
    const history = loadHistory();

    question = await generateTriviaQuestion(
      game.category,
      history
    );

    history.push({
      category: game.category,
      question: question.question
    });

    saveHistory(history);
  } catch (err) {
    console.error('[TRIVIA]', err.message);

    await sendTriviaMessage(
      sock,
      jid,
      `❌ I couldn't generate a valid question for **${game.category}** right now.`
    );

    await askForCategory(sock, jid, game);
    return;
  }

  game.currentQuestion = question;
  game.phase = 'question';

  const seconds =
    question.difficulty === 'easy'
      ? 20
      : question.difficulty === 'hard'
        ? 10
        : 15;

  game.questionStartedAt = Date.now();

  await sendTriviaMessage(
    sock,
    jid,
    `🧠 **TRIVIA — Question ${game.questionNumber}/${game.totalQuestions}**

📚 **${game.category}**
${question.difficulty === 'easy'
  ? '🟢'
  : question.difficulty === 'hard'
    ? '🔴'
    : '🟡'} **${question.difficulty.toUpperCase()}**

${question.question}

⏱️ **${seconds} seconds**
🏆 Correct answer: **${question.points} points**

Everyone can answer. First correct answer wins.`
  );

  clearGameTimer(game);

  game.timer = setTimeout(
    () => handleQuestionTimeout(sock, jid, game),
    seconds * 1000
  );
}

function answerMatches(question, answer) {
  const normalized = normalizeAnswer(answer);

  if (!normalized) return false;

  return question.acceptableAnswers.some(
    candidate =>
      normalizeAnswer(candidate) === normalized
  );
}

async function handleQuestionTimeout(sock, jid, game) {
  if (game.phase !== 'question') return;

  clearGameTimer(game);

  const question = game.currentQuestion;

  await sendTriviaMessage(
    sock,
    jid,
    `⌛ **TIME!**

Answer: **${question.answer}**${
      question.explanation
        ? `\n\n${question.explanation}`
        : ''
    }

📊 **Scoreboard**

${scoreBoard(game)}`
  );

  await moveToNextQuestionOrEnd(sock, jid, game);
}

async function moveToNextQuestionOrEnd(sock, jid, game) {
  game.questionNumber += 1;
  game.currentQuestion = null;

  if (game.questionNumber > game.totalQuestions) {
    await finishGame(sock, jid, game);
    return;
  }

  await askForCategory(sock, jid, game);
}

async function finishGame(sock, jid, game) {
  clearAllTimers(game);

  game.phase = 'finished';

  await sendTriviaMessage(
    sock,
    jid,
    `🏁 **TRIVIA COMPLETE!**

**${game.totalQuestions}/${game.totalQuestions} questions**

📊 **Final Scoreboard**

${scoreBoard(game)}

🎉 Game over. Type **!trivia** to start a new game.`
  );

  games.delete(jid);
}

async function startTrivia(sock, jid, message) {
  if (games.has(jid)) {
    await sendTriviaMessage(
      sock,
      jid,
      'A Trivia game is already running here.'
    );
    return;
  }

  const starter = getSenderId(message);

  const game = {
    jid,
    starter,
    starterName: getDisplayName(message),
    phase: 'questionCount',
    totalQuestions: 0,
    questionNumber: 1,
    category: null,
    currentQuestion: null,
    questionStartedAt: null,
    timer: null,
    categoryTimer: null,
    answerAttempts: new Set(),
    players: new Map()
  };

  games.set(jid, game);

  await sendTriviaMessage(
    sock,
    jid,
    `🧠 **TRIVIA**

How many questions do you want?

Choose a number from **1–50**.

${game.starterName} is starting the game.`
  );

  game.categoryTimer = setTimeout(async () => {
    if (game.phase !== 'questionCount') return;

    games.delete(jid);

    await sendTriviaMessage(
      sock,
      jid,
      '⌛ Trivia setup timed out. Type **!trivia** to start again.'
    );
  }, 30000);
}

async function handleTriviaMessage({ sock, jid, message, text }) {
  if (!jid || !message) return false;
  if (isBotMessage(message)) return true;

  const input = String(text || '').trim();

  if (!input) return false;

  const pictureHandled = await handlePictureTriviaMessage({
    sock,
    jid,
    message,
    text
  });

  if (pictureHandled) return true;

  const lower = input.toLowerCase();

  if (
    lower === '!trivia' ||
    lower === 'trivia'
  ) {
    await startTrivia(sock, jid, message);
    return true;
  }

  const game = games.get(jid);

  if (!game) return false;

  if (
    lower === '!trivia stop' ||
    lower === '!trivia cancel'
  ) {
    clearAllTimers(game);
    games.delete(jid);

    await sendTriviaMessage(
      sock,
      jid,
      '🛑 Trivia cancelled.'
    );

    return true;
  }

  if (game.phase === 'questionCount') {
    const senderId = getSenderId(message);

    if (senderId !== game.starter) {
      return true;
    }

    if (!/^\d+$/.test(input)) {
      await sendTriviaMessage(
        sock,
        jid,
        'Enter a number from **1 to 50**.'
      );
      return true;
    }

    const amount = Number(input);

    if (amount < 1 || amount > 50) {
      await sendTriviaMessage(
        sock,
        jid,
        'Choose between **1 and 50 questions**.'
      );
      return true;
    }

    clearCategoryTimer(game);

    game.totalQuestions = amount;
    game.questionNumber = 1;

    await sendTriviaMessage(
      sock,
      jid,
      `✅ **${amount} questions**

Now choose the first category.

${categoryListText()}`
    );

    game.phase = 'category';

    game.categoryTimer = setTimeout(async () => {
      if (game.phase !== 'category') return;

      const randomCategory =
        CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

      game.category = randomCategory;

      await sendTriviaMessage(
        sock,
        jid,
        `⏱️ No category was chosen.

Random category: **${randomCategory}**`
      );

      await startQuestion(sock, jid, game);
    }, 15000);

    return true;
  }

  if (game.phase === 'category') {
    const category = resolveCategory(input);

    if (!category) {
      return true;
    }

    clearCategoryTimer(game);

    game.category = category;

    await startQuestion(sock, jid, game);

    return true;
  }

  if (game.phase === 'generating') {
    return true;
  }

  if (game.phase === 'question') {
    const senderId = getSenderId(message);

    if (game.answerAttempts.has(senderId)) {
      return true;
    }

    game.answerAttempts.add(senderId);

    const playerName = getDisplayName(message);

    if (!game.players.has(senderId)) {
      game.players.set(senderId, {
        name: playerName,
        score: 0
      });
    }

    const player = game.players.get(senderId);

    if (!answerMatches(game.currentQuestion, input)) {
      await sendTriviaMessage(
        sock,
        jid,
        `❌ ${playerName} — wrong answer.`
      );
      return true;
    }

    clearGameTimer(game);

    player.name = playerName;
    player.score += game.currentQuestion.points;

    await sendTriviaMessage(
      sock,
      jid,
      `✅ **${playerName} got it!**

Answer: **${game.currentQuestion.answer}**

🏆 **+${game.currentQuestion.points} points**

📊 **Scoreboard**

${scoreBoard(game)}`
    );

    await moveToNextQuestionOrEnd(sock, jid, game);

    return true;
  }

  return true;
}


/* -------------------------------------------------------------------------- */
/* Picture Trivia                                                             */
/* -------------------------------------------------------------------------- */

const pictureGames = new Map();

const PICTURE_POINTS = 100;
const PICTURE_ROUND_SECONDS = 15;
const PICTURE_NEXT_ROUND_DELAY_MS = 1200;

const PICTURE_MODES = {
  logos: 'logos',
  actors: 'actors',
  characters: 'characters',
  flags: 'flags',
  mixed: 'mixed'
};

const PICTURE_MODE_ALIASES = new Map([
  ['logo', 'logos'],
  ['logos', 'logos'],
  ['brand', 'logos'],
  ['brands', 'logos'],
  ['company', 'logos'],
  ['companies', 'logos'],
  ['actor', 'actors'],
  ['actors', 'actors'],
  ['character', 'characters'],
  ['characters', 'characters'],
  ['anime', 'characters'],
  ['pokemon', 'characters'],
  ['pokémon', 'characters'],
  ['superhero', 'characters'],
  ['superheroes', 'characters'],
  ['flag', 'flags'],
  ['flags', 'flags'],
  ['country', 'flags'],
  ['countries', 'flags'],
  ['mixed', 'mixed'],
  ['random', 'mixed']
]);


function pictureNormalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function pictureAnswerMatches(question, input) {
  const normalized = pictureNormalize(input);

  if (!normalized) return false;

  return [
    question.answer,
    ...(question.aliases || [])
  ].some(
    candidate =>
      pictureNormalize(candidate) === normalized
  );
}

function pictureModeLabel(mode) {
  switch (mode) {
    case PICTURE_MODES.logos:
      return 'LOGOS';
    case PICTURE_MODES.actors:
      return 'ACTORS';
    case PICTURE_MODES.characters:
      return 'CHARACTERS';
    case PICTURE_MODES.flags:
      return 'FLAGS';
    default:
      return 'MIXED';
  }
}

function picturePool(mode) {
  return PICTURE_QUESTIONS.filter(
    question =>
      mode === PICTURE_MODES.mixed ||
      question.mode === mode
  );
}

function picturePickQuestion(game) {
  const pool = picturePool(game.mode);

  const available = pool.filter(
    question =>
      !game.usedQuestionIds.has(question.id)
  );

  if (!available.length) {
    game.usedQuestionIds.clear();
    return pool[
      Math.floor(Math.random() * pool.length)
    ] || null;
  }

  return available[
    Math.floor(Math.random() * available.length)
  ] || null;
}

function pictureClearTimer(game) {
  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function pictureScoreBoard(game) {
  const players = [...game.players.values()]
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.name.localeCompare(b.name);
    });

  if (!players.length) return 'No points yet.';

  return players.map((player, index) => {
    const prefix =
      index === 0 ? '🥇' :
      index === 1 ? '🥈' :
      index === 2 ? '🥉' :
      String(index + 1) + '.';

    return (
      prefix +
      ' ' +
      player.name +
      ' — ' +
      player.score +
      ' pts'
    );
  }).join('\n');
}

async function sendPictureMessage(
  sock,
  jid,
  question,
  caption
) {
  const sent = await sock.sendMessage(
    jid,
    {
      image: { url: question.imageUrl },
      caption
    }
  );

  if (sent?.key?.id) {
    botSentMessageIds.add(sent.key.id);

    if (botSentMessageIds.size > 500) {
      const first =
        botSentMessageIds.values().next().value;

      botSentMessageIds.delete(first);
    }
  }

  return sent;
}

function parsePictureStartCommand(input) {
  const lower = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[!?]+$/g, '')
    .trim();

  const aliases = [
    '!pictrivia',
    'pictrivia',
    '!picture trivia',
    'picture trivia',
    '!picturetrivia',
    'picturetrivia',
    '!pic trivia',
    'pic trivia'
  ];

  const matched = aliases.find(
    alias =>
      lower === alias ||
      lower.startsWith(alias + ' ')
  );

  if (!matched) return null;

  const remainder = lower
    .slice(matched.length)
    .trim();

  let rounds = 10;
  let mode = PICTURE_MODES.mixed;

  for (const token of remainder.split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(token)) {
      const amount = Number(token);

      if (amount >= 1 && amount <= 50) {
        rounds = amount;
      }

      continue;
    }

    if (PICTURE_MODE_ALIASES.has(token)) {
      mode = PICTURE_MODE_ALIASES.get(token);
    }
  }

  return { rounds, mode };
}

async function finishPictureGame(sock, jid, game) {
  pictureClearTimer(game);

  game.phase = 'finished';

  await sendTriviaMessage(
    sock,
    jid,
    '🏁 **PICTURE TRIVIA COMPLETE!**\n\n' +
    'Mode: **' + pictureModeLabel(game.mode) + '**\n' +
    'Rounds: **' + game.totalRounds + '**\n\n' +
    '📊 **Final Scoreboard**\n\n' +
    pictureScoreBoard(game) +
    '\n\n🎉 Type **!pictrivia** to play again.'
  );

  pictureGames.delete(jid);
}

async function startPictureRound(sock, jid, game) {
  pictureClearTimer(game);

  if (game.round > game.totalRounds) {
    await finishPictureGame(sock, jid, game);
    return;
  }

  const question = picturePickQuestion(game);

  if (!question) {
    await sendTriviaMessage(
      sock,
      jid,
      '❌ No picture questions are available for this mode yet.'
    );

    pictureGames.delete(jid);
    return;
  }

  game.currentQuestion = question;
  game.usedQuestionIds.add(question.id);
  game.phase = 'question';
  game.answerAttempts = new Set();
  game.startedAt = Date.now();

  const caption =
    '🖼️ **PICTURE TRIVIA — ROUND ' +
    game.round +
    '/' +
    game.totalRounds +
    '**\n\n' +
    '🎯 ' + question.prompt + '\n\n' +
    '⏱️ **' + PICTURE_ROUND_SECONDS + ' seconds**\n' +
    '🏆 First correct answer gets **' +
    PICTURE_POINTS +
    ' points!**';

  try {
    await sendPictureMessage(
      sock,
      jid,
      question,
      caption
    );
  } catch (error) {
    console.error(
      '[PICTURE TRIVIA] Image send failed:',
      error.message
    );

    await sendTriviaMessage(
      sock,
      jid,
      '⚠️ That picture could not be loaded. Skipping to the next one.'
    );

    game.round += 1;
    game.currentQuestion = null;

    setTimeout(
      () => startPictureRound(sock, jid, game),
      400
    );

    return;
  }

  game.timer = setTimeout(
    () => handlePictureTimeout(sock, jid, game),
    PICTURE_ROUND_SECONDS * 1000
  );
}

async function handlePictureTimeout(sock, jid, game) {
  if (game.phase !== 'question') return;

  pictureClearTimer(game);
  game.phase = 'between';

  const question = game.currentQuestion;

  await sendTriviaMessage(
    sock,
    jid,
    '⌛ **TIME!**\n\n' +
    'Answer: **' + question.answer + '**\n\n' +
    '📊 **Scoreboard**\n\n' +
    pictureScoreBoard(game)
  );

  game.round += 1;
  game.currentQuestion = null;

  setTimeout(
    () => startPictureRound(sock, jid, game),
    PICTURE_NEXT_ROUND_DELAY_MS
  );
}

async function startPictureGame(
  sock,
  jid,
  message,
  rounds,
  mode
) {
  if (pictureGames.has(jid)) {
    await sendTriviaMessage(
      sock,
      jid,
      'A Picture Trivia game is already running here.'
    );
    return;
  }

  if (!picturePool(mode).length) {
    await sendTriviaMessage(
      sock,
      jid,
      '❌ That picture category is not available yet.'
    );
    return;
  }

  const game = {
    jid,
    starter: getSenderId(message),
    starterName: getDisplayName(message),
    mode,
    totalRounds: rounds,
    round: 1,
    phase: 'starting',
    currentQuestion: null,
    startedAt: null,
    timer: null,
    answerAttempts: new Set(),
    usedQuestionIds: new Set(),
    players: new Map()
  };

  pictureGames.set(jid, game);

  await sendTriviaMessage(
    sock,
    jid,
    '🖼️ **PICTURE TRIVIA**\n\n' +
    game.starterName +
    ' started **' +
    rounds +
    ' rounds** of **' +
    pictureModeLabel(mode) +
    '**!\n\n' +
    '👀 Look at the picture.\n' +
    '⚡ First correct answer wins the round.\n' +
    '🏆 Each win = **' +
    PICTURE_POINTS +
    ' points**.'
  );

  setTimeout(
    () => startPictureRound(sock, jid, game),
    900
  );
}

async function handlePictureTriviaMessage({
  sock,
  jid,
  message,
  text
}) {
  if (!jid || !message) return false;

  if (isBotMessage(message)) {
    return true;
  }

  const input = String(text || '').trim();
  const lower = input.toLowerCase();

  if (
    lower === '!pictrivia stop' ||
    lower === '!pictrivia cancel' ||
    lower === 'picture trivia stop' ||
    lower === 'pic trivia stop'
  ) {
    const game = pictureGames.get(jid);

    if (!game) {
      return false;
    }

    pictureClearTimer(game);
    pictureGames.delete(jid);

    await sendTriviaMessage(
      sock,
      jid,
      '🛑 Picture Trivia cancelled.'
    );

    return true;
  }

  const start = parsePictureStartCommand(input);

  if (start) {
    await startPictureGame(
      sock,
      jid,
      message,
      start.rounds,
      start.mode
    );

    return true;
  }

  const game = pictureGames.get(jid);

  if (!game) return false;

  if (game.phase !== 'question') {
    return true;
  }

  const senderId = getSenderId(message);

  if (game.answerAttempts.has(senderId)) {
    return true;
  }

  game.answerAttempts.add(senderId);

  const playerName = getDisplayName(message);

  if (!game.players.has(senderId)) {
    game.players.set(senderId, {
      name: playerName,
      score: 0
    });
  }

  const player = game.players.get(senderId);

  if (
    !pictureAnswerMatches(
      game.currentQuestion,
      input
    )
  ) {
    return true;
  }

  pictureClearTimer(game);
  game.phase = 'between';

  player.name = playerName;
  player.score += PICTURE_POINTS;

  const elapsed = Math.max(
    0,
    Date.now() - game.startedAt
  );

  const seconds =
    (elapsed / 1000).toFixed(1);

  await sendTriviaMessage(
    sock,
    jid,
    '✅ **' + playerName + ' got it!**\n\n' +
    'Answer: **' +
    game.currentQuestion.answer +
    '**\n' +
    '⚡ Time: **' +
    seconds +
    's**\n' +
    '🏆 **+' +
    PICTURE_POINTS +
    ' points**\n\n' +
    '📊 **Scoreboard**\n\n' +
    pictureScoreBoard(game)
  );

  game.round += 1;
  game.currentQuestion = null;

  setTimeout(
    () => startPictureRound(sock, jid, game),
    PICTURE_NEXT_ROUND_DELAY_MS
  );

  return true;
}

export { handleTriviaMessage as handleNeroTriviaMessage };
