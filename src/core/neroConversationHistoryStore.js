import fs from 'node:fs';
import path from 'node:path';

function normalizeHistoryMap(value) {
  const result = new Map();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

  for (const [key, entries] of Object.entries(value)) {
    if (!key || !Array.isArray(entries)) continue;
    const safeEntries = entries
      .filter(entry => entry && typeof entry === 'object' && typeof entry.text === 'string')
      .map(entry => ({ ...entry }));
    result.set(key, safeEntries);
  }

  return result;
}

export function loadNeroConversationHistory(filePath) {
  const empty = {
    conversations: new Map(),
    personConversations: new Map()
  };

  try {
    if (!fs.existsSync(filePath)) return empty;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.version !== 1) return empty;

    return {
      conversations: normalizeHistoryMap(parsed.conversations),
      personConversations: normalizeHistoryMap(parsed.personConversations)
    };
  } catch (error) {
    console.log('[NERO CONVERSATION HISTORY] Load failed:', error.message);
    return empty;
  }
}

export function saveNeroConversationHistory(filePath, state) {
  const toObject = map => Object.fromEntries(
    map instanceof Map ? map.entries() : []
  );
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    conversations: toObject(state?.conversations),
    personConversations: toObject(state?.personConversations)
  };

  const temporaryPath = filePath + '.tmp';
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(payload), 'utf8');
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (error) {
    console.log('[NERO CONVERSATION HISTORY] Save failed:', error.message);
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {}
    return false;
  }
}
