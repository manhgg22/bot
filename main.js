// main.js
import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanForNewSignal, monitorOpenTrades, getAllSignalsForSymbol } from "./indicators.js";
import { filterHighQualitySignals } from "./signalFilter.js";
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
      ["/theodoi", "/quality"],
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
bot.onText(/\/quality/, (msg) => { 
    const qualityMessage = `
🎯 *THIẾT LẬP CHẤT LƯỢNG TÍN HIỆU*

📊 *Ngưỡng điểm số hiện tại:*
• Tín hiệu tự động: ≥70 điểm
• Gợi ý LONG/SHORT: ≥75 điểm

🔧 *Các lệnh điều chỉnh:*
• \`/set_quality_auto [điểm]\` - Đặt ngưỡng tín hiệu tự động
• \`/set_quality_suggest [điểm]\` - Đặt ngưỡng gợi ý
• \`/quality_info\` - Xem thông tin chi tiết về hệ thống chấm điểm

💡 *Gợi ý:*
• 60-70: Chất lượng trung bình
• 70-80: Chất lượng tốt  
• 80-90: Chất lượng cao
• 90+: Chất lượng xuất sắc
`;
    bot.sendMessage(msg.chat.id, qualityMessage, { parse_mode: "Markdown" });
});

bot.onText(/\/set_quality_auto (.+)/, (msg, match) => {
    const threshold = parseInt(match[1]);
    if (threshold >= 50 && threshold <= 95) {
        process.env.QUALITY_THRESHOLD_AUTO = threshold;
        bot.sendMessage(msg.chat.id, `✅ Đã đặt ngưỡng tín hiệu tự động: ${threshold} điểm`);
    } else {
        bot.sendMessage(msg.chat.id, "❌ Ngưỡng phải từ 50-95 điểm");
    }
});

bot.onText(/\/set_quality_suggest (.+)/, (msg, match) => {
    const threshold = parseInt(match[1]);
    if (threshold >= 60 && threshold <= 95) {
        process.env.QUALITY_THRESHOLD_SUGGEST = threshold;
        bot.sendMessage(msg.chat.id, `✅ Đã đặt ngưỡng gợi ý: ${threshold} điểm`);
    } else {
        bot.sendMessage(msg.chat.id, "❌ Ngưỡng phải từ 60-95 điểm");
    }
});

bot.onText(/\/quality_info/, (msg) => {
    const infoMessage = `
📈 *HỆ THỐNG CHẤM ĐIỂM TÍN HIỆU NÂNG CAO*

🎯 *Các tiêu chí đánh giá:*
• ADX (15%): Độ mạnh xu hướng
• Cấu trúc thị trường (15%): Phân tích swing points
• EMA Alignment (10%): Sự đồng thuận của EMA
• Volume (10%): Xác nhận khối lượng
• Momentum (10%): Động lượng giá
• Key Levels (10%): Hỗ trợ/kháng cự
• **Chỉ báo nâng cao (30%)**: MACD, Stochastic, Williams %R, MFI, CCI, Parabolic SAR, Ichimoku

🔍 *Phân tích cấu trúc:*
• Higher Highs/Lower Lows: Xu hướng rõ ràng
• Sideways: Thị trường đi ngang (loại bỏ)
• EMA slope: Hướng xu hướng

📊 *Điều kiện bắt buộc:*
• ADX ≥ 20
• Cấu trúc phù hợp với hướng tín hiệu
• Volume ≥ 1.5x trung bình
• **≥3 chỉ báo nâng cao đồng thuận**

🔥 *Chỉ báo nâng cao:*
• MACD: Giao cắt và histogram
• Stochastic: Overbought/Oversold
• Williams %R: Momentum ngắn hạn
• MFI: Money Flow Index
• CCI: Commodity Channel Index
• Parabolic SAR: Xác nhận xu hướng
• Ichimoku: Cloud analysis

💡 *Kết quả:* Chỉ những tín hiệu có nhiều chỉ báo đồng thuận mới được gửi, giảm thiểu tối đa nhiễu và false signals.
`;
    bot.sendMessage(msg.chat.id, infoMessage, { parse_mode: "Markdown" });
});

bot.onText(/💡 Gợi ý LONG/, (msg) => { handleSuggestionRequest(msg.chat.id, "LONG"); });
bot.onText(/💡 Gợi ý SHORT/, (msg) => { handleSuggestionRequest(msg.chat.id, "SHORT"); });

async function handleSuggestionRequest(chatId, direction) {
    if (isScanning) { return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau."); }
    bot.sendMessage(chatId, `🔍 Đang tìm các tín hiệu ${direction} CHẤT LƯỢNG CAO trên thị trường Futures...`);
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
            if (signal.direction === direction && signal.score >= 70) {
                suggestions.push(signal);
            }
            await sleep(150);
        }
        
        if (suggestions.length === 0) { 
            bot.sendMessage(chatId, `✅ Đã quét xong. Không tìm thấy gợi ý ${direction} nào đạt tiêu chuẩn chất lượng cao (≥70 điểm).`); 
            return; 
        }
        
        // Lọc và sắp xếp theo điểm số chất lượng
        const suggestThreshold = parseInt(process.env.QUALITY_THRESHOLD_SUGGEST) || 75;
        const filteredSuggestions = await filterHighQualitySignals(suggestions, suggestThreshold);
        const topSuggestions = filteredSuggestions.slice(0, 5);
        
        let reportMessage = `🔥 *TOP ${topSuggestions.length} GỢI Ý ${direction} CHẤT LƯỢNG CAO*\n_(Sắp xếp theo điểm số giảm dần)_\n\n`;
        
        topSuggestions.forEach((sig, index) => {
            let qualityIcon = '🔥';
            if (sig.score >= 90) qualityIcon = '🔥🔥🔥';
            else if (sig.score >= 85) qualityIcon = '🔥🔥';
            else if (sig.score >= 80) qualityIcon = '🔥';
            else qualityIcon = '✅';
            
            reportMessage += `${index + 1}. *${sig.symbol}* - ${sig.strategy}\n`;
            reportMessage += `${qualityIcon} Điểm chất lượng: *${sig.score}/100*\n`;
            reportMessage += `📊 ADX: ${sig.adx.toFixed(1)} | Giá: ${sig.price.toFixed(4)}\n`;
            reportMessage += `🎯 TP: ${sig.tp.toFixed(4)} | 🛑 SL: ${sig.sl.toFixed(4)}\n\n`;
        });
        
        reportMessage += `💡 *Lưu ý:* Chỉ những tín hiệu có điểm ≥75 mới được hiển thị để đảm bảo chất lượng cao nhất.`;
        
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