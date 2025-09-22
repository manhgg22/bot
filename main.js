import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import cron from "node-cron";
import { scanForNewSignal, monitorOpenTrades, getAllSignalsForSymbol } from "./indicators.js";
import { addTrade, closeTrade, getOpenTrades, getTradeStats } from "./tradeManager.js";
import { getCurrentPrice } from "./okx.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => { res.send("✅ Bot is running 🚀"); });
app.listen(PORT, () => { console.log(`🌐 [BOT] Server đang lắng nghe tại cổng ${PORT}`); });

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const startTime = Date.now();

// [CẬP NHẬT] Thêm các nút Gợi ý vào menu
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

// --- Xử lý các lệnh từ người dùng ---
bot.onText(/\/start/, (msg) => { bot.sendMessage(msg.chat.id, "👋 Chào mừng bạn! Bot giờ đây hoạt động trên thị trường Futures (Hợp đồng vĩnh cửu).", menuOptions); });
bot.onText(/\/status/, (msg) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/close (.+)/, (msg, match) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/positions/, (msg) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/scan_top_100/, (msg) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/scan_all_coins/, (msg) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/stats/, (msg) => { /* ... giữ nguyên code cũ ... */ });
bot.onText(/\/theodoi/, (msg) => { /* ... giữ nguyên code cũ ... */ });


// [MỚI] Xử lý các nút bấm Gợi ý
bot.onText(/💡 Gợi ý LONG/, (msg) => {
    handleSuggestionRequest(msg.chat.id, "LONG");
});

bot.onText(/💡 Gợi ý SHORT/, (msg) => {
    handleSuggestionRequest(msg.chat.id, "SHORT");
});

// [MỚI] Hàm chính để xử lý yêu cầu gợi ý
async function handleSuggestionRequest(chatId, direction) {
    if (isScanning) {
        return bot.sendMessage(chatId, "⚠️ Bot đang bận với một tác vụ quét khác, vui lòng thử lại sau vài phút.");
    }
    bot.sendMessage(chatId, `🔍 Đang tìm các tín hiệu ${direction} tốt nhất trên toàn bộ thị trường Futures... Việc này có thể mất vài phút.`);
    
    isScanning = true;
    try {
        const allSymbols = await getSymbols(null);
        if (!allSymbols || allSymbols.length === 0) {
            bot.sendMessage(chatId, "⚠️ Lỗi: Không thể lấy danh sách các hợp đồng Futures.");
            return;
        }

        let suggestions = [];
        const totalSymbols = allSymbols.length;
        for (let i = 0; i < totalSymbols; i++) {
            const symbol = allSymbols[i];
            console.log(`[SUGGEST] Đang quét (${i+1}/${totalSymbols}): ${symbol}`);
            
            // Bỏ qua các cặp BTC và ETH-USDC để tránh nhiễu
            if (symbol.includes('USDC')) continue;

            const signal = await getAllSignalsForSymbol(symbol);
            if (signal.direction === direction) {
                signal.symbol = symbol;
                suggestions.push(signal);
            }
            await sleep(150);
        }

        if (suggestions.length === 0) {
            bot.sendMessage(chatId, `✅ Đã quét xong. Không tìm thấy gợi ý ${direction} nào phù hợp tại thời điểm này.`);
            return;
        }

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
        console.error("Lỗi nghiêm trọng khi tìm gợi ý:", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi trong quá trình tìm kiếm gợi ý.");
    } finally {
        isScanning = false;
    }
}


// --- Các hàm hệ thống ---

// [NÂNG CẤP] Lấy danh sách Hợp đồng Vĩnh cửu
async function getSymbols(limit = null) {
  try {
    const res = await axios.get("https://www.okx.com/api/v5/public/instruments", { 
        params: { instType: "SWAP" }
    });
    
    let symbols = res.data.data
        .filter(t => t.state === 'live' && t.settleCcy === 'USDT')
        .map(t => t.instId);

    if (limit) {
        const tickersRes = await axios.get("https://www.okx.com/api/v5/market/tickers", { params: { instType: "SWAP" } });
        const volumeMap = new Map(tickersRes.data.data.map(t => [t.instId, Number(t.volCcy24h)]));
        symbols.sort((a, b) => (volumeMap.get(b) || 0) - (volumeMap.get(a) || 0));
        return symbols.slice(0, limit);
    }
    return symbols;

  } catch (err) {
    console.error("❌ [BOT] Lỗi khi lấy danh sách coin Futures:", err.message);
    return [];
  }
}

function sleep(ms) { /* ... giữ nguyên code cũ ... */ }
async function scanAll(symbols, mode = "initial", chatId) { /* ... giữ nguyên code cũ ... */ }
async function main() { /* ... giữ nguyên code cũ ... */ }

main();