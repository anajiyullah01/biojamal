import pkg from "whatsapp-web.js";
const { Client, AuthStrategy } = pkg;
import qrcode from "qrcode";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";
import pkgPG from "pg";
const { Client: PGClient } = pkgPG;

// === Telegram Bot Setup ===
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID;

// === PostgreSQL Setup ===
const db = new PGClient({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

await db.query(`
  CREATE TABLE IF NOT EXISTS whatsapp_session (
    id SERIAL PRIMARY KEY,
    data TEXT
  );
`);

// === Custom Auth Strategy (fix) ===
class DBAuth extends AuthStrategy {
  async beforeStart(client) {
    this.client = client;
    const res = await db.query("SELECT data FROM whatsapp_session LIMIT 1");
    if (res.rows.length > 0) {
      client.options.session = JSON.parse(res.rows[0].data);
      console.log("✅ Session loaded dari PostgreSQL");
    } else {
      console.log("ℹ️ Tidak ada session tersimpan, login baru diperlukan.");
    }
  }

  async afterAuth(session) {
    console.log("💾 Menyimpan session baru ke database...");
    await db.query("DELETE FROM whatsapp_session");
    await db.query("INSERT INTO whatsapp_session (data) VALUES ($1)", [
      JSON.stringify(session),
    ]);
  }

  async logout() {
    console.log("🧹 Menghapus session dari database...");
    await db.query("DELETE FROM whatsapp_session");
  }
}

// === WhatsApp Client ===
const client = new Client({
  authStrategy: new DBAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--single-process",
    ],
  },
});

// === QR Event ===
client.on("qr", async (qr) => {
  const qrImage = await qrcode.toBuffer(qr);
  await bot.sendPhoto(ADMIN_ID, qrImage, { caption: "📲 Scan QR untuk login WhatsApp" });
});

// === Ready Event ===
client.on("ready", async () => {
  console.log("✅ WhatsApp Web sudah terhubung!");
  await bot.sendMessage(ADMIN_ID, "✅ WhatsApp Web sudah terhubung!");
});

// === Disconnect Event ===
client.on("disconnected", async (reason) => {
  console.log("⚠️ WhatsApp disconnected:", reason);
  await bot.sendMessage(ADMIN_ID, "⚠️ WhatsApp disconnected. Reconnecting...");
});

// === Jalankan WhatsApp Client ===
client.initialize();

// === Command /cekbio ===
let cekBioState = {};

bot.onText(/^\/cekbio/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return;
  cekBioState[msg.chat.id] = true;
  bot.sendMessage(msg.chat.id, "📱 Kirim daftar nomor WhatsApp yang ingin dicek, satu per baris.");
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!cekBioState[chatId]) return;
  if (msg.text.startsWith("/")) return;

  cekBioState[chatId] = false;

  const numbers = msg.text
    .split(/\r?\n/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length > 5);

  if (!numbers.length) return bot.sendMessage(chatId, "❌ Tidak ada nomor valid ditemukan.");

  bot.sendMessage(chatId, `🔍 Mengecek ${numbers.length} nomor... Mohon tunggu.`);

  const withBio = [];
  const noBio = [];
  const notRegistered = [];

  for (const num of numbers) {
    try {
      const wid = `${num}@c.us`;
      const user = await client.getContactById(wid);
      const about = await user.getAbout();

      if (about && about.length > 0) {
        const bioTime = new Date(user.statusTimestamp || Date.now()).toLocaleString("id-ID");
        withBio.push(`└─ 📅 ${num}\n   └─ 📝 "${about}"\n      └─ ⏰ ${bioTime}`);
      } else {
        noBio.push(num);
      }
    } catch (err) {
      if (err.message.includes("not a WhatsApp user")) {
        notRegistered.push(num);
      } else {
        noBio.push(num);
      }
    }
  }

  let result = "----------------------------------------\n";
  if (withBio.length) result += withBio.join("\n") + "\n\n";
  if (noBio.length)
    result += `📵 NOMOR TANPA BIO / PRIVASI (${noBio.length})\n` + noBio.join("\n") + "\n\n";
  if (notRegistered.length)
    result += `🚫 NOMOR TIDAK TERDAFTAR (${notRegistered.length})\n` + notRegistered.join("\n");

  const fileName = `hasil_cekbio_${Date.now()}.txt`;
  fs.writeFileSync(fileName, result);
  await bot.sendDocument(chatId, fileName);
  fs.unlinkSync(fileName);
});
