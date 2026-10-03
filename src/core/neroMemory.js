import fs from 'node:fs';

export const NERO_MEMORY_TYPES = Object.freeze([
  'facts',
  'episodes',
  'projects',
  'people',
  'preferences',
  'learned_skills'
]);

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','have','how',
  'i','in','is','it','me','my','of','on','or','that','the','their','this',
  'to','was','what','when','where','who','why','with','you','your'
]);

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return [...new Set(
    cleanText(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter(token => token.length > 1 && !STOP_WORDS.has(token))
  )];
}

function canonical(value) {
  return tokens(value).sort().join(' ');
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function nowMs() {
  return Date.now();
}

function ageScore(timestamp, now) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return 0.5;
  const ageDays = Math.max(0, now - value) / 86400000;
  return Math.exp(-ageDays / 45);
}

function stableId(entry) {
  return [
    entry.type,
    entry.scope,
    entry.subject || '',
    canonical(entry.text)
  ].join('|');
}

export class NeroMemoryService {
  constructor({
    filePath = process.cwd() + '/nero_memory.json',
    clock = nowMs,
    maxEntries = 1000
  } = {}) {
    this.filePath = filePath;
    this.clock = clock;
    this.maxEntries = maxEntries;
    this.memories = [];
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));

      if (parsed?.version === 2 && Array.isArray(parsed.memories)) {
        this.memories = parsed.memories
          .map(entry => this.#normalizeEntry(entry))
          .filter(Boolean);
        return;
      }

      const migrated = [];
      for (const fact of Array.isArray(parsed?.master) ? parsed.master : []) {
        const entry = this.#makeEntry(fact, {
          type: 'facts',
          scope: 'master',
          source: 'legacy-memory'
        });
        if (entry) migrated.push(entry);
      }

      for (const [jid, facts] of Object.entries(
        parsed?.groups && typeof parsed.groups === 'object'
          ? parsed.groups
          : {}
      )) {
        for (const fact of Array.isArray(facts) ? facts : []) {
          const entry = this.#makeEntry(fact, {
            type: 'facts',
            scope: 'group:' + jid,
            source: 'legacy-memory'
          });
          if (entry) migrated.push(entry);
        }
      }

      this.memories = migrated;
      if (migrated.length) this.save();
    } catch (error) {
      console.log('[Memory] Could not load memory:', error.message);
    }
  }

  save() {
    try {
      const payload = {
        version: 2,
        updatedAt: this.clock(),
        memories: this.memories
      };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
    } catch (error) {
      console.log('[Memory] Could not save memory:', error.message);
    }
  }

  #normalizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const text = cleanText(entry.text);
    if (!text) return null;

    const type = NERO_MEMORY_TYPES.includes(entry.type)
      ? entry.type
      : 'facts';

    const createdAt = Number(entry.createdAt) || this.clock();
    const updatedAt = Number(entry.updatedAt) || createdAt;

    return {
      id: String(entry.id || stableId({
        ...entry,
        type,
        text
      })),
      type,
      text,
      scope: String(entry.scope || 'master'),
      subject: cleanText(entry.subject) || '',
      tags: Array.isArray(entry.tags)
        ? [...new Set(entry.tags.map(cleanText).filter(Boolean))]
        : [],
      importance: clamp(entry.importance, 0.05, 1),
      confidence: clamp(entry.confidence, 0.05, 1),
      createdAt,
      updatedAt,
      source: cleanText(entry.source) || 'memory',
      supersedes: cleanText(entry.supersedes) || '',
      status: entry.status === 'superseded' ? 'superseded' : 'active'
    };
  }

  #makeEntry(text, metadata = {}) {
    const clean = cleanText(text);
    if (!clean) return null;

    const timestamp = this.clock();
    const type = NERO_MEMORY_TYPES.includes(metadata.type)
      ? metadata.type
      : 'facts';

    return {
      id: stableId({
        type,
        scope: metadata.scope || 'master',
        subject: metadata.subject || '',
        text: clean
      }),
      type,
      text: clean,
      scope: String(metadata.scope || 'master'),
      subject: cleanText(metadata.subject),
      tags: Array.isArray(metadata.tags)
        ? [...new Set(metadata.tags.map(cleanText).filter(Boolean))]
        : [],
      importance: clamp(
        metadata.importance ?? (type === 'preferences' ? 0.8 : 0.65),
        0.05,
        1
      ),
      confidence: clamp(metadata.confidence ?? 0.9, 0.05, 1),
      createdAt: timestamp,
      updatedAt: timestamp,
      source: cleanText(metadata.source) || 'memory',
      supersedes: cleanText(metadata.supersedes),
      status: 'active'
    };
  }

  add(text, metadata = {}) {
    const entry = this.#makeEntry(text, metadata);
    if (!entry) return null;

    const duplicate = this.memories.find(existing =>
      existing.status === 'active' &&
      existing.type === entry.type &&
      existing.scope === entry.scope &&
      canonical(existing.text) === canonical(entry.text)
    );

    if (duplicate) {
      duplicate.updatedAt = this.clock();
      duplicate.importance = Math.max(duplicate.importance, entry.importance);
      duplicate.confidence = Math.max(duplicate.confidence, entry.confidence);
      this.save();
      return duplicate;
    }

    this.memories.push(entry);
    this.#trim();
    this.save();
    return entry;
  }

  correct(query, replacement, metadata = {}) {
    const matches = this.retrieve(query, {
      limit: 20,
      scope: metadata.scope,
      types: metadata.type ? [metadata.type] : undefined
    });

    const strongest = matches[0]?.entry;
    const next = this.add(replacement, {
      ...metadata,
      supersedes: strongest?.id || metadata.supersedes,
      confidence: metadata.confidence ?? 0.95
    });

    if (next && strongest) {
      strongest.status = 'superseded';
      strongest.updatedAt = this.clock();
      this.save();
    }

    return next;
  }

  remove(query, { scope } = {}) {
    const q = cleanText(query).toLowerCase();
    if (!q) return 0;

    const before = this.memories.length;
    this.memories = this.memories.filter(entry => {
      if (entry.status !== 'active') return true;
      if (scope && entry.scope !== scope) return true;

      const haystack = (
        entry.text + ' ' +
        entry.subject + ' ' +
        entry.tags.join(' ')
      ).toLowerCase();

      return !haystack.includes(q);
    });

    const removed = before - this.memories.length;
    if (removed) this.save();
    return removed;
  }

  clearScope(scope) {
    const before = this.memories.length;
    this.memories = this.memories.filter(entry => entry.scope !== scope);
    const removed = before - this.memories.length;
    if (removed) this.save();
    return removed;
  }

  retrieve(query, {
    scope,
    types,
    limit = 20,
    minScore = 0,
    now = this.clock()
  } = {}) {
    const queryText = cleanText(query);
    const queryTokens = tokens(queryText);
    const querySet = new Set(queryTokens);
    const allowedTypes = Array.isArray(types) && types.length
      ? new Set(types)
      : null;

    return this.memories
      .filter(entry => {
        if (entry.status !== 'active') return false;
        if (scope && entry.scope !== scope && entry.scope !== 'master') return false;
        if (allowedTypes && !allowedTypes.has(entry.type)) return false;
        return true;
      })
      .map(entry => {
        const entryTokens = tokens(
          entry.text + ' ' + entry.subject + ' ' + entry.tags.join(' ')
        );
        const entrySet = new Set(entryTokens);
        const overlap = querySet.size
          ? queryTokens.filter(token => entrySet.has(token)).length / querySet.size
          : 0;

        const phrase = queryText &&
          cleanText(entry.text).toLowerCase().includes(queryText.toLowerCase())
          ? 1
          : 0;

        const importance = clamp(entry.importance);
        const recency = ageScore(entry.updatedAt, now);
        const confidence = clamp(entry.confidence);

        const score =
          overlap * 0.5 +
          phrase * 0.15 +
          importance * 0.15 +
          recency * 0.1 +
          confidence * 0.1;

        return {
          entry,
          score,
          signals: {
            relevance: overlap,
            phrase,
            importance,
            recency,
            confidence
          }
        };
      })
      .filter(result => result.score >= minScore)
      .sort((a, b) =>
        b.score - a.score ||
        b.entry.updatedAt - a.entry.updatedAt ||
        b.entry.importance - a.entry.importance
      )
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  list({ scope, type } = {}) {
    return this.memories.filter(entry =>
      (!scope || entry.scope === scope) &&
      (!type || entry.type === type) &&
      entry.status === 'active'
    );
  }

  #trim() {
    if (this.memories.length <= this.maxEntries) return;

    this.memories.sort((a, b) =>
      (b.importance * b.confidence) - (a.importance * a.confidence) ||
      b.updatedAt - a.updatedAt
    );

    this.memories = this.memories.slice(0, this.maxEntries);
  }

  buildContext(query, {
    scope,
    limit = 20,
    maxChars = 2500,
    types
  } = {}) {
    const ranked = this.retrieve(query, {
      scope,
      types,
      limit
    });

    const selected = [];
    const seen = new Set();
    let usedChars = 0;

    for (const result of ranked) {
      const key = canonical(result.entry.text);
      if (!key || seen.has(key)) continue;

      const line = '- ' + result.entry.text;
      if (usedChars + line.length + 1 > maxChars) continue;

      seen.add(key);
      selected.push(result);
      usedChars += line.length + 1;
    }

    return {
      query: cleanText(query),
      items: selected,
      text: selected.length
        ? selected.map(result => '- ' + result.entry.text).join('\n')
        : '(no relevant long-term memories)',
      usedChars,
      considered: ranked.length
    };
  }
}
