// tradeManager.js
import dotenv from "dotenv";
dotenv.config();

const openTrades = [];
const RR = Number(process.env.RR || 2); // RR mặc định 1:2 nếu chưa set

export function addTrade(symbol, direction, entry, sl, bot, chatId) {
  const risk = Math.abs(entry - sl);
  const tp = direction === "LONG" ? entry + risk * RR : entry - risk * RR;

  openTrades.push({ symbol, direction, entry, sl, tp });
  bot.sendMessage(
    chatId,
    `✅ Theo dõi lệnh ${direction} ${symbol}\n📍 Entry: ${entry}\n🛑 SL: ${sl}\n🎯 TP: ${tp} (RR 1:${RR})`
  );
}

export function closeTrade(symbol, bot, chatId, reason = "Đóng lệnh theo dõi") {
  const idx = openTrades.findIndex(t => t.symbol === symbol);
  if (idx !== -1) {
    openTrades.splice(idx, 1);
    bot.sendMessage(chatId, `🛑 ${reason} (${symbol})`);
  } else {
    bot.sendMessage(chatId, `⚠️ Không tìm thấy lệnh ${symbol} đang theo dõi`);
  }
}

export function getOpenTrades() {
  return openTrades;
}
