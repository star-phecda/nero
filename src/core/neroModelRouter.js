const FAST_PREFERENCES = [
  'groq_qwen',
  'gemini_fallback'
];

const STRONG_PREFERENCES = [
  'apmix_claude_sonnet46',
  'fhrouter_grok',
  'openrouter_nemotron'
];

const MULTIMODAL_PREFERENCES = [
  'gemini_primary',
  'gemini_fallback'
];

export class NeroModelRouter {
  constructor(modelCatalog = []) {
    this.modelCatalog = Array.isArray(modelCatalog)
      ? modelCatalog
      : [];
  }

  has(key) {
    return this.modelCatalog.some(
      model => model.key === key
    );
  }

  supportsMedia(key, media) {
    const model = this.modelCatalog.find(
      candidate => candidate.key === key
    );

    if (!model) return false;
    if (!media) return true;

    if (
      key === 'gemini_primary' ||
      key === 'gemini_fallback'
    ) {
      return true;
    }

    return Boolean(
      model.media &&
      model.media.includes('🖼️') &&
      media.kind !== 'video'
    );
  }

  firstAvailable(keys, media = null) {
    return keys.find(
      key =>
        this.has(key) &&
        this.supportsMedia(key, media)
    ) || 'auto';
  }

  route({
    tier = 'normal',
    mode = 'normal',
    media = null,
    selectedModel = 'auto'
  } = {}) {
    if (
      selectedModel &&
      selectedModel !== 'auto' &&
      this.has(selectedModel)
    ) {
      return {
        modelKey: selectedModel,
        tier,
        source: 'explicit'
      };
    }

    if (media) {
      return {
        modelKey: this.firstAvailable(
          MULTIMODAL_PREFERENCES,
          media
        ),
        tier,
        source: 'multimodal'
      };
    }

    if (
      mode === 'god' ||
      tier === 'strong'
    ) {
      return {
        modelKey: this.firstAvailable(
          STRONG_PREFERENCES
        ),
        tier: 'strong',
        source:
          mode === 'god'
            ? 'god-runtime'
            : 'task-router'
      };
    }

    if (tier === 'fast') {
      return {
        modelKey: this.firstAvailable(
          FAST_PREFERENCES
        ),
        tier: 'fast',
        source: 'task-router'
      };
    }

    return {
      modelKey: 'auto',
      tier: 'normal',
      source: 'fallback-chain'
    };
  }
}
