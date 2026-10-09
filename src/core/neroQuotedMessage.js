export function extractNeroQuotedMessage(message, normalizeMessageContent = content => content) {
  const rawContent = message?.message;
  if (!rawContent) return null;

  const content = normalizeMessageContent(rawContent) || rawContent;
  let contextInfo = null;

  for (const part of Object.values(content)) {
    if (part?.contextInfo) {
      contextInfo = part.contextInfo;
      break;
    }
  }

  const quotedRaw = contextInfo?.quotedMessage;
  if (!quotedRaw) return null;

  const quoted = normalizeMessageContent(quotedRaw) || quotedRaw;
  const textFields = [
    quoted.conversation,
    quoted.extendedTextMessage?.text,
    quoted.imageMessage?.caption,
    quoted.videoMessage?.caption,
    quoted.documentMessage?.caption,
    quoted.audioMessage?.caption,
    quoted.templateMessage?.hydratedTemplate?.hydratedContentText,
    quoted.buttonsMessage?.contentText,
    quoted.listMessage?.description,
    quoted.listMessage?.title,
    quoted.pollCreationMessage?.name,
    quoted.pollCreationMessageV3?.name,
    quoted.pollCreationMessageV4?.name
  ];
  const quotedText = textFields.find(value => typeof value === 'string' && value.trim())?.trim() || '';

  const mediaLabels = [
    ['imageMessage', 'Image'],
    ['videoMessage', 'Video'],
    ['documentMessage', 'Document'],
    ['audioMessage', 'Audio'],
    ['stickerMessage', 'Sticker'],
    ['contactMessage', 'Contact'],
    ['contactsArrayMessage', 'Contacts'],
    ['locationMessage', 'Location'],
    ['liveLocationMessage', 'Live location'],
    ['pollCreationMessage', 'Poll'],
    ['pollCreationMessageV3', 'Poll'],
    ['pollCreationMessageV4', 'Poll']
  ];
  const mediaLabel = mediaLabels.find(([key]) => quoted[key])?.[1] || '';
  const text = [
    quotedText,
    mediaLabel ? '[' + mediaLabel + ' attachment' + (quotedText ? '; caption/text shown above' : '') + ']' : ''
  ].filter(Boolean).join('\n') || '[quoted message content unavailable]';

  return {
    text: text.slice(0, 8000),
    sender: contextInfo.participantPn || contextInfo.participant || '',
    messageId: contextInfo.stanzaId || '',
    remoteJid: contextInfo.remoteJid || ''
  };
}
