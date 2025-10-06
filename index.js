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

// Simpan path absolute agar Railway bisa buat file sementara
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fungsi untuk mulai client WhatsApp
const startWhatsApp = () => {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--no-zygote",
        "--single-process",
      ],
      headless: true,
    },
  });

  // Saat QR diterima
  client.on("qr", async (qr) => {
    console.log("QR RECEIVED, mengirim ke Telegram...");

    try {
      // Simpan QR code sementara di folder project
      const qrPath = path.join(__dirname, "whatsapp_qr.png");

      // Buat file gambar QR
      await qrcode.toFile(qrPath, qr, { width: 300 });

      // Kirim gambar QR ke admin Telegram
      await bot.sendPhoto(ADMIN_ID, qrPath, {
        caption: "📲 Scan QR ini di WhatsApp kamu untuk login WhatsApp Web.",
      });

      // Hapus file setelah dikirim (opsional)
      fs.unlinkSync(qrPath);
    } catch (err) {
      console.error("Gagal kirim QR:", err.message);
      await bot.sendMessage(ADMIN_ID, "⚠️ Gagal membuat QR image, scan lewat Railway Logs saja.");
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

// --- Command /cekbio (sama seperti versi sebelumnya) ---

bot.onText(/\/cekbio/, async (msg) => {
  const chatId = msg.chat.id;

  if (chatId.toString() !== ADMIN_ID) {
    return bot.sendMessage(chatId, "🚫 Kamu tidak punya akses untuk perintah ini.");
  }

  if (!ready) {
    return bot.sendMessage(chatId, "⏳ WhatsApp client belum siap, tunggu sebentar...");
  }

  bot.sendMessage(chatId, "📤 Kirim daftar nomor WhatsApp (satu per baris):");
  bot.once("message", async (listMsg) => {
    const numbers = listMsg.text
      .split("\n")
      .map((n) => n.replace(/\D/g, ""))
      .filter((n) => n.length > 7);

    let hasil = "";
    let tanpaBio = [];
    let tidakTerdaftar = [];

    bot.sendMessage(chatId, `🔍 Mengecek ${numbers.length} nomor, mohon tunggu...`);

    for (const num of numbers) {
      try {
        const wid = `${num}@c.us`;
        const isRegistered = await client.isRegisteredUser(wid);

        if (!isRegistered) {
          tidakTerdaftar.push(num);
          continue;
        }

        const contact = await client.getContactById(wid);
        const about = contact.status || (await client.getAbout(wid)) || "";

        if (about) {
          let date = "";
          if (contact?.statusTimestamp) {
            const d = new Date(contact.statusTimestamp);
            date = `${d.toLocaleDateString("id-ID")} ${d.toLocaleTimeString("id-ID")}`;
          }

          hasil += `└─ 📅 ${num}\n   └─ 📝 "${about}"\n      └─ ⏰ ${date || "Tidak diketahui"}\n\n`;
        } else {
          tanpaBio.push(num);
        }

        await new Promise((r) => setTimeout(r, 1000));
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
    await bot.sendDocument(chatId, filename);
  });
});
