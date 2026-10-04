import { NeroWorker } from './neroWorker.js';
export class NeroWorkerPool {
  constructor({maxWorkers=3,totalTokenBudget=12000,totalWallTimeMs=45000,maxResultChars=12000}={}){this.maxWorkers=Math.max(1,Math.min(3,Number(maxWorkers)||3));this.totalTokenBudget=Math.max(256,Math.min(12000,Number(totalTokenBudget)||12000));this.totalWallTimeMs=Math.max(1000,Math.min(45000,Number(totalWallTimeMs)||45000));this.maxResultChars=Math.max(1000,Math.min(20000,Number(maxResultChars)||12000));}
  async run(specs=[],{signal=null}={}) {
    const started=Date.now(), controller=new AbortController(), abort=()=>controller.abort(signal?.reason||new Error('Delegation cancelled.'));
    if(signal){if(signal.aborted)controller.abort(signal.reason);else signal.addEventListener('abort',abort,{once:true});}
    const selected=specs.slice(0,this.maxWorkers), per=Math.max(128,Math.floor(this.totalTokenBudget/Math.max(1,selected.length))); let reserved=0;
    const deadline=started+this.totalWallTimeMs;
    try {
      const jobs=selected.map((spec,i)=>{const remaining=this.totalTokenBudget-reserved,budget=Math.min(Number(spec.maxTokens)||per,per,remaining);if(budget<128)return Promise.resolve({workerId:spec.workerId||'worker-'+(i+1),role:spec.role||'analyst',status:'skipped',summary:'',findings:'',uncertainties:['Parent token budget exhausted before worker start.'],sources:[],metrics:{elapsedMs:0,maxTokens:0},permissions:spec.permissions||{}});reserved+=budget;return new NeroWorker({...spec,maxTokens:budget,timeoutMs:Math.min(Number(spec.timeoutMs)||Math.max(1000,deadline-Date.now()),Math.max(1000,deadline-Date.now()))}).run({signal:controller.signal});});
      const settled=await Promise.allSettled(jobs),workers=settled.map((x,i)=>x.status==='fulfilled'?x.value:{workerId:selected[i]?.workerId||'worker-'+(i+1),role:selected[i]?.role||'analyst',status:'failed',summary:'',findings:'',uncertainties:[String(x.reason?.message||x.reason||'Worker failed.')],sources:[],metrics:{elapsedMs:Date.now()-started},permissions:selected[i]?.permissions||{}});
      return {status:workers.some(x=>x.status==='completed')?'partial-or-complete':'failed',workers,budget:{totalTokenBudget:this.totalTokenBudget,reservedTokenBudget:reserved,totalWallTimeMs:this.totalWallTimeMs,elapsedMs:Date.now()-started,maxWorkers:this.maxWorkers,maxResultChars:this.maxResultChars,inheritedFromParent:true}};
    } finally {if(signal)signal.removeEventListener('abort',abort);controller.abort();}
  }
}
