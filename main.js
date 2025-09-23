// main.js
import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanForNewSignal, monitorOpenTrades, getAllSignalsForSymbol } from "./indicators.js";
import { addTrade, closeTrade, getOpenTrades, getTradeStats } from "./tradeManager.js";
import { getCurrentPrice, getCandles } from "./okx.js";
import { detectReversalSignals, getDailyMarketAnalysis, detectCrashRisk, calcMACD } from "./advancedIndicators.js";

dotenv.config();

// ==== Express server chỉ dùng để giữ cho Render không tắt bot ====
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.send("✅ Bot is running using Polling mode 🚀");
});
app.listen(PORT, () => {
  console.log(`🌐 [BOT] Server phụ đang lắng nghe tại cổng ${PORT} để giữ bot hoạt động.`);
});
// =============================================================

const TOKEN = process.env.TELEGRAM_TOKEN;

// [QUAY LẠI CODE CŨ] Khởi tạo bot với polling: true một cách tường minh.
// Bot sẽ luôn luôn hỏi Telegram để lấy tin nhắn.
const bot = new TelegramBot(TOKEN, { polling: true });

console.log("[BOT] Bot đang chạy ở chế độ Polling.");

// Ghi lại lỗi Polling để theo dõi, nhưng không làm sập chương trình
bot.on('polling_error', (error) => {
  console.log(`[POLLING ERROR] ${error.code}: ${error.message}`);
});


const startTime = Date.now();
const menuOptions = {
  reply_markup: {
    keyboard: [
      ["/status", "/positions", "/stats"],
      ["/scan_top_100", "/scan_all_coins"],
      ["💡 Gợi ý LONG", "💡 Gợi ý SHORT"],
      ["🔄 Tín hiệu đảo chiều", "📊 Phân tích thị trường"],
      ["⚠️ Cảnh báo rủi ro", "🎯 Tín hiệu MACD"],
      ["/theodoi"],
    ],
    resize_keyboard: true,
  },
};
let isScanning = false;

// --- Xử lý các lệnh từ người dùng (Toàn bộ phần này giữ nguyên) ---
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
bot.onText(/🔄 Tín hiệu đảo chiều/, (msg) => { handleReversalSignals(msg.chat.id); });
bot.onText(/📊 Phân tích thị trường/, (msg) => { handleMarketAnalysis(msg.chat.id); });
bot.onText(/⚠️ Cảnh báo rủi ro/, (msg) => { handleRiskWarnings(msg.chat.id); });
bot.onText(/🎯 Tín hiệu MACD/, (msg) => { handleMACDSignals(msg.chat.id); });

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

// --- Các hàm hệ thống ---
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
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 Bot đã khởi động!`, menuOptions);
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

// ==== CÁC HÀM XỬ LÝ TÍN HIỆU ĐẢO CHIỀU ====

async function handleReversalSignals(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "🔄 Đang tìm kiếm các tín hiệu đảo chiều trên thị trường...");
    isScanning = true;
    
    try {
        const symbols = await getSymbols(50); // Quét top 50 coin
        if (!symbols || symbols.length === 0) {
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin.");
            return;
        }
        
        let reversalSignals = [];
        
        for (let i = 0; i < Math.min(symbols.length, 30); i++) {
            const symbol = symbols[i];
            console.log(`[REVERSAL] Đang kiểm tra (${i+1}/30): ${symbol}`);
            
            try {
                const candles = await getCandles(symbol, "1H", 100);
                if (!candles || candles.length < 50) continue;
                
                const reversal = detectReversalSignals(candles);
                if (reversal && reversal.signal !== "NONE") {
                    const currentPrice = await getCurrentPrice(symbol);
                    if (currentPrice) {
                        reversalSignals.push({
                            symbol,
                            signal: reversal.signal,
                            strength: reversal.strength,
                            price: currentPrice,
                            isHammer: reversal.isHammer,
                            isEngulfing: reversal.isBullishEngulfing || reversal.isBearishEngulfing,
                            isDivergence: reversal.isDivergence
                        });
                    }
                }
            } catch (error) {
                console.error(`Lỗi kiểm tra reversal cho ${symbol}:`, error.message);
            }
            
            await sleep(100);
        }
        
        if (reversalSignals.length === 0) {
            bot.sendMessage(chatId, "✅ Không tìm thấy tín hiệu đảo chiều nào phù hợp.");
            return;
        }
        
        // Sắp xếp theo độ mạnh giảm dần
        reversalSignals.sort((a, b) => b.strength - a.strength);
        const topSignals = reversalSignals.slice(0, 5);
        
        let message = "🔄 *TOP 5 TÍN HIỆU ĐẢO CHIỀU MẠNH NHẤT*\n\n";
        
        topSignals.forEach((signal, index) => {
            const signalIcon = signal.signal === "BULLISH" ? "📈" : "📉";
            const strengthIcon = signal.strength > 60 ? "🔥" : signal.strength > 40 ? "⚡" : "💡";
            
            message += `${index + 1}. ${signalIcon} *${signal.symbol}*\n`;
            message += `   ${strengthIcon} Độ mạnh: ${signal.strength}/100\n`;
            message += `   💰 Giá: ${signal.price.toFixed(5)}\n`;
            
            if (signal.isHammer) message += `   🔨 Hammer Pattern\n`;
            if (signal.isEngulfing) message += `   🍃 Engulfing Pattern\n`;
            if (signal.isDivergence) message += `   📊 RSI Divergence\n`;
            
            message += `\n`;
        });
        
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi tìm tín hiệu đảo chiều:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình tìm kiếm tín hiệu đảo chiều.");
    } finally {
        isScanning = false;
    }
}

async function handleMarketAnalysis(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "📊 Đang phân tích thị trường tổng quan...");
    isScanning = true;
    
    try {
        const symbols = await getSymbols(20); // Phân tích top 20 coin
        if (!symbols || symbols.length === 0) {
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin.");
            return;
        }
        
        let bullishCount = 0, bearishCount = 0, neutralCount = 0;
        let highRiskCount = 0, mediumRiskCount = 0, lowRiskCount = 0;
        
        for (let i = 0; i < Math.min(symbols.length, 15); i++) {
            const symbol = symbols[i];
            console.log(`[ANALYSIS] Đang phân tích (${i+1}/15): ${symbol}`);
            
            try {
                const analysis = await getDailyMarketAnalysis(symbol);
                if (analysis && analysis.recommendation) {
                    const { direction, confidence } = analysis.recommendation;
                    const { riskLevel } = analysis.risk || { riskLevel: "LOW" };
                    
                    if (direction === "LONG") bullishCount++;
                    else if (direction === "SHORT") bearishCount++;
                    else neutralCount++;
                    
                    if (riskLevel === "HIGH") highRiskCount++;
                    else if (riskLevel === "MEDIUM") mediumRiskCount++;
                    else lowRiskCount++;
                }
            } catch (error) {
                console.error(`Lỗi phân tích cho ${symbol}:`, error.message);
            }
            
            await sleep(150);
        }
        
        const total = bullishCount + bearishCount + neutralCount;
        const bullishPercent = total > 0 ? (bullishCount / total * 100).toFixed(1) : 0;
        const bearishPercent = total > 0 ? (bearishCount / total * 100).toFixed(1) : 0;
        const neutralPercent = total > 0 ? (neutralCount / total * 100).toFixed(1) : 0;
        
        let message = "📊 *PHÂN TÍCH THỊ TRƯỜNG TỔNG QUAN*\n\n";
        message += "🎯 *Xu hướng thị trường:*\n";
        message += `📈 Tích cực: ${bullishCount} coin (${bullishPercent}%)\n`;
        message += `📉 Tiêu cực: ${bearishCount} coin (${bearishPercent}%)\n`;
        message += `⚖️ Trung tính: ${neutralCount} coin (${neutralPercent}%)\n\n`;
        
        message += "⚠️ *Mức độ rủi ro:*\n";
        message += `🔴 Cao: ${highRiskCount} coin\n`;
        message += `🟡 Trung bình: ${mediumRiskCount} coin\n`;
        message += `🟢 Thấp: ${lowRiskCount} coin\n\n`;
        
        // Đưa ra khuyến nghị tổng quan
        if (bullishPercent > 60) {
            message += "💡 *Khuyến nghị:* Thị trường có xu hướng tích cực, có thể cân nhắc các lệnh LONG.\n";
        } else if (bearishPercent > 60) {
            message += "💡 *Khuyến nghị:* Thị trường có xu hướng tiêu cực, có thể cân nhắc các lệnh SHORT.\n";
        } else {
            message += "💡 *Khuyến nghị:* Thị trường đang ở trạng thái trung tính, nên thận trọng.\n";
        }
        
        if (highRiskCount > 5) {
            message += "🚨 *Cảnh báo:* Nhiều coin có mức rủi ro cao, nên giảm tỷ lệ đòn bẩy.\n";
        }
        
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi phân tích thị trường:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình phân tích thị trường.");
    } finally {
        isScanning = false;
    }
}

async function handleRiskWarnings(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "⚠️ Đang kiểm tra các cảnh báo rủi ro...");
    isScanning = true;
    
    try {
        const symbols = await getSymbols(30);
        if (!symbols || symbols.length === 0) {
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin.");
            return;
        }
        
        let highRiskCoins = [];
        
        for (let i = 0; i < Math.min(symbols.length, 20); i++) {
            const symbol = symbols[i];
            console.log(`[RISK] Đang kiểm tra rủi ro (${i+1}/20): ${symbol}`);
            
            try {
                const candles = await getCandles(symbol, "1H", 50);
                if (!candles || candles.length < 30) continue;
                
                const risk = detectCrashRisk(candles);
                if (risk && risk.riskLevel === "HIGH") {
                    const currentPrice = await getCurrentPrice(symbol);
                    if (currentPrice) {
                        highRiskCoins.push({
                            symbol,
                            riskScore: risk.riskScore,
                            volatility: risk.volatility,
                            priceChange: risk.priceChange,
                            currentPrice
                        });
                    }
                }
            } catch (error) {
                console.error(`Lỗi kiểm tra rủi ro cho ${symbol}:`, error.message);
            }
            
            await sleep(100);
        }
        
        if (highRiskCoins.length === 0) {
            bot.sendMessage(chatId, "✅ Không có coin nào có mức rủi ro cao.");
            return;
        }
        
        // Sắp xếp theo điểm rủi ro giảm dần
        highRiskCoins.sort((a, b) => b.riskScore - a.riskScore);
        
        let message = "🚨 *CẢNH BÁO RỦI RO CAO*\n\n";
        message += `⚠️ Tìm thấy ${highRiskCoins.length} coin có mức rủi ro cao:\n\n`;
        
        highRiskCoins.slice(0, 10).forEach((coin, index) => {
            const riskIcon = coin.riskScore > 80 ? "🔴" : "🟠";
            message += `${index + 1}. ${riskIcon} *${coin.symbol}*\n`;
            message += `   📊 Điểm rủi ro: ${coin.riskScore.toFixed(1)}/100\n`;
            message += `   📈 Biến động: ${(coin.volatility * 100).toFixed(2)}%\n`;
            message += `   💰 Giá: ${coin.currentPrice.toFixed(5)}\n`;
            message += `   📉 Thay đổi: ${(coin.priceChange * 100).toFixed(2)}%\n\n`;
        });
        
        message += "💡 *Khuyến nghị:* Tránh giao dịch các coin này hoặc sử dụng đòn bẩy thấp.\n";
        message += "🛡️ Nên đặt stop loss chặt chẽ hơn bình thường.";
        
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi kiểm tra rủi ro:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình kiểm tra rủi ro.");
    } finally {
        isScanning = false;
    }
}

async function handleMACDSignals(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "🎯 Đang tìm kiếm các tín hiệu MACD...");
    isScanning = true;
    
    try {
        const symbols = await getSymbols(40);
        if (!symbols || symbols.length === 0) {
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin.");
            return;
        }
        
        let macdSignals = [];
        
        for (let i = 0; i < Math.min(symbols.length, 25); i++) {
            const symbol = symbols[i];
            console.log(`[MACD] Đang kiểm tra (${i+1}/25): ${symbol}`);
            
            try {
                const candles = await getCandles(symbol, "1H", 100);
                if (!candles || candles.length < 50) continue;
                
                const macd = calcMACD(candles);
                if (macd) {
                    const currentPrice = await getCurrentPrice(symbol);
                    if (currentPrice) {
                        // Tín hiệu MACD bullish: MACD cắt lên Signal
                        const isBullish = macd.prevMacd <= macd.prevSignal && macd.macd > macd.signal;
                        // Tín hiệu MACD bearish: MACD cắt xuống Signal
                        const isBearish = macd.prevMacd >= macd.prevSignal && macd.macd < macd.signal;
                        
                        if (isBullish || isBearish) {
                            macdSignals.push({
                                symbol,
                                signal: isBullish ? "BULLISH" : "BEARISH",
                                macd: macd.macd,
                                signal_line: macd.signal,
                                histogram: macd.histogram,
                                price: currentPrice
                            });
                        }
                    }
                }
            } catch (error) {
                console.error(`Lỗi kiểm tra MACD cho ${symbol}:`, error.message);
            }
            
            await sleep(100);
        }
        
        if (macdSignals.length === 0) {
            bot.sendMessage(chatId, "✅ Không tìm thấy tín hiệu MACD nào.");
            return;
        }
        
        // Sắp xếp theo histogram (độ mạnh tín hiệu)
        macdSignals.sort((a, b) => Math.abs(b.histogram) - Math.abs(a.histogram));
        
        let message = "🎯 *TÍN HIỆU MACD MỚI NHẤT*\n\n";
        
        macdSignals.slice(0, 8).forEach((signal, index) => {
            const signalIcon = signal.signal === "BULLISH" ? "📈" : "📉";
            const strengthIcon = Math.abs(signal.histogram) > 0.01 ? "🔥" : "⚡";
            
            message += `${index + 1}. ${signalIcon} *${signal.symbol}*\n`;
            message += `   ${strengthIcon} Tín hiệu: ${signal.signal}\n`;
            message += `   📊 MACD: ${signal.macd.toFixed(6)}\n`;
            message += `   📈 Signal: ${signal.signal_line.toFixed(6)}\n`;
            message += `   📊 Histogram: ${signal.histogram.toFixed(6)}\n`;
            message += `   💰 Giá: ${signal.price.toFixed(5)}\n\n`;
        });
        
        message += "💡 *Lưu ý:* Tín hiệu MACD mạnh nhất khi histogram có giá trị tuyệt đối lớn.\n";
        message += "🎯 Nên kết hợp với các chỉ báo khác để xác nhận tín hiệu.";
        
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi tìm tín hiệu MACD:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình tìm kiếm tín hiệu MACD.");
    } finally {
        isScanning = false;
    }
}
