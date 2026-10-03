const fs = require('fs');

const file = 'app.js';
let s = fs.readFileSync(file, 'utf8');

const oldGate = `const shouldRespond = isGroup
          ? (
              masterMentioned ||
              repliedToMaster ||
              saidNero
            )
          : (
              masterMentioned ||
              repliedToMaster ||
              saidNero
            );`;

const newGate = `const shouldRespond = isGroup
          ? (
              masterMentioned ||
              repliedToMaster ||
              saidNero
            )
          : (
              repliedToMaster ||
              saidNero
            );`;

if (!s.includes(oldGate)) {
  throw new Error('Expected shouldRespond gate not found; no changes made.');
}

s = s.replace(oldGate, newGate);

function removeConsoleLogContaining(source, marker) {
  let markerPos = source.indexOf(marker);
  let removed = 0;

  while (markerPos !== -1) {
    let start = source.lastIndexOf('console.log(', markerPos);
    if (start === -1) {
      throw new Error(`Could not find console.log before marker: ${marker}`);
    }

    let depth = 0;
    let quote = null;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    let end = -1;

    for (let i = start; i < source.length; i++) {
      const c = source[i];
      const n = source[i + 1];

      if (inLineComment) {
        if (c === '\n') inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (c === '*' && n === '/') {
          inBlockComment = false;
        }
        continue;
      }

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === quote) {
          quote = null;
        }
        continue;
      }

      if (c === '/' && n === '/') {
        inLineComment = true;
        continue;
      }

      if (c === '/' && n === '*') {
        inBlockComment = true;
        continue;
      }

      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        continue;
      }

      if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          if (source[end] === ';') end++;
          if (source[end] === '\n') end++;
          break;
        }
      }
    }

    if (end === -1) {
      throw new Error(`Could not find end of console.log for marker: ${marker}`);
    }

    source =
      source.slice(0, start).replace(/[ \t]*\n$/, '\n') +
      source.slice(end);

    removed++;
    markerPos = source.indexOf(marker);
  }

  return { source, removed };
}

for (const marker of [
  '[RAW UPSERT TEST]',
  '[NERO UPSERT]'
]) {
  const result = removeConsoleLogContaining(s, marker);
  s = result.source;
  console.log(`Removed ${result.removed} console.log(s) containing ${marker}`);
}

fs.writeFileSync(file, s);
console.log('PATCH APPLIED');
