const fs = require('fs');
const readline = require('readline/promises');

async function main() {
  const baileys = await import('@whiskeysockets/baileys');

  const makeWASocket = baileys.default;
  const {
    useMultiFileAuthState,
    Browsers,
    fetchLatestBaileysVersion
  } = baileys;

  let authDir = './auth_info_baileys';

  try {
    const app = fs.readFileSync('./app.js', 'utf8');
    const match = app.match(
      /useMultiFileAuthState\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/
    );
    if (match) authDir = match[1];
  } catch (_) {}

  console.log('\n=== NERO WHATSAPP PHONE PAIRING ===');
  console.log(`Auth folder: ${authDir}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let phone = await rl.question(
    'Enter your WhatsApp number with country code\n' +
    'Example: 2348012345678\n' +
    '(No +, spaces, brackets, or dashes): '
  );

  rl.close();

  phone = phone.replace(/\D/g, '');

  if (!phone || phone.length < 10) {
    console.log('\nInvalid phone number.');
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  if (state.creds.registered) {
    console.log('\nThis auth folder is already registered.');
    console.log('Run: npm start');
    return;
  }

  let version;

  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version;
    console.log(`Using WhatsApp Web version: ${version.join('.')}`);
  } catch (e) {
    console.log('Could not fetch latest version; using Baileys default.');
  }

  const socketOptions = {
    auth: state,
    printQRInTerminal: false,

    // IMPORTANT: use a canonical WhatsApp browser identity.
    browser: Browsers.macOS('Chrome'),

    markOnlineOnConnect: false,
    syncFullHistory: false
  };

  if (version) {
    socketOptions.version = version;
  }

  const sock = makeWASocket(socketOptions);

  sock.ev.on('creds.update', saveCreds);

  let requested = false;

  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {

    if (qr && !requested && !state.creds.registered) {
      requested = true;

      try {
        const code = await sock.requestPairingCode(phone);

        console.log('\n================================');
        console.log('      NERO PAIRING CODE');
        console.log('================================');
        console.log(`\n        ${code}`);
        console.log('\n================================\n');

        console.log('On WhatsApp:');
        console.log('WhatsApp → ⋮ → Linked devices → Link a device');
        console.log('→ Link with phone number instead');
        console.log('→ Enter the code above.\n');

      } catch (err) {
        console.error('\nPAIRING ERROR:\n', err);
      }
    }

    if (connection === 'open') {
      console.log('\n✅ NERO IS CONNECTED TO WHATSAPP!');
      console.log('Credentials saved successfully.');
      console.log('Stop this script with Ctrl+C.');
      console.log('Then run: npm start\n');
    }

    if (connection === 'close') {
      const status =
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.statusCode ??
        'unknown';

      console.log(`\nWhatsApp connection closed (${status}).`);

      if (status === 405) {
        console.log('WhatsApp rejected the registration handshake.');
      }
    }
  });
}

main().catch(err => {
  console.error('\nFatal error:', err);
});
