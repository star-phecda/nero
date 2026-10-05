import { NeroWorkerPool } from './neroWorkerPool.js';
import { NeroDelegationAggregator } from './neroDelegationAggregator.js';
import { NeroDelegationArtifact } from './neroDelegationArtifact.js';
const SAFE={web_search:false,memory_read:false,memory_write:false,whatsapp_send:false,file_write:false,run_code:false,runtime_control:false,group_admin:false,delegation:false};
const ROLES={web:{workerId:'web',role:'web researcher',permissions:{...SAFE,web_search:true},task:'Find current, relevant evidence for the request. Search only; do not answer the user.'},analyst:{workerId:'analyst',role:'analyst',permissions:{...SAFE},task:'Analyze the request using only assigned context. Identify strongest conclusions and trade-offs.'},critic:{workerId:'critic',role:'critic',permissions:{...SAFE},task:'Stress-test likely conclusions. Identify ambiguity, contradictions, missing evidence, and failure modes.'}};
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
export class NeroDelegator {
  constructor({workerPool=null,aggregator=null}={}){this.workerPool=workerPool||new NeroWorkerPool();this.aggregator=aggregator||new NeroDelegationAggregator();}
  shouldDelegate(plan={}){return plan?.delegation===true&&plan?.delegationContract?.enabled===true&&plan?.delegationContract?.workers?.length>0;}
  buildSpecs({request,context='',plan={},webSearch=null,runModel=null}={}){if(!this.shouldDelegate(plan))return [];const c=plan.delegationContract,shared=clean(context).slice(0,c.contextChars);return c.workers.slice(0,c.maxWorkers).map((spec,i)=>{const role=spec.role||['web','analyst','critic'][i]||'analyst',r=ROLES[role]||ROLES.analyst;return {workerId:r.workerId,role:r.role,task:r.task+' Parent request: '+clean(request),context:shared,permissions:{...SAFE,...r.permissions,...(spec.permissions||{}),delegation:false,whatsapp_send:false,memory_write:false,file_write:false,run_code:false,runtime_control:false,group_admin:false},maxTokens:spec.maxTokens,maxOutputChars:c.maxResultCharsPerWorker,timeoutMs:c.workerTimeoutMs,runModel,webSearch,modelTier:'worker',dependencies:spec.dependencies||[role==='web'?'web':'context']};});}
  async run({request='',plan={},context='',webSearch=null,runModel=null,signal=null,artifact=null,recoveryActions=[],invalidateWorkers=[],dependencyInputs=null}={}) {
    if(!this.shouldDelegate(plan)) return {status:'disabled',text:'',workers:[],budget:null,artifact:null};
    const c=plan.delegationContract;
    const specs=this.buildSpecs({request,context,plan,webSearch,runModel});
    const delegationArtifact=artifact instanceof NeroDelegationArtifact ? artifact : NeroDelegationArtifact.create({request,plan,specs});
    const dependencies=NeroDelegationArtifact.dependencySnapshot(dependencyInputs || {context,webSearch});
    const prepared=delegationArtifact.prepare({request,specs,recoveryActions,invalidateWorkers,dependencies});
    const activeArtifact=prepared.reason==='task-fingerprint-mismatch' ? NeroDelegationArtifact.create({request,plan,specs}) : delegationArtifact;
    const reusableWorkers=[];
    const missingSpecs=[];
    for (const spec of specs) {
      const reused=activeArtifact.getReusable(spec);
      if (reused) reusableWorkers.push({...reused,reused:true});
      else missingSpecs.push(spec);
    }
    const pool=new NeroWorkerPool({
      maxWorkers:Math.max(1,Math.min(c.maxWorkers,missingSpecs.length||1)),
      totalTokenBudget:c.totalTokenBudget,totalWallTimeMs:c.totalWallTimeMs,maxResultChars:c.maxTotalResultChars
    });
    const result=missingSpecs.length ? await pool.run(missingSpecs,{signal}) : {
      status:'partial-or-complete',workers:[],budget:{
        totalTokenBudget:c.totalTokenBudget,reservedTokenBudget:0,totalWallTimeMs:c.totalWallTimeMs,
        elapsedMs:0,maxWorkers:c.maxWorkers,maxResultChars:c.maxTotalResultChars,inheritedFromParent:true,reusedOnly:true
      }
    };
    for (let i=0;i<missingSpecs.length;i++) activeArtifact.store(missingSpecs[i],result.workers[i],dependencies);
    const workers=specs.map(spec => activeArtifact.getReusable(spec) || result.workers.find(worker=>worker.workerId===spec.workerId) || {
      workerId:spec.workerId,role:spec.role,status:'failed',summary:'',findings:[],
      uncertainties:['Worker result unavailable.'],sources:[],metrics:{elapsedMs:0},permissions:spec.permissions||{}
    });
    const aggregate=this.aggregator.aggregate({
      request,workers,budget:{
        ...(result.budget||{}),reusedWorkerCount:reusableWorkers.length,executedWorkerCount:missingSpecs.length
      }
    });
    return {...aggregate,artifact:activeArtifact,reusedWorkerCount:reusableWorkers.length,executedWorkerCount:missingSpecs.length};
  }
}
