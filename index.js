import TelegramBot from "node-telegram-bot-api";
import pkg from "whatsapp-web.js";
import fs from "fs";
import qrcode from "qrcode";
import { fileURLToPath } from "url";
import path from "path";

const { Client, LocalAuth } = pkg;

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID;

let client;
let ready = false;

// Path absolute
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Jalankan WhatsApp
const startWhatsApp = () => {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
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

  // Kirim QR ke Telegram
  client.on("qr", async (qr) => {
    console.log("QR RECEIVED, kirim ke Telegram...");
    try {
      const qrPath = path.join(__dirname, "whatsapp_qr.png");
      await qrcode.toFile(qrPath, qr, { width: 300 });
      await bot.sendPhoto(ADMIN_ID, qrPath, {
        caption: "📲 Scan QR ini di WhatsApp kamu untuk login.",
      });
      fs.unlinkSync(qrPath);
    } catch (err) {
      console.error("Gagal kirim QR:", err.message);
      await bot.sendMessage(ADMIN_ID, "⚠️ QR gagal dibuat, scan lewat Railway Logs saja.");
    }
  });

  client.on("ready", () => {
    ready = true;
    console.log("✅ WhatsApp client siap!");
    bot.sendMessage(ADMIN_ID, "✅ WhatsApp client sudah siap digunakan!");
  });

  client.initialize();
};

startWhatsApp();

// --- Command /cekbio ---
bot.onText(/\/cekbio/, async (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_ID) return bot.sendMessage(chatId, "🚫 Tidak ada izin.");

  if (!ready) return bot.sendMessage(chatId, "⏳ WhatsApp client belum siap...");

  bot.sendMessage(chatId, "📤 Kirim daftar nomor WhatsApp (satu per baris):");

  bot.once("message", async (listMsg) => {
    const numbers = listMsg.text
      .split("\n")
      .map((n) => n.replace(/\D/g, ""))
      .filter((n) => n.length > 7);

    let hasil = "";
    let tanpaBio = [];
    let tidakTerdaftar = [];

    bot.sendMessage(chatId, `🔍 Mengecek ${numbers.length} nomor...`);

    for (const num of numbers) {
      try {
        const wid = `${num}@c.us`;
        const isRegistered = await client.isRegisteredUser(wid);
        if (!isRegistered) {
          tidakTerdaftar.push(num);
          continue;
        }

        // Paksa ambil data terbaru dari server
        const contact = await client.getContactById(wid);
        const aboutInfo = await client.pupPage.evaluate(async (id) => {
          const wid = window.Store.WidFactory.createWid(id);
          const result = await window.Store.QueryExist(wid);
          if (result && result.status) return result.status;
          const about = await window.Store.StatusUtils.getStatus(wid);
          return about?.status || null;
        }, wid);

        const about = aboutInfo || contact.status || "—";
        if (about && about.trim() !== "—" && about.trim() !== "") {
          let date = "";
          if (contact?.statusTimestamp) {
            const d = new Date(contact.statusTimestamp);
            date = `${d.toLocaleDateString("id-ID")} ${d.toLocaleTimeString("id-ID")}`;
          }

          hasil += `└─ 📅 ${num}\n   └─ 📝 "${about}"\n      └─ ⏰ ${date || "Tidak diketahui"}\n\n`;
        } else {
          tanpaBio.push(num);
        }

        await new Promise((r) => setTimeout(r, 1200));
      } catch (err) {
        console.log(`Gagal cek ${num}:`, err.message);
        tanpaBio.push(num);
      }
    }

    hasil += `----------------------------------------\n\n`;
    hasil += `📵 NOMOR TANPA BIO / PRIVASI (${tanpaBio.length})\n${tanpaBio.join("\n")}\n\n`;
    hasil += `🚫 NOMOR TIDAK TERDAFTAR (${tidakTerdaftar.length})\n${tidakTerdaftar.join("\n")}\n`;

    const filename = "hasil_cekbio.txt";
    fs.writeFileSync(filename, hasil, "utf-8");
    await bot.sendDocument(chatId, filename, {}, { contentType: "text/plain" });
  });
});
