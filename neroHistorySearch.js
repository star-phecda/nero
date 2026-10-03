const DEFAULT_WINDOW_SECONDS = 8 * 60 * 60 * 3; // 192 hours
const MAX_RESULTS = 32;
const MAX_SCAN = 20000;

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','being','but','by','can','could',
  'did','do','does','for','from','had','has','have','he','her','here','hers',
  'him','his','how','i','if','in','is','it','its','me','my','of','on','or',
  'our','she','should','so','that','the','their','them','there','they','this',
  'to','was','we','were','what','when','where','which','who','why','will',
  'with','would','you','your','yours','anyone','anybody','someone','somebody',
  'say','said','says','saying','mention','mentioned','mentions','talk','talked',
  'about','tell','told','telling','remember','recall','chat','group','history',
  'message','messages','conversation','conversations','search','find','look',
  'check','please','nero','last','past','previous','ago','didnt','didn'
]);

const IRREGULAR_STEMS = new Map([
  ['travelling','travel'], ['traveling','travel'], ['travelled','travel'],
  ['traveled','travel'], ['travels','travel'], ['trip','travel'],
  ['trips','travel'], ['journey','travel'], ['journeys','travel'],
  ['vacation','travel'], ['vacations','travel'], ['holiday','travel'],
  ['holidays','travel'], ['flight','travel'], ['flights','travel'],
  ['flying','fly'], ['flew','fly'], ['going','go'], ['went','go'],
  ['visiting','visit'], ['visited','visit'], ['visits','visit'],
  ['universities','university']
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(token) {
  const clean = normalizeText(token);
  if (!clean) return '';

  if (IRREGULAR_STEMS.has(clean)) {
    return IRREGULAR_STEMS.get(clean);
  }

  if (clean.length <= 3) return clean;

  let out = clean;

  if (out.endsWith('ies') && out.length > 5) {
    out = out.slice(0, -3) + 'y';
  } else if (out.endsWith('ing') && out.length > 5) {
    out = out.slice(0, -3);
  } else if (out.endsWith('ed') && out.length > 4) {
    out = out.slice(0, -2);
  } else if (out.endsWith('es') && out.length > 4) {
    out = out.slice(0, -2);
  } else if (out.endsWith('s') && out.length > 3) {
    out = out.slice(0, -1);
  }

  return out;
}

function significantTokens(value) {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .filter(word => !STOPWORDS.has(word))
    .map(stemToken)
    .filter(Boolean);
}

function originalSearchTerms(value) {
  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .filter(word => !STOPWORDS.has(word))
    .filter((word, index, list) => list.indexOf(word) === index);
}

function parseTimeWindow(text) {
  const match = String(text || '').toLowerCase().match(
    /\b(?:last|past|previous|in the last|during the last)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|d|h|m)\b/
  );

  if (!match) {
    return {
      seconds: DEFAULT_WINDOW_SECONDS,
      label: 'the last 192 hours'
    };
  }

  const amount = Number(match[1]);
  const unit = match[2].startsWith('m')
    ? 'm'
    : (match[2].startsWith('h') ? 'h' : 'd');

  const seconds =
    unit === 'm'
      ? amount * 60
      : unit === 'h'
        ? amount * 3600
        : amount * 86400;

  const label =
    unit === 'm'
      ? 'the last ' + amount + ' minute' + (amount === 1 ? '' : 's')
      : unit === 'h'
        ? 'the last ' + amount + ' hour' + (amount === 1 ? '' : 's')
        : 'the last ' + amount + ' day' + (amount === 1 ? '' : 's');

  return {
    seconds: Math.max(60, seconds),
    label
  };
}

function parseCountWindow(text) {
  const match = String(text || '').match(
    /\b(?:last|past|previous)\s+(\d{1,5}(?:,\d{3})?)\s*(?:messages?|msgs?)\b/i
  );

  if (!match) return null;

  return Math.max(
    1,
    Math.min(
      MAX_SCAN,
      Number(match[1].replace(/,/g, ''))
    )
  );
}

export function parseNeroHistorySearchRequest(text) {
  const original = String(text || '').trim();
  if (!original) return null;

  const clean = original
    .replace(/^!?(?:nero)\s*[,!:;-]?\s*/i, '')
    .trim();

  if (!clean) return null;

  const timeWindow = parseTimeWindow(clean);
  const countWindow = parseCountWindow(clean);

  let query = clean;

  const explicitPatterns = [
    /^(?:search|find|look|check)\s+(?:the\s+)?(?:chat|group|history|messages?|conversation)\s+(?:for\s+)?(.+)$/i,
    /^(?:search|find|look|check)\s+(?:through\s+)?(?:the\s+)?(?:chat|history|messages?|conversation)\s+(?:for\s+)?(.+)$/i,
    /^(?:history|chat|messages?|conversation)\s+(?:search|query|lookup)\s*(?:for)?\s+(.+)$/i
  ];

  let explicitMatched = false;

  for (const pattern of explicitPatterns) {
    const match = clean.match(pattern);
    if (match) {
      query = match[1].trim();
      explicitMatched = true;
      break;
    }
  }

  const natural =
    /\b(?:what|where|when)\s+did\s+.+\s+say\b/i.test(clean) ||
    /\b(?:what|where|when)\s+did\s+.+\s+mention\b/i.test(clean) ||
    /\bwho\s+(?:said|mentioned)\b/i.test(clean) ||
    /\b(?:did|has)\s+(?:anyone|anybody|someone|somebody|\w+)\s+(?:say|said|mention|mentioned)\b/i.test(clean) ||
    /\b(?:did|has)\s+anyone\s+(?:talk|talked)\s+about\b/i.test(clean) ||
    /\b(?:what|where|when)\s+was\s+.+\b(?:saying|talking|going|doing)\b/i.test(clean) ||
    /\b(?:remember|recall)\s+(?:when|what|where|that)\b/i.test(clean) ||
    /\b(?:in|from)\s+(?:the\s+)?(?:chat|group|conversation|messages?)\b/i.test(clean) ||
    /\b(?:history|chat history|message history)\b/i.test(clean);

  if (!natural && !explicitMatched) {
    return null;
  }

  query = query
    .replace(/\b(?:in|within|during)\s+the\s+last\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|days?|d|h|m)\b/ig, '')
    .replace(/\b(?:last|past|previous)\s+\d+\s*(?:messages?|msgs?)\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();

  const searchTerms = originalSearchTerms(query);

  if (!searchTerms.length) return null;

  return {
    query,
    searchTerms,
    seconds: countWindow ? null : timeWindow.seconds,
    count: countWindow,
    windowLabel: countWindow
      ? 'the last ' + countWindow.toLocaleString() + ' messages'
      : timeWindow.label
  };
}

function tokenSet(value) {
  return new Set(significantTokens(value));
}

function overlapCount(leftSet, rightSet) {
  let count = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) count++;
  }
  return count;
}

export function searchNeroHistory(
  history,
  request,
  { limit = MAX_RESULTS, excludeId = '' } = {}
) {
  const all = Array.isArray(history) ? history : [];
  const now = Math.floor(Date.now() / 1000);

  let eligible = all.filter(item => {
    if (!item || !String(item.text || '').trim()) return false;
    if (excludeId && item.id === excludeId) return false;
    return true;
  });

  if (request.count != null) {
    eligible = eligible.slice(-request.count);
  } else if (request.seconds != null) {
    const cutoff = now - request.seconds;
    eligible = eligible.filter(item =>
      Number(item.timestamp || 0) >= cutoff
    );
  }

  const queryStems = significantTokens(request.query);
  const querySet = new Set(queryStems);
  const normalizedQuery = normalizeText(request.query);

  const scored = [];

  for (const item of eligible) {
    const sender = String(item.sender || 'Unknown');
    const messageText = String(item.text || '').trim();
    const contentSet = tokenSet(messageText);
    const senderSet = tokenSet(sender);

    const contentOverlap = overlapCount(querySet, contentSet);
    const senderOverlap = overlapCount(querySet, senderSet);

    if (contentOverlap === 0 && senderOverlap === 0) continue;

    let score = contentOverlap * 4 + senderOverlap * 10;

    const normalizedCombined = normalizeText(sender + ' ' + messageText);

    if (
      normalizedQuery.length >= 4 &&
      normalizedCombined.includes(normalizedQuery)
    ) {
      score += 14;
    }

    if (senderOverlap > 0 && contentOverlap > 0) {
      score += 8;
    }

    const timestamp = Number(item.timestamp || 0);
    if (timestamp > 0) {
      const age = Math.max(0, now - timestamp);
      score += Math.max(
        0,
        2 - age / Math.max(1, request.seconds || DEFAULT_WINDOW_SECONDS)
      );
    }

    scored.push({ item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      Number(b.item.timestamp || 0) -
      Number(a.item.timestamp || 0)
    );
  });

  const matches = scored
    .slice(0, Math.max(1, limit))
    .map(entry => entry.item);

  return {
    scanned: eligible.length,
    candidateCount: scored.length,
    inspected: Math.min(limit, scored.length),
    matches,
    searchTerms: request.searchTerms,
    query: request.query,
    windowLabel: request.windowLabel
  };
}

export function buildNeroHistorySearchPrompt(query, windowLabel, matches) {
  const transcript = matches.map((item, index) => {
    const timestamp = Number(item.timestamp || 0);
    const date = timestamp
      ? new Date(timestamp * 1000).toISOString()
      : 'unknown time';

    return [
      'MATCH ' + (index + 1),
      '[' + date + '] ' + String(item.sender || 'Unknown') + ':',
      String(item.text || '').trim()
    ].join(' ');
  }).join('\n\n');

  return [
    'You are answering a question about a WhatsApp group\'s stored conversation history.',
    'Question: ' + String(query || '').trim(),
    'Search window: ' + String(windowLabel || 'the requested period'),
    '',
    'The messages below are the only evidence you may use.',
    'Answer directly from them.',
    'Do not invent details or use general world knowledge.',
    'Do not claim a person said something unless the evidence supports it.',
    'When the evidence gives a destination, date, plan, or other concrete detail, state it plainly.',
    'When evidence is ambiguous, say so.',
    'If the messages do not contain enough evidence to answer confidently, say that you could not find a reliable answer.',
    'Keep the answer concise: normally 1–4 sentences.',
    '',
    'MATCHED MESSAGES:',
    transcript
  ].join('\n');
}
