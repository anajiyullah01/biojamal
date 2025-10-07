import TelegramBot from "node-telegram-bot-api";
import { Client, LocalAuth } from "whatsapp-web.js";
import puppeteer from "puppeteer";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

const __dirname = path.resolve();

// === Konfigurasi Bot ===
const TELEGRAM_BOT_TOKEN = process.env.BOT_TOKEN; // set di Railway variable: BOT_TOKEN
const ADMIN_ID = 379525054; // ganti dengan id Telegram kamu

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

let client;
let isWhatsAppReady = false;

// === Inisialisasi WhatsApp Client ===
const startWhatsApp = async () => {
  const executablePath = await puppeteer.executablePath();

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--single-process",
      ],
    },
  });

  client.on("qr", async (qr) => {
    console.log("QR Code diterima, mengirim ke Telegram...");
    const qrImagePath = path.join(__dirname, "qr.png");
    await QRCode.toFile(qrImagePath, qr);
    await bot.sendPhoto(ADMIN_ID, qrImagePath, { caption: "📱 Scan QR untuk login WhatsApp" });
  });

  client.on("ready", async () => {
    console.log("✅ WhatsApp Client siap digunakan!");
    isWhatsAppReady = true;
    await bot.sendMessage(ADMIN_ID, "✅ WhatsApp Web sudah terhubung!");
  });

  client.on("disconnected", async () => {
    console.log("❌ WhatsApp disconnected, mencoba ulang...");
    isWhatsAppReady = false;
    await bot.sendMessage(ADMIN_ID, "⚠️ WhatsApp disconnected. Reconnecting...");
    setTimeout(startWhatsApp, 5000);
  });

  await client.initialize();
};

startWhatsApp();

// === Fitur: /cekbio ===
bot.onText(/\/cekbio (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const numberList = match[1]
    .split("\n")
    .map((n) => n.trim())
    .filter((n) => n);

  if (!isWhatsAppReady) {
    return bot.sendMessage(chatId, "❌ WhatsApp belum siap. Tunggu beberapa detik lagi...");
  }

  const bioResults = [];
  const noBio = [];
  const notRegistered = [];

  await bot.sendMessage(chatId, `🔍 Memulai cek bio untuk ${numberList.length} nomor...`);

  for (const num of numberList) {
    const number = num.replace(/\D/g, "");
    const jid = `${number}@c.us`;

    try {
      const contact = await client.getNumberId(number);
      if (!contact) {
        notRegistered.push(number);
        continue;
      }

      const about = await client.getAbout(jid).catch(() => null);

      if (about) {
        bioResults.push({
          number,
          bio: about,
          date: new Date().toLocaleString("id-ID"),
        });
      } else {
        noBio.push(number);
      }
    } catch (e) {
      console.log(`❌ Gagal cek ${number}:`, e.message);
      notRegistered.push(number);
    }

    await new Promise((res) => setTimeout(res, 1200)); // delay antar request
  }

  let resultText = "";

  for (const item of bioResults) {
    resultText += `└─ 📅 ${item.number}\n   └─ 📝 "${item.bio}"\n      └─ ⏰ ${item.date}\n\n`;
  }

  if (noBio.length)
    resultText += `----------------------------------------\n📵 NOMOR TANPA BIO / PRIVASI (${noBio.length})\n${noBio.join("\n")}\n\n`;

  if (notRegistered.length)
    resultText += `🚫 NOMOR TIDAK TERDAFTAR (${notRegistered.length})\n${notRegistered.join("\n")}\n`;

  const outputPath = path.join(__dirname, "hasil_bio.txt");
  fs.writeFileSync(outputPath, resultText || "Tidak ada hasil.");

  await bot.sendDocument(chatId, outputPath, { caption: "✅ Hasil cek bio selesai." });
});

console.log("🤖 Telegram bot berjalan...");
