import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanSymbol } from "./indicators.js";
import { addTrade, closeTrade, getOpenTrades } from "./tradeManager.js";

dotenv.config();

// ==== Thêm Express server để Render detect cổng ====
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  console.log("🔄 [BOT] Ping từ UptimeRobot - giữ bot sống");
  res.send("✅ Bot is running 🚀");
});

app.listen(PORT, () => {
  console.log(`🌐 [BOT] Server đang lắng nghe tại cổng ${PORT}`);
});
// ==================================================

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const startTime = Date.now();

// --- TÙY CHỌN MENU LỆNH (KEYBOARD) ---
const menuOptions = {
  reply_markup: {
    keyboard: [
      ["/status", "/positions"], // Hàng 1
      ["/scan_now"],             // Hàng 2: Nút quét thủ công
    ],
    resize_keyboard: true,    // Tự động điều chỉnh kích thước nút
    one_time_keyboard: false, // Không ẩn menu sau khi bấm
  },
};

// Gửi menu chào mừng khi người dùng gõ /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 Chào mừng bạn! Vui lòng chọn một lệnh từ menu bên dưới:", menuOptions);
});

bot.onText(/\/status/, (msg) => {
  const uptimeMs = Date.now() - startTime;
  const uptimeMinutes = Math.floor(uptimeMs / 60000);
  const hours = Math.floor(uptimeMinutes / 60);
  const minutes = uptimeMinutes % 60;

  bot.sendMessage(
    msg.chat.id,
    `✅ Bot đang chạy bình thường!
🤖 Cấu hình: SMC + EMA Crossover.
📊 Đang quét top 100 coin USDT mỗi 5 phút.
⏱ Uptime: ${hours}h ${minutes}m
🕒 Thời gian hiện tại: ${new Date().toLocaleString()}`,
    menuOptions // Gửi kèm menu để nó luôn hiển thị
  );
});

bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  const entry = parseFloat(match[2]);
  const sl = parseFloat(match[3]);
  addTrade(symbol, "LONG", entry, sl, bot, msg.chat.id);
});

bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  const entry = parseFloat(match[2]);
  const sl = parseFloat(match[3]);
  addTrade(symbol, "SHORT", entry, sl, bot, msg.chat.id);
});

bot.onText(/\/close (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  closeTrade(symbol, bot, msg.chat.id, "Đóng thủ công");
});

bot.onText(/\/positions/, (msg) => {
  const trades = getOpenTrades();
  if (trades.length === 0) {
    bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào đang được theo dõi.");
  } else {
    const text = trades
      .map(
        t => `${t.symbol} | ${t.direction} | Entry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl}`
      )
      .join("\n");
    bot.sendMessage(msg.chat.id, `📊 Lệnh đang theo dõi:\n${text}`);
  }
});

// Thêm lệnh để quét thủ công
bot.onText(/\/scan_now/, async (msg) => {
    bot.sendMessage(msg.chat.id, "🔎 Bắt đầu quét tín hiệu thủ công, vui lòng chờ...");
    const symbols = await getTopSymbols(100);
    if(symbols.length > 0) {
        await scanAll(symbols, 'manual');
        bot.sendMessage(msg.chat.id, "✅ Đã quét xong 100 coins!");
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ Không thể lấy danh sách top coins để quét.");
    }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==== Lấy danh sách top coin USDT theo volume ====
async function getTopSymbols(limit = 100) {
  try {
    const res = await axios.get("https://www.okx.com/api/v5/market/tickers", {
      params: { instType: "SPOT" }
    });

    const symbols = res.data.data
      .filter(t => t.instId.endsWith("-USDT"))
      .sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h))
      .slice(0, limit)
      .map(t => t.instId);

    return symbols;
  } catch (err) {
    console.error("❌ [BOT] Lỗi khi lấy danh sách top coin:", err.message);
    return [];
  }
}

async function scanAll(symbols, mode = "initial") {
    const modeText = {
        initial: "ngay khi khởi động",
        cron: "định kỳ (mỗi 5 phút)",
        manual: "thủ công theo yêu cầu"
    };
  console.log(`🔎 [BOT] Bắt đầu quét ${modeText[mode] || "..."}`);

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    console.log(`🔄 [BOT] (${i + 1}/${symbols.length}) Đang quét: ${sym}...`);
    await scanSymbol(sym, bot, process.env.TELEGRAM_CHAT_ID);
    await sleep(250); // Tăng nhẹ delay để tránh bị OKX chặn
  }

  console.log(`✅ [BOT] Hoàn thành quét ${modeText[mode] || "..."}.`);
}

async function main() {
  console.log("🚀 [BOT] Khởi động bot...");
  const symbols = await getTopSymbols(100);

  if (!symbols.length) {
    console.log("⚠️ [BOT] Không tìm thấy coin nào để quét. Thoát.");
    return;
  }

  console.log(`✅ [BOT] Sẽ quét ${symbols.length} cặp coin top volume USDT.`);
  // Gửi tin nhắn thông báo khởi động và menu cho người dùng
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 Bot đã khởi động! Sẽ quét ${symbols.length} coin. Gõ /start để hiển thị lại menu.`, menuOptions);

  // Quét ngay khi khởi động
  await scanAll(symbols, "initial");

  // Cron job mỗi 5 phút
  console.log("⏳ [BOT] Đã cài cron job. Sẽ quét lại sau 5 phút...");
  cron.schedule("*/5 * * * *", async () => {
    await scanAll(symbols, "cron");
  });
}

main();