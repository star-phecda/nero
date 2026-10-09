const PARTICIPANT_ID_FIELDS = Object.freeze([
  'phoneNumber',
  'id',
  'lid',
  'jid',
  'pn',
  'participantPn',
  'participantAlt'
]);

function normalizedIds(values, normalizeId) {
  return [...new Set(
    values
      .filter(value => value != null && String(value).trim())
      .map(value => normalizeId(value))
      .filter(Boolean)
  )];
}

/**
 * Each WhatsApp group member may have both a phone-number JID and a LID.
 * Save a shared plot under every known alias so a later DM resolves correctly
 * regardless of which identifier Baileys uses for that message.
 */
export function buildNeroPlotShareRecipients(
  participants,
  normalizeId,
  excludedIdentifiers = []
) {
  if (typeof normalizeId !== 'function' || !Array.isArray(participants)) return [];

  const excluded = new Set(normalizedIds(excludedIdentifiers, normalizeId));
  const alreadyAssigned = new Set();
  const recipients = [];

  for (const participant of participants) {
    const aliases = normalizedIds(
      PARTICIPANT_ID_FIELDS.map(field => participant?.[field]),
      normalizeId
    );

    if (!aliases.length || aliases.some(alias => excluded.has(alias))) continue;

    const uniqueAliases = aliases.filter(alias => !alreadyAssigned.has(alias));
    if (!uniqueAliases.length) continue;

    uniqueAliases.forEach(alias => alreadyAssigned.add(alias));
    recipients.push({ ids: uniqueAliases });
  }

  return recipients;
}
