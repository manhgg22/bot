import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanSymbol } from "./indicators.js";
import { addTrade, closeTrade, getOpenTrades, getTradeStats } from "./tradeManager.js";
import { getCurrentPrice } from "./okx.js"; // Import hàm lấy giá mới

dotenv.config();

// ==== Thiết lập Express server để chạy liên tục trên các nền tảng hosting ====
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  console.log("🔄 [BOT] Ping từ UptimeRobot - giữ bot sống");
  res.send("✅ Bot is running 🚀");
});

app.listen(PORT, () => {
  console.log(`🌐 [BOT] Server đang lắng nghe tại cổng ${PORT}`);
});
// =======================================================================

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const startTime = Date.now();

// --- Cấu hình các nút bấm menu cho người dùng ---
const menuOptions = {
  reply_markup: {
    keyboard: [
      ["/status", "/positions", "/stats"],
      ["/scan_top_100", "/scan_all_coins"],
      ["/theodoi"], // Nút mới để theo dõi PnL
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

// Biến cờ để đảm bảo không có 2 phiên quét chạy cùng lúc
let isScanning = false;

// --- Xử lý các lệnh từ người dùng ---

// Lệnh /start: Gửi lời chào và hiển thị menu
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 Chào mừng bạn! Vui lòng chọn một lệnh từ menu bên dưới:", menuOptions);
});

// Lệnh /status: Báo cáo trạng thái và thời gian hoạt động của bot
bot.onText(/\/status/, (msg) => {
  const uptimeMs = Date.now() - startTime;
  const uptimeMinutes = Math.floor(uptimeMs / 60000);
  const hours = Math.floor(uptimeMinutes / 60);
  const minutes = uptimeMinutes % 60;
  bot.sendMessage(
    msg.chat.id,
    `✅ Bot đang chạy bình thường!\n⏱ Uptime: ${hours}h ${minutes}m\n🕒 Thời gian hiện tại: ${new Date().toLocaleString()}`,
    menuOptions
  );
});

// Lệnh /long: Thêm một lệnh LONG vào danh sách theo dõi
bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  const entry = parseFloat(match[2]);
  const sl = parseFloat(match[3]);
  addTrade(symbol, "LONG", entry, sl, bot, msg.chat.id);
});

// Lệnh /short: Thêm một lệnh SHORT vào danh sách theo dõi
bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  const entry = parseFloat(match[2]);
  const sl = parseFloat(match[3]);
  addTrade(symbol, "SHORT", entry, sl, bot, msg.chat.id);
});

// Lệnh /close: Đóng một lệnh đang theo dõi theo cách thủ công
bot.onText(/\/close (.+)/, (msg, match) => {
  const symbol = match[1].toUpperCase();
  closeTrade(symbol, bot, msg.chat.id, "Đóng thủ công");
});

// Lệnh /positions: Hiển thị tất cả các lệnh đang được theo dõi
bot.onText(/\/positions/, (msg) => {
  const trades = getOpenTrades();
  if (trades.length === 0) {
    bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào đang được theo dõi.");
  } else {
    const text = trades
      .map(t => `${t.symbol} | ${t.direction} | Entry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl}`)
      .join("\n");
    bot.sendMessage(msg.chat.id, `📊 Lệnh đang theo dõi:\n${text}`);
  }
});

// Lệnh /scan_top_100: Quét thủ công 100 coin có volume cao nhất
bot.onText(/\/scan_top_100/, async (msg) => {
  if (isScanning) {
    return bot.sendMessage(msg.chat.id, "⚠️ Bot đang trong quá trình quét, vui lòng thử lại sau.");
  }
  bot.sendMessage(msg.chat.id, "🔎 Bắt đầu quét tín hiệu top 100 coin...");
  const symbols = await getSymbols(100);
  if (symbols.length > 0) {
    const signalCount = await scanAll(symbols, 'manual_top_100', msg.chat.id);
    bot.sendMessage(msg.chat.id, `✅ Đã quét xong top 100! Tìm thấy ${signalCount} tín hiệu.`);
  } else {
    bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách top 100 coin để quét.");
  }
});

// Lệnh /scan_all_coins: Quét thủ công toàn bộ coin trên sàn OKX
bot.onText(/\/scan_all_coins/, async (msg) => {
  if (isScanning) {
    return bot.sendMessage(msg.chat.id, "⚠️ Bot đang trong quá trình quét, vui lòng thử lại sau.");
  }
  bot.sendMessage(msg.chat.id, "⏳ Bắt đầu quét TOÀN BỘ coin trên OKX. Quá trình này sẽ mất nhiều thời gian, vui lòng kiên nhẫn...");
  const symbols = await getSymbols(null);
  if (symbols.length > 0) {
    bot.sendMessage(msg.chat.id, `🔎 Tìm thấy ${symbols.length} coin. Bắt đầu quét...`);
    const signalCount = await scanAll(symbols, 'manual_full', msg.chat.id);
    bot.sendMessage(msg.chat.id, `✅ Đã quét xong ${symbols.length} coin! Tìm thấy ${signalCount} tín hiệu.`);
  } else {
    bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách toàn bộ coins để quét.");
  }
});

// Lệnh /stats: Xem thống kê hiệu suất giao dịch
bot.onText(/\/stats/, (msg) => {
  const statsMessage = getTradeStats();
  bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: "Markdown" });
});

// [MỚI] Lệnh /theodoi: Kiểm tra và báo cáo lãi/lỗ của các lệnh đang mở
bot.onText(/\/theodoi/, async (msg) => {
    const trades = getOpenTrades();
    if (trades.length === 0) {
        return bot.sendMessage(msg.chat.id, "📭 Bạn không có lệnh nào đang được theo dõi.");
    }

    bot.sendMessage(msg.chat.id, "🔍 Đang kiểm tra trạng thái các lệnh, vui lòng chờ...");

    let reportMessage = "📊 *BÁO CÁO TRẠNG THÁI LỆNH* 📊\n\n";

    // Lấy giá hiện tại cho tất cả các lệnh đang theo dõi
    const pricePromises = trades.map(trade => getCurrentPrice(trade.symbol));
    const currentPrices = await Promise.all(pricePromises);

    // Tạo báo cáo cho từng lệnh
    trades.forEach((trade, index) => {
        const currentPrice = currentPrices[index];
        if (currentPrice === null) {
            reportMessage += `*${trade.symbol}* | ${trade.direction}\n- Không thể lấy giá hiện tại.\n\n`;
            return; // Bỏ qua nếu không lấy được giá
        }

        // Tính toán phần trăm lãi/lỗ
        let pnlPercent = 0;
        if (trade.direction === 'LONG') {
            pnlPercent = ((currentPrice - trade.entry) / trade.entry) * 100;
        } else { // SHORT
            pnlPercent = ((trade.entry - currentPrice) / trade.entry) * 100;
        }

        const statusIcon = pnlPercent >= 0 ? '🟢' : '🔴';
        const formattedPnl = pnlPercent.toFixed(2);

        reportMessage += `${statusIcon} *${trade.symbol}* | ${trade.direction}\n`;
        reportMessage += `- Entry: \`${trade.entry}\`\n`;
        reportMessage += `- Giá hiện tại: \`${currentPrice}\`\n`;
        reportMessage += `- Lãi/Lỗ: *${formattedPnl}%*\n\n`;
    });

    bot.sendMessage(msg.chat.id, reportMessage, { parse_mode: "Markdown" });
});


// --- Các hàm hệ thống ---

// Hàm sleep để tạo độ trễ giữa các lần gọi API, tránh bị block
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Hàm lấy danh sách symbols từ OKX
async function getSymbols(limit = 100) {
  try {
    if (limit) {
      // Lấy top coin theo volume 24h
      const res = await axios.get("https://www.okx.com/api/v5/market/tickers", { params: { instType: "SPOT" } });
      return res.data.data
        .filter(t => t.instId.endsWith("-USDT"))
        .sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h))
        .slice(0, limit)
        .map(t => t.instId);
    } else {
      // Lấy tất cả các coin đang giao dịch
      const res = await axios.get("https://www.okx.com/api/v5/public/instruments", { params: { instType: "SPOT" } });
      return res.data.data
        .filter(t => t.instId.endsWith("-USDT") && t.state === 'live')
        .map(t => t.instId);
    }
  } catch (err) {
    console.error("❌ [BOT] Lỗi khi lấy danh sách coin:", err.message);
    return [];
  }
}

// Hàm quét chính, lặp qua danh sách các symbols
async function scanAll(symbols, mode = "initial", chatId) {
  isScanning = true;
  let signalFoundCount = 0;
  const totalSymbols = symbols.length;
  const isManualScan = mode.startsWith('manual');

  console.log(`🔎 [BOT] Bắt đầu quét (chế độ: ${mode}). Tổng cộng: ${totalSymbols} coin.`);
  try {
    for (let i = 0; i < totalSymbols; i++) {
      const sym = symbols[i];
      console.log(`🔄 [BOT] (${i + 1}/${totalSymbols}) Đang quét: ${sym}...`);
      
      // Gửi thông báo tiến trình khi quét toàn bộ sàn
      if (mode === 'manual_full' && (i + 1) % 100 === 0 && chatId) {
        bot.sendMessage(chatId, `⏳ Đã quét ${i + 1}/${totalSymbols} coin...`);
      }
      
      const hasSignal = await scanSymbol(sym, bot, process.env.TELEGRAM_CHAT_ID);
      if (hasSignal) {
        signalFoundCount++;
      }
      await sleep(300); // Đợi 0.3 giây
    }
  } catch (error) {
    console.error(`❌ [BOT] Lỗi nghiêm trọng trong quá trình quét:`, error);
    if (chatId) {
      bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình quét, vui lòng kiểm tra console log.");
    }
  } finally {
    console.log(`✅ [BOT] Hoàn thành quét (chế độ: ${mode}).`);
    isScanning = false;
    
    // Nếu là quét thủ công và không tìm thấy gì, thông báo cho người dùng
    if (isManualScan && signalFoundCount === 0 && chatId) {
      bot.sendMessage(chatId, "✅ Đã quét xong. Không tìm thấy tín hiệu mới nào phù hợp.");
    }
  }
  return signalFoundCount;
}

// Hàm chính khởi động bot
async function main() {
  console.log("🚀 [BOT] Khởi động bot...");
  const symbols = await getSymbols(100);

  if (!symbols.length) {
    console.log("⚠️ [BOT] Không tìm thấy coin nào để quét. Bot sẽ thoát.");
    return;
  }

  console.log(`✅ [BOT] Sẽ quét định kỳ ${symbols.length} cặp coin top volume USDT.`);
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 Bot đã khởi động! Sẽ quét ${symbols.length} coin. Gõ /start để hiển thị menu.`, menuOptions);

  // Quét một lần ngay khi khởi động
  await scanAll(symbols, "initial");

  // Thiết lập cron job để quét định kỳ mỗi 5 phút
  console.log("⏳ [BOT] Đã cài cron job. Sẽ quét lại top 100 coin sau 5 phút...");
  cron.schedule("*/5 * * * *", async () => {
    if (isScanning) {
      console.log("⚠️ [BOT] Bỏ qua quét định kỳ vì đang có một phiên quét khác chạy.");
      return;
    }
    await scanAll(symbols, "cron");
  });
}

// Chạy hàm chính
main();