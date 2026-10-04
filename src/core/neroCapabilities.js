import { NERO_MODES } from './neroModes.js';

const SAFE_CAPABILITIES = Object.freeze([
  'chat',
  'memory_read',
  'memory_write',
  'model_routing',
  'web_search',
  'delegation'
]);

const GOD_CAPABILITIES = Object.freeze([
  ...SAFE_CAPABILITIES,
  'planning',
  'expanded_context',
  'tool_selection'
]);

const RESERVED_CAPABILITIES = Object.freeze([
  'group_admin',
  'ban_user',
  'run_code',
  'modify_files',
  'restart_runtime',
  'subagents',
  'swarms'
]);

function buildCapabilitySet(mode) {
  if (mode === NERO_MODES.GOD || mode === NERO_MODES.MOON_CELL) {
    return new Set(GOD_CAPABILITIES);
  }

  return new Set(SAFE_CAPABILITIES);
}

export class NeroCapabilityRegistry {
  can(mode, capability) {
    const normalized = String(capability || '').trim().toLowerCase();

    if (RESERVED_CAPABILITIES.includes(normalized)) {
      return false;
    }

    return buildCapabilitySet(mode).has(normalized);
  }

  list(mode) {
    return [...buildCapabilitySet(mode)];
  }
}
