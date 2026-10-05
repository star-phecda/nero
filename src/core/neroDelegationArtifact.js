import { createHash } from 'node:crypto';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function stable(value) {
  if (typeof value === 'function') return '[Function]';
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}

function fingerprint(value) {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

function dependencySnapshot({ context = '', webSearch = null } = {}) {
  const webInput = typeof webSearch === 'function' ? null : (webSearch?.results || webSearch || null);
  return {
    web: fingerprint(webInput),
    context: fingerprint(clean(context)),
  };
}

export class NeroDelegationArtifact {
  constructor({ request = '', plan = {}, specs = [], createdAt = Date.now(), entries = {} } = {}) {
    this.requestId = fingerprint({ request: clean(request), createdAt });
    this.taskFingerprint = fingerprint({
      request: clean(request),
      workers: specs.map(spec => ({
        workerId: spec.workerId, role: spec.role, task: spec.task,
        maxTokens: spec.maxTokens, maxOutputChars: spec.maxOutputChars,
        dependencies: spec.dependencies || []
      }))
    });
    this.createdAt = createdAt;
    this.reusable = true;
    this.entries = { ...entries };
    this.invalidations = [];
    this.planFingerprint = fingerprint({
      delegation: plan.delegation,
      contract: plan.delegationContract || null
    });
  }

  static create(args = {}) { return new NeroDelegationArtifact(args); }
  static dependencySnapshot(args = {}) { return dependencySnapshot(args); }

  _specFingerprint(spec) {
    return fingerprint({
      workerId: spec.workerId, role: spec.role, task: spec.task,
      maxTokens: spec.maxTokens, maxOutputChars: spec.maxOutputChars,
      dependencies: spec.dependencies || []
    });
  }

  invalidateWorkers(workerIds = [], reason = 'manual-invalidation') {
    const ids = new Set(workerIds.map(clean).filter(Boolean));
    for (const id of ids) {
      const entry = this.entries[id];
      if (entry) {
        entry.reusable = false;
        entry.invalidatedReason = reason;
      }
    }
    if (ids.size) this.invalidations.push({ reason, workerIds: [...ids], at: Date.now() });
  }

  invalidateByDependencies(changedDependencies = [], specs = [], reason = 'dependency-changed') {
    const changed = new Set(changedDependencies.map(clean).filter(Boolean));
    if (!changed.size) return;
    const invalid = new Set();
    for (const spec of specs) {
      if ((spec.dependencies || []).some(dep => changed.has(dep))) invalid.add(spec.workerId);
    }
    this.invalidateWorkers([...invalid], reason);
  }

  prepare({ request = '', specs = [], recoveryActions = [], invalidateWorkers = [], dependencies = {} } = {}) {
    const expected = fingerprint({
      request: clean(request),
      workers: specs.map(spec => ({
        workerId: spec.workerId, role: spec.role, task: spec.task,
        maxTokens: spec.maxTokens, maxOutputChars: spec.maxOutputChars,
        dependencies: spec.dependencies || []
      }))
    });
    if (this.taskFingerprint !== expected) {
      this.reusable = false;
      return { reusable: false, reason: 'task-fingerprint-mismatch' };
    }
    const actions = new Set(recoveryActions.map(clean));
    const candidateDependencies = new Set();
    if (actions.has('refresh_web')) candidateDependencies.add('web');
    if (actions.has('force_memory') || actions.has('expand_history')) candidateDependencies.add('context');
    for (const spec of specs) {
      const entry = this.entries[spec.workerId];
      if (!entry || !entry.reusable || !candidateDependencies.size) continue;
      const changed = [...candidateDependencies].some(key =>
        (spec.dependencies || []).includes(key) &&
        entry.dependencyFingerprints?.[key] !== dependencies[key]
      );
      if (changed) this.invalidateWorkers([spec.workerId], 'recovery-dependency-changed');
    }
    this.invalidateWorkers(invalidateWorkers, 'explicit-invalidation');
    return { reusable: this.reusable, reason: 'eligible' };
  }

  getReusable(spec) {
    const entry = this.entries[spec.workerId];
    if (!entry || !entry.reusable || entry.status !== 'completed') return null;
    if (entry.specFingerprint !== this._specFingerprint(spec)) return null;
    return entry.result;
  }

  store(spec, result, dependencies = {}) {
    if (!result || result.status !== 'completed') {
      if (this.entries[spec.workerId]) this.entries[spec.workerId].reusable = false;
      return;
    }
    this.entries[spec.workerId] = {
      workerId: spec.workerId, status: result.status, reusable: true,
      specFingerprint: this._specFingerprint(spec),
      dependencyFingerprints: Object.fromEntries(
        (spec.dependencies || []).map(key => [key, dependencies[key] || fingerprint(null)])
      ),
      evidenceFingerprint: fingerprint({
        summary: result.summary, findings: result.findings,
        structured: result.structured, sources: result.sources
      }),
      result, createdAt: Date.now()
    };
  }

  snapshot() {
    return {
      requestId: this.requestId, taskFingerprint: this.taskFingerprint,
      planFingerprint: this.planFingerprint, createdAt: this.createdAt,
      reusable: this.reusable, invalidations: this.invalidations.slice(-20),
      workers: Object.fromEntries(Object.entries(this.entries).map(([id, entry]) => [id, {
        workerId: entry.workerId, status: entry.status, reusable: entry.reusable,
        specFingerprint: entry.specFingerprint,
        dependencyFingerprints: entry.dependencyFingerprints,
        evidenceFingerprint: entry.evidenceFingerprint, createdAt: entry.createdAt
      }]))
    };
  }
}
