import assert from 'node:assert/strict';
import { NeroPresence } from '../src/core/neroPresence.js';

const clock = { now: 1_000_000 };
const presence = new NeroPresence({
  clock: () => clock.now,
  initiativeCooldownMs: 30 * 60 * 1000,
  maxRecentInteractions: 8
});

const initial = presence.observe({
  scope: 'chat-1',
  text: 'Hello',
  senderRole: 'Master'
});
assert.equal(initial.state.mood, 'attentive');
assert.equal(initial.state.energy, 1);
assert.equal(initial.state.interest, 0.5);
assert.deepEqual(initial.state.recentInteractions.map(x => x.text), ['Hello']);
assert.equal(initial.state.lastReaction, null);

const normalDecision = presence.decide({
  scope: 'chat-1',
  text: 'What is two plus two?',
  senderRole: 'Master',
  plan: {}
});
assert.equal(normalDecision.initiativeEligible, false);

clock.now += 60_000;
presence.observe({
  scope: 'chat-1',
  text: 'I finally fixed the Nero bug.',
  senderRole: 'Master'
});
const achievement = presence.decide({
  scope: 'chat-1',
  text: 'I finally fixed the Nero bug.',
  senderRole: 'Master',
  plan: {}
});
assert.equal(achievement.initiativeEligible, true);
assert.equal(achievement.reason, 'achievement');
assert.match(achievement.prompt, /brief unsolicited remark/i);
assert.match(achievement.prompt, /BEHAVIORAL STATE/);
assert.match(achievement.prompt, /mood=satisfied/);

presence.recordResponse({
  scope: 'chat-1',
  socialAction: { action: 'reply', text: 'Hm. You survived.' },
  initiativeUsed: true
});
assert.equal(presence.getState('chat-1').lastReaction, 'reply');

const cooldownBlocked = presence.decide({
  scope: 'chat-1',
  text: 'I fixed another thing.',
  senderRole: 'Master',
  plan: {}
});
assert.equal(cooldownBlocked.initiativeEligible, false);
assert.equal(cooldownBlocked.reason, 'cooldown');

const serious = presence.decide({
  scope: 'chat-1',
  text: 'I am in an emergency and need help.',
  senderRole: 'Master',
  plan: {}
});
assert.equal(serious.initiativeEligible, false);
assert.equal(serious.reason, 'serious-message');

const important = presence.decide({
  scope: 'chat-1',
  text: 'Research the latest version and verify it.',
  senderRole: 'Group member',
  plan: { web: true, verification: true }
});
assert.equal(important.initiativeEligible, false);
assert.equal(important.reason, 'important-task');

clock.now += 31 * 60 * 1000;
const longSessionPresence = new NeroPresence({
  clock: () => clock.now,
  initiativeCooldownMs: 30 * 60 * 1000
});
for (let i = 0; i < 9; i++) {
  clock.now += 5 * 60 * 1000;
  longSessionPresence.observe({
    scope: 'chat-2',
    text: 'Still working on Nero.',
    senderRole: 'Master'
  });
}
const longSession = longSessionPresence.decide({
  scope: 'chat-2',
  text: 'Still working on Nero.',
  senderRole: 'Master',
  plan: {}
});
assert.equal(longSession.initiativeEligible, true);
assert.equal(longSession.reason, 'long-session');

const otherChat = longSessionPresence.getState('chat-3');
assert.equal(otherChat.recentInteractions.length, 0);

const appSource = await import('node:fs').then(fs => fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8'));
assert.match(appSource, /new NeroPresence\(\)/);
assert.match(appSource, /neroPresence\.observe\(/);
assert.match(appSource, /neroPresence\.decide\(/);
assert.match(appSource, /neroPresence\.buildPrompt\(/);
assert.match(appSource, /neroPresence\.recordResponse\(/);
console.log('Phase 5.2.5 Presence integration gate: PASS');
