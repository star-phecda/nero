import assert from 'node:assert/strict';
import { NeroModelRouter } from '../src/core/neroModelRouter.js';
import { NeroWorker } from '../src/core/neroWorker.js';
import { NeroRuntime } from '../src/core/neroRuntime.js';
import { NeroDelegator } from '../src/core/neroDelegator.js';
import { NeroPlanner } from '../src/core/neroPlanner.js';

const catalog = [
  { key: 'gemini_primary', model: 'gemini-3.5-flash-lite', media: '📝 text' },
  { key: 'gemini_worker', model: 'gemini-3.1-flash-lite', media: '📝 text' },
  { key: 'apmix_claude_sonnet46', model: 'claude-sonnet-4-6-free', media: '📝 text' }
];

const router = new NeroModelRouter(catalog);

const runtime = new NeroRuntime({
  stateFile: '/mnt/files/phase5_1/runtime-test.json',
  modelCatalog: catalog
});
const runtimeWorkerRoute = runtime.routeWorkerModel();
assert.equal(runtimeWorkerRoute.modelKey, 'gemini_worker');
assert.equal(runtimeWorkerRoute.tier, 'worker');
const workerRoute = router.route({ tier: 'worker' });
assert.equal(workerRoute.tier, 'worker');
assert.equal(workerRoute.modelKey, 'gemini_worker');
assert.equal(workerRoute.source, 'worker-router');

let seenRequest = null;
const worker = new NeroWorker({
  workerId: 'analyst',
  role: 'analyst',
  task: 'Compare two approaches from the assigned evidence.',
  runModel: async request => {
    seenRequest = request;
    return JSON.stringify({
      summary: 'Approach A is preferable.',
      findings: [
        {
          claim: 'A is simpler',
          evidence: 'Assigned context says A uses fewer components.',
          confidence: 0.91
        }
      ],
      uncertainties: ['Long-term scaling was not provided.']
    });
  }
});

const result = await worker.run();
assert.equal(result.status, 'completed');
assert.equal(result.structured.summary, 'Approach A is preferable.');
assert.equal(result.structured.findings[0].confidence, 0.91);
assert.ok(seenRequest.prompt.includes('Return JSON'));
assert.equal(seenRequest.tier, 'worker');

const malformedWorker = new NeroWorker({
  workerId: 'analyst',
  role: 'analyst',
  task: 'Return structured findings.',
  runModel: async () => 'not json'
});
const malformed = await malformedWorker.run();
assert.equal(malformed.status, 'failed');
assert.ok(malformed.uncertainties.join(' ').includes('invalid-worker-json'));

assert.equal(router.route({ tier: 'primary' }).modelKey, 'gemini_primary');
console.log('Phase 5.1 unit gate: PASS');

const planner = new NeroPlanner();
const delegatedPlan = planner.plan({
  text: 'Research and compare the latest three options with sources.',
  mode: 'normal',
  context: {}
});
assert.equal(delegatedPlan.delegation, true);
assert.equal(delegatedPlan.delegationContract.maxWorkers, 1);
assert.equal(delegatedPlan.delegationContract.sideEffects, false);

const delegator = new NeroDelegator();
let observedTier = '';
const delegated = await delegator.run({
  request: 'Research and compare the latest three options with sources.',
  plan: delegatedPlan,
  context: 'Only assigned evidence.',
  runModel: async request => {
    observedTier = request.tier;
    return JSON.stringify({
      summary: 'One bounded finding.',
      findings: [
        {
          claim: 'A is preferable.',
          evidence: 'The supplied evidence supports A.',
          confidence: 0.88
        }
      ],
      uncertainties: []
    });
  }
});
assert.equal(observedTier, 'worker');
assert.equal(delegated.status, 'usable');
assert.equal(delegated.completedWorkers, 1);
assert.equal(delegated.failedWorkers, 0);
assert.match(delegated.text, /CONFIDENCE: 0\.88/);

const appSource = await import('node:fs').then(fs => fs.readFileSync('/mnt/files/phase5_1/app.js', 'utf8'));
assert.match(appSource, /key: 'gemini_worker'/);
assert.match(appSource, /internal: true/);
assert.match(appSource, /!model\.internal/);
console.log('Phase 5.1 visibility gate: PASS');
