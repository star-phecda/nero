import fs from 'node:fs';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function canonicalName(value) {
  return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
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

function normalizeContactIdentifier(value) {
  const raw = clean(value);
  if (!raw) return '';

  if (!raw.includes('@')) {
    if (!/^\+?[\d\s().-]+$/.test(raw)) return '';
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15
      ? digits + '@s.whatsapp.net'
      : '';
  }

  const at = raw.indexOf('@');
  const user = raw.slice(0, at).split(':')[0].trim();
  const server = raw.slice(at + 1).trim().toLowerCase();
  if (!user || !['s.whatsapp.net', 'c.us', 'lid'].includes(server)) return '';
  if (server !== 'lid' && !/^\d{7,15}$/.test(user)) return '';
  if (server === 'lid' && !/^[\da-z._-]{2,64}$/i.test(user)) return '';
  return user + '@' + (server === 'c.us' ? 's.whatsapp.net' : server);
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
      for (const [storedId, storedProfile] of Object.entries(parsed.people)) {
        if (!storedId) continue;
        const id = normalizeId(storedId) || storedId;
        const profile = storedProfile && typeof storedProfile === 'object' ? storedProfile : {};
        const nameConfirmed = profile.nameConfirmed === true;
        const displayName = clean(profile.displayName) || 'Unknown';
        const aliases = Array.isArray(profile.aliases) ? profile.aliases : [];
        this.profiles.set(id, {
          id,
          displayName,
          suggestedName: clean(profile.suggestedName) || (!nameConfirmed && displayName !== 'Unknown' ? displayName : ''),
          nameConfirmed,
          nameSource: clean(profile.nameSource) || (nameConfirmed ? 'explicit' : 'observed'),
          role: profile.role === 'dawn' ? 'dawn' : profile.role === 'master' ? 'master' : 'person',
          aliases: [...new Set([id, ...aliases.map(normalizeId)].filter(Boolean))],
          firstSeenAt: Number(profile.firstSeenAt) || this.clock(),
          lastSeenAt: Number(profile.lastSeenAt) || this.clock(),
          chats: Array.isArray(profile.chats) ? [...new Set(profile.chats.map(clean).filter(Boolean))] : []
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

  #findProfileByIds(ids) {
    const candidates = [...new Set(ids.map(normalizeId).filter(Boolean))];
    for (const candidate of candidates) {
      const direct = this.profiles.get(candidate);
      if (direct) return direct;
      const aliasMatch = [...this.profiles.values()].find(profile => profile.aliases?.includes(candidate));
      if (aliasMatch) return aliasMatch;
    }
    return null;
  }

  #trimProfiles() {
    if (this.profiles.size <= this.maxProfiles) return;
    const retained = [...this.profiles.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, this.maxProfiles);
    this.profiles = new Map(retained.map(item => [item.id, item]));
  }

  resolve({ chatId = '', senderId = '', senderName = '', role = 'person', aliases = [] } = {}) {
    const normalizedSenderId = role === 'master' ? 'master' : normalizeId(senderId);
    const aliasIds = [...new Set([
      normalizedSenderId,
      ...aliases.map(normalizeId)
    ].filter(id => id && !id.endsWith('@g.us')))];
    const existing = role === 'master'
      ? this.profiles.get('master') || null
      : this.#findProfileByIds(aliasIds);
    // Never downgrade a previously known privileged identity because a message
    // arrived with only an alternate WhatsApp identifier.
    const resolvedRole = existing?.role === 'master' || existing?.role === 'dawn'
      ? existing.role
      : role;
    const personId = resolvedRole === 'master'
      ? 'master'
      : existing?.id || normalizedSenderId || 'unknown';
    const chat = normalizeId(chatId);
    const now = this.clock();
    const observedName = clean(senderName);
    const existingConfirmed = existing?.nameConfirmed === true;
    const displayName = existingConfirmed
      ? existing.displayName
      : observedName || existing?.displayName || 'Unknown';
    const suggestedName = existingConfirmed
      ? (observedName && observedName !== existing.displayName ? observedName : '')
      : observedName || existing?.suggestedName || '';
    const profile = {
      id: personId,
      displayName,
      suggestedName,
      nameConfirmed: existingConfirmed,
      nameSource: existing?.nameSource || 'observed',
      role: resolvedRole,
      aliases: [...new Set([...(existing?.aliases || []), ...aliasIds, personId].filter(Boolean))],
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      chats: [...new Set([...(existing?.chats || []), chat].filter(Boolean))].slice(-50)
    };
    this.profiles.set(profile.id, profile);
    this.#trimProfiles();
    this.save();

    const personScope = resolvedRole === 'master' ? 'master' : 'person:' + (personId || 'unknown');
    const conversationKey = (chat || 'unknown-chat') + '|' + (personId || 'unknown-person');
    return { chatId: chat, personId: personId || 'unknown', role: resolvedRole, displayName, personScope, conversationKey, profile };
  }

  observeContact(identifier, observedName = '', { chatId = '' } = {}) {
    const id = normalizeContactIdentifier(identifier);
    if (!id) return null;
    const existing = this.#findProfileByIds([id]);
    if (existing && existing.role !== 'person') return null;

    const now = this.clock();
    const name = clean(observedName);
    const profileId = existing?.id || id;
    const aliases = [...new Set([...(existing?.aliases || []), id, profileId])];
    const profile = {
      id: profileId,
      displayName: existing?.nameConfirmed
        ? existing.displayName
        : name || existing?.displayName || id.split('@')[0],
      suggestedName: name || existing?.suggestedName || '',
      nameConfirmed: existing?.nameConfirmed === true,
      nameSource: existing?.nameSource || 'observed',
      role: 'person',
      aliases,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      chats: [...new Set([...(existing?.chats || []), normalizeId(chatId)].filter(Boolean))].slice(-50)
    };
    this.profiles.set(profileId, profile);
    this.#trimProfiles();
    this.save();
    return profile;
  }

  nameContact(identifier, displayName) {
    const id = normalizeContactIdentifier(identifier);
    if (!id) throw new Error('Provide a valid WhatsApp phone number or person JID.');
    const name = clean(displayName);
    if (!name || name.length > 80) throw new Error('Contact name must contain 1 to 80 characters.');

    const existing = this.#findProfileByIds([id]);
    if (existing && existing.role !== 'person') throw new Error('I cannot rename a protected system identity.');
    const now = this.clock();
    const profileId = existing?.id || id;
    const profile = {
      id: profileId,
      displayName: name,
      suggestedName: existing?.suggestedName || '',
      nameConfirmed: true,
      nameSource: 'explicit',
      role: 'person',
      aliases: [...new Set([...(existing?.aliases || []), id, profileId])],
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: existing?.lastSeenAt || now,
      chats: existing?.chats || []
    };
    this.profiles.set(profileId, profile);
    this.#trimProfiles();
    this.save();
    return profile;
  }

  getProfile(personId) {
    const id = normalizeId(personId);
    return this.profiles.get(id) || this.#findProfileByIds([id]) || null;
  }

  getContact(identifier) {
    const id = normalizeContactIdentifier(identifier);
    if (!id) return null;
    const profile = this.#findProfileByIds([id]);
    return profile?.role === 'person' ? profile : null;
  }

  findContactsByName(name) {
    const wanted = canonicalName(name);
    if (!wanted) return [];
    const matches = [...this.profiles.values()].filter(profile =>
      profile.role === 'person' &&
      profile.nameConfirmed === true &&
      canonicalName(profile.displayName) === wanted
    );
    return matches.length === 1 ? matches : [];
  }

  listContacts() {
    return [...this.profiles.values()]
      .filter(profile => profile.role === 'person')
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  forgetContact(identifier) {
    const id = normalizeContactIdentifier(identifier);
    if (!id) return false;
    const profile = this.#findProfileByIds([id]);
    if (!profile || profile.role !== 'person') return false;
    const removed = this.profiles.delete(profile.id);
    if (removed) this.save();
    return removed;
  }

  getProfiles() {
    return [...this.profiles.values()];
  }
}

export function normalizeNeroIdentityId(value) {
  return normalizeId(value);
}

export function normalizeNeroContactIdentifier(value) {
  return normalizeContactIdentifier(value);
}
