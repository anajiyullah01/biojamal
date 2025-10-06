import TelegramBot from "node-telegram-bot-api";
import pkg from "whatsapp-web.js";
import fs from "fs";
import qrcode from "qrcode-terminal";

const { Client, LocalAuth } = pkg;

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const ADMIN_ID = process.env.ADMIN_ID;

let client;
let ready = false;

// Inisialisasi WhatsApp Client
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

  client.on("qr", (qr) => {
    console.log("QR RECEIVED, SCAN INI DI WHATSAPP WEB:");
    qrcode.generate(qr, { small: true });
    if (ADMIN_ID) bot.sendMessage(ADMIN_ID, "📱 Silakan scan QR code di terminal Railway (lihat Logs).");
  });

  client.on("ready", () => {
    ready = true;
    console.log("✅ WhatsApp client siap!");
    if (ADMIN_ID) bot.sendMessage(ADMIN_ID, "✅ WhatsApp client sudah siap digunakan!");
  });

  client.initialize();
};

startWhatsApp();

// Command /cekbio
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

        // Ambil bio lewat dua cara
        const contact = await client.getContactById(wid);
        const about = contact.status || (await client.getAbout(wid)) || "";

        if (about) {
          // Ambil waktu dari metadata jika ada
          let date = "";
          if (contact?.statusTimestamp) {
            const d = new Date(contact.statusTimestamp);
            date = `${d.toLocaleDateString("id-ID")} ${d.toLocaleTimeString("id-ID")}`;
          }

          hasil += `└─ 📅 ${num}\n   └─ 📝 "${about}"\n      └─ ⏰ ${date || "Tidak diketahui"}\n\n`;
        } else {
          tanpaBio.push(num);
        }

        // jeda kecil biar gak rate limit
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
