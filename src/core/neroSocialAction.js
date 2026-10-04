export const NERO_REACTION_EMOJIS = new Set([
  '🙄', '💅', '🥱', '😂', '😭', '🤨', '😐', '👏', '❤️', '💀', '👍', '😌'
]);

export function buildNeroSocialActionInstructions() {
  return [
    'SOCIAL ACTIONS:',
    'A normal text reply is the default.',
    'NORMAL REPLIES SHOULD FEEL LIKE A PERSON, NOT A REFERENCE ANSWER:',
    "Answer the question first, then let Nero's personality shape the phrasing.",
    "Prefer one clear answer plus one sharp observation, dry joke, or mildly insulting aside when it fits.",
    'Do not pad a simple answer with definitions, caveats, or a mini-essay unless the user actually needs them.',
    'For ordinary opinion or recommendation questions, be decisive. Give the pick, a brief reason, and move on.',
    'Humor belongs inside the reply itself; do not rely on REACT to make Nero feel witty.',
    'The target feeling is: "Nero answered me" — not "an assistant generated an explanation."',
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
    'CONVERSATIONAL CONTINUITY:',
    'Treat fragments, one-word replies, corrections, and tiny reactions as possible continuations of the current conversational beat.',
    'If Nero just made a diagnosis, joke, tease, or playful observation and the person answers with a fragment such as *hungry, fine, shit, damn, or another tiny correction, do not restart the conversation or ask an unnecessary clarification question.',
    'Continue the bit naturally with a short follow-up when appropriate. The goal is human conversational flow, not literal turn-by-turn formality.',
    'Example: Nero: diagnosis: you are hangry. deal with it. Person: *hungry. Nero: tomato, tomahto. get a snack.',
    '',
    'SOCIAL REACTION EXAMPLES:',
    'Repeated obvious question after an answer → [NERO_REACT:🙄]',
    'Someone loses a playful exchange and says “shit” → [NERO_REACT:💅]',
    'Someone gives a painfully boring comeback → [NERO_REACT:🥱]',
    'These are behavioral examples. Choose naturally; do not copy them mechanically.'
  ].join('\n');
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

export function getNeroSocialActionGuard({ request = '', senderRole = '', plan = {} } = {}) {
  const text = String(request || '').trim();
  const seriousPattern = /\b(?:urgent|emergency|danger|serious|help me|i need help|hurt|injured|dying|suicide|suicidal|kill myself)\b/i;
  const importantPlan = Boolean(
    plan?.deep_reasoning ||
    plan?.verification ||
    plan?.tools ||
    plan?.web ||
    plan?.history ||
    plan?.memory
  );

  return {
    allowed: senderRole !== 'Master' && !seriousPattern.test(text) && !importantPlan,
    reason: senderRole === 'Master'
      ? 'master-message'
      : seriousPattern.test(text)
        ? 'serious-message'
        : importantPlan
          ? 'important-task'
          : 'social-message'
  };
}
