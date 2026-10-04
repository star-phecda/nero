const PRIMARY_PREFERENCES = [
  'gemini_primary'
];

const WORKER_PREFERENCES = [
  'gemini_worker'
];

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
    plan = null,
    tier = 'normal',
    mode = 'normal',
    media = null,
    selectedModel = 'auto'
  } = {}) {
    const requestedTier =
      plan?.tier ||
      tier ||
      'normal';

    const deepReasoning =
      plan?.deep_reasoning === true;

    const needsVerification =
      plan?.verification === true;
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

    if (requestedTier === 'worker') {
      return {
        modelKey: this.firstAvailable(
          WORKER_PREFERENCES
        ),
        tier: 'worker',
        source: 'worker-router'
      };
    }

    if (requestedTier === 'primary') {
      return {
        modelKey: this.firstAvailable(
          PRIMARY_PREFERENCES,
          media
        ),
        tier: 'primary',
        source: 'primary-router'
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
      requestedTier === 'strong' ||
      deepReasoning
    ) {
      return {
        modelKey: this.firstAvailable(
          STRONG_PREFERENCES
        ),
        tier: 'strong',
        source:
          mode === 'god'
            ? 'god-runtime'
            : needsVerification
              ? 'verified-strong-task'
              : 'task-router'
      };
    }

    if (requestedTier === 'fast') {
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
