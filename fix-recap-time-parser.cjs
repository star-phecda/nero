const fs = require('fs');
const { execSync } = require('child_process');

const file = 'app.js';
const backup = 'app.js.before-recap-time-fix';

let src = fs.readFileSync(file, 'utf8');
fs.copyFileSync(file, backup);

const start = src.indexOf(
  'function parseNeroNaturalRecapRequest('
);

const end = src.indexOf(
  '\nfunction selectNeroRecapMessages(',
  start
);

if (start === -1 || end === -1) {
  console.error('Could not locate recap parser.');
  process.exit(1);
}

const replacement = String.raw`function parseNeroNaturalRecapRequest(
  text,
  historyLength
) {
  const original =
    String(text || '').trim();

  const clean =
    original
      .toLowerCase()
      .replace(/\s+/g, ' ');

  if (
    !clean ||
    clean.startsWith('!')
  ) {
    return null;
  }

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
  // Natural statistics.
  //
  const wantsStats =
    intentText === 'stats' ||
    intentText === 'history stats' ||
    intentText === 'message stats' ||
    /^(?:show|give me|tell me)\s+(?:the\s+)?(?:history|message)\s+(?:stats?|statistics?)$/.test(intentText) ||
    /^(?:how many|how much)\s+(?:messages?|is stored|of the history)/.test(intentText);

  if (wantsStats) {
    console.log(
      '[NERO RECAP PARSER]',
      JSON.stringify(original),
      '→ stats'
    );

    return {
      stats: true
    };
  }

  //
  // Number words.
  //
  const numberWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    twentyone: 21,
    twentytwo: 22,
    twentythree: 23,
    twentyfour: 24
  };

  //
  // First look for an actual time window.
  // This happens BEFORE the generic recap-intent test,
  // so wording differences cannot force the 6h default.
  //
  const timeMatch =
    intentText.match(
      /\b(?:last|past|previous|in the last|during the last)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty[- ]?one|twenty[- ]?two|twenty[- ]?three|twenty[- ]?four)\s*(minutes?|mins?|hours?|hrs?|days?|d|h|m)\b/
    );

  const hasRecapWords =
    /\b(?:recap|summary|summarize|summarise|catch me up|fill me in|what did i miss|what have i missed|what happened|what has happened|what's happened|what have been happening|what's been happening|what is happening|what's going on|what is going on|anything important|past|previous|last)\b/.test(intentText);

  if (
    timeMatch &&
    hasRecapWords
  ) {
    const rawAmount =
      timeMatch[1]
        .replace(/[- ]/g, '');

    const amount =
      /^\d+$/.test(rawAmount)
        ? Number(rawAmount)
        : numberWords[rawAmount];

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

    const seconds =
      unit === 'm'
        ? amount * 60
        : unit === 'h'
          ? amount * 3600
          : amount * 86400;

    const label =
      unit === 'm'
        ? `the last ${amount} minute${amount === 1 ? '' : 's'}`
        : unit === 'h'
          ? 'the last ' + amount + ' hour' + (amount === 1 ? '' : 's')
          : 'the last ' + amount + ' day' + (amount === 1 ? '' : 's');

    const result = {
      seconds,
      label
    };

    console.log(
      '[NERO RECAP PARSER]',
      JSON.stringify(original),
      '→',
      JSON.stringify(result)
    );

    return result;
  }

  //
  // Today / yesterday.
  //
  if (
    /\btoday\b/.test(intentText)
  ) {
    const result =
      parseNeroRecapRequest(
        '!nero recap today',
        historyLength
      );

    console.log(
      '[NERO RECAP PARSER]',
      JSON.stringify(original),
      '→',
      JSON.stringify(result)
    );

    return result;
  }

  if (
    /\byesterday\b/.test(intentText)
  ) {
    const result =
      parseNeroRecapRequest(
        '!nero recap yesterday',
        historyLength
      );

    console.log(
      '[NERO RECAP PARSER]',
      JSON.stringify(original),
      '→',
      JSON.stringify(result)
    );

    return result;
  }

  //
  // Message count.
  //
  const countMatch =
    intentText.match(
      /\b(?:last\s+)?(\d{1,5}(?:,\d{3})?)\s*(k|messages?|msgs?)\b/
    );

  if (
    countMatch &&
    /\b(?:recap|summary|summarize|summarise|catch me up|fill me in|what did i miss|what happened)\b/.test(intentText)
  ) {
    const rawCount =
      countMatch[1]
        .replace(/,/g, '');

    const count =
      Number(rawCount) *
      (countMatch[2] === 'k' ? 1000 : 1);

    const result =
      parseNeroRecapRequest(
        '!nero recap ' +
        count,
        historyLength
      );

    console.log(
      '[NERO RECAP PARSER]',
      JSON.stringify(original),
      '→',
      JSON.stringify(result)
    );

    return result;
  }

  //
  // Generic recap.
  //
  const hasPlainRecapIntent =
    /^(?:please\s+)?(?:give me\s+(?:a\s+)?)?(?:recap|summary|summarize|summarise)(?:\s+.*)?$/.test(intentText) ||
    /^(?:please\s+)?(?:catch me up|fill me in|what did i miss|what have i missed)(?:\s+.*)?$/.test(intentText) ||
    /^(?:so\s+)?what happened(?:\s+.*)?\??$/.test(intentText) ||
    /^(?:so\s+)?what(?:'s| is| has)\s+(?:happened|been happening|going on)(?:\s+.*)?\??$/.test(intentText) ||
    /^anything important(?:\s+.*)?\??$/.test(intentText);

  if (
    hasPlainRecapIntent
  ) {
    const result = {
      seconds: 21600,
      label: 'the last 6 hours'
    };

    console.log(
      '[NERO RECAP PARSER]',
      JSON.stringify(original),
      '→',
      JSON.stringify(result)
    );

    return result;
  }

  return null;
}
`;

src =
  src.slice(0, start) +
  replacement +
  src.slice(end);

fs.writeFileSync(
  file,
  src,
  'utf8'
);

execSync(
  `node --check ${file}`,
  { stdio: 'inherit' }
);

execSync(
  'git add app.js',
  { stdio: 'inherit' }
);

try {
  execSync(
    'git diff --cached --quiet',
    { stdio: 'ignore' }
  );

  console.log('No changes to commit.');
} catch (_) {
  execSync(
    'git commit -m "Make recap time parsing robust"',
    { stdio: 'inherit' }
  );

  execSync(
    'git push origin main',
    { stdio: 'inherit' }
  );

  console.log('✅ Recap parser fixed and pushed.');
}
