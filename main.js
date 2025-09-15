import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanSymbol } from "./indicators.js";
import { addTrade, closeTrade, getOpenTrades } from "./tradeManager.js";

dotenv.config();

// ==== Express server ====
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  console.log("🔄 [BOT] Ping từ UptimeRobot - giữ bot sống");
  res.send("✅ Bot is running 🚀");
});

app.listen(PORT, () => {
  console.log(`🌐 [BOT] Server đang lắng nghe tại cổng ${PORT}`);
});
// =========================

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const startTime = Date.now();

const menuOptions = {
  reply_markup: {
    keyboard: [
      ["/status", "/positions"],
      ["/scan_top_100", "/scan_all_coins"],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

let isScanning = false;

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
📊 Quét định kỳ: Top 100 coin USDT mỗi 5 phút.
⏱ Uptime: ${hours}h ${minutes}m
🕒 Thời gian hiện tại: ${new Date().toLocaleString()}`,
    menuOptions
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

bot.onText(/\/scan_top_100/, async (msg) => {
    if (isScanning) {
        return bot.sendMessage(msg.chat.id, "⚠️ Bot đang trong quá trình quét, vui lòng thử lại sau.");
    }
    bot.sendMessage(msg.chat.id, "🔎 Bắt đầu quét tín hiệu top 100 coin...");
    const symbols = await getSymbols(100);
    if(symbols.length > 0) {
        const signalCount = await scanAll(symbols, 'manual_top_100', msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Đã quét xong top 100 coin! Tìm thấy ${signalCount} tín hiệu mới.`);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách top 100 coin để quét.");
    }
});

bot.onText(/\/scan_all_coins/, async (msg) => {
    if (isScanning) {
        return bot.sendMessage(msg.chat.id, "⚠️ Bot đang trong quá trình quét, vui lòng thử lại sau.");
    }
    bot.sendMessage(msg.chat.id, "⏳ Bắt đầu quét TOÀN BỘ coin trên OKX. Quá trình này sẽ mất nhiều thời gian, vui lòng kiên nhẫn...");
    const symbols = await getSymbols(null);
    if(symbols.length > 0) {
        bot.sendMessage(msg.chat.id, `🔎 Tìm thấy ${symbols.length} cặp coin-USDT. Bắt đầu quét...`);
        const signalCount = await scanAll(symbols, 'manual_full', msg.chat.id);
        bot.sendMessage(msg.chat.id, `✅ Đã quét xong toàn bộ ${symbols.length} coin! Tìm thấy ${signalCount} tín hiệu mới.`);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách toàn bộ coins để quét.");
    }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSymbols(limit = 100) {
  try {
    if (limit) {
      const res = await axios.get("https://www.okx.com/api/v5/market/tickers", {
        params: { instType: "SPOT" }
      });
      return res.data.data
        .filter(t => t.instId.endsWith("-USDT"))
        .sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h))
        .slice(0, limit)
        .map(t => t.instId);
    } else {
      const res = await axios.get("https://www.okx.com/api/v5/public/instruments", {
        params: { instType: "SPOT" }
      });
      return res.data.data
        .filter(t => t.instId.endsWith("-USDT") && t.state === 'live') // Chỉ lấy coin đang giao dịch
        .map(t => t.instId);
    }
  } catch (err) {
    console.error("❌ [BOT] Lỗi khi lấy danh sách coin:", err.message);
    return [];
  }
}

// [NÂNG CẤP] Hàm này giờ sẽ trả về số lượng tín hiệu tìm thấy
async function scanAll(symbols, mode = "initial", chatId) {
  isScanning = true;
  let signalFoundCount = 0; // Biến đếm tín hiệu
  const totalSymbols = symbols.length;
  const isManualScan = mode.startsWith('manual');

  console.log(`🔎 [BOT] Bắt đầu quét (chế độ: ${mode})...`);

  try {
    for (let i = 0; i < totalSymbols; i++) {
        const sym = symbols[i];
        console.log(`🔄 [BOT] (${i + 1}/${totalSymbols}) Đang quét: ${sym}...`);
        
        if (mode === 'manual_full' && (i + 1) % 100 === 0 && chatId) {
            bot.sendMessage(chatId, `⏳ Đã quét ${i + 1}/${totalSymbols} coin...`);
        }

        // `scanSymbol` sẽ trả về `true` nếu tìm thấy tín hiệu
        const hasSignal = await scanSymbol(sym, bot, process.env.TELEGRAM_CHAT_ID);
        if (hasSignal) {
            signalFoundCount++;
        }
        await sleep(300);
    }
  } catch(error) {
      console.error(`❌ [BOT] Đã xảy ra lỗi nghiêm trọng trong quá trình quét:`, error);
      if (chatId) {
          bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình quét, vui lòng kiểm tra console log.");
      }
  } finally {
    console.log(`✅ [BOT] Hoàn thành quét (chế độ: ${mode}).`);
    isScanning = false;
    
    // [MỚI] Nếu là quét thủ công và không tìm thấy gì, hãy thông báo
    if (isManualScan && signalFoundCount === 0 && chatId) {
        bot.sendMessage(chatId, "✅ Đã quét xong. Không tìm thấy tín hiệu mới nào phù hợp.");
    }
  }
  return signalFoundCount; // Trả về số lượng tín hiệu
}

async function main() {
  console.log("🚀 [BOT] Khởi động bot...");
  const symbols = await getSymbols(100); 

  if (!symbols.length) {
    console.log("⚠️ [BOT] Không tìm thấy coin nào để quét. Thoát.");
    return;
  }

  console.log(`✅ [BOT] Sẽ quét định kỳ ${symbols.length} cặp coin top volume USDT.`);
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 Bot đã khởi động! Sẽ quét ${symbols.length} coin. Gõ /start để hiển thị menu.`, menuOptions);

  await scanAll(symbols, "initial");

  console.log("⏳ [BOT] Đã cài cron job. Sẽ quét lại top 100 coin sau 5 phút...");
  cron.schedule("*/5 * * * *", async () => {
    if (isScanning) {
        console.log("⚠️ [BOT] Đang có một phiên quét khác chạy, bỏ qua lần quét định kỳ này.");
        return;
    }
    await scanAll(symbols, "cron");
  });
}

main();