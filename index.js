import { Telegraf } from "telegraf";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = waPkg;
import QRCode from "qrcode";
import fs from "fs";
import pkg from "pg";
const { Pool } = pkg;

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS bio_history (
    id SERIAL PRIMARY KEY,
    number TEXT NOT NULL,
    bio TEXT NOT NULL,
    last_seen TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
`);

const waClient = new Client({
  authStrategy: new LocalAuth({ clientId: "telegram-wa-bio" }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }
});

waClient.on("qr", async (qr) => {
  const pngBuffer = await QRCode.toBuffer(qr);
  await bot.telegram.sendPhoto(process.env.ADMIN_ID, { source: pngBuffer }, { caption: "🔑 Scan QR ini untuk login WhatsApp bot!" });
});

waClient.on("ready", () => console.log("✅ WhatsApp client siap"));
waClient.initialize();

function toWhatsAppId(num) {
  const digits = num.replace(/\D/g, "");
  return `${digits}@c.us`;
}

function formatTimestamp(date = new Date()) {
  return date
    .toLocaleString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
    .replace(/\./g, ":");
}

bot.command("cekbio", async (ctx) => {
  const lines = ctx.message.text.split("\n").slice(1);
  const numbers = lines.map((n) => n.trim()).filter((n) => n.length > 5);

  if (!numbers.length)
    return ctx.reply("Kirim daftar nomor di bawah /cekbio\nContoh:\n/cekbio\n6281234567890\n6289876543210");

  await ctx.reply(`🔍 Mengecek ${numbers.length} nomor... Mohon tunggu...`);

  const withBio = [];
  const noBio = [];
  const notRegistered = [];

  for (const num of numbers) {
    const waId = toWhatsAppId(num);
    try {
      const contact = await waClient.getContactById(waId);
      if (!contact) {
        notRegistered.push(num);
        continue;
      }

      let about = null;
      if (typeof contact.getAbout === "function") {
        try { about = await contact.getAbout(); } catch {}
      }

      const now = new Date();
      if (about && about.trim() !== "") {
        const res = await pool.query(
          "SELECT * FROM bio_history WHERE number=$1 ORDER BY id DESC LIMIT 1",
          [num]
        );
        const last = res.rows[0];

        if (!last) {
          await pool.query(
            "INSERT INTO bio_history (number, bio, last_seen, updated_at) VALUES ($1,$2,$3,$3)",
            [num, about, now]
          );
        } else if (last.bio !== about) {
          await pool.query(
            "INSERT INTO bio_history (number, bio, last_seen, updated_at) VALUES ($1,$2,$3,$3)",
            [num, about, now]
          );
        } else {
          await pool.query("UPDATE bio_history SET last_seen=$1 WHERE id=$2", [now, last.id]);
        }

        const first = await pool.query(
          "SELECT MIN(updated_at) AS first_seen FROM bio_history WHERE number=$1",
          [num]
        );
        const firstSeen = first.rows[0]?.first_seen
          ? formatTimestamp(new Date(first.rows[0].first_seen))
          : formatTimestamp(now);

        withBio.push({ num, about, firstSeen });
      } else {
        noBio.push(num);
      }
    } catch (err) {
      notRegistered.push(num);
    }
  }

  let result = "";
  for (const entry of withBio) {
    result += `└─ 📅 ${entry.num}\n`;
    result += `   └─ 📝 "${entry.about}"\n`;
    result += `      └─ 🕓 Pertama kali terlihat: ${entry.firstSeen}\n\n`;
  }

  result += "----------------------------------------\n\n";
  result += `📵 NOMOR TANPA BIO / PRIVASI (${noBio.length})\n${noBio.join("\n") || "(Tidak ada)"}\n\n`;
  result += `🚫 NOMOR TIDAK TERDAFTAR (${notRegistered.length})\n${notRegistered.join("\n") || "(Tidak ada)"}`;

  const filename = `/tmp/hasil_cekbio_${Date.now()}.txt`;
  fs.writeFileSync(filename, result);

  await ctx.replyWithDocument({ source: filename, filename: "hasil_cekbio.txt" });
  fs.unlinkSync(filename);
});

bot.launch();
console.log("🚀 Telegram bot aktif (output berupa file .txt)");
