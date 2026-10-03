const CURRENT_PATTERN =
  /(?:latest|recent|today|tonight|tomorrow|currently|current|live|price|pricing|availability|schedule|weather|forecast|score|standings|news|release)/i;

const STRONG_PATTERN =
  /(?:debug|debugging|code|coding|program|programming|architecture|design|research|analyze|analyse|compare|comparison|reason|reasoning|prove|proof|derive|calculate|solve|strategy|strategize|complex|difficult|why|tradeoff|trade-off|implementation|implement)/i;

export class NeroPlanner {
  plan({ text = '', mode = 'normal', media = null } = {}) {
    const input = String(text || '').trim();
    const hasMedia = Boolean(media);

    const needsWebSearch = CURRENT_PATTERN.test(input);
    const needsStrongReasoning =
      STRONG_PATTERN.test(input) ||
      input.length > 500;

    let tier = 'normal';

    if (mode === 'god') {
      tier = 'strong';
    } else if (needsStrongReasoning) {
      tier = 'strong';
    } else if (
      input.length <= 90 &&
      !needsWebSearch &&
      !hasMedia
    ) {
      tier = 'fast';
    }

    return {
      tier,
      needsWebSearch,
      needsMemory: true,
      planning: mode === 'god',
      verification: mode === 'god' && needsStrongReasoning,
      reason: mode === 'god'
        ? 'god-mode'
        : needsStrongReasoning
          ? 'complex-task'
          : tier === 'fast'
            ? 'simple-task'
            : 'normal-task'
    };
  }
}
