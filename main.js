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
      ["🎯 Tín hiệu tốt nhất", "📊 Phân tích thị trường"],
      ["⚠️ Cảnh báo rủi ro", "🔄 Tín hiệu đảo chiều"],
      ["/theodoi", "/daily_report", "/indicators"],
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
bot.onText(/🎯 Tín hiệu tốt nhất/, async (msg) => { await handleBestSignals(msg.chat.id); });
bot.onText(/\/stats/, (msg) => { const statsMessage = getTradeStats(); bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: "Markdown" }); });
bot.onText(/\/theodoi/, async (msg) => { const trades = getOpenTrades(); if (trades.length === 0) { return bot.sendMessage(msg.chat.id, "📭 Bạn không có lệnh nào đang được theo dõi."); } bot.sendMessage(msg.chat.id, "🔍 Đang kiểm tra trạng thái các lệnh..."); let reportMessage = "📊 *BÁO CÁO TRẠNG THÁI LỆNH* 📊\n\n"; const pricePromises = trades.map(trade => getCurrentPrice(trade.symbol)); const currentPrices = await Promise.all(pricePromises); trades.forEach((trade, index) => { const currentPrice = currentPrices[index]; if (currentPrice === null) { reportMessage += `*${trade.symbol}* | ${trade.direction}\n- Không thể lấy giá hiện tại.\n\n`; return; } let pnlPercent = 0; if (trade.direction === 'LONG') { pnlPercent = ((currentPrice - trade.entry) / trade.entry) * 100; } else { pnlPercent = ((trade.entry - currentPrice) / trade.entry) * 100; } const statusIcon = pnlPercent >= 0 ? '🟢' : '🔴'; const formattedPnl = pnlPercent.toFixed(2); reportMessage += `${statusIcon} *${trade.symbol}* | ${trade.direction}\n`; reportMessage += `- Entry: \`${trade.entry}\`\n`; reportMessage += `- Giá hiện tại: \`${currentPrice}\`\n`; reportMessage += `- Lãi/Lỗ: *${formattedPnl}%*\n\n`; }); bot.sendMessage(msg.chat.id, reportMessage, { parse_mode: "Markdown" }); });
bot.onText(/🔄 Tín hiệu đảo chiều/, (msg) => { handleReversalSignals(msg.chat.id); });
bot.onText(/📊 Phân tích thị trường/, (msg) => { handleMarketAnalysis(msg.chat.id); });
bot.onText(/⚠️ Cảnh báo rủi ro/, (msg) => { handleRiskWarnings(msg.chat.id); });
bot.onText(/\/daily_report/, (msg) => { handleDailyReport(msg.chat.id); });
bot.onText(/\/indicators/, (msg) => { handleIndicatorsInfo(msg.chat.id); });

// ==== HÀM TÍN HIỆU TỐT NHẤT (TỐI ƯU HÓA) ====
async function handleBestSignals(chatId) {
    if (isScanning) { 
        return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau."); 
    }
    
    bot.sendMessage(chatId, "🎯 Đang tìm các tín hiệu tốt nhất với độ chính xác cao...");
    isScanning = true;
    
    try {
        // Quét TOÀN BỘ coin để tìm tín hiệu tốt nhất
        const symbols = await getSymbols(null);
        if (!symbols || symbols.length === 0) { 
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin."); 
            return; 
        }
        
        let allSignals = [];
        const batchSize = 15; // Tăng batch size để xử lý nhiều coin hơn
        
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const batchPromises = batch.map(async (symbol) => {
                if (symbol.includes('USDC')) return null;
                try {
                    const signal = await getAllSignalsForSymbol(symbol);
                    if (signal.direction !== "NONE") {
                        signal.symbol = symbol;
                        // Tính điểm chất lượng tổng hợp
                        signal.qualityScore = calculateQualityScore(signal);
                        return signal;
                    }
                } catch (error) {
                    console.error(`Lỗi quét ${symbol}:`, error.message);
                }
                return null;
            });
            
            const batchResults = await Promise.all(batchPromises);
            allSignals.push(...batchResults.filter(s => s !== null));
            
            // Cập nhật tiến trình mỗi 100 coin
            const processed = Math.min(i + batchSize, symbols.length);
            if (processed % 100 === 0 || processed === symbols.length) {
                bot.sendMessage(chatId, `⏳ Đã quét ${processed}/${symbols.length} coin... Tìm thấy ${allSignals.length} tín hiệu.`);
            }
            
            await sleep(100); // Giảm delay để tăng tốc
        }
        
        if (allSignals.length === 0) { 
            bot.sendMessage(chatId, "✅ Đã quét xong. Không tìm thấy tín hiệu nào phù hợp."); 
            return; 
        }
        
        // Sắp xếp theo điểm chất lượng và chỉ lấy top 10
        allSignals.sort((a, b) => b.qualityScore - a.qualityScore);
        const topSignals = allSignals.slice(0, 10);
        
        let reportMessage = "🎯 *TOP TÍN HIỆU TỐT NHẤT HÔM NAY*\n";
        reportMessage += "_(Sắp xếp theo độ chính xác giảm dần)_\n\n";
        
        topSignals.forEach((sig, index) => {
            const qualityIcon = sig.qualityScore > 80 ? '🔥' : sig.qualityScore > 60 ? '⚡' : '💡';
            const safetyLevel = sig.adx > 25 ? 'CAO' : (sig.adx >= 20 ? 'TRUNG BÌNH' : 'THẤP');
            const safetyIcon = sig.adx > 25 ? '✅' : (sig.adx >= 20 ? '⚠️' : '❌');
            
            reportMessage += `${index + 1}. ${qualityIcon} *${sig.symbol}* | ${sig.direction}\n`;
            reportMessage += `   📊 Chiến lược: ${sig.strategy}\n`;
            reportMessage += `   ${safetyIcon} Độ an toàn: ${sig.adx.toFixed(1)} (${safetyLevel})\n`;
            reportMessage += `   🎯 Điểm chất lượng: ${sig.qualityScore.toFixed(1)}/100\n`;
            reportMessage += `   💰 Entry: ${sig.price.toFixed(5)}\n`;
            reportMessage += `   🎯 TP: ${sig.tp.toFixed(5)} | 🛑 SL: ${sig.sl.toFixed(5)}\n\n`;
        });
        
        reportMessage += "💡 *Khuyến nghị:* Chỉ vào lệnh với điểm chất lượng > 70\n";
        reportMessage += "🛡️ Luôn đặt stop loss và quản lý rủi ro cẩn thận\n\n";
        reportMessage += "📊 *CHỈ BÁO ĐƯỢC SỬ DỤNG:*\n";
        reportMessage += "• ADX: Độ mạnh xu hướng (0-100)\n";
        reportMessage += "• RSI: Overbought/Oversold (0-100)\n";
        reportMessage += "• ATR: Biến động giá (Stop Loss)\n";
        reportMessage += "• Bollinger Bands: Breakout detection\n";
        reportMessage += "• EMA Cross: Golden/Death cross\n";
        reportMessage += "• Stochastic RSI: Momentum reversal\n";
        reportMessage += "• SMC: Order blocks, BOS, Swing points";
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch(error) {
        console.error("Lỗi khi tìm tín hiệu tốt nhất:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình tìm kiếm tín hiệu.");
    } finally {
        isScanning = false;
    }
}

// Tính điểm chất lượng tổng hợp
function calculateQualityScore(signal) {
    let score = 0;
    
    // Điểm từ ADX (độ mạnh xu hướng)
    score += Math.min(signal.adx * 2, 40);
    
    // Điểm từ chiến lược
    const strategyScores = {
        'SMC': 25,
        'EMA_CROSS': 20,
        'BB_BREAKOUT': 15,
        'STOCH_RSI_REVERSAL': 20
    };
    score += strategyScores[signal.strategy] || 10;
    
    // Điểm từ Risk/Reward ratio
    const risk = Math.abs(signal.price - signal.sl);
    const reward = Math.abs(signal.tp - signal.price);
    const rr = reward / risk;
    score += Math.min(rr * 10, 25);
    
    // Điểm bonus cho các điều kiện đặc biệt
    if (signal.adx > 30) score += 10; // Xu hướng rất mạnh
    if (rr > 2) score += 5; // Risk/Reward tốt
    
    return Math.min(score, 100);
}

// ==== THÔNG TIN CHỈ BÁO ====
function handleIndicatorsInfo(chatId) {
    const message = `📊 *THÔNG TIN CHỈ BÁO KỸ THUẬT*

🎯 *CHỈ BÁO CHÍNH:*

📈 *ADX (Average Directional Index)*
• Mục đích: Đo độ mạnh xu hướng
• Giá trị: 0-100 (càng cao = xu hướng càng mạnh)
• Sử dụng: Đánh giá độ tin cậy tín hiệu
• Ngưỡng: >25 = xu hướng mạnh

📊 *RSI (Relative Strength Index)*
• Mục đích: Đo overbought/oversold
• Giá trị: 0-100
• Ngưỡng: >70 = overbought, <30 = oversold
• Sử dụng: Xác nhận tín hiệu đảo chiều

📉 *ATR (Average True Range)*
• Mục đích: Đo biến động giá
• Sử dụng: Tính Stop Loss và Take Profit
• Công thức: SL = Entry ± (ATR × 1.5-2.5)

📊 *Bollinger Bands*
• Mục đích: Xác định breakout và mean reversion
• Cấu hình: SMA 20 ± 2 standard deviations
• Sử dụng: Phát hiện breakout với volume cao

📈 *EMA (Exponential Moving Average)*
• Cấu hình: EMA 12, 26, 200
• Golden Cross: EMA 12 cắt lên EMA 26
• Death Cross: EMA 12 cắt xuống EMA 26
• Trend Filter: EMA 200

📊 *Stochastic RSI*
• Mục đích: Đo momentum
• Ngưỡng: K<20 = oversold, K>80 = overbought
• Sử dụng: Phát hiện đảo chiều sớm

🏦 *SMC (Smart Money Concepts)*
• Order Blocks: Vùng giá quan trọng
• BOS (Break of Structure): Phá vỡ cấu trúc
• Swing Points: Điểm đảo chiều
• Fair Value Gaps: Khoảng trống giá

🎯 *CHIẾN LƯỢC GIAO DỊCH:*

1️⃣ *SMC Strategy*
• Phân tích Daily bias (EMA 50)
• Tìm BOS trên H1
• Entry trên M15 với Order Block/FVG
• RSI confirmation

2️⃣ *EMA Cross Strategy*
• EMA 12 cắt EMA 26
• Filter với EMA 200
• ATR cho SL/TP
• Volume confirmation

3️⃣ *Bollinger Breakout*
• Giá phá vỡ band
• Volume > 1.8x average
• ATR cho SL/TP
• Retest confirmation

4️⃣ *Stochastic RSI Reversal*
• K cắt D từ oversold/overbought
• RSI confirmation
• ATR cho SL/TP
• 4H timeframe

💡 *HỆ THỐNG ĐIỂM CHẤT LƯỢNG:*
• ADX: 40 điểm tối đa
• Chiến lược: 10-25 điểm
• Risk/Reward: 25 điểm tối đa
• Bonus: 10-15 điểm

🎯 *KHUYẾN NGHỊ:*
• Chỉ vào lệnh với điểm > 70
• Kết hợp nhiều chỉ báo
• Luôn đặt Stop Loss
• Quản lý rủi ro cẩn thận`;

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
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
  // Quét tín hiệu mỗi 3 phút (tăng tần suất)
  cron.schedule("*/3 * * * *", async () => {
    if (isScanning || !symbols || !symbols.length) { console.log("⚠️ [BOT] Bỏ qua quét định kỳ."); return; }
    await scanAll(symbols, "cron");
  });
  
  // Phân tích hàng ngày lúc 8:00 sáng
  cron.schedule("0 8 * * *", async () => {
    console.log("📊 [DAILY] Bắt đầu phân tích hàng ngày...");
    await handleDailyReport(process.env.TELEGRAM_CHAT_ID);
  });
  
  // Phân tích hàng tuần vào thứ 2 lúc 9:00 sáng
  cron.schedule("0 9 * * 1", async () => {
    console.log("📈 [WEEKLY] Bắt đầu phân tích hàng tuần...");
    await handleWeeklyReport(process.env.TELEGRAM_CHAT_ID);
  });
  
  console.log("⏳ [BOT] Đã cài cron job quét tín hiệu mới (3 phút/lần).");
  console.log("📊 [BOT] Đã cài phân tích hàng ngày (8:00 sáng).");
  console.log("📈 [BOT] Đã cài phân tích hàng tuần (Thứ 2, 9:00 sáng).");
}
initialize();
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function getSymbols(limit = null) { try { const res = await axios.get("https://www.okx.com/api/v5/public/instruments", { params: { instType: "SWAP" } }); let symbols = res.data.data.filter(t => t.state === 'live' && t.settleCcy === 'USDT').map(t => t.instId); if (limit) { const tickersRes = await axios.get("https://www.okx.com/api/v5/market/tickers", { params: { instType: "SWAP" } }); const volumeMap = new Map(tickersRes.data.data.map(t => [t.instId, Number(t.volCcy24h)])); symbols.sort((a, b) => (volumeMap.get(b) || 0) - (volumeMap.get(a) || 0)); return symbols.slice(0, limit); } return symbols; } catch (err) { console.error("❌ [BOT] Lỗi khi lấy danh sách coin Futures:", err.message); return []; } }
async function scanAll(symbols, mode = "initial", chatId) { 
    isScanning = true; 
    let signalFoundCount = 0; 
    const totalSymbols = symbols.length; 
    const isManualScan = mode.startsWith('manual'); 
    console.log(`🔎 [BOT] Bắt đầu quét (chế độ: ${mode})...`); 
    
    try { 
        // Tối ưu hóa: xử lý theo batch để tăng tốc độ
        const batchSize = mode === "cron" ? 5 : 10; // Cron job nhỏ hơn để không làm chậm hệ thống
        const delay = mode === "cron" ? 50 : 100; // Giảm delay cho cron job
        
        for (let i = 0; i < totalSymbols; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            
            // Xử lý song song trong batch
            const batchPromises = batch.map(async (sym) => {
                try {
                    const hasSignal = await scanForNewSignal(sym, bot, process.env.TELEGRAM_CHAT_ID);
                    return hasSignal ? 1 : 0;
                } catch (error) {
                    console.error(`❌ Lỗi quét ${sym}:`, error.message);
                    return 0;
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            signalFoundCount += batchResults.reduce((sum, count) => sum + count, 0);
            
            // Log tiến trình
            const processed = Math.min(i + batchSize, totalSymbols);
            console.log(`🔄 [BOT] (${processed}/${totalSymbols}) Đã xử lý batch...`);
            
            // Cập nhật tiến trình cho manual scan
            if (isManualScan && processed % 50 === 0 && chatId) {
                bot.sendMessage(chatId, `⏳ Đã quét ${processed}/${totalSymbols} coin...`);
            }
            
            await sleep(delay);
        }
        
    } catch(error) { 
        console.error(`❌ Lỗi nghiêm trọng trong quá trình quét:`, error); 
        if (chatId) bot.sendMessage(chatId, "❌ Lỗi trong quá trình quét, kiểm tra console log."); 
    } finally { 
        console.log(`✅ [BOT] Hoàn thành quét (chế độ: ${mode}). Tìm thấy ${signalFoundCount} tín hiệu.`); 
        isScanning = false; 
        if (isManualScan && signalFoundCount === 0 && chatId) { 
            bot.sendMessage(chatId, "✅ Đã quét xong. Không tìm thấy tín hiệu mới nào phù hợp."); 
        } 
    } 
    return signalFoundCount; 
}

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

// ==== PHÂN TÍCH HÀNG NGÀY ====
async function handleDailyReport(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, sẽ gửi báo cáo sau.");
    }
    
    bot.sendMessage(chatId, "📊 Đang tạo báo cáo phân tích hàng ngày...");
    isScanning = true;
    
    try {
        const symbols = await getSymbols(30); // Top 30 coin
        if (!symbols || symbols.length === 0) {
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin.");
            return;
        }
        
        let bullishCount = 0, bearishCount = 0, neutralCount = 0;
        let highQualitySignals = [];
        let marketTrend = "NEUTRAL";
        
        // Phân tích xu hướng tổng thể
        for (let i = 0; i < Math.min(symbols.length, 20); i++) {
            const symbol = symbols[i];
            try {
                const analysis = await getDailyMarketAnalysis(symbol);
                if (analysis && analysis.recommendation) {
                    const { direction } = analysis.recommendation;
                    if (direction === "LONG") bullishCount++;
                    else if (direction === "SHORT") bearishCount++;
                    else neutralCount++;
                    
                    // Thu thập tín hiệu chất lượng cao
                    const signal = await getAllSignalsForSymbol(symbol);
                    if (signal.direction !== "NONE") {
                        signal.symbol = symbol;
                        signal.qualityScore = calculateQualityScore(signal);
                        if (signal.qualityScore > 70) {
                            highQualitySignals.push(signal);
                        }
                    }
                }
            } catch (error) {
                console.error(`Lỗi phân tích ${symbol}:`, error.message);
            }
            await sleep(100);
        }
        
        // Xác định xu hướng thị trường
        const total = bullishCount + bearishCount + neutralCount;
        if (total > 0) {
            const bullishPercent = (bullishCount / total) * 100;
            const bearishPercent = (bearishCount / total) * 100;
            
            if (bullishPercent > 60) marketTrend = "BULLISH";
            else if (bearishPercent > 60) marketTrend = "BEARISH";
        }
        
        // Sắp xếp tín hiệu chất lượng cao
        highQualitySignals.sort((a, b) => b.qualityScore - a.qualityScore);
        
        const today = new Date().toLocaleDateString('vi-VN');
        let reportMessage = `📊 *BÁO CÁO PHÂN TÍCH HÀNG NGÀY*\n`;
        reportMessage += `📅 Ngày: ${today}\n\n`;
        
        // Xu hướng thị trường
        const trendIcon = marketTrend === "BULLISH" ? "📈" : marketTrend === "BEARISH" ? "📉" : "⚖️";
        reportMessage += `${trendIcon} *XU HƯỚNG THỊ TRƯỜNG: ${marketTrend}*\n`;
        reportMessage += `📈 Tích cực: ${bullishCount} coin\n`;
        reportMessage += `📉 Tiêu cực: ${bearishCount} coin\n`;
        reportMessage += `⚖️ Trung tính: ${neutralCount} coin\n\n`;
        
        // Tín hiệu chất lượng cao
        if (highQualitySignals.length > 0) {
            reportMessage += `🎯 *TÍN HIỆU CHẤT LƯỢNG CAO HÔM NAY*\n`;
            highQualitySignals.slice(0, 5).forEach((sig, index) => {
                const qualityIcon = sig.qualityScore > 85 ? '🔥' : '⚡';
                reportMessage += `${index + 1}. ${qualityIcon} *${sig.symbol}* | ${sig.direction}\n`;
                reportMessage += `   📊 Chiến lược: ${sig.strategy}\n`;
                reportMessage += `   🎯 Điểm chất lượng: ${sig.qualityScore.toFixed(1)}/100\n`;
                reportMessage += `   💰 Entry: ${sig.price.toFixed(5)}\n\n`;
            });
        } else {
            reportMessage += `⚠️ *Không có tín hiệu chất lượng cao hôm nay*\n`;
            reportMessage += `💡 Khuyến nghị: Chờ đợi cơ hội tốt hơn\n\n`;
        }
        
        // Khuyến nghị giao dịch
        reportMessage += `💡 *KHUYẾN NGHỊ GIAO DỊCH:*\n`;
        if (marketTrend === "BULLISH") {
            reportMessage += `✅ Ưu tiên các lệnh LONG\n`;
            reportMessage += `🎯 Tập trung vào coin có xu hướng mạnh\n`;
        } else if (marketTrend === "BEARISH") {
            reportMessage += `✅ Ưu tiên các lệnh SHORT\n`;
            reportMessage += `🛡️ Cẩn thận với các lệnh LONG\n`;
        } else {
            reportMessage += `⚠️ Thị trường trung tính, nên thận trọng\n`;
            reportMessage += `🎯 Chỉ vào lệnh khi có tín hiệu rõ ràng\n`;
        }
        
        reportMessage += `\n🕐 Báo cáo tiếp theo: Ngày mai lúc 8:00 sáng`;
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi tạo báo cáo hàng ngày:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi khi tạo báo cáo hàng ngày.");
    } finally {
        isScanning = false;
    }
}

// ==== PHÂN TÍCH HÀNG TUẦN ====
async function handleWeeklyReport(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, sẽ gửi báo cáo sau.");
    }
    
    bot.sendMessage(chatId, "📈 Đang tạo báo cáo phân tích hàng tuần...");
    isScanning = true;
    
    try {
        const symbols = await getSymbols(20); // Top 20 coin cho phân tích tuần
        
        let weeklyTrends = [];
        let marketSummary = {
            bullish: 0,
            bearish: 0,
            neutral: 0,
            highRisk: 0,
            lowRisk: 0
        };
        
        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            try {
                // Phân tích xu hướng tuần
                const candles = await getCandles(symbol, "1D", 30);
                if (!candles || candles.length < 20) continue;
                
                const analysis = await getDailyMarketAnalysis(symbol);
                if (analysis) {
                    const { recommendation, risk } = analysis;
                    if (recommendation) {
                        if (recommendation.direction === "LONG") marketSummary.bullish++;
                        else if (recommendation.direction === "SHORT") marketSummary.bearish++;
                        else marketSummary.neutral++;
                    }
                    
                    if (risk && risk.riskLevel === "HIGH") marketSummary.highRisk++;
                    else if (risk && risk.riskLevel === "LOW") marketSummary.lowRisk++;
                    
                    weeklyTrends.push({
                        symbol,
                        trend: recommendation?.direction || "NEUTRAL",
                        confidence: recommendation?.confidence || 0,
                        risk: risk?.riskLevel || "MEDIUM"
                    });
                }
            } catch (error) {
                console.error(`Lỗi phân tích tuần cho ${symbol}:`, error.message);
            }
            await sleep(150);
        }
        
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Thứ 2
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6); // Chủ nhật
        
        let reportMessage = `📈 *BÁO CÁO PHÂN TÍCH HÀNG TUẦN*\n`;
        reportMessage += `📅 Tuần: ${weekStart.toLocaleDateString('vi-VN')} - ${weekEnd.toLocaleDateString('vi-VN')}\n\n`;
        
        // Tổng quan thị trường
        const total = marketSummary.bullish + marketSummary.bearish + marketSummary.neutral;
        const bullishPercent = total > 0 ? (marketSummary.bullish / total * 100).toFixed(1) : 0;
        const bearishPercent = total > 0 ? (marketSummary.bearish / total * 100).toFixed(1) : 0;
        
        reportMessage += `📊 *TỔNG QUAN THỊ TRƯỜNG TUẦN NÀY:*\n`;
        reportMessage += `📈 Xu hướng tích cực: ${marketSummary.bullish} coin (${bullishPercent}%)\n`;
        reportMessage += `📉 Xu hướng tiêu cực: ${marketSummary.bearish} coin (${bearishPercent}%)\n`;
        reportMessage += `⚖️ Trung tính: ${marketSummary.neutral} coin\n\n`;
        
        reportMessage += `⚠️ *PHÂN TÍCH RỦI RO:*\n`;
        reportMessage += `🔴 Rủi ro cao: ${marketSummary.highRisk} coin\n`;
        reportMessage += `🟢 Rủi ro thấp: ${marketSummary.lowRisk} coin\n\n`;
        
        // Top coin theo xu hướng
        const bullishCoins = weeklyTrends.filter(t => t.trend === "LONG").sort((a, b) => b.confidence - a.confidence);
        const bearishCoins = weeklyTrends.filter(t => t.trend === "SHORT").sort((a, b) => b.confidence - a.confidence);
        
        if (bullishCoins.length > 0) {
            reportMessage += `📈 *TOP COIN XU HƯỚNG TÍCH CỰC:*\n`;
            bullishCoins.slice(0, 3).forEach((coin, index) => {
                reportMessage += `${index + 1}. *${coin.symbol}* - Độ tin cậy: ${coin.confidence.toFixed(1)}%\n`;
            });
            reportMessage += `\n`;
        }
        
        if (bearishCoins.length > 0) {
            reportMessage += `📉 *TOP COIN XU HƯỚNG TIÊU CỰC:*\n`;
            bearishCoins.slice(0, 3).forEach((coin, index) => {
                reportMessage += `${index + 1}. *${coin.symbol}* - Độ tin cậy: ${coin.confidence.toFixed(1)}%\n`;
            });
            reportMessage += `\n`;
        }
        
        // Khuyến nghị tuần tới
        reportMessage += `💡 *KHUYẾN NGHỊ CHO TUẦN TỚI:*\n`;
        if (bullishPercent > 60) {
            reportMessage += `✅ Thị trường có xu hướng tích cực\n`;
            reportMessage += `🎯 Tập trung vào các lệnh LONG\n`;
            reportMessage += `📈 Theo dõi các coin có xu hướng mạnh\n`;
        } else if (bearishPercent > 60) {
            reportMessage += `⚠️ Thị trường có xu hướng tiêu cực\n`;
            reportMessage += `🎯 Cân nhắc các lệnh SHORT\n`;
            reportMessage += `🛡️ Cẩn thận với các lệnh LONG\n`;
        } else {
            reportMessage += `⚖️ Thị trường ở trạng thái trung tính\n`;
            reportMessage += `🎯 Chờ đợi tín hiệu rõ ràng\n`;
            reportMessage += `📊 Theo dõi các breakout quan trọng\n`;
        }
        
        reportMessage += `\n📅 Báo cáo tiếp theo: Thứ 2 tuần sau lúc 9:00 sáng`;
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi tạo báo cáo hàng tuần:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi khi tạo báo cáo hàng tuần.");
    } finally {
        isScanning = false;
    }
}
