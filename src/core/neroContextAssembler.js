function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function canonical(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chars(value) {
  return Array.from(String(value ?? '')).length;
}

export class NeroContextAssembler {
  constructor({ memory = null, defaultBudgetChars = 3000 } = {}) {
    this.memory = memory;
    this.defaultBudgetChars = defaultBudgetChars;
  }

  assemble({
    request = '',
    plan = {},
    history = [],
    projectState = null,
    web = null,
    budgetChars = this.defaultBudgetChars,
    memoryScope = 'master',
    memoryScopes = null
  } = {}) {
    const budget = Math.max(500, Number(budgetChars) || this.defaultBudgetChars);
    const sections = [];
    const selected = [];
    const failures = [];
    const seen = new Set();
    let usedChars = 0;
    let dropped = 0;

    const append = (kind, text, metadata = {}) => {
      const value = clean(text);
      if (!value) return false;

      const key = canonical(value);
      if (!key || seen.has(key)) {
        dropped += 1;
        return false;
      }

      const separator = sections.length ? 2 : 0;
      if (usedChars + separator + chars(value) > budget) {
        dropped += 1;
        return false;
      }

      seen.add(key);
      usedChars += separator + chars(value);
      selected.push({ kind, text: value, ...metadata });
      sections.push(value);
      return true;
    };

    if (plan.memory && this.memory) {
      try {
        const memoryContext = this.memory.buildContext(request, {
          scope: memoryScope,
          scopes: Array.isArray(memoryScopes) && memoryScopes.length ? memoryScopes : undefined,
          limit: plan.tier === 'strong' ? 30 : 15,
          maxChars: Math.max(700, Math.floor(budget * 0.55))
        });

        for (const result of memoryContext.items) {
          append('memory', result.entry.text, {
            id: result.entry.id,
            type: result.entry.type,
            scope: result.entry.scope,
            score: result.score,
            signals: result.signals
          });
        }
      } catch (error) {
        failures.push({
          source: 'memory',
          error: String(error?.message || error)
        });
      }
    }

    if (Array.isArray(history) && history.length) {
      const recent = history
        .slice(-12)
        .map(item => clean(item?.sender || 'Unknown') + ': ' + clean(item?.text || ''))
        .filter(Boolean)
        .join('\n');

      if (recent) append('history', recent);
    }

    if (projectState) {
      const projectText = typeof projectState === 'string'
        ? projectState
        : JSON.stringify(projectState);

      append('project', projectText);
    }

    if (plan.web && web?.results?.length) {
      for (const result of web.results.slice(0, 5)) {
        append(
          'web',
          clean(result.title || result.url || 'Source') + ': ' + clean(result.excerpt),
          { url: clean(result.url) }
        );
      }
    }

    return {
      request: clean(request),
      sections,
      items: selected,
      text: sections.join('\n\n'),
      usedChars,
      budgetChars: budget,
      dropped,
      failures,
      hasContext: selected.length > 0
    };
  }
}
