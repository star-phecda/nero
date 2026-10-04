const CURRENT_PATTERN =
  /\b(?:latest|most\s+recent|today|tonight|tomorrow|currently|current|right\s+now|live|price|pricing|availability|schedule|weather|forecast|score|standings|news|update|release|version|outage|status)\b/i;

const EXPLICIT_WEB_PATTERN =
  /(?:search the web|web search|search online|look it up|check the internet|verify online|find out online)/i;

const HISTORY_PATTERN =
  /(?:previous|earlier|last\s+(?:message|messages|commit|change|conversation|week|day|hour)|what happened|what did .+ say|where did .+ say|since the last|after the last|before that|from earlier|in the chat|in this group|history)/i;

const MEMORY_PATTERN =
  /(?:remember|memory|you know|as you know|my\s+(?:project|preference|setup|phone|repo|account)|who is|what do you know about|what have i told you)/i;

const PROJECT_PATTERN =
  /\b(?:nero|whatsapp|baileys|github|termux|repo(?:sitory)?|project|runtime|app|commit|provider|model|codebase)\b/i;

const TOOL_PATTERN =
  /(?:inspect|check|look at|read|fetch|search|find|test|verify|run|execute|use the|github|repo(?:sitory)?|whatsapp|baileys|termux|code|file|logs?|commit)/i;

const PHASE4_MAX_REASONING_ATTEMPTS =
  Math.max(
    1,
    Number(process.env.NERO_PHASE4_MAX_REASONING_ATTEMPTS || 2)
  );

const PHASE4_MAX_RECOVERY_ATTEMPTS =
  Math.max(
    0,
    Number(process.env.NERO_PHASE4_MAX_RECOVERY_ATTEMPTS || 1)
  );

const PHASE4_TIME_BUDGET_MS =
  Math.max(
    5000,
    Number(process.env.NERO_PHASE4_TIME_BUDGET_MS || 45000)
  );

const STRONG_PATTERN =
  /(?:debug|debugging|code|coding|program|programming|architecture|design|research|analyze|analyse|compare|comparison|reason|reasoning|prove|proof|derive|calculate|solve|strategy|strategize|complex|difficult|why|trade-?off|implementation|implement|investigate|diagnose|root cause)/i;

const DELEGATION_RESEARCH_PATTERN =
  /(?:research|compare|comparison|survey|alternatives?|options?|trade-?offs?|pros?\s*(?:and|&)\s*cons?|multiple\s+sources?|literature|landscape)/i;

function hasReferenceToPriorContext(input) {
  return (
    HISTORY_PATTERN.test(input) ||
    /\b(?:this|that|it|they|them|he|she|we)\b.{0,80}\b(?:said|did|happened|changed|broke)\b/i.test(input)
  );
}

export class NeroPlanner {
  plan({
    text = '',
    mode = 'normal',
    media = null,
    context = {}
  } = {}) {
    const input = String(text || '').trim();
    const hasMedia = Boolean(media);
    const hasHistory = hasReferenceToPriorContext(input);
    const explicitWeb = EXPLICIT_WEB_PATTERN.test(input);
    const projectTask = PROJECT_PATTERN.test(input);

    const needsStrongReasoning =
      STRONG_PATTERN.test(input) ||
      input.length > 500 ||
      hasMedia;

    const needsWebSearch =
      explicitWeb ||
      CURRENT_PATTERN.test(input) ||
      (
        needsStrongReasoning &&
        projectTask &&
        /\b(?:investigate|diagnose|why|root cause|research|latest|current)\b/i.test(input)
      );

    const needsMemory =
      Boolean(context.memoryHint) ||
      MEMORY_PATTERN.test(input) ||
      hasHistory ||
      projectTask;

    const needsTools =
      mode === 'god' ||
      Boolean(context.toolHint) ||
      TOOL_PATTERN.test(input) ||
      hasMedia;

    const needsDeepReasoning =
      mode === 'god' ||
      needsStrongReasoning;

    const needsDelegation =
      !hasMedia &&
      needsStrongReasoning &&
      DELEGATION_RESEARCH_PATTERN.test(input) &&
      (
        explicitWeb ||
        /\b(?:current|latest|multiple|three|four|five|sources?|options?|alternatives?)\b/i.test(input)
      );

    const needsVerification =
      (
        mode === 'god' &&
        (
          needsStrongReasoning ||
          needsTools ||
          needsWebSearch
        )
      ) ||
      (
        needsStrongReasoning &&
        (
          hasHistory ||
          needsWebSearch ||
          projectTask
        )
      );

    let tier = 'normal';

    if (mode === 'god') {
      tier = 'strong';
    } else if (needsStrongReasoning) {
      tier = 'strong';
    } else if (
      input.length <= 90 &&
      !needsWebSearch &&
      !needsMemory &&
      !hasHistory &&
      !needsTools &&
      !hasMedia
    ) {
      tier = 'fast';
    }

    const contextNeeds = [];
    if (hasHistory) contextNeeds.push('history');
    if (needsMemory) contextNeeds.push('memory');
    if (needsWebSearch) contextNeeds.push('web');
    if (hasMedia) contextNeeds.push('media');
    if (!contextNeeds.length) contextNeeds.push('recent');

    const tools = [];
    if (needsMemory) tools.push('memory');
    if (hasHistory) tools.push('history');
    if (needsWebSearch) tools.push('web_search');
    if (hasMedia) tools.push('media');

    const execution = [];
    if (needsMemory) execution.push('retrieve_memory');
    if (hasHistory) execution.push('retrieve_history');
    if (needsWebSearch) execution.push('web_search');
    execution.push(
      needsDeepReasoning
        ? 'reason'
        : 'answer'
    );
    if (needsVerification) {
      execution.push('verify');
      execution.push('recover');
    }

    return {
      tier,
      tierName: tier.toUpperCase(),
      memory: needsMemory,
      history: hasHistory,
      web: needsWebSearch,
      tools: needsTools,
      toolset: tools,
      deep_reasoning: needsDeepReasoning,
      verification: needsVerification,
      recovery: needsVerification,
      reasoning: {
        max_reasoning_attempts:
          needsDeepReasoning
            ? PHASE4_MAX_REASONING_ATTEMPTS
            : 1,
        max_recovery_attempts:
          needsVerification
            ? PHASE4_MAX_RECOVERY_ATTEMPTS
            : 0,
        time_budget_ms:
          PHASE4_TIME_BUDGET_MS,
        max_total_tokens:
          Number(process.env.NERO_PHASE4_MAX_TOTAL_TOKENS || 12000)
      },
      delegation: needsDelegation,
      delegationContract: needsDelegation
        ? {
            enabled: true,
            strategy: 'parallel-research-analysis-critique',
            maxWorkers: Math.max(1, Math.min(3, Number(process.env.NERO_PHASE5_MAX_WORKERS || 1))),
            workerTimeoutMs: 15000,
            totalWallTimeMs: PHASE4_TIME_BUDGET_MS,
            totalTokenBudget: 9000,
            parentSynthesisTokenBudget: 3000,
            maxTotalResultChars: 12000,
            maxResultCharsPerWorker: 4000,
            contextChars: 7000,
            workers: [
              { role: 'web', maxTokens: 4000 },
              { role: 'analyst', maxTokens: 4000 },
              { role: 'critic', maxTokens: 4000 }
            ],
            allowRecursiveDelegation: false,
            sideEffects: false
          }
        : {
            enabled: false,
            strategy: 'none',
            maxWorkers: 0,
            totalWallTimeMs: 0,
            totalTokenBudget: 0,
            workers: [],
            allowRecursiveDelegation: false,
            sideEffects: false
          },
      context: contextNeeds,
      execution,
      planning:
        mode === 'god' ||
        needsDeepReasoning ||
        needsTools ||
        needsMemory ||
        hasHistory ||
        needsWebSearch,
      reason: mode === 'god'
        ? 'god-mode'
        : needsVerification
          ? 'complex-task-with-verification'
          : needsStrongReasoning
            ? 'complex-task'
            : needsWebSearch
              ? 'current-information'
              : needsMemory || hasHistory
                ? 'context-dependent'
                : needsTools
                  ? 'tool-assisted'
                  : tier === 'fast'
                    ? 'simple-task'
                    : 'normal-task'
    };
  }
}
