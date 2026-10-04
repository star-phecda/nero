export const NERO_REACTION_EMOJIS = new Set([
  '🙄', '💅', '🥱', '😂', '😭', '🤨', '😐', '👏', '❤️', '💀', '👍', '😌'
]);

export function buildNeroSocialActionInstructions() {
  return [
    'SOCIAL ACTIONS:',
    'A normal text reply is the default.',
    'You may occasionally choose a reaction instead of a text reply when the message is low-value, repetitive, hilariously obvious, an embarrassing loss, or has a painfully weak comeback.',
    'You may occasionally choose silence when the message genuinely does not need a response.',
    'Do NOT use REACT or SILENT for questions that need an answer, requests for useful help, technical/important tasks, messages from Master, or serious/emotional situations.',
    'Do not react to every short message. Reactions should feel selective and earned.',
    'A reaction is to the current incoming message.',
    'When reacting, output exactly one machine marker and nothing else:',
    '[NERO_REACT:🙄]',
    'Allowed reaction emojis: 🙄 💅 🥱 😂 😭 🤨 😐 👏 ❤️ 💀 👍 😌',
    'When choosing silence, output exactly: [NERO_SILENT]',
    'When replying normally, output ordinary Nero text with no machine marker.',
    'Do not explain or mention these action markers.',
    '',
    'SOCIAL REACTION EXAMPLES:',
    'Repeated obvious question after an answer → [NERO_REACT:🙄]',
    'Someone loses a playful exchange and says “shit” → [NERO_REACT:💅]',
    'Someone gives a painfully boring comeback → [NERO_REACT:🥱]',
    'These are behavioral examples. Choose naturally; do not copy them mechanically.'
  ].join('\\n');
}

export function parseNeroSocialAction(raw) {
  const text = String(raw ?? '').trim();

  const reactMatch = text.match(/^\[NERO_REACT:([^\]]+)\]$/i);
  if (reactMatch) {
    const emoji = reactMatch[1].trim();
    if (NERO_REACTION_EMOJIS.has(emoji)) {
      return { action: 'react', emoji };
    }
  }

  if (/^\[NERO_SILENT\]$/i.test(text)) {
    return { action: 'silent' };
  }

  return { action: 'reply', text };
}
