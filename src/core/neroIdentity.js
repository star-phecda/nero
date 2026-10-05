import fs from 'node:fs';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export const NERO_IDENTITY_ROLES = Object.freeze({
  MASTER: 'master',
  DAWN: 'dawn',
  PERSON: 'person'
});

function normalizeId(value) {
  const raw = clean(value);
  if (!raw) return '';
  if (raw.includes('@')) {
    const at = raw.indexOf('@');
    const user = raw.slice(0, at).split(':')[0].trim();
    const server = raw.slice(at + 1).trim();
    if (!user || !server) return raw;
    return user + '@' + (server === 'c.us' ? 's.whatsapp.net' : server);
  }
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? digits + '@s.whatsapp.net' : raw;
}

export class NeroIdentityService {
  constructor({ filePath = process.cwd() + '/nero_people.json', clock = () => Date.now(), maxProfiles = 1000 } = {}) {
    this.filePath = filePath;
    this.clock = clock;
    this.maxProfiles = maxProfiles;
    this.profiles = new Map();
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed?.version !== 1 || !parsed.people || typeof parsed.people !== 'object') return;
      for (const [id, profile] of Object.entries(parsed.people)) {
        if (!id) continue;
        this.profiles.set(id, {
          id,
          displayName: clean(profile?.displayName) || 'Unknown',
          role: profile?.role === 'dawn' ? 'dawn' : profile?.role === 'master' ? 'master' : 'person',
          firstSeenAt: Number(profile?.firstSeenAt) || this.clock(),
          lastSeenAt: Number(profile?.lastSeenAt) || this.clock(),
          chats: Array.isArray(profile?.chats) ? [...new Set(profile.chats.map(clean).filter(Boolean))] : []
        });
      }
    } catch (error) {
      console.log('[Identity] Could not load person profiles:', error.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify({ version: 1, updatedAt: this.clock(), people: Object.fromEntries(this.profiles) }, null, 2), 'utf8');
    } catch (error) {
      console.log('[Identity] Could not save person profiles:', error.message);
    }
  }

  resolve({ chatId = '', senderId = '', senderName = '', role = 'person' } = {}) {
    const personId = role === 'master' ? 'master' : normalizeId(senderId);
    const chat = normalizeId(chatId);
    const existing = this.profiles.get(personId || 'unknown');
    const now = this.clock();
    const displayName = clean(senderName) || existing?.displayName || 'Unknown';
    const personScope = role === 'master' ? 'master' : 'person:' + (personId || 'unknown');
    const conversationKey = (chat || 'unknown-chat') + '|' + (personId || 'unknown-person');
    const profile = {
      id: personId || 'unknown',
      displayName,
      role,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      chats: [...new Set([...(existing?.chats || []), chat].filter(Boolean))].slice(-50)
    };
    this.profiles.set(profile.id, profile);
    if (this.profiles.size > this.maxProfiles) {
      const retained = [...this.profiles.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, this.maxProfiles);
      this.profiles = new Map(retained.map(item => [item.id, item]));
    }
    this.save();
    return { chatId: chat, personId: personId || 'unknown', role, displayName, personScope, conversationKey, profile };
  }

  getProfile(personId) {
    return this.profiles.get(normalizeId(personId)) || null;
  }

  getProfiles() {
    return [...this.profiles.values()];
  }
}

export function normalizeNeroIdentityId(value) {
  return normalizeId(value);
}
