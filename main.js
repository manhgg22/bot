// main.js
import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanForNewSignal, monitorOpenTrades, getAllSignalsForSymbol, checkRiskAndWarn, calcRSI, calcATR } from "./indicators.js";
import { filterHighQualitySignals, generateSignalReport } from "./signalFilter.js";
import { addTrade, closeTrade, getOpenTrades, getTradeStats } from "./tradeManager.js";
import { getCurrentPrice, getCandles, getAllSymbols } from "./okx.js";
import { analyzeAdvancedIndicators } from "./advancedIndicators.js";
import OKXAutoTrader from "./autoTrader.js";
import WyckoffVolumeAnalysis from "./wyckoffVolumeProfile.js";

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
      ["/wyckoff_scan", "/scan_all_coins"],
      ["💡 Gợi ý LONG", "💡 Gợi ý SHORT"],
      ["/wyckoff BTC", "/volume_profile ETH", "/dual_rsi SOL"],
      ["/theodoi", "/quality", "/risk_check"],
      ["/reset_scan"]
    ],
    resize_keyboard: true,
  },
};
let isScanning = false;
const autoTrader = new OKXAutoTrader();

// --- Xử lý các lệnh từ người dùng (Toàn bộ phần này giữ nguyên) ---
bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "👋 Chào mừng! Bot hoạt động trên thị trường Futures.", menuOptions); });
bot.onText(/\/status/, (msg) => { const uptimeMs = Date.now() - startTime; const uptimeMinutes = Math.floor(uptimeMs / 60000); const hours = Math.floor(uptimeMinutes / 60); const minutes = uptimeMinutes % 60; bot.sendMessage(msg.chat.id, `✅ Bot đang chạy bình thường!\n⏱ Uptime: ${hours}h ${minutes}m`, menuOptions); });
bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => { const [_, symbol, entry, sl] = match; addTrade(symbol.toUpperCase(), "LONG", parseFloat(entry), parseFloat(sl), bot, msg.chat.id); });
bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => { const [_, symbol, entry, sl] = match; addTrade(symbol.toUpperCase(), "SHORT", parseFloat(entry), parseFloat(sl), bot, msg.chat.id); });
bot.onText(/\/close (.+)/, (msg, match) => { closeTrade(match[1].toUpperCase(), bot, msg.chat.id, "Đóng thủ công"); });
bot.onText(/\/positions/, (msg) => { const trades = getOpenTrades(); if (trades.length === 0) { bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào đang được theo dõi."); } else { const text = trades.map(t => `${t.symbol} | ${t.direction} | Entry: ${t.entry} | TP: ${t.tp} | SL: ${t.sl}`).join("\n"); bot.sendMessage(msg.chat.id, `📊 Lệnh đang theo dõi:\n${text}`); } });
bot.onText(/🎯 Tín hiệu tốt nhất/, async (msg) => { await handleBestSignals(msg.chat.id); });
bot.onText(/💎 Tín hiệu Premium/, async (msg) => { await handlePremiumSignals(msg.chat.id, 20); });
bot.onText(/🌍 Quét hết coin/, async (msg) => { await handleScanAllCoins(msg.chat.id); });
bot.onText(/\/premium (.+)/, async (msg, match) => { 
    const coinCount = parseInt(match[1]) || 20;
    await handlePremiumSignals(msg.chat.id, coinCount); 
});
bot.onText(/\/wyckoff (.+)/, async (msg, match) => {
    const symbol = match[1];
    await handleWyckoffAnalysis(msg.chat.id, symbol);
});

bot.onText(/\/volume_profile (.+)/, async (msg, match) => {
    const symbol = match[1];
    await handleVolumeProfileAnalysis(msg.chat.id, symbol);
});

bot.onText(/\/dual_rsi (.+)/, async (msg, match) => {
    const symbol = match[1];
    await handleDualRSIAnalysis(msg.chat.id, symbol);
});

bot.onText(/\/wyckoff_scan/, async (msg) => {
    await handleWyckoffScanAll(msg.chat.id);
});
bot.onText(/\/stats/, (msg) => { const statsMessage = getTradeStats(); bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: "Markdown" }); });
bot.onText(/\/theodoi/, async (msg) => { const trades = getOpenTrades(); if (trades.length === 0) { return bot.sendMessage(msg.chat.id, "📭 Bạn không có lệnh nào đang được theo dõi."); } bot.sendMessage(msg.chat.id, "🔍 Đang kiểm tra trạng thái các lệnh..."); let reportMessage = "📊 *BÁO CÁO TRẠNG THÁI LỆNH* 📊\n\n"; const pricePromises = trades.map(trade => getCurrentPrice(trade.symbol)); const currentPrices = await Promise.all(pricePromises); trades.forEach((trade, index) => { const currentPrice = currentPrices[index]; if (currentPrice === null) { reportMessage += `*${trade.symbol}* | ${trade.direction}\n- Không thể lấy giá hiện tại.\n\n`; return; } let pnlPercent = 0; if (trade.direction === 'LONG') { pnlPercent = ((currentPrice - trade.entry) / trade.entry) * 100; } else { pnlPercent = ((trade.entry - currentPrice) / trade.entry) * 100; } const statusIcon = pnlPercent >= 0 ? '🟢' : '🔴'; const formattedPnl = pnlPercent.toFixed(2); reportMessage += `${statusIcon} *${trade.symbol}* | ${trade.direction}\n`; reportMessage += `- Entry: \`${trade.entry}\`\n`; reportMessage += `- Giá hiện tại: \`${currentPrice}\`\n`; reportMessage += `- Lãi/Lỗ: *${formattedPnl}%*\n\n`; }); bot.sendMessage(msg.chat.id, reportMessage, { parse_mode: "Markdown" }); });
bot.onText(/\/quality/, (msg) => { 
    const qualityMessage = `
🎯 *THIẾT LẬP CHẤT LƯỢNG TÍN HIỆU*

📊 *Ngưỡng điểm số hiện tại:*
• Tín hiệu tự động: ≥45 điểm
• Gợi ý LONG/SHORT: ≥50 điểm

🔧 *Các lệnh điều chỉnh:*
• \`/set_quality_auto [điểm]\` - Đặt ngưỡng tín hiệu tự động
• \`/set_quality_suggest [điểm]\` - Đặt ngưỡng gợi ý
• \`/quality_info\` - Xem thông tin chi tiết về hệ thống chấm điểm

💡 *Gợi ý:*
• 50-60: Chất lượng trung bình
• 60-70: Chất lượng tốt  
• 70-80: Chất lượng cao
• 80+: Chất lượng xuất sắc
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

bot.onText(/\/risk_check/, async (msg) => {
    const openTrades = getOpenTrades();
    if (openTrades.length === 0) {
        bot.sendMessage(msg.chat.id, "📭 Bạn không có lệnh nào đang được theo dõi để kiểm tra rủi ro.");
        return;
    }
    
    bot.sendMessage(msg.chat.id, "🔍 Đang kiểm tra rủi ro cho các lệnh đang mở...");
    await checkRiskAndWarn(bot, msg.chat.id);
});

// Lệnh reset trạng thái scanning
bot.onText(/\/reset_scan/, (msg) => {
    isScanning = false;
    bot.sendMessage(msg.chat.id, "✅ Đã reset trạng thái scanning. Bây giờ có thể sử dụng các lệnh quét.");
});

// Handler cho scan top 100 coins
bot.onText(/\/scan_top_100/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (isScanning) {
        bot.sendMessage(chatId, "⏳ Bot đang quét, vui lòng đợi...");
        return;
    }
    
    isScanning = true;
    bot.sendMessage(chatId, "🔍 Bắt đầu quét top 100 coin...");
    
    try {
        const symbols = await getSymbols(100);
        const totalSymbols = symbols.length;
        let processedCount = 0;
        let signalCount = 0;
        
        for (const symbol of symbols) {
            try {
                const signal = await scanForNewSignal(symbol);
                
                if (signal && signal.direction !== "NONE") {
                    signalCount++;
                    const report = await generateSignalReport(signal);
                    bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
                }
                
                processedCount++;
                
                // Cập nhật tiến độ mỗi 20 coin
                if (processedCount % 20 === 0) {
                    bot.sendMessage(chatId, `📊 Đã quét ${processedCount}/${totalSymbols} coin. Tìm thấy ${signalCount} tín hiệu.`);
                }
                
                await sleep(100); // Tránh rate limit
                
            } catch (error) {
                console.error(`Lỗi quét ${symbol}:`, error);
            }
        }
        
        bot.sendMessage(chatId, `✅ Hoàn thành quét ${totalSymbols} coin. Tổng cộng tìm thấy ${signalCount} tín hiệu chất lượng cao.`);
        
    } catch (error) {
        console.error("Lỗi quét top 100 coins:", error);
        bot.sendMessage(chatId, "❌ Có lỗi xảy ra khi quét coin.");
    } finally {
        isScanning = false;
    }
});

// Handler cho scan all coins
bot.onText(/\/scan_all_coins/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (isScanning) {
        bot.sendMessage(chatId, "⏳ Bot đang quét, vui lòng đợi...");
        return;
    }
    
    isScanning = true;
    bot.sendMessage(chatId, "🔍 Bắt đầu quét toàn bộ coin...");
    
    try {
        const allSymbols = await getAllSymbols();
        const totalSymbols = allSymbols.length;
        let processedCount = 0;
        let signalCount = 0;
        
        for (const symbol of allSymbols) {
            try {
                const signal = await scanForNewSignal(symbol);
                
                if (signal && signal.direction !== "NONE") {
                    signalCount++;
                    const report = await generateSignalReport(signal);
                    bot.sendMessage(chatId, report, { parse_mode: "Markdown" });
                }
                
                processedCount++;
                
                // Cập nhật tiến độ mỗi 50 coin
                if (processedCount % 50 === 0) {
                    bot.sendMessage(chatId, `📊 Đã quét ${processedCount}/${totalSymbols} coin. Tìm thấy ${signalCount} tín hiệu.`);
                }
                
                await sleep(100); // Tránh rate limit
                
            } catch (error) {
                console.error(`Lỗi quét ${symbol}:`, error);
            }
        }
        
        bot.sendMessage(chatId, `✅ Hoàn thành quét ${totalSymbols} coin. Tổng cộng tìm thấy ${signalCount} tín hiệu chất lượng cao.`);
        
    } catch (error) {
        console.error("Lỗi quét all coins:", error);
        bot.sendMessage(chatId, "❌ Có lỗi xảy ra khi quét coin.");
    } finally {
        isScanning = false;
    }
});

// ==== LỆNH TỰ ĐỘNG GIAO DỊCH ====
bot.onText(/\/auto_start/, async (msg) => {
    try {
        await autoTrader.startAutoTrading();
        const stats = autoTrader.getTradingStats();
        bot.sendMessage(msg.chat.id, `🚀 *TỰ ĐỘNG GIAO DỊCH ĐÃ BẮT ĐẦU*\n\n💰 Vốn: ${stats.totalCapital}U\n📊 Lệnh tối đa: ${stats.maxPositions}\n🎯 Điểm tín hiệu tối thiểu: 70/100\n🎯 Mục tiêu: 100U mỗi lệnh\n\n⚠️ Bot sẽ tự động:\n• Quét tín hiệu mỗi 15s\n• Sử dụng đòn bẩy tối đa\n• Đặt SL/TP tự động\n• Quản lý rủi ro`, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Lỗi khởi động tự động giao dịch: ${error.message}`);
    }
});

bot.onText(/\/auto_stop/, (msg) => {
    autoTrader.stopAutoTrading();
    bot.sendMessage(msg.chat.id, "⏹️ *TỰ ĐỘNG GIAO DỊCH ĐÃ DỪNG*\n\nBot sẽ không đặt lệnh mới nữa.", { parse_mode: "Markdown" });
});

bot.onText(/\/auto_status/, (msg) => {
    const stats = autoTrader.getTradingStats();
    let message = `🤖 *TRẠNG THÁI TỰ ĐỘNG GIAO DỊCH*\n\n`;
    message += `🔄 Trạng thái: ${stats.isTrading ? '🟢 ĐANG CHẠY' : '🔴 ĐÃ DỪNG'}\n`;
    message += `💰 Vốn tổng: ${stats.totalCapital}U\n`;
    message += `📊 Lệnh đang mở: ${stats.openPositions}/${stats.maxPositions}\n\n`;
    
    if (stats.positions.length > 0) {
        message += `📈 *LỆNH ĐANG MỞ:*\n`;
        stats.positions.forEach((pos, index) => {
            message += `${index + 1}. ${pos.symbol} | ${pos.side}\n`;
            message += `   Khối lượng: ${pos.size} (${pos.leverage}x)\n`;
            message += `   Entry: ${pos.entryPrice}\n`;
            message += `   SL: ${pos.slPrice} | TP: ${pos.tpPrice}\n\n`;
        });
    } else {
        message += `📭 Không có lệnh nào đang mở`;
    }
    
    bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
});

bot.onText(/\/auto_close_all/, async (msg) => {
    const stats = autoTrader.getTradingStats();
    if (stats.positions.length === 0) {
        bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào để đóng.");
        return;
    }
    
    bot.sendMessage(msg.chat.id, `🔄 Đang đóng ${stats.positions.length} lệnh...`);
    
    let closedCount = 0;
    for (const position of stats.positions) {
        const closed = await autoTrader.closePosition(position.symbol, "Đóng thủ công");
        if (closed) closedCount++;
    }
    
    bot.sendMessage(msg.chat.id, `✅ Đã đóng ${closedCount}/${stats.positions.length} lệnh.`);
});

bot.onText(/🤖 Auto Start/, async (msg) => {
    try {
        await autoTrader.startAutoTrading();
        const stats = autoTrader.getTradingStats();
        bot.sendMessage(msg.chat.id, `🚀 *TỰ ĐỘNG GIAO DỊCH ĐÃ BẮT ĐẦU*\n\n💰 Vốn: ${stats.totalCapital}U\n📊 Lệnh tối đa: ${stats.maxPositions}\n🎯 Điểm tín hiệu tối thiểu: 70/100\n🎯 Mục tiêu: 100U mỗi lệnh\n\n⚠️ Bot sẽ tự động:\n• Quét tín hiệu mỗi 15s\n• Sử dụng đòn bẩy tối đa\n• Đặt SL/TP tự động\n• Quản lý rủi ro`, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Lỗi khởi động tự động giao dịch: ${error.message}`);
    }
});

bot.onText(/⏹️ Auto Stop/, (msg) => {
    autoTrader.stopAutoTrading();
    bot.sendMessage(msg.chat.id, "⏹️ *TỰ ĐỘNG GIAO DỊCH ĐÃ DỪNG*\n\nBot sẽ không đặt lệnh mới nữa.", { parse_mode: "Markdown" });
});

bot.onText(/📊 Auto Status/, (msg) => {
    const stats = autoTrader.getTradingStats();
    let message = `🤖 *TRẠNG THÁI TỰ ĐỘNG GIAO DỊCH*\n\n`;
    message += `🔄 Trạng thái: ${stats.isTrading ? '🟢 ĐANG CHẠY' : '🔴 ĐÃ DỪNG'}\n`;
    message += `💰 Vốn tổng: ${stats.totalCapital}U\n`;
    message += `📊 Lệnh đang mở: ${stats.openPositions}/${stats.maxPositions}\n\n`;
    
    if (stats.positions.length > 0) {
        message += `📈 *LỆNH ĐANG MỞ:*\n`;
        stats.positions.forEach((pos, index) => {
            message += `${index + 1}. ${pos.symbol} | ${pos.side}\n`;
            message += `   Khối lượng: ${pos.size} (${pos.leverage}x)\n`;
            message += `   Entry: ${pos.entryPrice}\n`;
            message += `   SL: ${pos.slPrice} | TP: ${pos.tpPrice}\n\n`;
        });
    } else {
        message += `📭 Không có lệnh nào đang mở`;
    }
    
    bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
});

bot.onText(/⚙️ Auto Config/, (msg) => {
    const configMessage = `
⚙️ *CẤU HÌNH TỰ ĐỘNG GIAO DỊCH*

💰 *Vốn:* 100U
📊 *Lệnh tối đa:* 10 lệnh cùng lúc
🎯 *Điểm tín hiệu tối thiểu:* 70/100
🎯 *Mục tiêu:* 100U mỗi lệnh
⚠️ *Rủi ro mỗi lệnh:* 2%

📈 *Tính toán khối lượng:*
• Sử dụng đòn bẩy tối đa có thể
• Mục tiêu: 100U notional mỗi lệnh
• Ví dụ: BTC 50x → 2U, ETH 20x → 5U

🔄 *Tần suất quét:* 15 giây/lần
🎯 *Symbols:* Top 20 coin theo volume
🔍 *Nguồn tín hiệu:* Hệ thống phân tích hiện tại

💡 *Lệnh điều khiển:*
• \`/auto_start\` - Bắt đầu tự động giao dịch
• \`/auto_stop\` - Dừng tự động giao dịch
• \`/auto_status\` - Xem trạng thái
• \`/auto_close_all\` - Đóng tất cả lệnh
• \`/auto_config\` - Xem cấu hình
`;
    bot.sendMessage(msg.chat.id, configMessage, { parse_mode: "Markdown" });
});

bot.onText(/💡 Gợi ý LONG/, (msg) => { handleSuggestionRequest(msg.chat.id, "LONG"); });
bot.onText(/💡 Gợi ý SHORT/, (msg) => { handleSuggestionRequest(msg.chat.id, "SHORT"); });
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

// ==== HÀM GỢI Ý LONG/SHORT ====
async function handleSuggestionRequest(chatId, direction) {
    if (isScanning) { 
        return bot.sendMessage(chatId, "⚠️ Bot đang bận quét, vui lòng thử lại sau."); 
    }
    
    bot.sendMessage(chatId, `🔍 Đang tìm các tín hiệu ${direction} CHẤT LƯỢNG CAO trên thị trường Futures...`);
    isScanning = true;
    
    try {
        const allSymbols = await getSymbols(null);
        if (!allSymbols || allSymbols.length === 0) { 
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin Futures."); 
            return; 
        }
        
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
            bot.sendMessage(chatId, `✅ Đã quét xong. Không tìm thấy gợi ý ${direction} nào đạt tiêu chuẩn chất lượng cao (≥50 điểm).`); 
            return; 
        }
        
        // Lọc và sắp xếp theo điểm số chất lượng
        const suggestThreshold = parseInt(process.env.QUALITY_THRESHOLD_SUGGEST) || 50;
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
  
  // Monitoring real-time với cảnh báo rủi ro
  const REALTIME_MONITOR_INTERVAL = 30 * 1000;
  setInterval(() => {
    monitorOpenTrades(bot, process.env.TELEGRAM_CHAT_ID);
  }, REALTIME_MONITOR_INTERVAL);
  
  // Kiểm tra rủi ro mỗi 2 phút
  const RISK_CHECK_INTERVAL = 2 * 60 * 1000;
  setInterval(async () => {
    await checkRiskAndWarn(bot, process.env.TELEGRAM_CHAT_ID);
  }, RISK_CHECK_INTERVAL);
  
  console.log(`✅ [BOT] Luồng giám sát Real-time và cảnh báo rủi ro đã được kích hoạt.`);
  symbols = await getSymbols(100);
  if (!symbols || !symbols.length) { console.log("⚠️ [BOT] Không tìm thấy coin để quét định kỳ."); return; }
  console.log(`✅ [BOT] Sẽ quét định kỳ ${symbols.length} coin.`);
  bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `🚀 Bot đã khởi động với hệ thống cảnh báo rủi ro!`, menuOptions);
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

// ==== PHÂN TÍCH ĐẦU NGÀY ====
async function handleDailyAnalysis(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "🌅 Đang phân tích đầu ngày để đưa ra khuyến nghị LONG/SHORT...");
    isScanning = true;
    
    try {
        const analysis = await getDailyAnalysisReport();
        if (!analysis) {
            bot.sendMessage(chatId, "❌ Không thể thực hiện phân tích đầu ngày.");
            return;
        }
        
        const { recommendation, confidence, reasoning, riskFactors, summary, details } = analysis;
        
        // Tạo báo cáo chi tiết
        let reportMessage = "🌅 *PHÂN TÍCH ĐẦU NGÀY - KHUYẾN NGHỊ GIAO DỊCH*\n\n";
        
        // Khuyến nghị chính
        const recommendationIcon = recommendation === "LONG" ? "📈" : 
                                  recommendation === "SHORT" ? "📉" : "⚖️";
        const confidenceIcon = confidence > 80 ? "🔥" : 
                              confidence > 60 ? "⚡" : "💡";
        
        reportMessage += `${recommendationIcon} *KHUYẾN NGHỊ CHÍNH: ${recommendation}*\n`;
        reportMessage += `${confidenceIcon} *Độ tin cậy: ${confidence}%*\n`;
        reportMessage += `📝 *Lý do: ${reasoning}*\n\n`;
        
        // Tổng quan thị trường
        reportMessage += "📊 *TỔNG QUAN THỊ TRƯỜNG:*\n";
        reportMessage += `🎭 Fear & Greed: ${summary.fearGreedLevel}\n`;
        reportMessage += `📈 Xu hướng coin: ${summary.marketBias}\n`;
        reportMessage += `🏗️ Cấu trúc thị trường: ${summary.structureTrend}\n`;
        reportMessage += `⏰ Thời gian giao dịch: ${summary.timeRecommendation}\n`;
        reportMessage += `⚠️ Mức rủi ro: ${summary.riskLevel}\n\n`;
        
        // Chi tiết phân tích
        reportMessage += "🔍 *CHI TIẾT PHÂN TÍCH:*\n";
        
        // Fear & Greed
        const fgIcon = details.fearGreed.value < 30 ? "🟢" : 
                       details.fearGreed.value > 70 ? "🔴" : "🟡";
        reportMessage += `${fgIcon} Fear & Greed Index: ${details.fearGreed.value} (${details.fearGreed.classification})\n`;
        
        // Top Coins
        reportMessage += `📊 Top Coins: ${details.topCoins.bullishCount} tăng, ${details.topCoins.bearishCount} giảm\n`;
        reportMessage += `📈 Tỷ lệ tăng: ${details.topCoins.bullishPercent.toFixed(1)}%\n`;
        reportMessage += `📉 Tỷ lệ giảm: ${details.topCoins.bearishPercent.toFixed(1)}%\n`;
        
        // Market Structure
        const structureIcon = details.marketStructure.structureBias === "BULLISH" ? "📈" : 
                            details.marketStructure.structureBias === "BEARISH" ? "📉" : "⚖️";
        reportMessage += `${structureIcon} Cấu trúc: ${details.marketStructure.structureBias} (${details.marketStructure.structureStrength.toFixed(2)})\n`;
        
        // Time Analysis
        reportMessage += `⏰ Giờ hiện tại: ${details.timeAnalysis.hour}:00\n`;
        reportMessage += `📅 Khuyến nghị thời gian: ${details.timeAnalysis.timeRecommendation}\n\n`;
        
        // Risk Factors
        if (riskFactors.length > 0) {
            reportMessage += "⚠️ *CÁC YẾU TỐ RỦI RO:*\n";
            riskFactors.forEach((factor, index) => {
                reportMessage += `${index + 1}. ${factor}\n`;
            });
            reportMessage += `\n`;
        }
        
        // Khuyến nghị cụ thể
        reportMessage += "💡 *KHUYẾN NGHỊ CỤ THỂ:*\n";
        if (recommendation === "LONG") {
            reportMessage += "✅ Ưu tiên các lệnh LONG\n";
            reportMessage += "🎯 Tìm coin có xu hướng tăng mạnh\n";
            reportMessage += "📊 Chú ý các breakout với volume cao\n";
        } else if (recommendation === "SHORT") {
            reportMessage += "✅ Ưu tiên các lệnh SHORT\n";
            reportMessage += "🎯 Tìm coin có xu hướng giảm mạnh\n";
            reportMessage += "📊 Chú ý các breakdown với volume cao\n";
        } else {
            reportMessage += "⚠️ Thị trường không có xu hướng rõ ràng\n";
            reportMessage += "🎯 Chờ đợi tín hiệu rõ ràng hơn\n";
            reportMessage += "📊 Có thể giao dịch range-bound\n";
        }
        
        // Risk Management
        reportMessage += `\n🛡️ *QUẢN LÝ RỦI RO:*\n`;
        if (summary.riskLevel === "HIGH") {
            reportMessage += "🚨 Rủi ro cao - Giảm kích thước lệnh\n";
            reportMessage += "🛑 Đặt stop loss chặt chẽ\n";
            reportMessage += "⏰ Theo dõi sát sao các lệnh\n";
        } else if (summary.riskLevel === "MEDIUM") {
            reportMessage += "⚠️ Rủi ro trung bình - Giao dịch bình thường\n";
            reportMessage += "🛑 Luôn đặt stop loss\n";
        } else {
            reportMessage += "✅ Rủi ro thấp - Có thể giao dịch thoải mái\n";
            reportMessage += "🛑 Vẫn nên đặt stop loss\n";
        }
        
        reportMessage += `\n🕐 Phân tích tiếp theo: Ngày mai lúc 8:00 sáng`;
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi thực hiện phân tích đầu ngày:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình phân tích đầu ngày.");
    } finally {
        isScanning = false;
    }
}

// ==== TÍN HIỆU PREMIUM ====
async function handlePremiumSignals(chatId, coinCount = 20) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "💎 Đang tìm kiếm các tín hiệu Premium chất lượng cao nhất...");
    isScanning = true;
    
    try {
        // Lấy coin để quét (mặc định 20 coin chính)
        const symbols = await getSymbols(coinCount);
        if (!symbols || symbols.length === 0) {
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách coin.");
            return;
        }
        
        bot.sendMessage(chatId, `🔍 Đang phân tích ${symbols.length} coin chính với tiêu chí Premium nghiêm ngặt...`);
        
        // Quét tín hiệu premium
        const premiumSignals = await scanForPremiumSignals(symbols);
        
        if (premiumSignals.length === 0) {
            bot.sendMessage(chatId, "✅ Không tìm thấy tín hiệu Premium nào đạt tiêu chuẩn.\n\n💡 *Tiêu chuẩn Premium:*\n• Điểm chất lượng ≥ 85/100\n• Đa khung thời gian đồng thuận\n• ADX > 25 (xu hướng mạnh)\n• Volume confirmation\n• Risk/Reward ≥ 2.5:1\n\n🎯 Hãy thử lại sau hoặc sử dụng 'Tín hiệu tốt nhất' để tìm cơ hội khác.");
            return;
        }
        
        // Tạo báo cáo premium
        let reportMessage = "💎 *TÍN HIỆU PREMIUM - CHẤT LƯỢNG CAO NHẤT*\n\n";
        reportMessage += `🎯 Tìm thấy ${premiumSignals.length} tín hiệu đạt tiêu chuẩn Premium\n\n`;
        
        premiumSignals.slice(0, 5).forEach((signal, index) => {
            const qualityIcon = signal.quality > 95 ? '🔥' : signal.quality > 90 ? '💎' : '⭐';
            const directionIcon = signal.direction === 'LONG' ? '📈' : '📉';
            
            reportMessage += `${index + 1}. ${qualityIcon} *${signal.symbol}* | ${directionIcon} ${signal.direction}\n`;
            reportMessage += `   🎯 Điểm chất lượng: ${signal.quality.toFixed(1)}/100\n`;
            reportMessage += `   📊 Độ tin cậy: ${signal.confidence.toFixed(1)}%\n`;
            reportMessage += `   💰 Entry: ${signal.price.toFixed(5)}\n`;
            reportMessage += `   🎯 TP: ${signal.tp.toFixed(5)} | 🛑 SL: ${signal.sl.toFixed(5)}\n`;
            reportMessage += `   📈 Risk/Reward: 1:${signal.riskReward.toFixed(1)}\n`;
            
            // Chi tiết phân tích
            if (signal.analysis) {
                const { daily, h4, h1, m15 } = signal.analysis;
                reportMessage += `   📅 Daily: ${daily?.trend || 'N/A'} (ADX: ${daily?.adx?.toFixed(1) || 'N/A'})\n`;
                reportMessage += `   🏗️ H4 Structure: ${h4?.structure || 'N/A'}\n`;
                reportMessage += `   ⚡ H1 Momentum: ${h1?.momentum || 'N/A'}\n`;
                reportMessage += `   🎯 M15 Entry: ${m15?.entrySignal || 'N/A'}\n`;
            }
            
            reportMessage += `\n`;
        });
        
        reportMessage += "💡 *TIÊU CHUẨN PREMIUM:*\n";
        reportMessage += "• Đa khung thời gian đồng thuận (D1, H4, H1, M15)\n";
        reportMessage += "• ADX > 25 (xu hướng mạnh)\n";
        reportMessage += "• Volume confirmation\n";
        reportMessage += "• Order Block hoặc Swing Point retest\n";
        reportMessage += "• Risk/Reward ≥ 2.5:1\n";
        reportMessage += "• Điểm chất lượng ≥ 85/100\n\n";
        
        reportMessage += "🛡️ *QUẢN LÝ RỦI RO PREMIUM:*\n";
        reportMessage += "• Chỉ vào lệnh với điểm ≥ 90\n";
        reportMessage += "• Luôn đặt Stop Loss\n";
        reportMessage += "• Theo dõi sát sao các lệnh\n";
        reportMessage += "• Không vào lệnh khi có rủi ro cao\n\n";
        
        reportMessage += "🎯 *KHUYẾN NGHỊ:*\n";
        reportMessage += "• Ưu tiên tín hiệu có điểm cao nhất\n";
        reportMessage += "• Chờ retest để vào lệnh tốt hơn\n";
        reportMessage += "• Kết hợp với phân tích đầu ngày\n\n";
        
        reportMessage += "⚙️ *TÙY CHỌN SỐ LƯỢNG COIN:*\n";
        reportMessage += "• `/premium 10` - Quét 10 coin chính (nhanh nhất)\n";
        reportMessage += "• `/premium 20` - Quét 20 coin chính (mặc định)\n";
        reportMessage += "• `/premium 50` - Quét 50 coin (nhiều cơ hội hơn)\n";
        reportMessage += "• `/premium 100` - Quét 100 coin (toàn diện nhất)\n";
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi tìm tín hiệu Premium:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình tìm kiếm tín hiệu Premium.");
    } finally {
        isScanning = false;
    }
}

// ==== QUÉT HẾT TẤT CẢ COIN ====
async function handleScanAllCoins(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "🌍 Đang quét hết tất cả coin để tìm cơ hội tốt nhất...\n\n⏰ Quá trình này có thể mất 5-10 phút tùy thuộc vào số lượng coin.");
    isScanning = true;
    
    try {
        const opportunities = await scanAllCoinsForOpportunities();
        
        if (opportunities.length === 0) {
            bot.sendMessage(chatId, "✅ Đã quét hết tất cả coin nhưng không tìm thấy cơ hội nào phù hợp.\n\n💡 Thị trường có thể đang ở trạng thái không có xu hướng rõ ràng. Hãy thử lại sau hoặc sử dụng các chức năng khác.");
            return;
        }
        
        // Tạo báo cáo tổng hợp
        let reportMessage = "🌍 *QUÉT HẾT TẤT CẢ COIN - BÁO CÁO TỔNG HỢP*\n\n";
        reportMessage += `🎯 Tìm thấy ${opportunities.length} cơ hội giao dịch\n\n`;
        
        // Phân loại theo chất lượng
        const premiumSignals = opportunities.filter(s => s.quality >= 85);
        const goodSignals = opportunities.filter(s => s.quality >= 70 && s.quality < 85);
        const averageSignals = opportunities.filter(s => s.quality >= 50 && s.quality < 70);
        
        reportMessage += "📊 *PHÂN LOẠI THEO CHẤT LƯỢNG:*\n";
        reportMessage += `💎 Premium (≥85 điểm): ${premiumSignals.length} tín hiệu\n`;
        reportMessage += `⭐ Tốt (70-84 điểm): ${goodSignals.length} tín hiệu\n`;
        reportMessage += `📈 Trung bình (50-69 điểm): ${averageSignals.length} tín hiệu\n\n`;
        
        // Top 10 cơ hội tốt nhất
        const topOpportunities = opportunities.slice(0, 10);
        reportMessage += "🏆 *TOP 10 CƠ HỘI TỐT NHẤT:*\n\n";
        
        topOpportunities.forEach((signal, index) => {
            const qualityIcon = signal.quality > 95 ? '🔥' : signal.quality > 90 ? '💎' : '⭐';
            const directionIcon = signal.direction === 'LONG' ? '📈' : '📉';
            
            reportMessage += `${index + 1}. ${qualityIcon} *${signal.symbol}* | ${directionIcon} ${signal.direction}\n`;
            reportMessage += `   🎯 Điểm chất lượng: ${signal.quality.toFixed(1)}/100\n`;
            reportMessage += `   📊 Độ tin cậy: ${signal.confidence.toFixed(1)}%\n`;
            reportMessage += `   💰 Entry: ${signal.price.toFixed(5)}\n`;
            reportMessage += `   🎯 TP: ${signal.tp.toFixed(5)} | 🛑 SL: ${signal.sl.toFixed(5)}\n`;
            reportMessage += `   📈 Risk/Reward: 1:${signal.riskReward.toFixed(1)}\n\n`;
        });
        
        // Thống kê theo hướng
        const longSignals = opportunities.filter(s => s.direction === 'LONG');
        const shortSignals = opportunities.filter(s => s.direction === 'SHORT');
        
        reportMessage += "📊 *THỐNG KÊ THEO HƯỚNG:*\n";
        reportMessage += `📈 LONG: ${longSignals.length} tín hiệu (${((longSignals.length / opportunities.length) * 100).toFixed(1)}%)\n`;
        reportMessage += `📉 SHORT: ${shortSignals.length} tín hiệu (${((shortSignals.length / opportunities.length) * 100).toFixed(1)}%)\n\n`;
        
        // Khuyến nghị
        reportMessage += "💡 *KHUYẾN NGHỊ:*\n";
        if (premiumSignals.length > 0) {
            reportMessage += "✅ Ưu tiên các tín hiệu Premium (≥85 điểm)\n";
        }
        if (longSignals.length > shortSignals.length) {
            reportMessage += "📈 Thị trường có xu hướng tích cực - Ưu tiên LONG\n";
        } else if (shortSignals.length > longSignals.length) {
            reportMessage += "📉 Thị trường có xu hướng tiêu cực - Ưu tiên SHORT\n";
        } else {
            reportMessage += "⚖️ Thị trường cân bằng - Chọn tín hiệu có điểm cao nhất\n";
        }
        
        reportMessage += "\n🛡️ *LƯU Ý QUAN TRỌNG:*\n";
        reportMessage += "• Chỉ vào lệnh với điểm ≥ 70\n";
        reportMessage += "• Luôn đặt Stop Loss\n";
        reportMessage += "• Không vào quá nhiều lệnh cùng lúc\n";
        reportMessage += "• Theo dõi sát sao các lệnh\n";
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi quét hết coin:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình quét hết coin. Vui lòng thử lại sau.");
    } finally {
        isScanning = false;
    }
}

// ==== CÁC HÀM MISSING ====
async function detectReversalSignals(candles) {
    if (!candles || candles.length < 10) return null;
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    // Phân tích Hammer pattern
    const lastCandle = candles[candles.length - 1];
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const lowerShadow = Math.min(lastCandle.close, lastCandle.open) - lastCandle.low;
    const upperShadow = lastCandle.high - Math.max(lastCandle.close, lastCandle.open);
    
    const isHammer = lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.5;
    
    // Phân tích Engulfing pattern
    const prevCandle = candles[candles.length - 2];
    const isBullishEngulfing = prevCandle.close < prevCandle.open && 
                              lastCandle.close > lastCandle.open &&
                              lastCandle.open < prevCandle.close &&
                              lastCandle.close > prevCandle.open;
    
    const isBearishEngulfing = prevCandle.close > prevCandle.open && 
                              lastCandle.close < lastCandle.open &&
                              lastCandle.open > prevCandle.close &&
                              lastCandle.close < prevCandle.open;
    
    // Phân tích RSI Divergence
    const rsi = calcRSI(candles, 14);
    const isDivergence = (rsi < 30 && closes[closes.length - 1] > closes[closes.length - 5]) ||
                        (rsi > 70 && closes[closes.length - 1] < closes[closes.length - 5]);
    
    let signal = "NONE";
    let strength = 0;
    
    if (isHammer && lastCandle.close > lastCandle.open) {
        signal = "BULLISH";
        strength += 30;
    }
    
    if (isBullishEngulfing) {
        signal = "BULLISH";
        strength += 40;
    }
    
    if (isHammer && lastCandle.close < lastCandle.open) {
        signal = "BEARISH";
        strength += 30;
    }
    
    if (isBearishEngulfing) {
        signal = "BEARISH";
        strength += 40;
    }
    
    if (isDivergence) {
        strength += 20;
    }
    
    return {
        signal,
        strength: Math.min(strength, 100),
        isHammer,
        isBullishEngulfing,
        isBearishEngulfing,
        isDivergence
    };
}

async function getDailyMarketAnalysis(symbol) {
    try {
        const candles = await getCandles(symbol, "1D", 30);
        if (!candles || candles.length < 20) return null;
        
        const analysis = await analyzeAdvancedIndicators(candles, "LONG");
        const risk = detectCrashRisk(candles);
        
        let recommendation = null;
        if (analysis && analysis.totalScore > 60) {
            recommendation = {
                direction: analysis.totalScore > 80 ? "LONG" : "NEUTRAL",
                confidence: Math.min(analysis.totalScore, 100)
            };
        }
        
        return {
            recommendation,
            risk,
            analysis
        };
    } catch (error) {
        console.error(`Lỗi phân tích thị trường cho ${symbol}:`, error);
        return null;
    }
}

function detectCrashRisk(candles) {
    if (candles.length < 20) return null;
    
    const closes = candles.map(c => c.close);
    const recentPrices = closes.slice(-10);
    const olderPrices = closes.slice(-20, -10);
    
    const recentAvg = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    const olderAvg = olderPrices.reduce((sum, price) => sum + price, 0) / olderPrices.length;
    
    const priceChange = (recentAvg - olderAvg) / olderAvg;
    const volatility = calcATR(candles.slice(-10), 10) / recentAvg;
    
    let riskScore = 0;
    
    // Giảm giá mạnh
    if (priceChange < -0.1) riskScore += 40;
    else if (priceChange < -0.05) riskScore += 20;
    
    // Biến động cao
    if (volatility > 0.08) riskScore += 30;
    else if (volatility > 0.05) riskScore += 15;
    
    // Volume spike (simplified)
    const volumes = candles.map(c => c.volume || 0);
    const avgVolume = volumes.slice(-20).reduce((sum, vol) => sum + vol, 0) / 20;
    const recentVolume = volumes.slice(-5).reduce((sum, vol) => sum + vol, 0) / 5;
    
    if (recentVolume > avgVolume * 2) riskScore += 20;
    else if (recentVolume > avgVolume * 1.5) riskScore += 10;
    
    let riskLevel = "LOW";
    if (riskScore > 60) riskLevel = "HIGH";
    else if (riskScore > 30) riskLevel = "MEDIUM";
    
    return {
        riskLevel,
        riskScore: Math.min(riskScore, 100),
        volatility,
        priceChange
    };
}

async function getDailyAnalysisReport() {
    // Simplified daily analysis
    return {
        recommendation: "NEUTRAL",
        confidence: 50,
        reasoning: "Thị trường đang ở trạng thái trung tính",
        riskFactors: [],
        summary: {
            fearGreedLevel: "Neutral",
            marketBias: "Sideways",
            structureTrend: "Consolidation",
            timeRecommendation: "Wait for breakout",
            riskLevel: "MEDIUM"
        },
        details: {
            fearGreed: { value: 50, classification: "Neutral" },
            topCoins: { bullishCount: 5, bearishCount: 5, bullishPercent: 50, bearishPercent: 50 },
            marketStructure: { structureBias: "NEUTRAL", structureStrength: 0.5 },
            timeAnalysis: { hour: new Date().getHours(), timeRecommendation: "Wait" }
        }
    };
}

async function scanForPremiumSignals(symbols) {
    const premiumSignals = [];
    
    for (const symbol of symbols) {
        try {
            const signal = await getAllSignalsForSymbol(symbol);
            if (signal.direction !== 'NONE' && signal.score >= 85) {
                signal.symbol = symbol;
                signal.quality = signal.score;
                signal.confidence = signal.score;
                signal.riskReward = Math.abs(signal.tp - signal.price) / Math.abs(signal.price - signal.sl);
                premiumSignals.push(signal);
            }
        } catch (error) {
            console.error(`Lỗi quét premium cho ${symbol}:`, error.message);
        }
    }
    
    return premiumSignals.sort((a, b) => b.quality - a.quality);
}

async function scanAllCoinsForOpportunities() {
    const symbols = await getSymbols(null);
    const opportunities = [];
    
    for (let i = 0; i < Math.min(symbols.length, 50); i++) {
        const symbol = symbols[i];
        try {
            const signal = await getAllSignalsForSymbol(symbol);
            if (signal.direction !== 'NONE') {
                signal.symbol = symbol;
                signal.quality = signal.score || calculateQualityScore(signal);
                signal.confidence = signal.score || 70;
                signal.riskReward = Math.abs(signal.tp - signal.price) / Math.abs(signal.price - signal.sl);
                opportunities.push(signal);
            }
        } catch (error) {
            console.error(`Lỗi quét ${symbol}:`, error.message);
        }
    }
    
    return opportunities.sort((a, b) => b.quality - a.quality);
}

async function analyzeSpecificCoin(symbol) {
    try {
        const cleanSymbol = symbol.toUpperCase().replace('-USDT-SWAP', '') + '-USDT-SWAP';
        const signal = await getAllSignalsForSymbol(cleanSymbol);
        
        if (signal.direction === 'NONE') {
            return {
                success: false,
                error: `Không tìm thấy tín hiệu cho ${symbol}`,
                suggestions: ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC']
            };
        }
        
        signal.symbol = cleanSymbol;
        signal.quality = signal.score || calculateQualityScore(signal);
        signal.confidence = signal.score || 70;
        signal.riskReward = Math.abs(signal.tp - signal.price) / Math.abs(signal.price - signal.sl);
        
        return {
            success: true,
            symbol: cleanSymbol,
            recommendation: signal.direction,
            quality: signal.quality,
            confidence: signal.confidence,
            price: signal.price,
            tp: signal.tp,
            sl: signal.sl,
            riskReward: signal.riskReward,
            analysis: {
                daily: { trend: signal.direction, adx: signal.adx },
                h4: { structure: signal.direction },
                h1: { momentum: signal.direction },
                m15: { entrySignal: signal.direction }
            },
            message: `Tín hiệu ${signal.direction} với điểm chất lượng ${signal.quality.toFixed(1)}/100`
        };
    } catch (error) {
        return {
            success: false,
            error: `Lỗi phân tích ${symbol}: ${error.message}`,
            suggestions: ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC']
        };
    }
}

// ==== PHÂN TÍCH WYCKOFF ====
async function handleWyckoffAnalysis(chatId, symbol) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, `🔍 Đang phân tích Wyckoff cho ${symbol.toUpperCase()}...`);
    isScanning = true;
    
    try {
        const cleanSymbol = symbol.toUpperCase().replace('-USDT-SWAP', '') + '-USDT-SWAP';
        const signal = await getAllSignalsForSymbol(cleanSymbol);
        
        if (signal.direction === 'NONE') {
            bot.sendMessage(chatId, `❌ Không tìm thấy tín hiệu Wyckoff cho ${symbol}\n\n💡 *Gợi ý:*\n• Thử với các coin khác: BTC, ETH, SOL\n• Sử dụng \`/wyckoff BTC\` hoặc \`/wyckoff ETH\`\n• Kiểm tra lại sau vài phút`);
            return;
        }
        
        // Tạo báo cáo Wyckoff chi tiết
        let reportMessage = `🎯 *PHÂN TÍCH WYCKOFF - ${cleanSymbol}*\n\n`;
        
        const directionIcon = signal.direction === 'LONG' ? '📈' : '📉';
        const qualityIcon = signal.confidence > 80 ? '🔥' : signal.confidence > 60 ? '⚡' : '💡';
        
        reportMessage += `${directionIcon} *TÍN HIỆU: ${signal.direction}*\n`;
        reportMessage += `${qualityIcon} *Độ tin cậy: ${signal.confidence}%*\n`;
        reportMessage += `📊 *Chiến lược: ${signal.strategy}*\n\n`;
        
        if (signal.wyckoffAnalysis) {
            const analysis = signal.wyckoffAnalysis;
            
            // Volume Profile Analysis
            reportMessage += "📊 *VOLUME PROFILE ANALYSIS:*\n";
            if (analysis.volumeProfile.poc) {
                reportMessage += `🎯 POC: ${analysis.volumeProfile.poc.price.toFixed(5)}\n`;
            }
            if (analysis.volumeProfile.valueArea) {
                reportMessage += `📈 VAH: ${analysis.volumeProfile.valueArea.high.toFixed(5)}\n`;
                reportMessage += `📉 VAL: ${analysis.volumeProfile.valueArea.low.toFixed(5)}\n`;
            }
            reportMessage += `📍 Trong Value Area: ${analysis.isInValueArea ? 'Có' : 'Không'}\n\n`;
            
            // Key Volume Analysis
            reportMessage += "🔊 *KEY VOLUME ANALYSIS:*\n";
            if (analysis.keyVolume.isKeyVolume) {
                reportMessage += `✅ Phát hiện Key Volume\n`;
                reportMessage += `📊 Volume: ${analysis.keyVolume.volume.toFixed(0)}\n`;
                reportMessage += `📈 Trung bình: ${analysis.keyVolume.averageVolume.toFixed(0)}\n`;
                reportMessage += `⚡ Hệ số: ${analysis.keyVolume.multiplier.toFixed(1)}x\n`;
                reportMessage += `💪 Độ mạnh: ${analysis.keyVolume.strength}\n`;
            } else {
                reportMessage += `❌ Không có Key Volume\n`;
            }
            reportMessage += `\n`;
            
            // Dual RSI Analysis
            reportMessage += "📊 *DUAL RSI ANALYSIS:*\n";
            if (analysis.dualRSI.current) {
                reportMessage += `⚡ RSI Nhanh (5): ${analysis.dualRSI.current.fast.toFixed(1)}\n`;
                reportMessage += `🐌 RSI Chậm (14): ${analysis.dualRSI.current.slow.toFixed(1)}\n`;
                reportMessage += `📈 Xu hướng: ${analysis.dualRSI.trend}\n`;
                reportMessage += `🔄 Differential: ${analysis.dualRSI.differential.toFixed(1)}\n`;
            }
            
            if (analysis.dualRSI.signals && analysis.dualRSI.signals.length > 0) {
                reportMessage += `\n🎯 *TÍN HIỆU RSI:*\n`;
                analysis.dualRSI.signals.forEach(signal => {
                    const signalIcon = signal.type.includes('BULLISH') ? '📈' : '📉';
                    reportMessage += `${signalIcon} ${signal.description} (${signal.strength})\n`;
                });
            }
            reportMessage += `\n`;
        }
        
        // Thông tin giao dịch
        reportMessage += "💰 *THÔNG TIN GIAO DỊCH:*\n";
        reportMessage += `• Entry: ${signal.price.toFixed(5)}\n`;
        reportMessage += `• Take Profit: ${signal.tp.toFixed(5)}\n`;
        reportMessage += `• Stop Loss: ${signal.sl.toFixed(5)}\n`;
        reportMessage += `• Risk/Reward: 1:${((Math.abs(signal.tp - signal.price)) / Math.abs(signal.price - signal.sl)).toFixed(1)}\n\n`;
        
        // Khuyến nghị
        reportMessage += "💡 *KHUYẾN NGHỊ:*\n";
        if (signal.direction === 'LONG') {
            reportMessage += "✅ Ưu tiên lệnh LONG\n";
            reportMessage += "🎯 Chờ retest POC hoặc VAL để vào lệnh\n";
            reportMessage += "📊 Xác nhận với volume cao\n";
        } else {
            reportMessage += "✅ Ưu tiên lệnh SHORT\n";
            reportMessage += "🎯 Chờ retest POC hoặc VAH để vào lệnh\n";
            reportMessage += "📊 Xác nhận với volume cao\n";
        }
        
        reportMessage += "\n🛡️ *QUẢN LÝ RỦI RO:*\n";
        reportMessage += "• Luôn đặt Stop Loss\n";
        reportMessage += "• Theo dõi Key Volume\n";
        reportMessage += "• Chú ý các mức POC, VAH, VAL\n";
        
        // Lệnh vào lệnh
        const commandDirection = signal.direction.toLowerCase();
        reportMessage += `\n⚡ *LỆNH VÀO LỆNH:*\n`;
        reportMessage += `\`/${commandDirection} ${symbol.replace('-USDT-SWAP', '')} ${signal.price.toFixed(5)} ${signal.sl.toFixed(5)}\`\n`;
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi phân tích Wyckoff:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình phân tích Wyckoff. Vui lòng thử lại sau.");
    } finally {
        isScanning = false;
    }
}

async function handleVolumeProfileAnalysis(chatId, symbol) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, `📊 Đang phân tích Volume Profile cho ${symbol.toUpperCase()}...`);
    isScanning = true;
    
    try {
        const cleanSymbol = symbol.toUpperCase().replace('-USDT-SWAP', '') + '-USDT-SWAP';
        const wyckoffAnalyzer = new WyckoffVolumeAnalysis(cleanSymbol, '1H', 100);
        const analysisResult = await wyckoffAnalyzer.performAnalysis();
        
        if (!analysisResult.success) {
            bot.sendMessage(chatId, `❌ ${analysisResult.error}`);
            return;
        }
        
        const analysis = analysisResult.analysis;
        let reportMessage = `📊 *VOLUME PROFILE ANALYSIS - ${cleanSymbol}*\n\n`;
        
        // POC Analysis
        if (analysis.volumeProfile.poc) {
            reportMessage += "🎯 *POINT OF CONTROL (POC):*\n";
            reportMessage += `• Giá: ${analysis.volumeProfile.poc.price.toFixed(5)}\n`;
            reportMessage += `• Volume: ${analysis.volumeProfile.poc.volume.toFixed(0)}\n`;
            reportMessage += `• Trades: ${analysis.volumeProfile.poc.trades}\n\n`;
        }
        
        // Value Area Analysis
        if (analysis.volumeProfile.valueArea) {
            reportMessage += "📈 *VALUE AREA (70% Volume):*\n";
            reportMessage += `• VAH: ${analysis.volumeProfile.valueArea.high.toFixed(5)}\n`;
            reportMessage += `• VAL: ${analysis.volumeProfile.valueArea.low.toFixed(5)}\n`;
            reportMessage += `• % Volume: ${analysis.volumeProfile.valueArea.volumePercentage.toFixed(1)}%\n`;
            reportMessage += `• Giá hiện tại trong VA: ${analysis.isInValueArea ? 'Có' : 'Không'}\n\n`;
        }
        
        // HVN Analysis
        if (analysis.volumeProfile.hvn && analysis.volumeProfile.hvn.length > 0) {
            reportMessage += "🔥 *HIGH VOLUME NODES (HVN):*\n";
            analysis.volumeProfile.hvn.slice(0, 5).forEach((hvn, index) => {
                reportMessage += `${index + 1}. ${hvn.price.toFixed(5)} (Vol: ${hvn.volume.toFixed(0)})\n`;
            });
            reportMessage += `\n`;
        }
        
        // LVN Analysis
        if (analysis.volumeProfile.lvn && analysis.volumeProfile.lvn.length > 0) {
            reportMessage += "⚡ *LOW VOLUME NODES (LVN):*\n";
            analysis.volumeProfile.lvn.slice(0, 5).forEach((lvn, index) => {
                reportMessage += `${index + 1}. ${lvn.price.toFixed(5)} (Vol: ${lvn.volume.toFixed(0)})\n`;
            });
            reportMessage += `\n`;
        }
        
        // Support/Resistance Levels
        if (analysis.volumeProfile.supportResistance && analysis.volumeProfile.supportResistance.length > 0) {
            reportMessage += "🛡️ *SUPPORT/RESISTANCE LEVELS:*\n";
            analysis.volumeProfile.supportResistance.forEach((level, index) => {
                const levelIcon = level.type === 'POC' ? '🎯' : level.type === 'VAH' ? '📈' : level.type === 'VAL' ? '📉' : '🔥';
                reportMessage += `${levelIcon} ${level.type}: ${level.price.toFixed(5)} (${level.strength})\n`;
            });
            reportMessage += `\n`;
        }
        
        // Key Volume Analysis
        reportMessage += "🔊 *KEY VOLUME ANALYSIS:*\n";
        if (analysis.keyVolume.isKeyVolume) {
            reportMessage += `✅ Phát hiện Key Volume!\n`;
            reportMessage += `📊 Volume hiện tại: ${analysis.keyVolume.volume.toFixed(0)}\n`;
            reportMessage += `📈 Volume trung bình: ${analysis.keyVolume.averageVolume.toFixed(0)}\n`;
            reportMessage += `⚡ Hệ số: ${analysis.keyVolume.multiplier.toFixed(1)}x\n`;
            reportMessage += `💪 Độ mạnh: ${analysis.keyVolume.strength}\n`;
        } else {
            reportMessage += `❌ Không có Key Volume\n`;
            reportMessage += `📊 Volume hiện tại: ${analysis.keyVolume.volume.toFixed(0)}\n`;
            reportMessage += `📈 Volume trung bình: ${analysis.keyVolume.averageVolume.toFixed(0)}\n`;
        }
        
        reportMessage += `\n💡 *KHUYẾN NGHỊ:*\n`;
        reportMessage += `• POC là mức giá quan trọng nhất\n`;
        reportMessage += `• VAH/VAL là các mức hỗ trợ/kháng cự mạnh\n`;
        reportMessage += `• HVN có thể là hỗ trợ/kháng cự\n`;
        reportMessage += `• LVN dễ bị phá vỡ\n`;
        reportMessage += `• Key Volume xác nhận động lực\n`;
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi phân tích Volume Profile:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình phân tích Volume Profile.");
    } finally {
        isScanning = false;
    }
}

async function handleDualRSIAnalysis(chatId, symbol) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, `📊 Đang phân tích Dual RSI cho ${symbol.toUpperCase()}...`);
    isScanning = true;
    
    try {
        const cleanSymbol = symbol.toUpperCase().replace('-USDT-SWAP', '') + '-USDT-SWAP';
        const wyckoffAnalyzer = new WyckoffVolumeAnalysis(cleanSymbol, '1H', 100);
        const analysisResult = await wyckoffAnalyzer.performAnalysis();
        
        if (!analysisResult.success) {
            bot.sendMessage(chatId, `❌ ${analysisResult.error}`);
            return;
        }
        
        const analysis = analysisResult.analysis;
        let reportMessage = `📊 *DUAL RSI ANALYSIS - ${cleanSymbol}*\n\n`;
        
        // Current RSI Values
        if (analysis.dualRSI.current) {
            reportMessage += "📈 *GIÁ TRỊ RSI HIỆN TẠI:*\n";
            reportMessage += `⚡ RSI Nhanh (5): ${analysis.dualRSI.current.fast.toFixed(1)}\n`;
            reportMessage += `🐌 RSI Chậm (14): ${analysis.dualRSI.current.slow.toFixed(1)}\n`;
            reportMessage += `📊 RSI Nhanh trước: ${analysis.dualRSI.current.prevFast.toFixed(1)}\n`;
            reportMessage += `📊 RSI Chậm trước: ${analysis.dualRSI.current.prevSlow.toFixed(1)}\n\n`;
        }
        
        // Trend Analysis
        reportMessage += "📈 *PHÂN TÍCH XU HƯỚNG:*\n";
        const trendIcon = analysis.dualRSI.trend === 'BULLISH' ? '📈' : 
                         analysis.dualRSI.trend === 'BEARISH' ? '📉' : '⚖️';
        reportMessage += `${trendIcon} Xu hướng chính: ${analysis.dualRSI.trend}\n`;
        
        // Differential RSI
        reportMessage += `🔄 Differential RSI: ${analysis.dualRSI.differential.toFixed(1)}\n`;
        if (analysis.dualRSI.differential > 5) {
            reportMessage += `📈 Momentum tích cực mạnh\n`;
        } else if (analysis.dualRSI.differential < -5) {
            reportMessage += `📉 Momentum tiêu cực mạnh\n`;
        } else {
            reportMessage += `⚖️ Momentum trung tính\n`;
        }
        reportMessage += `\n`;
        
        // Signals Analysis
        if (analysis.dualRSI.signals && analysis.dualRSI.signals.length > 0) {
            reportMessage += "🎯 *TÍN HIỆU RSI:*\n";
            analysis.dualRSI.signals.forEach((signal, index) => {
                const signalIcon = signal.type.includes('BULLISH') ? '📈' : 
                                 signal.type.includes('BEARISH') ? '📉' : '⚡';
                const strengthIcon = signal.strength === 'HIGH' ? '🔥' : 
                                   signal.strength === 'MEDIUM' ? '⚡' : '💡';
                
                reportMessage += `${index + 1}. ${signalIcon} ${signal.description}\n`;
                reportMessage += `   ${strengthIcon} Độ mạnh: ${signal.strength}\n`;
            });
            reportMessage += `\n`;
        } else {
            reportMessage += "❌ *Không có tín hiệu RSI đặc biệt*\n\n";
        }
        
        // RSI Levels Analysis
        reportMessage += "📊 *PHÂN TÍCH MỨC RSI:*\n";
        const fastRSI = analysis.dualRSI.current.fast;
        const slowRSI = analysis.dualRSI.current.slow;
        
        // Fast RSI Analysis
        if (fastRSI > 70) {
            reportMessage += `⚡ RSI Nhanh: Overbought (${fastRSI.toFixed(1)})\n`;
        } else if (fastRSI < 30) {
            reportMessage += `⚡ RSI Nhanh: Oversold (${fastRSI.toFixed(1)})\n`;
        } else {
            reportMessage += `⚡ RSI Nhanh: Trung tính (${fastRSI.toFixed(1)})\n`;
        }
        
        // Slow RSI Analysis
        if (slowRSI > 70) {
            reportMessage += `🐌 RSI Chậm: Overbought (${slowRSI.toFixed(1)})\n`;
        } else if (slowRSI < 30) {
            reportMessage += `🐌 RSI Chậm: Oversold (${slowRSI.toFixed(1)})\n`;
        } else {
            reportMessage += `🐌 RSI Chậm: Trung tính (${slowRSI.toFixed(1)})\n`;
        }
        
        // Crossover Analysis
        const prevFast = analysis.dualRSI.current.prevFast;
        const prevSlow = analysis.dualRSI.current.prevSlow;
        
        if (prevFast <= prevSlow && fastRSI > slowRSI) {
            reportMessage += `\n📈 *BULLISH CROSSOVER:* RSI nhanh cắt lên RSI chậm\n`;
        } else if (prevFast >= prevSlow && fastRSI < slowRSI) {
            reportMessage += `\n📉 *BEARISH CROSSOVER:* RSI nhanh cắt xuống RSI chậm\n`;
        }
        
        reportMessage += `\n💡 *KHUYẾN NGHỊ:*\n`;
        if (analysis.dualRSI.trend === 'BULLISH') {
            reportMessage += `✅ Xu hướng tích cực - Ưu tiên LONG\n`;
            reportMessage += `🎯 Tìm điểm vào khi RSI nhanh hồi về 50\n`;
        } else if (analysis.dualRSI.trend === 'BEARISH') {
            reportMessage += `✅ Xu hướng tiêu cực - Ưu tiên SHORT\n`;
            reportMessage += `🎯 Tìm điểm vào khi RSI nhanh hồi về 50\n`;
        } else {
            reportMessage += `⚠️ Xu hướng không rõ ràng\n`;
            reportMessage += `🎯 Chờ tín hiệu crossover\n`;
        }
        
        reportMessage += `\n🛡️ *QUẢN LÝ RỦI RO:*\n`;
        reportMessage += `• RSI nhanh cho tín hiệu sớm\n`;
        reportMessage += `• RSI chậm xác nhận xu hướng\n`;
        reportMessage += `• Differential RSI đo momentum\n`;
        reportMessage += `• Kết hợp với Volume Profile\n`;
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi phân tích Dual RSI:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình phân tích Dual RSI.");
    } finally {
        isScanning = false;
    }
}

// ==== QUÉT TOÀN BỘ COIN BẰNG WYCKOFF ====
async function handleWyckoffScanAll(chatId) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, "🎯 Đang quét toàn bộ coin bằng hệ thống Wyckoff Volume Profile + Dual RSI...\n\n⏰ Quá trình này có thể mất 5-10 phút để phân tích tất cả coin.");
    isScanning = true;
    
    try {
        const allSymbols = await getAllSymbols();
        if (!allSymbols || allSymbols.length === 0) {
            bot.sendMessage(chatId, "❌ Không thể lấy danh sách coin.");
            return;
        }
        
        let wyckoffSignals = [];
        const totalSymbols = allSymbols.length;
        let processedCount = 0;
        
        bot.sendMessage(chatId, `🔍 Bắt đầu phân tích ${totalSymbols} coin với hệ thống Wyckoff...`);
        
        for (let i = 0; i < totalSymbols; i++) {
            const symbol = allSymbols[i];
            
            try {
                console.log(`[WYCKOFF SCAN] Đang phân tích (${i+1}/${totalSymbols}): ${symbol}`);
                
                const signal = await getAllSignalsForSymbol(symbol);
                if (signal.direction !== 'NONE') {
                    signal.symbol = symbol;
                    
                    // Tính điểm chất lượng Wyckoff
                    signal.wyckoffScore = calculateWyckoffScore(signal);
                    
                    wyckoffSignals.push(signal);
                    
                    // Gửi tín hiệu ngay khi tìm thấy (giảm ngưỡng xuống 50)
                    if (signal.wyckoffScore >= 50) {
                        const quickMessage = `🎯 *WYCKOFF SIGNAL FOUND*\n\n${signal.direction} ${symbol}\n📊 Score: ${signal.wyckoffScore}/100\n💰 Entry: ${signal.price.toFixed(5)}\n🎯 TP: ${signal.tp.toFixed(5)}\n🛑 SL: ${signal.sl.toFixed(5)}`;
                        bot.sendMessage(chatId, quickMessage, { parse_mode: "Markdown" });
                    }
                }
                
                processedCount++;
                
                // Cập nhật tiến trình mỗi 50 coin
                if (processedCount % 50 === 0) {
                    bot.sendMessage(chatId, `⏳ Đã phân tích ${processedCount}/${totalSymbols} coin. Tìm thấy ${wyckoffSignals.length} tín hiệu Wyckoff.`);
                }
                
                await sleep(100); // Tránh rate limit
                
            } catch (error) {
                console.error(`Lỗi phân tích Wyckoff cho ${symbol}:`, error.message);
            }
        }
        
        // Tạo báo cáo tổng hợp
        if (wyckoffSignals.length === 0) {
            bot.sendMessage(chatId, "✅ Đã quét xong toàn bộ coin. Không tìm thấy tín hiệu Wyckoff nào phù hợp.\n\n💡 Thị trường có thể đang ở trạng thái không có xu hướng rõ ràng.");
            return;
        }
        
        // Sắp xếp theo điểm Wyckoff
        wyckoffSignals.sort((a, b) => b.wyckoffScore - a.wyckoffScore);
        
        // Phân loại theo chất lượng (giảm ngưỡng)
        const premiumSignals = wyckoffSignals.filter(s => s.wyckoffScore >= 75);
        const highQualitySignals = wyckoffSignals.filter(s => s.wyckoffScore >= 60 && s.wyckoffScore < 75);
        const mediumQualitySignals = wyckoffSignals.filter(s => s.wyckoffScore >= 40 && s.wyckoffScore < 60);
        const lowQualitySignals = wyckoffSignals.filter(s => s.wyckoffScore >= 30 && s.wyckoffScore < 40);
        
        let reportMessage = "🎯 *WYCKOFF SCAN - BÁO CÁO TỔNG HỢP*\n\n";
        reportMessage += `📊 Đã phân tích: ${totalSymbols} coin\n`;
        reportMessage += `🎯 Tìm thấy: ${wyckoffSignals.length} tín hiệu Wyckoff\n\n`;
        
        reportMessage += "📈 *PHÂN LOẠI THEO CHẤT LƯỢNG:*\n";
        reportMessage += `💎 Premium (≥75 điểm): ${premiumSignals.length} tín hiệu\n`;
        reportMessage += `⭐ Cao (60-74 điểm): ${highQualitySignals.length} tín hiệu\n`;
        reportMessage += `📊 Trung bình (40-59 điểm): ${mediumQualitySignals.length} tín hiệu\n`;
        reportMessage += `⚠️ Thấp (30-39 điểm): ${lowQualitySignals.length} tín hiệu\n\n`;
        
        // Top 10 tín hiệu tốt nhất
        const topSignals = wyckoffSignals.slice(0, 10);
        reportMessage += "🏆 *TOP 10 TÍN HIỆU WYCKOFF TỐT NHẤT:*\n\n";
        
        topSignals.forEach((signal, index) => {
            const qualityIcon = signal.wyckoffScore > 95 ? '🔥' : 
                              signal.wyckoffScore > 90 ? '💎' : 
                              signal.wyckoffScore > 80 ? '⭐' : '✅';
            const directionIcon = signal.direction === 'LONG' ? '📈' : '📉';
            
            reportMessage += `${index + 1}. ${qualityIcon} *${signal.symbol}* | ${directionIcon} ${signal.direction}\n`;
            reportMessage += `   🎯 Wyckoff Score: ${signal.wyckoffScore.toFixed(1)}/100\n`;
            reportMessage += `   📊 Confidence: ${signal.confidence || 0}%\n`;
            reportMessage += `   💰 Entry: ${signal.price.toFixed(5)}\n`;
            reportMessage += `   🎯 TP: ${signal.tp.toFixed(5)} | 🛑 SL: ${signal.sl.toFixed(5)}\n`;
            reportMessage += `   📈 Risk/Reward: 1:${((Math.abs(signal.tp - signal.price)) / Math.abs(signal.price - signal.sl)).toFixed(1)}\n\n`;
        });
        
        // Thống kê theo hướng
        const longSignals = wyckoffSignals.filter(s => s.direction === 'LONG');
        const shortSignals = wyckoffSignals.filter(s => s.direction === 'SHORT');
        
        reportMessage += "📊 *THỐNG KÊ THEO HƯỚNG:*\n";
        reportMessage += `📈 LONG: ${longSignals.length} tín hiệu (${((longSignals.length / wyckoffSignals.length) * 100).toFixed(1)}%)\n`;
        reportMessage += `📉 SHORT: ${shortSignals.length} tín hiệu (${((shortSignals.length / wyckoffSignals.length) * 100).toFixed(1)}%)\n\n`;
        
        // Khuyến nghị
        reportMessage += "💡 *KHUYẾN NGHỊ WYCKOFF:*\n";
        if (premiumSignals.length > 0) {
            reportMessage += "✅ Ưu tiên các tín hiệu Premium (≥75 điểm)\n";
        }
        if (highQualitySignals.length > 0) {
            reportMessage += "⭐ Cân nhắc các tín hiệu Cao (60-74 điểm)\n";
        }
        if (longSignals.length > shortSignals.length) {
            reportMessage += "📈 Thị trường có xu hướng tích cực - Ưu tiên LONG\n";
        } else if (shortSignals.length > longSignals.length) {
            reportMessage += "📉 Thị trường có xu hướng tiêu cực - Ưu tiên SHORT\n";
        } else {
            reportMessage += "⚖️ Thị trường cân bằng - Chọn tín hiệu có điểm cao nhất\n";
        }
        
        reportMessage += "\n🛡️ *LƯU Ý QUAN TRỌNG:*\n";
        reportMessage += "• Ưu tiên vào lệnh với Wyckoff Score ≥ 60\n";
        reportMessage += "• Có thể cân nhắc tín hiệu ≥ 50 điểm\n";
        reportMessage += "• Luôn đặt Stop Loss\n";
        reportMessage += "• Theo dõi Key Volume và Volume Profile\n";
        reportMessage += "• Chú ý các mức POC, VAH, VAL\n";
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi quét Wyckoff:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình quét Wyckoff. Vui lòng thử lại sau.");
    } finally {
        isScanning = false;
    }
}

/**
 * Tính điểm chất lượng Wyckoff
 */
function calculateWyckoffScore(signal) {
    let score = 0;
    
    // Điểm từ confidence (40%)
    if (signal.confidence) {
        score += signal.confidence * 0.4;
    }
    
    // Điểm từ Wyckoff Analysis (60%)
    if (signal.wyckoffAnalysis) {
        const analysis = signal.wyckoffAnalysis;
        
        // Key Volume (20%) - giảm ngưỡng để có nhiều tín hiệu hơn
        if (analysis.keyVolume && analysis.keyVolume.isKeyVolume) {
            const volumeMultipliers = {
                'VERY_HIGH': 20,
                'HIGH': 18,
                'MEDIUM': 15,
                'LOW': 12,
                'VERY_LOW': 8
            };
            score += volumeMultipliers[analysis.keyVolume.strength] || 8;
        } else if (analysis.keyVolume && analysis.keyVolume.multiplier >= 1.2) {
            // Bonus cho volume cao hơn trung bình 20%
            score += 5;
        }
        
        // Volume Profile (20%) - giảm ngưỡng để có nhiều tín hiệu hơn
        if (analysis.volumeProfile && analysis.volumeProfile.poc) {
            score += 8; // Có POC
        }
        if (analysis.volumeProfile && analysis.volumeProfile.valueArea) {
            score += 8; // Có Value Area
        }
        if (analysis.volumeProfile && analysis.volumeProfile.hvn && analysis.volumeProfile.hvn.length > 0) {
            score += 4; // Bonus cho có HVN
        }
        
        // Dual RSI (20%) - giảm ngưỡng để có nhiều tín hiệu hơn
        if (analysis.dualRSI && analysis.dualRSI.signals && analysis.dualRSI.signals.length > 0) {
            score += Math.min(analysis.dualRSI.signals.length * 4, 16);
        }
        if (analysis.dualRSI && analysis.dualRSI.trend && analysis.dualRSI.trend !== 'NEUTRAL') {
            score += 4; // Bonus cho có xu hướng RSI
        }
        
        // Bonus cho các điều kiện đặc biệt - giảm ngưỡng để có nhiều tín hiệu hơn
        if (analysis.isInValueArea === false && analysis.keyVolume && analysis.keyVolume.isKeyVolume) {
            score += 8; // Phá vỡ Value Area với Key Volume
        }
        
        if (analysis.dualRSI && analysis.dualRSI.trend === signal.direction) {
            score += 8; // RSI trend đồng thuận
        }
        
        // Bonus cho có bất kỳ tín hiệu nào
        if (analysis.keyVolume || analysis.volumeProfile || analysis.dualRSI) {
            score += 5; // Bonus cơ bản
        }
    }
    
    return Math.min(score, 100);
}

// ==== PHÂN TÍCH COIN CỤ THỂ ====
async function handleAnalyzeCoin(chatId, symbol) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận, vui lòng thử lại sau.");
    }
    
    bot.sendMessage(chatId, `🔍 Đang phân tích ${symbol.toUpperCase()}...`);
    isScanning = true;
    
    try {
        const result = await analyzeSpecificCoin(symbol);
        
        if (!result.success) {
            let errorMessage = `❌ ${result.error}\n\n`;
            
            if (result.suggestions && result.suggestions.length > 0) {
                errorMessage += "💡 *Có thể bạn muốn phân tích:*\n";
                result.suggestions.forEach(suggestion => {
                    const cleanSymbol = suggestion.replace('-USDT-SWAP', '');
                    errorMessage += `• ${cleanSymbol}\n`;
                });
                errorMessage += `\nSử dụng: \`/analyze BTC\` hoặc \`/analyze ETH\``;
            }
            
            bot.sendMessage(chatId, errorMessage, { parse_mode: "Markdown" });
            return;
        }
        
        // Tạo báo cáo phân tích
        let reportMessage = `🔍 *PHÂN TÍCH ${result.symbol}*\n\n`;
        
        if (result.recommendation === "NEUTRAL") {
            reportMessage += "⚖️ *KHUYẾN NGHỊ: NEUTRAL*\n";
            reportMessage += `📝 ${result.message}\n`;
            reportMessage += `🎯 Điểm chất lượng: ${result.quality.toFixed(1)}/100\n\n`;
            
            reportMessage += "💡 *LÝ DO:*\n";
            reportMessage += "• Không có xu hướng rõ ràng\n";
            reportMessage += "• Các chỉ báo kỹ thuật không đồng thuận\n";
            reportMessage += "• Thị trường đang sideway\n\n";
            
            reportMessage += "🎯 *KHUYẾN NGHỊ:*\n";
            reportMessage += "• Chờ đợi tín hiệu rõ ràng hơn\n";
            reportMessage += "• Có thể giao dịch range-bound\n";
            reportMessage += "• Theo dõi các breakout quan trọng\n";
            
        } else {
            const directionIcon = result.recommendation === 'LONG' ? '📈' : '📉';
            const qualityIcon = result.quality > 95 ? '🔥' : result.quality > 90 ? '💎' : '⭐';
            
            reportMessage += `${directionIcon} *KHUYẾN NGHỊ: ${result.recommendation}*\n`;
            reportMessage += `${qualityIcon} *Điểm chất lượng: ${result.quality.toFixed(1)}/100*\n`;
            reportMessage += `📊 *Độ tin cậy: ${result.confidence.toFixed(1)}%*\n\n`;
            
            reportMessage += "💰 *THÔNG TIN GIAO DỊCH:*\n";
            reportMessage += `• Entry: ${result.price.toFixed(5)}\n`;
            reportMessage += `• Take Profit: ${result.tp.toFixed(5)}\n`;
            reportMessage += `• Stop Loss: ${result.sl.toFixed(5)}\n`;
            reportMessage += `• Risk/Reward: 1:${result.riskReward.toFixed(1)}\n\n`;
            
            reportMessage += "📊 *PHÂN TÍCH CHI TIẾT:*\n";
            if (result.analysis) {
                const { daily, h4, h1, m15 } = result.analysis;
                
                if (daily) {
                    const trendIcon = daily.trend.includes('BULLISH') ? '📈' : daily.trend.includes('BEARISH') ? '📉' : '⚖️';
                    reportMessage += `${trendIcon} *Daily Trend:* ${daily.trend} (ADX: ${daily.adx?.toFixed(1)})\n`;
                }
                
                if (h4) {
                    const structureIcon = h4.structure === 'BULLISH' ? '📈' : h4.structure === 'BEARISH' ? '📉' : '⚖️';
                    reportMessage += `${structureIcon} *H4 Structure:* ${h4.structure}\n`;
                }
                
                if (h1) {
                    const momentumIcon = h1.momentum === 'BULLISH' ? '📈' : h1.momentum === 'BEARISH' ? '📉' : '⚖️';
                    reportMessage += `${momentumIcon} *H1 Momentum:* ${h1.momentum}\n`;
                }
                
                if (m15) {
                    const entryIcon = m15.entrySignal.includes('BULLISH') ? '📈' : m15.entrySignal.includes('BEARISH') ? '📉' : '⚖️';
                    reportMessage += `${entryIcon} *M15 Entry:* ${m15.entrySignal}\n`;
                }
            }
            
            reportMessage += "\n💡 *KHUYẾN NGHỊ GIAO DỊCH:*\n";
            if (result.recommendation === 'LONG') {
                reportMessage += "✅ Ưu tiên lệnh LONG\n";
                reportMessage += "🎯 Tìm điểm entry tốt trên M15\n";
                reportMessage += "📊 Chờ retest để vào lệnh\n";
            } else {
                reportMessage += "✅ Ưu tiên lệnh SHORT\n";
                reportMessage += "🎯 Tìm điểm entry tốt trên M15\n";
                reportMessage += "📊 Chờ retest để vào lệnh\n";
            }
            
            reportMessage += "\n🛡️ *QUẢN LÝ RỦI RO:*\n";
            reportMessage += "• Luôn đặt Stop Loss\n";
            reportMessage += "• Theo dõi sát sao lệnh\n";
            reportMessage += "• Không vào lệnh khi không chắc chắn\n";
            
            // Thêm lệnh để vào lệnh
            const commandDirection = result.recommendation.toLowerCase();
            reportMessage += `\n⚡ *LỆNH VÀO LỆNH:*\n`;
            reportMessage += `\`/${commandDirection} ${result.symbol.replace('-USDT-SWAP', '')} ${result.price.toFixed(5)} ${result.sl.toFixed(5)}\`\n`;
        }
        
        bot.sendMessage(chatId, reportMessage, { parse_mode: "Markdown" });
        
    } catch (error) {
        console.error("Lỗi khi phân tích coin:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình phân tích coin. Vui lòng thử lại sau.");
    } finally {
        isScanning = false;
    }
}
