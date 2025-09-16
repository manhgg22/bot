import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
// [CẬP NHẬT] Import thêm monitorOpenTrades
import { scanForNewSignal, monitorOpenTrades } from "./indicators.js"; 
import { addTrade, closeTrade, getOpenTrades, getTradeStats } from "./tradeManager.js";
import { getCurrentPrice } from "./okx.js";

dotenv.config();

// ==== Express server (giữ nguyên) ====
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => { res.send("✅ Bot is running 🚀"); });
app.listen(PORT, () => { console.log(`🌐 [BOT] Server đang lắng nghe tại cổng ${PORT}`); });
// =========================

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const startTime = Date.now();

const menuOptions = {
  reply_markup: {
    keyboard: [
      ["/status", "/positions", "/stats"],
      ["/scan_top_100", "/scan_all_coins"],
      ["/theodoi"],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
};

let isScanning = false;

// --- Các lệnh bot (giữ nguyên, không thay đổi) ---
bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "👋 Chào mừng bạn! Vui lòng chọn một lệnh từ menu bên dưới:", menuOptions); });
bot.onText(/\/status/, (msg) => { const uptimeMs = Date.now() - startTime; const uptimeMinutes = Math.floor(uptimeMs / 60000); const hours = Math.floor(uptimeMinutes / 60); const minutes = uptimeMinutes % 60; bot.sendMessage( msg.chat.id, `✅ Bot đang chạy bình thường!\n⏱ Uptime: ${hours}h ${minutes}m\n🕒 Thời gian hiện tại: ${new Date().toLocaleString()}`, menuOptions ); });
bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => { const [_, symbol, entry, sl] = match; addTrade(symbol.toUpperCase(), "LONG", parseFloat(entry), parseFloat(sl), bot, msg.chat.id); });
bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => { const [_, symbol, entry, sl] = match; addTrade(symbol.toUpperCase(), "SHORT", parseFloat(entry), parseFloat(sl), bot, msg.chat.id); });
bot.onText(/\/close (.+)/, (msg, match) => { closeTrade(match[1].toUpperCase(), bot, msg.chat.id, "Đóng thủ công"); });
bot.onText(/\/positions/, (msg) => { const trades = getOpenTrades(); if (trades.length === 0) { bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào đang được theo dõi."); } else { const text = trades.map(t => `${t.symbol} | ${t.direction} | Entry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl}`).join("\n"); bot.sendMessage(msg.chat.id, `📊 Lệnh đang theo dõi:\n${text}`); } });
bot.onText(/\/scan_top_100/, async (msg) => { if (isScanning) return bot.sendMessage(msg.chat.id, "⚠️ Bot đang quét, vui lòng chờ."); bot.sendMessage(msg.chat.id, "🔎 Bắt đầu quét top 100 coin..."); const symbols = await getSymbols(100); if(symbols.length > 0) { const signalCount = await scanAll(symbols, 'manual_top_100', msg.chat.id); bot.sendMessage(msg.chat.id, `✅ Đã quét xong top 100! Tìm thấy ${signalCount} tín hiệu.`); } else { bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách top 100."); } });
bot.onText(/\/scan_all_coins/, async (msg) => { if (isScanning) return bot.sendMessage(msg.chat.id, "⚠️ Bot đang quét, vui lòng chờ."); bot.sendMessage(msg.chat.id, "⏳ Bắt đầu quét TOÀN BỘ coin..."); const symbols = await getSymbols(null); if(symbols.length > 0) { bot.sendMessage(msg.chat.id, `🔎 Tìm thấy ${symbols.length} coin. Bắt đầu quét...`); const signalCount = await scanAll(symbols, 'manual_full', msg.chat.id); bot.sendMessage(msg.chat.id, `✅ Đã quét xong ${symbols.length} coin! Tìm thấy ${signalCount} tín hiệu.`); } else { bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách toàn bộ coin."); } });
bot.onText(/\/stats/, (msg) => { const statsMessage = getTradeStats(); bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: "Markdown" }); });
bot.onText(/\/theodoi/, async (msg) => { const trades = getOpenTrades(); if (trades.length === 0) { return bot.sendMessage(msg.chat.id, "📭 Bạn không có lệnh nào đang được theo dõi."); } bot.sendMessage(msg.chat.id, "🔍 Đang kiểm tra trạng thái các lệnh, vui lòng chờ..."); let reportMessage = "📊 *BÁO CÁO TRẠNG THÁI LỆNH* 📊\n\n"; const pricePromises = trades.map(trade => getCurrentPrice(trade.symbol)); const currentPrices = await Promise.all(pricePromises); trades.forEach((trade, index) => { const currentPrice = currentPrices[index]; if (currentPrice === null) { reportMessage += `*${trade.symbol}* | ${trade.direction}\n- Không thể lấy giá hiện tại.\n\n`; return; } let pnlPercent = 0; if (trade.direction === 'LONG') { pnlPercent = ((currentPrice - trade.entry) / trade.entry) * 100; } else { pnlPercent = ((trade.entry - currentPrice) / trade.entry) * 100; } const statusIcon = pnlPercent >= 0 ? '🟢' : '🔴'; const formattedPnl = pnlPercent.toFixed(2); reportMessage += `${statusIcon} *${trade.symbol}* | ${trade.direction}\n`; reportMessage += `- Entry: \`${trade.entry}\`\n`; reportMessage += `- Giá hiện tại: \`${currentPrice}\`\n`; reportMessage += `- Lãi/Lỗ: *${formattedPnl}%*\n\n`; }); bot.sendMessage(msg.chat.id, reportMessage, { parse_mode: "Markdown" }); });

// --- Các hàm hệ thống ---
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function getSymbols(limit = 100) { try { if (limit) { const res = await axios.get("https://www.okx.com/api/v5/market/tickers", { params: { instType: "SPOT" } }); return res.data.data.filter(t => t.instId.endsWith("-USDT")).sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h)).slice(0, limit).map(t => t.instId); } else { const res = await axios.get("https://www.okx.com/api/v5/public/instruments", { params: { instType: "SPOT" } }); return res.data.data.filter(t => t.instId.endsWith("-USDT") && t.state === 'live').map(t => t.instId); } } catch (err) { console.error("❌ [BOT] Lỗi khi lấy danh sách coin:", err.message); return []; } }

// [NÂNG CẤP] Hàm này giờ CHỈ quét TÍN HIỆU MỚI
async function scanAll(symbols, mode = "initial", chatId) {
  isScanning = true;
  let signalFoundCount = 0;
  const totalSymbols = symbols.length;
  console.log(`🔎 [BOT] Bắt đầu quét TÍN HIỆU MỚI (chế độ: ${mode})...`);
  try {
    for (let i = 0; i < totalSymbols; i++) {
      const sym = symbols[i];
      console.log(`🔄 [BOT] (${i + 1}/${totalSymbols}) Đang tìm tín hiệu mới: ${sym}...`);
      
      if (mode === 'manual_full' && (i + 1) % 100 === 0 && chatId) {
        bot.sendMessage(chatId, `⏳ Đã quét ${i + 1}/${totalSymbols} coin để tìm tín hiệu mới...`);
      }
      
      const hasSignal = await scanForNewSignal(sym, bot, process.env.TELEGRAM_CHAT_ID);
      if (hasSignal) {
        signalFoundCount++;
      }
      await sleep(300);
    }
  } catch(error) {
      console.error(`❌ [BOT] Lỗi trong quá trình quét tín hiệu mới:`, error);
      if (chatId) bot.sendMessage(chatId, "❌ Lỗi trong quá trình quét, kiểm tra console log.");
  } finally {
    console.log(`✅ [BOT] Hoàn thành quét tín hiệu mới (chế độ: ${mode}).`);
    isScanning = false;
    if (mode.startsWith('manual') && signalFoundCount === 0 && chatId) {
      bot.sendMessage(chatId, "✅ Đã quét xong. Không tìm thấy tín hiệu mới nào phù hợp.");
    }
  }
  return signalFoundCount;
}

async function main() {
  console.log("🚀 [BOT] Khởi động bot...");
  
  // [MỚI] Khởi chạy luồng giám sát Real-time
  const REALTIME_MONITOR_INTERVAL = 30 * 1000; // 30 giây
  setInterval(() => {
    monitorOpenTrades(bot, process.env.TELEGRAM_CHAT_ID);
  }, REALTIME_MONITOR_INTERVAL);
  console.log(`✅ [BOT] Luồng giám sát Real-time đã được kích hoạt (mỗi ${REALTIME_MONITOR_INTERVAL / 1000} giây).`);

  // --- Phần quét định kỳ vẫn giữ nguyên ---
  const symbols = await getSymbols(100);
  if (!symbols.length) {
    console.log("⚠️ [BOT] Không tìm thấy coin để quét. Bot sẽ thoát.");
    return;
  }
  console.log(`✅ [BOT] Sẽ quét định kỳ ${symbols.length} coin để tìm tín hiệu mới.`);
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 Bot đã khởi động!\n- Giám sát lệnh mở: Mỗi 30 giây.\n- Tìm tín hiệu mới: Mỗi 5 phút.\nGõ /start để hiển thị menu.`, menuOptions);
  
  await scanAll(symbols, "initial");

  cron.schedule("*/5 * * * *", async () => {
    if (isScanning) {
      console.log("⚠️ [BOT] Bỏ qua quét định kỳ vì đang có phiên quét thủ công chạy.");
      return;
    }
    await scanAll(symbols, "cron");
  });
  console.log("⏳ [BOT] Đã cài cron job quét tín hiệu mới mỗi 5 phút.");
}

// Chạy hàm chính
main();