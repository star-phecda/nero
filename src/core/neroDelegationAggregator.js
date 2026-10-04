const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
export class NeroDelegationAggregator {
  constructor({maxChars=12000}={}){this.maxChars=Math.max(1000,Number(maxChars)||12000);}
  aggregate({request='',workers=[],budget={}}={}) {
    const completed=workers.filter(x=>x?.status==='completed'),failed=workers.filter(x=>x?.status!=='completed');
    const sources=[...new Set(workers.flatMap(x=>Array.isArray(x?.sources)?x.sources:[]).map(clean).filter(Boolean))].slice(0,12);
    const uncertainties=[...new Set(workers.flatMap(x=>Array.isArray(x?.uncertainties)?x.uncertainties:[]).map(clean).filter(Boolean))].slice(0,12);
    const sections=workers.map(x=>{
      const structured =
        x &&
        x.structured &&
        typeof x.structured === 'object'
          ? x.structured
          : null;

      const findings =
        structured &&
        Array.isArray(structured.findings)
          ? structured.findings.map(item => [
              'CLAIM: '+clean(item.claim),
              'EVIDENCE: '+clean(item.evidence),
              'CONFIDENCE: '+String(item.confidence)
            ].join('\n')).join('\n')
          : clean(x && x.summary ? x.summary : '');

      return [
        'WORKER '+clean(x && x.workerId),
        'ROLE: '+clean(x && x.role),
        'STATUS: '+clean(x && x.status),
        structured && structured.summary
          ? 'SUMMARY: '+clean(structured.summary)
          : '',
        findings,
        x && x.sources && x.sources.length
          ? 'SOURCES: '+x.sources.slice(0,6).join(', ')
          : ''
      ].filter(Boolean).join('\n\n');
    });
    const text=['DELEGATION AGGREGATE','REQUEST: '+clean(request),'COMPLETED WORKERS: '+completed.length,'FAILED/SKIPPED WORKERS: '+failed.length,'',sections.join('\n\n'),'',uncertainties.length?'UNCERTAINTIES:\n- '+uncertainties.join('\n- '):'UNCERTAINTIES: none reported',sources.length?'SOURCES:\n- '+sources.join('\n- '):'SOURCES: none'].join('\n').slice(0,this.maxChars);
    return {status:completed.length?'usable':'unusable',request:clean(request),text,workers,sources,uncertainties,budget,completedWorkers:completed.length,failedWorkers:failed.length};
  }
}
