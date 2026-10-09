function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Parse the explicit contact-management commands accepted by Nero. */
export function parseNeroContactCommand(input) {
  const source = clean(input);
  const prefix = source.match(/^!?nero\s+contact(?:\s+([\s\S]*))?$/i);
  if (!prefix) return null;

  const body = clean(prefix[1] || '');
  if (!body || /^help$/i.test(body)) return { action: 'help' };
  if (/^list$/i.test(body)) return { action: 'list' };

  let match = body.match(/^name\s+(.+?)\s+as\s+([\s\S]+)$/i);
  if (match) {
    return { action: 'name', target: clean(match[1]), name: clean(match[2]) };
  }

  match = body.match(/^show\s+([\s\S]+)$/i);
  if (match) return { action: 'show', target: clean(match[1]) };

  match = body.match(/^forget\s+([\s\S]+)$/i);
  if (match) return { action: 'forget', target: clean(match[1]) };

  return { action: 'invalid' };
}


/** Parse explicit named-contact DM syntax. Names require a separator so message text is never guessed as a target. */
export function parseNeroNamedDmCommand(input) {
  const body = clean(input);
  let match = body.match(/^(?:dm|message|msg)\s+(.+?)\s*:\s*([\s\S]+)$/i);
  if (match) return { target: clean(match[1]), instruction: clean(match[2]) };

  match = body.match(/^(?:dm|message|msg)\s+(.+?)\s+(?:saying|that|to\s+say)\s+([\s\S]+)$/i);
  if (match) return { target: clean(match[1]), instruction: clean(match[2]) };
  return null;
}
