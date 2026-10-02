import dotenv from 'dotenv';

dotenv.config();

function normalizeNumber(value) {
  return String(value || '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@g\.us$/i, '')
    .replace(/:\d+@/i, '@')
    .replace(/\D/g, '');
}

function getSender(message) {
  return (
    message?.key?.participant ||
    message?.participant ||
    message?.key?.remoteJid ||
    ''
  );
}

function isTagAllCommand(text) {
  const input = String(text || '')
    .trim()
    .replace(/\s+/g, ' ');

  return /^(?:nero[\s,:;!.-]+)(?:tagall|tag all|tag everyone|mention everyone|summon everyone)[.!?]*$/i.test(
    input
  );
}

const DAWN_NUMBER = '2347066350574';

function getConfiguredMasterNumbers() {
  return [
    process.env.MASTER_NUMBER,
    process.env.MASTER_PHONE,
    process.env.MASTER_JID,
    process.env.MASTER,
    process.env.OWNER_NUMBER,
    process.env.OWNER_JID,
  ]
    .filter(Boolean)
    .map(normalizeNumber)
    .filter(Boolean);
}

function isMaster(sender) {
  const senderNumber = normalizeNumber(sender);

  if (!senderNumber) return false;

  return getConfiguredMasterNumbers().includes(senderNumber);
}

function isDawn(sender) {
  return normalizeNumber(sender) === DAWN_NUMBER;
}

async function isGroupAdmin(sock, jid, sender) {
  try {
    const metadata = await sock.groupMetadata(jid);

    const participant = (metadata?.participants || []).find(
      p => p.id === sender
    );

    return (
      participant?.admin === 'admin' ||
      participant?.admin === 'superadmin'
    );
  } catch {
    return false;
  }
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getNaturalAnnouncement() {
  const lines = [
    'fine. everyone get over here for a second.',
    'alright, I’m getting the whole room’s attention. behave yourselves.',
    'you know what? I’m calling everyone in. this should be interesting.',
    'fine. apparently I have to summon the entire circus.',
    'right, everybody. get over here.',
    'alright, I’ve decided you’re all getting involved now.',
    'everyone, over here. I have something to say.',
    'fine. let’s get everyone’s attention before this gets any more chaotic.',
    'alright. I’m calling the whole group in. try not to embarrass yourselves.',
    'everyone. yes, you too. get over here.',
    'come here, all of you. apparently this is necessary.',
    'fine. I’ll deal with all of you at once.',
  ];

  return randomItem(lines);
}

function chunk(array, size) {
  const result = [];

  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }

  return result;
}

async function tagEveryone(sock, jid, message) {
  const metadata = await sock.groupMetadata(jid);
  const participants = metadata?.participants || [];

  const botId = sock.user?.id
    ? String(sock.user.id).split(':')[0]
    : '';

  const targets = participants
    .map(p => p.id)
    .filter(Boolean)
    .filter(id => {
      const clean = String(id).split(':')[0];
      return clean !== botId;
    });

  if (!targets.length) {
    await sock.sendMessage(
      jid,
      { text: 'apparently there’s nobody else here. impressive.' },
      { quoted: message }
    );
    return;
  }

  const announcement = getNaturalAnnouncement();

  await sock.sendMessage(
    jid,
    {
      text: announcement,
    },
    { quoted: message }
  );

  // Keep the mention messages manageable.
  const groups = chunk(targets, 40);

  for (const group of groups) {
    const mentions = group.map(id => `@${id.split('@')[0]}`);

    await sock.sendMessage(jid, {
      text: mentions.join(' '),
      mentions: group,
    });
  }
}

async function refuseUnauthorized(sock, jid, message) {
  const responses = [
    'no, sorry. you’re not Master or Lord Dawn.',
    'nice try. you’re not one of the two people with that privilege.',
    'nope. that privilege is for Master, Lord Dawn, and group admins.',
    'absolutely not. ask Master or Lord Dawn.',
    'you’re asking a lot for someone who isn’t Master or Lord Dawn.',
    'cute. but no. you’re not authorized to summon the entire group.',
  ];

  await sock.sendMessage(
    jid,
    { text: randomItem(responses) },
    { quoted: message }
  );
}

export async function handleNeroTagAllMessage({
  sock,
  jid,
  message,
  text,
}) {
  if (!jid || !message) return false;
  if (!isTagAllCommand(text)) {
    return false;
  }

  const sender = getSender(message);

  const master = isMaster(sender);
  const dawn = isDawn(sender);
  const admin = await isGroupAdmin(sock, jid, sender);

  if (!master && !dawn && !admin) {
    await refuseUnauthorized(sock, jid, message);
    return true;
  }

  try {
    await tagEveryone(sock, jid, message);
  } catch (error) {
    console.log('[TAGALL] Error:', error.message);

    await sock.sendMessage(
      jid,
      {
        text: 'I tried. WhatsApp decided to be difficult.',
      },
      { quoted: message }
    );
  }

  return true;
}
