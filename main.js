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

// (phần cron job và bot Telegram của bạn vẫn giữ nguyên)

app.listen(PORT, () => {
  console.log(`🌐 [BOT] Server đang lắng nghe tại cổng ${PORT}`);
});
// ==================================================

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

const startTime = Date.now();

bot.onText(/\/status/, (msg) => {
  const uptimeMs = Date.now() - startTime;
  const uptimeMinutes = Math.floor(uptimeMs / 60000);
  const hours = Math.floor(uptimeMinutes / 60);
  const minutes = uptimeMinutes % 60;

  bot.sendMessage(
    msg.chat.id,
    `✅ Bot đang chạy bình thường!
🤖 Cấu hình: EMA + RSI + Volume + FVG + Daily Bias + TP/SL.
📊 Đang quét top coin USDT có thanh khoản cao nhất mỗi 5 phút.
⏱ Uptime: ${hours}h ${minutes}m
🕒 Thời gian hiện tại: ${new Date().toLocaleString()}`
  );
});

bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  const entry = parseFloat(match[2]);
  const sl = parseFloat(match[3]);
  addTrade(symbol, "LONG", entry, sl, bot, msg.chat.id);
});

// /short BTC-USDT entry sl
bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  const entry = parseFloat(match[2]);
  const sl = parseFloat(match[3]);
  addTrade(symbol, "SHORT", entry, sl, bot, msg.chat.id);
});

// /close SOL-USDT
bot.onText(/\/close (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  closeTrade(symbol, bot, msg.chat.id, "Đóng thủ công");
});

// /positions -> xem lệnh đang mở
bot.onText(/\/positions/, (msg) => {
  const trades = getOpenTrades();
  if (trades.length === 0) {
    bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào đang được theo dõi.");
  } else {
    const text = trades
      .map(
        t =>
          `${t.symbol} | ${t.direction} | Entry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl}`
      )
      .join("\n");
    bot.sendMessage(msg.chat.id, `📊 Lệnh đang theo dõi:\n${text}`);
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
  console.log(mode === "initial"
    ? "🔎 [BOT] Quét tín hiệu ngay khi khởi động..."
    : "🔁 [BOT] Bắt đầu quét định kỳ (mỗi 5 phút)...");

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    console.log(`🔄 [BOT] (${i + 1}/${symbols.length}) Đang quét: ${sym}...`);
    await scanSymbol(sym, bot, process.env.TELEGRAM_CHAT_ID);
    await sleep(200); // delay tránh 429
  }

  console.log(mode === "initial"
    ? "✅ [BOT] Hoàn tất quét lần đầu. Chờ 5 phút để cron job chạy."
    : "✅ [BOT] Hoàn thành quét định kỳ.");
}

async function main() {
  console.log("🚀 [BOT] Khởi động bot...");
  const symbols = await getTopSymbols(100);

  if (!symbols.length) {
    console.log("⚠️ [BOT] Không tìm thấy coin nào để quét. Thoát.");
    return;
  }

  console.log(`✅ [BOT] Sẽ quét ${symbols.length} cặp coin top volume USDT.`);

  // Quét ngay khi khởi động
  await scanAll(symbols, "initial");

  // Cron job mỗi 5 phút
  console.log("⏳ [BOT] Đã cài cron job. Sẽ quét lại sau 5 phút...");
  cron.schedule("*/5 * * * *", async () => {
    await scanAll(symbols, "cron");
  });
}

main();
