import fs from 'node:fs';

import {
  NERO_MODES,
  NERO_MODE_PROFILES,
  normalizeNeroMode
} from './neroModes.js';
import { NeroCapabilityRegistry } from './neroCapabilities.js';
import { NeroMemoryService } from './neroMemory.js';
import { NeroPlanner } from './neroPlanner.js';
import { NeroModelRouter } from './neroModelRouter.js';

export class NeroRuntime {
  constructor({
    stateFile = process.cwd() + '/nero_runtime.json',
    modelCatalog = []
  } = {}) {
    this.stateFile = stateFile;
    this.state = {
      version: 1,
      chats: {}
    };

    this.capabilities =
      new NeroCapabilityRegistry();

    this.memory =
      new NeroMemoryService();

    this.planner =
      new NeroPlanner();

    this.modelRouter =
      new NeroModelRouter(modelCatalog);

    this.load();
  }

  normalizeChatId(chatId) {
    return String(chatId || '').trim();
  }

  load() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return;
      }

      const parsed =
        JSON.parse(
          fs.readFileSync(
            this.stateFile,
            'utf8'
          )
        );

      if (
        parsed &&
        typeof parsed === 'object'
      ) {
        this.state = {
          version: 1,
          chats:
            parsed.chats &&
            typeof parsed.chats === 'object'
              ? parsed.chats
              : {}
        };
      }
    } catch (error) {
      console.log(
        '[NERO RUNTIME] State load failed:',
        error.message
      );
    }
  }

  save() {
    try {
      fs.writeFileSync(
        this.stateFile,
        JSON.stringify(
          this.state,
          null,
          2
        ),
        'utf8'
      );
    } catch (error) {
      console.log(
        '[NERO RUNTIME] State save failed:',
        error.message
      );
    }
  }

  getMode(chatId) {
    const id =
      this.normalizeChatId(chatId);

    if (!id) {
      return NERO_MODES.NORMAL;
    }

    return normalizeNeroMode(
      this.state.chats[id]?.mode
    );
  }

  setMode(chatId, mode) {
    const id =
      this.normalizeChatId(chatId);

    if (!id) {
      throw new Error(
        'A chat id is required to set Nero runtime mode.'
      );
    }

    const normalized =
      normalizeNeroMode(mode);

    this.state.chats[id] = {
      ...(this.state.chats[id] || {}),
      mode: normalized,
      updatedAt: Date.now()
    };

    this.save();

    return normalized;
  }

  getProfile(chatId) {
    return (
      NERO_MODE_PROFILES[
        this.getMode(chatId)
      ] ||
      NERO_MODE_PROFILES[
        NERO_MODES.NORMAL
      ]
    );
  }

  can(chatId, capability) {
    return this.capabilities.can(
      this.getMode(chatId),
      capability
    );
  }

  getCapabilities(chatId) {
    return this.capabilities.list(
      this.getMode(chatId)
    );
  }

  plan(chatId, request = {}) {
    const mode =
      this.getMode(chatId);

    return {
      mode,
      profile:
        this.getProfile(chatId),
      ...this.planner.plan({
        ...request,
        mode,
        context: {
          ...(request.context || {}),
          canUseMemory:
            this.can(chatId, 'memory_read'),
          canUseWebSearch:
            this.can(chatId, 'web_search'),
          canUseToolSelection:
            this.can(chatId, 'tool_selection')
        }
      })
    };
  }

  routeWorkerModel({ selectedModel = 'auto', media = null } = {}) {
    return this.modelRouter.route({
      tier: 'worker',
      mode: NERO_MODES.NORMAL,
      media,
      selectedModel
    });
  }

  routeModel(chatId, request = {}) {
    const plan =
      this.plan(
        chatId,
        request
      );

    return {
      plan,
      route:
        this.modelRouter.route({
          plan,
          tier: plan.tier,
          mode: plan.mode,
          media:
            request.media || null,
          selectedModel:
            request.selectedModel ||
            'auto'
        })
    };
  }

  getContextPolicy(chatId) {
    const mode =
      this.getMode(chatId);

    if (
      mode === NERO_MODES.GOD ||
      mode === NERO_MODES.MOON_CELL
    ) {
      return {
        recentMessages: 30,
        promptCharacters: 9000
      };
    }

    return {
      recentMessages: 12,
      promptCharacters: 4500
    };
  }
}

export {
  NERO_MODES,
  NERO_MODE_PROFILES
};
