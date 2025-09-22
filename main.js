// main.js
import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanForNewSignal, monitorOpenTrades, getAllSignalsForSymbol } from "./indicators.js";
import { addTrade, closeTrade, getOpenTrades, getTradeStats } from "./tradeManager.js";
import { getCurrentPrice } from "./okx.js";

dotenv.config();

const TOKEN = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_URL;

const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN, { polling: process.env.NODE_ENV !== 'production' });

if (process.env.NODE_ENV === 'production') {
  if (!RENDER_URL) {
    console.error("LỖI NGHIÊM TRỌNG: Biến môi trường RENDER_URL chưa được thiết lập!");
    process.exit(1);
  }
  const webhookPath = `/bot${TOKEN}`;
  const fullWebhookUrl = `${RENDER_URL}${webhookPath}`;
  bot.setWebHook(fullWebhookUrl);
  console.log(`[BOT] Webhook đã được thiết lập tại: ${fullWebhookUrl}`);
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  console.log("[BOT] Bot đang chạy ở chế độ Polling (Development).");
}

const startTime = Date.now();
const menuOptions = {
  reply_markup: {
    keyboard: [
      ["/status", "/positions", "/stats"],
      ["/scan_top_100", "/scan_all_coins"],
      ["💡 Gợi ý LONG", "💡 Gợi ý SHORT"],
      ["/theodoi"],
    ],
    resize_keyboard: true,
  },
};
let isScanning = false;

bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "👋 Chào mừng! Bot hoạt động trên thị trường Futures.", menuOptions); });
bot.onText(/\/status/, (msg) => { const uptimeMs = Date.now() - startTime; const uptimeMinutes = Math.floor(uptimeMs / 60000); const hours = Math.floor(uptimeMinutes / 60); const minutes = uptimeMinutes % 60; bot.sendMessage(msg.chat.id, `✅ Bot đang chạy bình thường!\n⏱ Uptime: ${hours}h ${minutes}m`, menuOptions); });
bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => { const [_, symbol, entry, sl] = match; addTrade(symbol.toUpperCase(), "LONG", parseFloat(entry), parseFloat(sl), bot, msg.chat.id); });
bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => { const [_, symbol, entry, sl] = match; addTrade(symbol.toUpperCase(), "SHORT", parseFloat(entry), parseFloat(sl), bot, msg.chat.id); });
bot.onText(/\/close (.+)/, (msg, match) => { closeTrade(match[1].toUpperCase(), bot, msg.chat.id, "Đóng thủ công"); });
bot.onText(/\/positions/, (msg) => { const trades = getOpenTrades(); if (trades.length === 0) { bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào đang được theo dõi."); } else { const text = trades.map(t => `${t.symbol} | ${t.direction} | Entry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl}`).join("\n"); bot.sendMessage(msg.chat.id, `📊 Lệnh đang theo dõi:\n${text}`); } });
bot.onText(/\/scan_top_100/, async (msg) => { if (isScanning) return bot.sendMessage(msg.chat.id, "⚠️ Bot đang bận quét, vui lòng chờ."); bot.sendMessage(msg.chat.id, "🔎 Bắt đầu quét top 100 coin..."); const symbols = await getSymbols(100); if (symbols.length > 0) { const signalCount = await scanAll(symbols, 'manual_top_100', msg.chat.id); bot.sendMessage(msg.chat.id, `✅ Đã quét xong top 100! Tìm thấy ${signalCount} tín hiệu.`); } else { bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách top 100."); } });
bot.onText(/\/scan_all_coins/, async (msg) => { if (isScanning) return bot.sendMessage(msg.chat.id, "⚠️ Bot đang bận quét, vui lòng chờ."); bot.sendMessage(msg.chat.id, "⏳ Bắt đầu quét TOÀN BỘ coin..."); const symbols = await getSymbols(null); if (symbols.length > 0) { bot.sendMessage(msg.chat.id, `🔎 Tìm thấy ${symbols.length} coin. Bắt đầu quét...`); const signalCount = await scanAll(symbols, 'manual_full', msg.chat.id); bot.sendMessage(msg.chat.id, `✅ Đã quét xong ${symbols.length} coin! Tìm thấy ${signalCount} tín hiệu.`); } else { bot.sendMessage(msg.chat.id, "⚠️ Lỗi: Không thể lấy danh sách toàn bộ coin."); } });
bot.onText(/\/stats/, (msg) => { const statsMessage = getTradeStats(); bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: "Markdown" }); });
bot.onText(/\/theodoi/, async (msg) => { const trades = getOpenTrades(); if (trades.length === 0) { return bot.sendMessage(msg.chat.id, "📭 Bạn không có lệnh nào đang được theo dõi."); } bot.sendMessage(msg.chat.id, "🔍 Đang kiểm tra trạng thái các lệnh..."); let reportMessage = "📊 *BÁO CÁO TRẠNG THÁI LỆNH* 📊\n\n"; const pricePromises = trades.map(trade => getCurrentPrice(trade.symbol)); const currentPrices = await Promise.all(pricePromises); trades.forEach((trade, index) => { const currentPrice = currentPrices[index]; if (currentPrice === null) { reportMessage += `*${trade.symbol}* | ${trade.direction}\n- Không thể lấy giá hiện tại.\n\n`; return; } let pnlPercent = 0; if (trade.direction === 'LONG') { pnlPercent = ((currentPrice - trade.entry) / trade.entry) * 100; } else { pnlPercent = ((trade.entry - currentPrice) / trade.entry) * 100; } const statusIcon = pnlPercent >= 0 ? '🟢' : '🔴'; const formattedPnl = pnlPercent.toFixed(2); reportMessage += `${statusIcon} *${trade.symbol}* | ${trade.direction}\n`; reportMessage += `- Entry: \`${trade.entry}\`\n`; reportMessage += `- Giá hiện tại: \`${currentPrice}\`\n`; reportMessage += `- Lãi/Lỗ: *${formattedPnl}%*\n\n`; }); bot.sendMessage(msg.chat.id, reportMessage, { parse_mode: "Markdown" }); });
bot.onText(/💡 Gợi ý LONG/, (msg) => { handleSuggestionRequest(msg.chat.id, "LONG"); });
bot.onText(/💡 Gợi ý SHORT/, (msg) => { handleSuggestionRequest(msg.chat.id, "SHORT"); });

async function handleSuggestionRequest(chatId, direction) {
    if (isScanning) { return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau."); }
    bot.sendMessage(chatId, `🔍 Đang tìm các tín hiệu ${direction} tốt nhất trên thị trường Futures...`);
    isScanning = true;
    try {
        const allSymbols = await getSymbols(null);
        if (!allSymbols || allSymbols.length === 0) { bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin Futures."); return; }
        let suggestions = [];
        const totalSymbols = allSymbols.length;
        for (let i = 0; i < totalSymbols; i++) {
            const symbol = allSymbols[i];
            console.log(`[SUGGEST] Đang quét (${i+1}/${totalSymbols}): ${symbol}`);
            if (symbol.includes('USDC')) continue;
            const signal = await getAllSignalsForSymbol(symbol);
            if (signal.direction === direction) {
                signal.symbol = symbol;
                suggestions.push(signal);
            }
            await sleep(150);
        }
        if (suggestions.length === 0) { bot.sendMessage(chatId, `✅ Đã quét xong. Không tìm thấy gợi ý ${direction} nào phù hợp.`); return; }
        suggestions.sort((a, b) => b.adx - a.adx);
        const topSuggestions = suggestions.slice(0, 5);
        let reportMessage = `📈 *TOP 5 GỢI Ý ${direction} TIỀM NĂNG NHẤT*\n_(Sắp xếp theo Độ an toàn giảm dần)_\n\n`;
        topSuggestions.forEach(sig => {
            const safetyLevel = sig.adx > 25 ? 'CAO' : (sig.adx >= 20 ? 'TRUNG BÌNH' : 'THẤP');
            const safetyIcon = sig.adx > 25 ? '✅' : (sig.adx >= 20 ? '⚠️' : '❌');
            reportMessage += `*${sig.symbol}* - (Chiến lược: ${sig.strategy})\n`;
            reportMessage += `${safetyIcon} Độ an toàn (ADX): *${sig.adx.toFixed(1)}* (${safetyLevel})\n`;
            reportMessage += `Giá: ${sig.price.toFixed(4)}, TP: ${sig.tp.toFixed(4)}, SL: ${sig.sl.toFixed(4)}\n\n`;
        });
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
    } catch(error) {
        console.error("Lỗi khi tìm gợi ý:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình tìm kiếm gợi ý.");
    } finally {
        isScanning = false;
    }
}

app.get("/", (req, res) => { res.send("✅ Bot Webhook Server is running 🚀"); });
app.listen(PORT, () => { console.log(`🌐 [BOT] Server đang lắng nghe tại cổng ${PORT}`); });

let symbols;
async function initialize() {
  console.log("🚀 [BOT] Khởi động các tác vụ nền...");
  const REALTIME_MONITOR_INTERVAL = 30 * 1000;
  setInterval(() => {
    monitorOpenTrades(bot, process.env.TELEGRAM_CHAT_ID);
  }, REALTIME_MONITOR_INTERVAL);
  console.log(`✅ [BOT] Luồng giám sát Real-time đã được kích hoạt.`);
  symbols = await getSymbols(100);
  if (!symbols || !symbols.length) { console.log("⚠️ [BOT] Không tìm thấy coin để quét định kỳ."); return; }
  console.log(`✅ [BOT] Sẽ quét định kỳ ${symbols.length} coin.`);
  if (process.env.NODE_ENV === 'production') { bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 Bot đã khởi động trên server!`, menuOptions); }
  cron.schedule("*/5 * * * *", async () => {
    if (isScanning || !symbols || !symbols.length) { console.log("⚠️ [BOT] Bỏ qua quét định kỳ."); return; }
    await scanAll(symbols, "cron");
  });
  console.log("⏳ [BOT] Đã cài cron job quét tín hiệu mới.");
}
initialize();
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function getSymbols(limit = null) { try { const res = await axios.get("https://www.okx.com/api/v5/public/instruments", { params: { instType: "SWAP" } }); let symbols = res.data.data.filter(t => t.state === 'live' && t.settleCcy === 'USDT').map(t => t.instId); if (limit) { const tickersRes = await axios.get("https://www.okx.com/api/v5/market/tickers", { params: { instType: "SWAP" } }); const volumeMap = new Map(tickersRes.data.data.map(t => [t.instId, Number(t.volCcy24h)])); symbols.sort((a, b) => (volumeMap.get(b) || 0) - (volumeMap.get(a) || 0)); return symbols.slice(0, limit); } return symbols; } catch (err) { console.error("❌ [BOT] Lỗi khi lấy danh sách coin Futures:", err.message); return []; } }
async function scanAll(symbols, mode = "initial", chatId) { isScanning = true; let signalFoundCount = 0; const totalSymbols = symbols.length; const isManualScan = mode.startsWith('manual'); console.log(`🔎 [BOT] Bắt đầu quét (chế độ: ${mode})...`); try { for (let i = 0; i < totalSymbols; i++) { const sym = symbols[i]; console.log(`🔄 [BOT] (${i + 1}/${totalSymbols}) Đang quét: ${sym}...`); if (mode === 'manual_full' && (i + 1) % 100 === 0 && chatId) { bot.sendMessage(chatId, `⏳ Đã quét ${i + 1}/${totalSymbols} coin...`); } const hasSignal = await scanForNewSignal(sym, bot, process.env.TELEGRAM_CHAT_ID); if (hasSignal) signalFoundCount++; await sleep(150); } } catch(error) { console.error(`❌ Lỗi nghiêm trọng trong quá trình quét:`, error); if (chatId) bot.sendMessage(chatId, "❌ Lỗi trong quá trình quét, kiểm tra console log."); } finally { console.log(`✅ [BOT] Hoàn thành quét (chế độ: ${mode}).`); isScanning = false; if (isManualScan && signalFoundCount === 0 && chatId) { bot.sendMessage(chatId, "✅ Đã quét xong. Không tìm thấy tín hiệu mới nào phù hợp."); } } return signalFoundCount; }