const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','been','being','by','for','from',
  'has','have','how','i','if','in','is','it','its','me','my','of','on',
  'or','our','that','the','their','there','this','to','was','we','what',
  'when','where','which','who','why','with','you','your'
]);

const UNCERTAINTY_PATTERN =
  /^(?:i\s+(?:don'?t|do not)\s+know|i\s+(?:can'?t|cannot)\s+verify|i'?m\s+not\s+sure|not\s+enough\s+(?:evidence|information)|i\s+can'?t\s+confirm)\b/i;

const ERROR_PATTERN =
  /(?:no ai provider returned|returned no text|api key is missing|internal error|\[object object\]|undefined|null)/i;

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(token =>
      token.length > 2 &&
      !STOP_WORDS.has(token)
    );
}

function unique(values) {
  return [...new Set(values)];
}

function overlapScore(sourceTokens, targetTokens) {
  const source = new Set(sourceTokens);
  if (!source.size) return 0;
  const hits = targetTokens.filter(token => source.has(token));
  return unique(hits).length / source.size;
}

function numbers(value) {
  return unique(
    clean(value).match(/\b\d+(?:\.\d+)?\b/g) || []
  );
}

function urls(value) {
  return clean(value).match(/https?:\/\/[^\s)]+/gi) || [];
}

function evidenceText(context = {}) {
  const memory = Array.isArray(context.items)
    ? context.items.map(item => item?.text || '').join('\n')
    : '';

  const web = Array.isArray(context.web?.results)
    ? context.web.results
        .map(result =>
          [
            result?.title,
            result?.excerpt,
            result?.url
          ].filter(Boolean).join(' ')
        )
        .join('\n')
    : '';

  return clean(memory + '\n' + web);
}

export class NeroVerifier {
  verify({
    request = '',
    answer = '',
    plan = {},
    context = {}
  } = {}) {
    const input = clean(request);
    const reply = clean(answer);
    const issues = [];

    const socialAction = context?.socialAction;
    if (socialAction) {
      const isReaction = socialAction.action === 'react';
      const isSilent = socialAction.action === 'silent';
      const allowedReactions = new Set([
        '🙄', '💅', '🥱', '😂', '😭', '🤨', '😐', '👏', '❤️', '💀', '👍', '😌'
      ]);

      if (!isReaction && !isSilent) {
        issues.push({
          code: 'invalid-social-action',
          severity: 'high',
          message: 'The social action type is invalid.'
        });
      }

      if (isReaction && !allowedReactions.has(String(socialAction.emoji || ''))) {
        issues.push({
          code: 'invalid-social-action',
          severity: 'high',
          message: 'The reaction emoji is outside Nero\'s curated vocabulary.'
        });
      }

      if (context.socialActionAllowed === false || context.senderRole === 'Master') {
        issues.push({
          code: 'social-action-prohibited',
          severity: 'high',
          message: 'This message requires a normal textual response.'
        });
      }

      if (!issues.length) {
        return {
          pass: true,
          verified: true,
          uncertain: false,
          recoverable: false,
          issues: [],
          score: 1,
          reason: 'verified-social-action'
        };
      }
    }

    if (!reply) {
      issues.push({
        code: 'empty-answer',
        severity: 'high',
        message: 'The generated result is empty.'
      });
    }

    if (
      typeof answer !== 'string' ||
      reply.length > 16000
    ) {
      issues.push({
        code: 'malformed-answer',
        severity: 'high',
        message: 'The generated result is malformed or excessively large.'
      });
    }

    if (ERROR_PATTERN.test(reply)) {
      issues.push({
        code: 'provider-artifact',
        severity: 'high',
        message: 'The generated result looks like a provider/runtime artifact.'
      });
    }

    if (
      context.operation &&
      context.operation.success === false
    ) {
      issues.push({
        code: 'operation-failed',
        severity: 'high',
        message: 'The requested operation did not succeed.'
      });
    }

    const failures = Array.isArray(context.failures)
      ? context.failures
      : [];

    if (
      plan.memory &&
      failures.some(failure =>
        String(failure?.source || '').toLowerCase() === 'memory'
      )
    ) {
      issues.push({
        code: 'required-memory-failed',
        severity: 'high',
        message: 'Required memory retrieval failed.'
      });
    }

    const webResults = Array.isArray(context.web?.results)
      ? context.web.results
      : [];

    if (
      plan.web &&
      !webResults.length
    ) {
      issues.push({
        code: 'required-web-evidence-missing',
        severity: 'high',
        message: 'The plan required fresh web evidence, but none was gathered.'
      });
    }

    const requestTokens = tokens(input);
    const answerTokens = tokens(reply);

    if (
      input.length >= 30 &&
      answerTokens.length <= 2 &&
      !/^(?:yes|no|yeah|yep|nah|sure|okay|ok|done|indeed|hm)\b/i.test(reply)
    ) {
      issues.push({
        code: 'did-not-answer',
        severity: 'medium',
        message: 'The result is too thin to count as an answer to the request.'
      });
    }

    if (
      input.length >= 20 &&
      UNCERTAINTY_PATTERN.test(reply)
    ) {
      issues.push({
        code: 'uncertain-result',
        severity: 'medium',
        message: 'The result explicitly reports uncertainty.'
      });
    }

    if (webResults.length) {
      const evidence = evidenceText(context);
      const evidenceTokens = tokens(evidence);

      const currentTask =
        Boolean(plan.web) ||
        /\b(?:latest|current|today|tonight|tomorrow|recent|now|live|price|pricing|availability|schedule|news|update|release|version|status|outage)\b/i.test(input);

      if (
        currentTask &&
        reply.length >= 25 &&
        overlapScore(answerTokens, evidenceTokens) < 0.08
      ) {
        issues.push({
          code: 'unsupported-by-evidence',
          severity: 'medium',
          message: 'The result does not visibly align with the gathered evidence.'
        });
      }

      const answerUrls = urls(reply);
      const evidenceUrls = urls(evidence);
      if (
        answerUrls.some(url =>
          !evidenceUrls.some(source => url.startsWith(source))
        )
      ) {
        issues.push({
          code: 'unsupported-url',
          severity: 'medium',
          message: 'The result contains a URL that was not present in gathered evidence.'
        });
      }

      const evidenceNumbers = numbers(evidence);
      const answerNumbers = numbers(reply);
      if (
        evidenceNumbers.length &&
        answerNumbers.some(value =>
          !evidenceNumbers.includes(value)
        )
      ) {
        issues.push({
          code: 'unsupported-number',
          severity: 'medium',
          message: 'The result contains a numeric claim not found in the gathered evidence.'
        });
      }
    }

    const highSeverity =
      issues.some(issue => issue.severity === 'high');

    const recoverable =
      issues.length > 0 &&
      !issues.some(issue =>
        issue.code === 'operation-failed'
      );

    const pass =
      issues.length === 0;

    return {
      pass,
      verified: pass,
      uncertain:
        issues.length === 1 &&
        issues[0].code === 'uncertain-result',
      recoverable,
      issues,
      score:
        pass
          ? 1
          : highSeverity
            ? 0
            : 0.5,
      reason:
        issues.length
          ? issues.map(issue => issue.code).join(', ')
          : 'verified'
    };
  }

  recoveryActions(verdict = {}) {
    const codes = new Set(
      (verdict.issues || []).map(issue => issue.code)
    );

    const actions = [];

    if (
      codes.has('required-web-evidence-missing') ||
      codes.has('unsupported-by-evidence') ||
      codes.has('unsupported-url') ||
      codes.has('unsupported-number')
    ) {
      actions.push('refresh_web');
    }

    if (
      codes.has('required-memory-failed') ||
      codes.has('did-not-answer') ||
      codes.has('uncertain-result')
    ) {
      actions.push('force_memory');
    }

    if (codes.has('social-action-prohibited') || codes.has('invalid-social-action')) {
      actions.push('force_reply');
    }

    if (
      codes.has('did-not-answer') ||
      codes.has('uncertain-result') ||
      codes.has('unsupported-by-evidence')
    ) {
      actions.push('expand_history');
    }

    if (!actions.length) {
      actions.push('rewrite_answer');
    }

    return unique(actions);
  }

  uncertaintyReply() {
    return (
      "I couldn't verify that reliably from what I gathered, so I won't pretend certainty."
    );
  }
}
