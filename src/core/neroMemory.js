export const NERO_MEMORY_TYPES = Object.freeze([
  'facts',
  'episodes',
  'projects',
  'people',
  'preferences',
  'learned_skills'
]);

export class NeroMemoryService {
  constructor(adapter = null) {
    this.adapter = adapter;
  }

  setAdapter(adapter) {
    this.adapter = adapter;
  }

  async retrieve(query, options = {}) {
    if (
      this.adapter &&
      typeof this.adapter.retrieve === 'function'
    ) {
      return this.adapter.retrieve(query, options);
    }

    return [];
  }

  async buildContext(query, options = {}) {
    const results = await this.retrieve(query, options);

    return {
      query: String(query || ''),
      results: Array.isArray(results) ? results : []
    };
  }

  getTypes() {
    return [...NERO_MEMORY_TYPES];
  }
}
