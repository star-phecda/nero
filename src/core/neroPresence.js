const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const normalize = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const IMPORTANT_PLAN_KEYS = [
  'deep_reasoning',
  'verification',
  'tools',
  'web',
  'history',
  'memory',
];

const SERIOUS_PATTERN =
  /\b(?:urgent|emergency|danger|serious|help me|i need help|hurt|injured|dying|suicide|suicidal|kill myself)\b/i;

const ACHIEVEMENT_PATTERN =
  /\b(?:finally|fixed|solved|worked|passed|done|finished|completed|got it working|bug is gone|bug fixed|nailed it)\b/i;

const INTEREST_PATTERN =
  /\b(?:nero|code|coding|bug|build|test|commit|phase|github|model|whatsapp|delegation|moon cell)\b/i;

function defaultState(now) {
  return {
    mood: 'attentive',
    energy: 1,
    interest: 0.5,
    recentInteractions: [],
    lastReaction: null,
    lastInitiativeAt: 0,
    updatedAt: now,
  };
}

function cloneState(state) {
  return {
    ...state,
    recentInteractions: state.recentInteractions.map(item => ({ ...item })),
  };
}

export class NeroPresence {
  constructor({
    clock = () => Date.now(),
    initiativeCooldownMs = 30 * 60 * 1000,
    maxRecentInteractions = 12,
  } = {}) {
    this.clock = clock;
    this.initiativeCooldownMs = Math.max(1000, Number(initiativeCooldownMs) || 30 * 60 * 1000);
    this.maxRecentInteractions = Math.max(4, Math.min(32, Number(maxRecentInteractions) || 12));
    this.states = new Map();
  }

  getState(scope = 'global') {
    const key = clean(scope) || 'global';
    if (!this.states.has(key)) {
      this.states.set(key, defaultState(this.clock()));
    }
    return cloneState(this.states.get(key));
  }

  observe({ scope = 'global', text = '', senderRole = 'Group member', now = this.clock() } = {}) {
    const key = clean(scope) || 'global';
    const state = this.states.get(key) || defaultState(now);
    const message = clean(text).slice(0, 500);

    const recent = [...state.recentInteractions, {
      at: now,
      text: message,
      senderRole: clean(senderRole) || 'Group member',
    }].slice(-this.maxRecentInteractions);

    const recentHour = recent.filter(item => now - item.at <= 60 * 60 * 1000).length;
    const focusBoost = INTEREST_PATTERN.test(message) ? 0.12 : 0;
    const repeated =
      recent.length >= 2 &&
      normalize(recent[recent.length - 2].text) === normalize(message);
    const repetitionPenalty = repeated ? 0.08 : 0;

    state.recentInteractions = recent;
    state.energy = clamp(1 - Math.max(0, recentHour - 5) * 0.07, 0.45, 1);
    state.interest = clamp(
      state.interest * 0.85 + 0.5 * 0.15 + focusBoost - repetitionPenalty,
      0,
      1
    );
    state.mood = SERIOUS_PATTERN.test(message)
      ? 'concerned'
      : ACHIEVEMENT_PATTERN.test(message)
        ? 'satisfied'
        : INTEREST_PATTERN.test(message)
          ? 'focused'
          : 'attentive';
    state.updatedAt = now;

    this.states.set(key, state);
    return {
      state: cloneState(state),
      cues: {
        serious: SERIOUS_PATTERN.test(message),
        achievement: ACHIEVEMENT_PATTERN.test(message),
        repeated,
        longSession: recent.length >= 8 && (now - recent[0].at) >= 30 * 60 * 1000,
      },
    };
  }

  decide({
    scope = 'global',
    text = '',
    senderRole = 'Group member',
    plan = {},
    now = this.clock(),
  } = {}) {
    const key = clean(scope) || 'global';
    const state = this.states.get(key) || defaultState(now);
    const message = clean(text);
    const importantTask = IMPORTANT_PLAN_KEYS.some(key => Boolean(plan?.[key]));

    if (SERIOUS_PATTERN.test(message)) {
      return this.decision(state, false, 'serious-message');
    }

    if (importantTask) {
      return this.decision(state, false, 'important-task');
    }

    if (
      state.lastInitiativeAt &&
      now - state.lastInitiativeAt < this.initiativeCooldownMs
    ) {
      return this.decision(state, false, 'cooldown');
    }

    const interactions = state.recentInteractions;
    const longSession =
      interactions.length >= 8 &&
      now - interactions[0].at >= 30 * 60 * 1000;
    const achievement = ACHIEVEMENT_PATTERN.test(message);
    const repeated =
      interactions.length >= 2 &&
      normalize(interactions[interactions.length - 2].text) === normalize(message);

    if (achievement) return this.decision(state, true, 'achievement');
    if (longSession) return this.decision(state, true, 'long-session');
    if (repeated) return this.decision(state, true, 'repetition');

    return this.decision(state, false, 'no-opportunity');
  }

  decision(state, initiativeEligible, reason) {
    const stateLine = [
      'BEHAVIORAL STATE (internal; never mention these values):',
      'mood=' + state.mood,
      'energy=' + state.energy.toFixed(2),
      'interest=' + state.interest.toFixed(2),
    ].join(' ');

    return {
      initiativeEligible,
      reason,
      state: cloneState(state),
      prompt: initiativeEligible
        ? [
            'NERO PRESENCE:',
            stateLine,
            'Nero may add ONE brief unsolicited remark because there is a genuine conversational reason.',
            'Keep it short, natural, and in character.',
            'Do not derail the answer, repeat the research, or turn this into a monologue.',
            'This is permission, not a requirement. Skip the remark if it would feel forced.',
            'A good presence remark can be a dry observation, a tiny tease, congratulations, or a practical nudge.',
          ].join('\n')
        : [
            'NERO PRESENCE:',
            'No unsolicited remark is requested for this turn.',
            'Answer normally and let Nero\'s personality carry the response.',
          ].join('\n'),
    };
  }

  recordResponse({
    scope = 'global',
    socialAction = { action: 'reply' },
    initiativeUsed = false,
    now = this.clock(),
  } = {}) {
    const key = clean(scope) || 'global';
    const state = this.states.get(key) || defaultState(now);
    const action = socialAction?.action || 'reply';

    state.lastReaction =
      action === 'react'
        ? 'react:' + clean(socialAction?.emoji)
        : action;

    if (initiativeUsed) {
      state.lastInitiativeAt = now;
    }

    state.updatedAt = now;
    this.states.set(key, state);
    return cloneState(state);
  }

  buildPrompt(decision = {}) {
    return decision?.prompt || this.decision(
      defaultState(this.clock()),
      false,
      'no-opportunity'
    ).prompt;
  }
}
