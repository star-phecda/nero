import assert from 'node:assert/strict';
import { NeroDelegator } from '../src/core/neroDelegator.js';

const efficiencyPlan = {
  delegation: true,
  delegationContract: {
    enabled: true, maxWorkers: 2, totalTokenBudget: 2000, totalWallTimeMs: 10000,
    maxResultCharsPerWorker: 4000, workerTimeoutMs: 5000, contextChars: 3000,
    workers: [{ role: 'web', dependencies: ['web'] }, { role: 'analyst', dependencies: ['context'] }]
  }
};
let efficientCalls = 0;
const efficientDelegator = new NeroDelegator();
const efficientModel = async () => {
  efficientCalls++;
  return JSON.stringify({summary:'Reusable finding.',findings:[{claim:'Reuse works.',evidence:'Artifact retained the worker result.',confidence:0.95}],uncertainties:[]});
};
const firstEfficient = await efficientDelegator.run({
  request:'Research reuse behavior.', plan:efficiencyPlan, context:'Stable assigned context.',
  webSearch:async()=>({results:[{title:'Source',excerpt:'Stable evidence',url:'https://example.com/a'}]}),
  dependencyInputs:{context:'Stable assigned context.',webSearch:{results:[{title:'Source',excerpt:'Stable evidence',url:'https://example.com/a'}]}},
  runModel:efficientModel
});
assert.equal(firstEfficient.executedWorkerCount,2);
assert.equal(efficientCalls,2);
const secondEfficient = await efficientDelegator.run({
  request:'Research reuse behavior.', plan:efficiencyPlan, context:'Stable assigned context.',
  webSearch:async()=>({results:[{title:'Source',excerpt:'Stable evidence',url:'https://example.com/a'}]}),
  dependencyInputs:{context:'Stable assigned context.',webSearch:{results:[{title:'Source',excerpt:'Stable evidence',url:'https://example.com/a'}]}},
  runModel:efficientModel, artifact:firstEfficient.artifact
});
assert.equal(secondEfficient.reusedWorkerCount,2);
assert.equal(secondEfficient.executedWorkerCount,0);
assert.equal(efficientCalls,2);
const sameRefresh = await efficientDelegator.run({
  request:'Research reuse behavior.', plan:efficiencyPlan, context:'Stable assigned context.',
  webSearch:async()=>({results:[{title:'Source',excerpt:'Stable evidence',url:'https://example.com/a'}]}),
  dependencyInputs:{context:'Stable assigned context.',webSearch:{results:[{title:'Source',excerpt:'Stable evidence',url:'https://example.com/a'}]}},
  runModel:efficientModel, artifact:secondEfficient.artifact, recoveryActions:['refresh_web']
});
assert.equal(sameRefresh.reusedWorkerCount,2);
assert.equal(sameRefresh.executedWorkerCount,0);
assert.equal(efficientCalls,2);
const refreshedEfficient = await efficientDelegator.run({
  request:'Research reuse behavior.', plan:efficiencyPlan, context:'Stable assigned context.',
  webSearch:async()=>({results:[{title:'Source',excerpt:'Fresh changed evidence',url:'https://example.com/b'}]}),
  dependencyInputs:{context:'Stable assigned context.',webSearch:{results:[{title:'Source',excerpt:'Fresh changed evidence',url:'https://example.com/b'}]}},
  runModel:efficientModel, artifact:secondEfficient.artifact, recoveryActions:['refresh_web']
});
assert.equal(refreshedEfficient.reusedWorkerCount,1);
assert.equal(refreshedEfficient.executedWorkerCount,1);
assert.equal(efficientCalls,3);
const mismatched = await efficientDelegator.run({
  request:'A completely new request.', plan:efficiencyPlan, context:'Stable assigned context.',
  webSearch:async()=>({results:[{title:'Source',excerpt:'New request evidence',url:'https://example.com/c'}]}),
  dependencyInputs:{context:'Stable assigned context.',webSearch:{results:[{title:'Source',excerpt:'New request evidence',url:'https://example.com/c'}]}},
  runModel:efficientModel, artifact:refreshedEfficient.artifact
});
assert.equal(mismatched.executedWorkerCount,2);
assert.equal(mismatched.reusedWorkerCount,0);
assert.equal(efficientCalls,5);
let retryCalls = 0;
const retryDelegator = new NeroDelegator();
const retryPlan = {
  delegation:true,
  delegationContract:{enabled:true,maxWorkers:1,totalTokenBudget:1000,totalWallTimeMs:5000,maxResultCharsPerWorker:3000,workerTimeoutMs:2000,contextChars:1000,workers:[{role:'analyst',dependencies:['context']}]}
};
const failedOnce = await retryDelegator.run({
  request:'Retry a failed worker.',plan:retryPlan,context:'Retry context.',
  dependencyInputs:{context:'Retry context.'},
  runModel:async()=>{retryCalls++;if(retryCalls===1)return 'not json';return JSON.stringify({summary:'Recovered.',findings:[],uncertainties:[]});}
});
assert.equal(failedOnce.executedWorkerCount,1);
assert.equal(failedOnce.status,'unusable');
const retried = await retryDelegator.run({
  request:'Retry a failed worker.',plan:retryPlan,context:'Retry context.',
  dependencyInputs:{context:'Retry context.'},
  runModel:async()=>{retryCalls++;return JSON.stringify({summary:'Recovered.',findings:[],uncertainties:[]});},
  artifact:failedOnce.artifact
});
assert.equal(retried.executedWorkerCount,1);
assert.equal(retryCalls,2);
console.log('Phase 5.2 delegation efficiency gate: PASS');
