// main.js - Bot crypto trading đơn giản và hiệu quả
import express from "express";
import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import { getSignal, scanTopSignals, formatSignalMessage } from "./signals.js";
import { addTrade, closeTrade, getOpenTrades, monitorTrades, getTradeStats } from "./trades.js";
import { getAllSymbols } from "./okx.js";

dotenv.config();

// Express server để giữ bot hoạt động trên Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("✅ Crypto Trading Bot đang hoạt động!"));
app.listen(PORT, () => console.log(`🌐 Server đang chạy tại port ${PORT}`));

// Khởi tạo Telegram Bot
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const bot = new TelegramBot(TOKEN, { polling: true });

console.log("🤖 Bot đã khởi động!");

// Kiểm tra OKX mode
const IS_SANDBOX = process.env.OKX_SANDBOX === 'true';
console.log(`🔧 OKX Mode: ${IS_SANDBOX ? 'SANDBOX (Test)' : 'PRODUCTION (Real)'}`);

// Menu chính
const mainMenu = {
    reply_markup: {
        keyboard: [
            ["🔍 Quét Top 50", "🌍 Quét Toàn Bộ"],
            ["⏰ Auto Scan", "🤖 Auto Trading"],
            ["📊 Lệnh Đang Mở", "📈 Thống Kê"],
            ["🔗 OKX Sandbox", "ℹ️ Hướng Dẫn"]
        ],
        resize_keyboard: true
    }
};

let isScanning = false;
let autoScanEnabled = false;
let autoScanInterval = null;
let autoTradingEnabled = false;
let autoTradingInterval = null;

// === LỆNH CƠ BẢN ===
bot.onText(/\/start/, (msg) => {
    const welcomeMessage = `🤖 *CHÀO MỪNG ĐẾN CRYPTO TRADING BOT*

🔧 *Environment:* ${IS_SANDBOX ? '🧪 SANDBOX (Test Mode)' : '🔴 PRODUCTION (Real Trading)'}

🎯 *Tính năng chính:*
• 7 chỉ báo confluence: EMA + RSI + MACD + Stochastic + Bollinger + Williams %R + Volume
• Timeframe 15M (low lag, nhanh hơn EMA)
• Tự động tính SL/TP thông minh
• Risk/Reward tối thiểu 1:1.5
• Confidence score ≥70 điểm

📱 *Sử dụng menu bên dưới để bắt đầu!*`;
    
    bot.sendMessage(msg.chat.id, welcomeMessage, { 
        parse_mode: "Markdown", 
        ...mainMenu 
    });
});

bot.onText(/\/mode|\/environment/, (msg) => {
    const IS_SANDBOX = process.env.OKX_SANDBOX === 'true';
    const modeMessage = `🔧 *OKX ENVIRONMENT STATUS*

📊 *Chế độ hiện tại:* ${IS_SANDBOX ? '🧪 SANDBOX' : '🔴 PRODUCTION'}
🌐 *API Endpoint:* ${IS_SANDBOX ? 'aws.okx.com (Test)' : 'www.okx.com (Real)'}
💰 *Giao dịch:* ${IS_SANDBOX ? 'Tiền ảo (Test)' : 'Tiền thật (Real)'}

${IS_SANDBOX ? 
`🧪 *SANDBOX MODE:*
• Sử dụng tiền ảo để test
• Không ảnh hưởng tài khoản thật
• Dữ liệu giá thật nhưng giao dịch fake
• An toàn để test chiến lược` :
`🔴 *PRODUCTION MODE:*
• ⚠️ SỬ DỤNG TIỀN THẬT
• Mọi giao dịch đều thực tế
• Cần cẩn thận với risk management
• Khuyến nghị test trên Sandbox trước`}

💡 *Để đổi mode:*
1. Sửa file .env: OKX_SANDBOX=true (test) hoặc false (real)
2. Restart bot`;

    bot.sendMessage(msg.chat.id, modeMessage, { parse_mode: "Markdown" });
});

bot.onText(/\/help|ℹ️ Hướng Dẫn/, (msg) => {
    const helpMessage = `📖 *HƯỚNG DẪN SỬ DỤNG*

🔍 *Quét Tín Hiệu:*
• \`🔍 Quét Top 50\` - Quét 50 coins hàng đầu (2 phút)
• \`🌍 Quét Toàn Bộ\` - Quét tất cả coins OKX (5-10 phút)
• \`⏰ Auto Scan\` - Tự động quét mỗi 5 phút
• \`🤖 Auto Trading\` - Tự động quét và vào lệnh (Sandbox)
• \`/quick_scan [số]\` - Quét số lượng tùy chỉnh (5-200)
• \`/top_signals\` - Xem tất cả tín hiệu đã tìm được

📊 *Quản lý lệnh:*
• \`/long BTC-USDT-SWAP 50000 49000\` - Vào lệnh LONG
• \`/short ETH-USDT-SWAP 3000 3100\` - Vào lệnh SHORT  
• \`/close BTC-USDT-SWAP\` - Đóng lệnh
• \`/positions\` - Xem lệnh đang mở
• \`/mode\` - Kiểm tra Sandbox/Production mode
• \`/sandbox\` - Link OKX Demo Trading

🎯 *Multi-Indicator Strategy:*
• EMA 9/21 Cross = Trend nhanh
• RSI 45-65 = Momentum tối ưu  
• MACD Histogram = Xác nhận trend
• Stochastic = Entry timing
• Bollinger Bands = Support/Resistance
• Williams %R = Oversold/Overbought
• Volume ≥1.2x = Confirmation
• Score ≥70/100 = High probability

⚠️ *Lưu ý:*
• Luôn đặt Stop Loss
• Risk 1-2% mỗi lệnh
• Không revenge trading`;
    
    bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: "Markdown" });
});

// === QUÉT TÍN HIỆU ===
bot.onText(/🔍 Quét Top 50|\/scan/, async (msg) => {
    if (isScanning) {
        return bot.sendMessage(msg.chat.id, "⏳ Đang quét, vui lòng đợi...");
    }
    
    isScanning = true;
    bot.sendMessage(msg.chat.id, "🔍 Đang quét Top 50 coins...\n⏱ 7 chỉ báo confluence | 15M timeframe | 1-2 phút");
    
    try {
        // Lấy top 50 coins theo volume
        const allSymbols = await getAllSymbols();
        const topSymbols = allSymbols.slice(0, 50);
        
        const signals = await scanTopSignals(topSymbols, 70);
        
        if (signals.length === 0) {
            bot.sendMessage(msg.chat.id, "❌ Không tìm thấy tín hiệu nào đạt tiêu chuẩn (≥70 điểm confluence)");
        } else {
            // Gửi summary
            let summary = `✅ *TÌM THẤY ${signals.length} TÍN HIỆU CHẤT LƯỢNG CAO*\n\n`;
            signals.slice(0, 5).forEach((signal, index) => {
                const icon = signal.direction === 'LONG' ? '📈' : '📉';
                summary += `${index + 1}. ${icon} ${signal.symbol} | ${signal.confidence.toFixed(1)}%\n`;
            });
            
            bot.sendMessage(msg.chat.id, summary, { parse_mode: "Markdown" });
            
            // Gửi chi tiết top 3
            for (const signal of signals.slice(0, 3)) {
                const message = formatSignalMessage(signal);
                await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
    } catch (error) {
        console.error("Lỗi quét tín hiệu:", error);
        bot.sendMessage(msg.chat.id, "❌ Có lỗi xảy ra khi quét tín hiệu");
    } finally {
        isScanning = false;
    }
});

// === QUÉT TOÀN BỘ COIN OKX ===
bot.onText(/🌍 Quét Toàn Bộ|\/scan_all/, async (msg) => {
    if (isScanning) {
        return bot.sendMessage(msg.chat.id, "⏳ Đang quét, vui lòng đợi...");
    }
    
    isScanning = true;
    bot.sendMessage(msg.chat.id, "🌍 Đang quét TOÀN BỘ coin OKX...\n⏱ Có thể mất 5-10 phút\n🔍 Sẽ cập nhật tiến độ định kỳ");
    
    try {
        // Lấy tất cả symbols
        const allSymbols = await getAllSymbols();
        bot.sendMessage(msg.chat.id, `📊 Tìm thấy ${allSymbols.length} coins trên OKX\n🔍 Bắt đầu quét với 7 chỉ báo confluence...`);
        
        const signals = [];
        let processedCount = 0;
        let lastUpdateTime = Date.now();
        
        for (let i = 0; i < allSymbols.length; i++) {
            const symbol = allSymbols[i];
            try {
                const signal = await getSignal(symbol);
                
                if (signal.direction !== "NONE" && signal.confidence >= 70) {
                    signals.push(signal);
                    console.log(`✅ Tìm thấy: ${symbol} ${signal.direction} (${signal.confidence.toFixed(1)}%)`);
                }
                
                processedCount++;
                
                // Cập nhật tiến độ mỗi 50 coins hoặc mỗi 2 phút
                const now = Date.now();
                if (processedCount % 50 === 0 || (now - lastUpdateTime) > 120000) {
                    const progress = ((processedCount / allSymbols.length) * 100).toFixed(1);
                    bot.sendMessage(msg.chat.id, `📊 Tiến độ: ${processedCount}/${allSymbols.length} (${progress}%)\n✅ Tìm thấy: ${signals.length} tín hiệu chất lượng cao`);
                    lastUpdateTime = now;
                }
                
                // Rate limiting - delay giữa các coin
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.error(`Lỗi quét ${symbol}:`, error.message);
            }
        }
        
        // Kết quả cuối cùng
        if (signals.length === 0) {
            bot.sendMessage(msg.chat.id, `✅ Hoàn thành quét ${allSymbols.length} coins!\n❌ Không tìm thấy tín hiệu nào đạt tiêu chuẩn (≥70 điểm confluence)`);
        } else {
            // Sắp xếp theo confidence và lưu kết quả
            signals.sort((a, b) => b.confidence - a.confidence);
            lastScanResults = [...signals]; // Lưu kết quả để dùng cho /top_signals
            
            // Gửi summary
            let summary = `🎉 *HOÀN THÀNH QUÉT ${allSymbols.length} COINS*\n\n`;
            summary += `✅ Tìm thấy ${signals.length} tín hiệu chất lượng cao:\n\n`;
            
            signals.slice(0, 10).forEach((signal, index) => {
                const icon = signal.direction === 'LONG' ? '📈' : '📉';
                summary += `${index + 1}. ${icon} ${signal.symbol} | ${signal.confidence.toFixed(1)}%\n`;
            });
            
            if (signals.length > 10) {
                summary += `\n... và ${signals.length - 10} tín hiệu khác`;
            }
            
            bot.sendMessage(msg.chat.id, summary, { parse_mode: "Markdown" });
            
            // Gửi chi tiết top 5 tín hiệu tốt nhất
            bot.sendMessage(msg.chat.id, "📊 *CHI TIẾT TOP 5 TÍN HIỆU TỐT NHẤT:*", { parse_mode: "Markdown" });
            
            for (const signal of signals.slice(0, 5)) {
                const message = formatSignalMessage(signal);
                await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            
            if (signals.length > 5) {
                bot.sendMessage(msg.chat.id, `📝 Còn ${signals.length - 5} tín hiệu khác với confidence ≥70%\nSử dụng /top_signals để xem tất cả`);
            }
        }
        
    } catch (error) {
        console.error("Lỗi quét toàn bộ coin:", error);
        bot.sendMessage(msg.chat.id, "❌ Có lỗi xảy ra khi quét toàn bộ coin");
    } finally {
        isScanning = false;
    }
});

// Lệnh xem top signals đã tìm được
let lastScanResults = [];
bot.onText(/\/top_signals/, (msg) => {
    if (lastScanResults.length === 0) {
        return bot.sendMessage(msg.chat.id, "❌ Chưa có kết quả quét nào. Sử dụng 🌍 Quét Toàn Bộ trước.");
    }
    
    let message = `📊 *TẤT CẢ TÍN HIỆU CHẤT LƯỢNG CAO*\n\n`;
    lastScanResults.forEach((signal, index) => {
        const icon = signal.direction === 'LONG' ? '📈' : '📉';
        message += `${index + 1}. ${icon} ${signal.symbol} | ${signal.direction} | ${signal.confidence.toFixed(1)}%\n`;
    });
    
    bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
});

// Quét nhanh với số lượng tùy chỉnh
bot.onText(/\/quick_scan (.+)/, async (msg, match) => {
    const count = parseInt(match[1]) || 20;
    if (count < 5 || count > 200) {
        return bot.sendMessage(msg.chat.id, '❌ Số lượng phải từ 5-200 coins');
    }
    
    if (isScanning) {
        return bot.sendMessage(msg.chat.id, "⏳ Đang quét, vui lòng đợi...");
    }
    
    isScanning = true;
    bot.sendMessage(msg.chat.id, `🚀 Đang quét ${count} coins...\n⏱ Thời gian dự kiến: ${Math.ceil(count/10)} phút`);
    
    try {
        const allSymbols = await getAllSymbols();
        const selectedSymbols = allSymbols.slice(0, count);
        
        const signals = await scanTopSignals(selectedSymbols, 70);
        
        if (signals.length === 0) {
            bot.sendMessage(msg.chat.id, `✅ Đã quét ${count} coins\n❌ Không tìm thấy tín hiệu nào đạt tiêu chuẩn`);
        } else {
            let summary = `✅ Quét ${count} coins - Tìm thấy ${signals.length} tín hiệu:\n\n`;
            signals.slice(0, 8).forEach((signal, index) => {
                const icon = signal.direction === 'LONG' ? '📈' : '📉';
                summary += `${index + 1}. ${icon} ${signal.symbol} | ${signal.confidence.toFixed(1)}%\n`;
            });
            
            bot.sendMessage(msg.chat.id, summary);
            
            // Gửi chi tiết top 3
            for (const signal of signals.slice(0, 3)) {
                const message = formatSignalMessage(signal);
                await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
    } catch (error) {
        console.error("Lỗi quick scan:", error);
        bot.sendMessage(msg.chat.id, "❌ Có lỗi xảy ra khi quét");
    } finally {
        isScanning = false;
    }
});

// === AUTO SCAN MỖI 5 PHÚT ===
bot.onText(/⏰ Auto Scan|\/auto/, (msg) => {
    const autoMenu = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: autoScanEnabled ? "🔴 Tắt Auto Scan" : "🟢 Bật Auto Scan", callback_data: "toggle_auto" },
                ],
                [
                    { text: "⚙️ Cài Đặt", callback_data: "auto_settings" },
                    { text: "📊 Trạng Thái", callback_data: "auto_status" }
                ],
                [
                    { text: "🔗 Link OKX Test", callback_data: "okx_links" }
                ]
            ]
        }
    };
    
    const statusText = autoScanEnabled ? "🟢 ĐANG BẬT" : "🔴 ĐANG TẮT";
    const message = `⏰ *AUTO SCAN SYSTEM*

📊 Trạng thái: ${statusText}
⏱ Chu kỳ: 5 phút
🎯 Quét: Top 50 coins
📈 Ngưỡng: ≥70 điểm confluence

${autoScanEnabled ? '🔄 Lần quét tiếp theo: ' + getNextScanTime() : '💡 Bật để tự động quét mỗi 5 phút'}`;

    bot.sendMessage(msg.chat.id, message, { 
        parse_mode: "Markdown", 
        ...autoMenu 
    });
});

// Xử lý callback buttons
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    
    if (data === 'toggle_auto') {
        if (autoScanEnabled) {
            // Tắt auto scan
            autoScanEnabled = false;
            if (autoScanInterval) {
                clearInterval(autoScanInterval);
                autoScanInterval = null;
            }
            bot.answerCallbackQuery(callbackQuery.id, { text: "🔴 Đã tắt Auto Scan" });
            bot.sendMessage(msg.chat.id, "🔴 *Auto Scan đã được TẮT*", { parse_mode: "Markdown" });
        } else {
            // Bật auto scan
            autoScanEnabled = true;
            startAutoScan();
            bot.answerCallbackQuery(callbackQuery.id, { text: "🟢 Đã bật Auto Scan" });
            bot.sendMessage(msg.chat.id, `🟢 *Auto Scan đã được BẬT*\n\n⏱ Sẽ quét mỗi 5 phút\n🔄 Lần đầu: ${getNextScanTime()}`, { parse_mode: "Markdown" });
        }
    }
    
    if (data === 'auto_settings') {
        const settingsMessage = `⚙️ *CÀI ĐẶT AUTO SCAN*

⏱ *Chu kỳ hiện tại:* 5 phút
🎯 *Phạm vi:* Top 50 coins
📊 *Ngưỡng:* ≥70 điểm confluence
🔔 *Thông báo:* Chỉ tín hiệu chất lượng cao

💡 *Lệnh tùy chỉnh:*
• \`/auto_interval [phút]\` - Đổi chu kỳ (3-60 phút)
• \`/auto_threshold [điểm]\` - Đổi ngưỡng (60-90)
• \`/auto_count [số]\` - Đổi số coins (20-100)`;

        bot.sendMessage(msg.chat.id, settingsMessage, { parse_mode: "Markdown" });
    }
    
    if (data === 'auto_status') {
        const statusMessage = `📊 *TRẠNG THÁI AUTO SCAN*

🔄 Trạng thái: ${autoScanEnabled ? '🟢 Đang chạy' : '🔴 Đã tắt'}
⏱ Chu kỳ: 5 phút
🎯 Coins: Top 50
📈 Ngưỡng: ≥70 điểm

${autoScanEnabled ? `🕐 Lần quét tiếp theo: ${getNextScanTime()}\n📊 Đã quét: ${autoScanCount} lần` : '💡 Sử dụng 🟢 Bật Auto Scan để kích hoạt'}`;

        bot.sendMessage(msg.chat.id, statusMessage, { parse_mode: "Markdown" });
    }
    
    if (data === 'okx_links') {
        const IS_SANDBOX = process.env.OKX_SANDBOX === 'true';
        const okxMessage = `🔗 *LINK OKX ĐỂ TEST CHỈ BÁO*

🔧 *Bot Mode:* ${IS_SANDBOX ? '🧪 SANDBOX (Test)' : '🔴 PRODUCTION (Real)'}

📊 *OKX Trading Links:*
• [BTC-USDT Futures](https://www.okx.com/trade-swap/btc-usdt-swap)
• [ETH-USDT Futures](https://www.okx.com/trade-swap/eth-usdt-swap)
• [SOL-USDT Futures](https://www.okx.com/trade-swap/sol-usdt-swap)

${IS_SANDBOX ? 
`🧪 *Sandbox Testing:*
• Bot đang dùng test data
• Giao dịch không thật
• An toàn để test chiến lược` :
`🔴 *Production Mode:*
• ⚠️ Bot có thể giao dịch thật
• Cẩn thận với risk management
• Khuyến nghị test trên Sandbox trước`}

📈 *Cách test chỉ báo:*
1. Mở link OKX Futures
2. Chuyển sang khung 15M
3. Thêm các chỉ báo:
   • EMA 9, EMA 21
   • RSI 14
   • MACD
   • Stochastic
   • Bollinger Bands
   • Williams %R
4. So sánh với tín hiệu bot

💡 *Lưu ý:* Bot sử dụng API data, có thể khác nhau 1-2 điểm so với chart`;

        bot.sendMessage(msg.chat.id, okxMessage, { parse_mode: "Markdown" });
    }
    
    if (data === 'toggle_auto_trading') {
        const IS_SANDBOX = process.env.OKX_SANDBOX === 'true';
        
        if (!IS_SANDBOX) {
            bot.answerCallbackQuery(callbackQuery.id, { text: "❌ Chỉ hoạt động ở Sandbox mode!" });
            return;
        }
        
        if (autoTradingEnabled) {
            // Tắt auto trading
            autoTradingEnabled = false;
            if (autoTradingInterval) {
                clearInterval(autoTradingInterval);
                autoTradingInterval = null;
            }
            bot.answerCallbackQuery(callbackQuery.id, { text: "🔴 Đã tắt Auto Trading" });
            bot.sendMessage(msg.chat.id, "🔴 *Auto Trading đã được TẮT*", { parse_mode: "Markdown" });
        } else {
            // Bật auto trading
            autoTradingEnabled = true;
            startAutoTrading();
            bot.answerCallbackQuery(callbackQuery.id, { text: "🟢 Đã bật Auto Trading" });
            bot.sendMessage(msg.chat.id, `🟢 *Auto Trading đã được BẬT*

🧪 *Sandbox Mode* - An toàn 100%
⏱ Sẽ quét và trading mỗi 5 phút
🌍 Quét TOÀN BỘ coins OKX
🎯 Chỉ vào lệnh với confidence ≥80%
🔄 Lần đầu: ${getNextTradingTime()}

💡 Tất cả giao dịch đều là TEST!`, { parse_mode: "Markdown" });
        }
    }
    
    if (data === 'auto_trading_settings') {
        const settingsMessage = `⚙️ *CÀI ĐẶT AUTO TRADING*

🧪 *Mode:* Sandbox (Test only)
⏱ *Chu kỳ:* 5 phút
🌍 *Phạm vi:* TOÀN BỘ coins OKX
🎯 *Ngưỡng vào lệnh:* ≥80 điểm confluence
💰 *Position size:* 1% portfolio mỗi lệnh
📊 *Max lệnh:* 5 lệnh cùng lúc
🛑 *Auto SL/TP:* Theo tín hiệu

💡 *Tính năng:*
• Tự động quét toàn bộ coins
• Chỉ vào lệnh chất lượng cao nhất
• Tự động đặt SL/TP
• Theo dõi và đóng lệnh tự động
• Báo cáo chi tiết mỗi lần trading`;

        bot.sendMessage(msg.chat.id, settingsMessage, { parse_mode: "Markdown" });
    }
    
    if (data === 'auto_trading_status') {
        const openTrades = getOpenTrades();
        const statusMessage = `📊 *TRẠNG THÁI AUTO TRADING*

🔄 Trạng thái: ${autoTradingEnabled ? '🟢 Đang chạy' : '🔴 Đã tắt'}
🧪 Mode: Sandbox (Test)
⏱ Chu kỳ: 5 phút
🎯 Ngưỡng: ≥80 điểm

📊 *Thống kê:*
• Đã chạy: ${autoTradingCount} lần
• Lệnh đang mở: ${openTrades.length}
• Lệnh sandbox: ${openTrades.filter(t => t.mode === 'SANDBOX').length}

${autoTradingEnabled ? `🕐 Lần trading tiếp theo: ${getNextTradingTime()}` : '💡 Sử dụng 🟢 Bật Auto Trading để kích hoạt'}`;

        bot.sendMessage(msg.chat.id, statusMessage, { parse_mode: "Markdown" });
    }
    
    if (data === 'okx_sandbox_link') {
        const sandboxMessage = `🔗 *OKX SANDBOX LINKS*

🧪 *OKX Demo Trading (Sandbox):*
• [OKX Demo Account](https://www.okx.com/demo)
• [Futures Demo Trading](https://www.okx.com/trade-swap-demo)

📊 *Cách sử dụng OKX Sandbox:*
1. Truy cập link Demo Account
2. Đăng ký tài khoản demo (miễn phí)
3. Nhận 100,000 USDT ảo
4. Test trading không rủi ro

🎯 *Theo dõi tín hiệu bot:*
• Bot sẽ tự động vào lệnh sandbox
• Bạn có thể copy lệnh trên OKX Demo
• So sánh kết quả giữa bot và manual

💡 *Lưu ý:*
• Tất cả đều là tiền ảo
• Giá và data real-time
• Hoàn hảo để test chiến lược`;

        bot.sendMessage(msg.chat.id, sandboxMessage, { parse_mode: "Markdown" });
    }
});

let autoScanCount = 0;
let autoTradingCount = 0;

function getNextScanTime() {
    const next = new Date(Date.now() + 5 * 60 * 1000);
    return next.toLocaleTimeString('vi-VN');
}

function startAutoScan() {
    if (autoScanInterval) {
        clearInterval(autoScanInterval);
    }
    
    autoScanInterval = setInterval(async () => {
        if (!autoScanEnabled) return;
        
        console.log("🔄 [AUTO SCAN] Bắt đầu quét tự động...");
        autoScanCount++;
        
        try {
            // Quét top 50 coins
            const allSymbols = await getAllSymbols();
            const topSymbols = allSymbols.slice(0, 50);
            
            const signals = await scanTopSignals(topSymbols, 70);
            
            if (signals.length > 0) {
                // Chỉ gửi thông báo nếu có tín hiệu mới
                let message = `🔄 *AUTO SCAN #${autoScanCount}*\n\n`;
                message += `✅ Tìm thấy ${signals.length} tín hiệu mới:\n\n`;
                
                signals.slice(0, 5).forEach((signal, index) => {
                    const icon = signal.direction === 'LONG' ? '📈' : '📉';
                    message += `${index + 1}. ${icon} ${signal.symbol} | ${signal.confidence.toFixed(1)}%\n`;
                });
                
                if (signals.length > 5) {
                    message += `\n... và ${signals.length - 5} tín hiệu khác`;
                }
                
                message += `\n\n⏰ Lần quét tiếp theo: ${getNextScanTime()}`;
                
                bot.sendMessage(CHAT_ID, message, { parse_mode: "Markdown" });
                
                // Gửi chi tiết tín hiệu tốt nhất
                if (signals[0].confidence >= 80) {
                    const bestSignal = formatSignalMessage(signals[0]);
                    await bot.sendMessage(CHAT_ID, `🔥 *TÍN HIỆU TỐT NHẤT:*\n\n${bestSignal}`, { parse_mode: "Markdown" });
                }
            } else {
                // Thông báo ngắn gọn khi không có tín hiệu
                const message = `🔄 Auto Scan #${autoScanCount}: Không có tín hiệu mới\n⏰ Tiếp theo: ${getNextScanTime()}`;
                bot.sendMessage(CHAT_ID, message);
            }
            
        } catch (error) {
            console.error("Lỗi auto scan:", error);
            bot.sendMessage(CHAT_ID, `❌ Auto Scan #${autoScanCount} lỗi: ${error.message}`);
        }
    }, 5 * 60 * 1000); // 5 phút
}

function startAutoTrading() {
    if (autoTradingInterval) {
        clearInterval(autoTradingInterval);
    }
    
    autoTradingInterval = setInterval(async () => {
        if (!autoTradingEnabled) return;
        
        console.log("🤖 [AUTO TRADING] Bắt đầu quét và trading tự động...");
        autoTradingCount++;
        
        try {
            // Kiểm tra số lệnh đang mở (giới hạn 5 lệnh)
            const openTrades = getOpenTrades();
            if (openTrades.length >= 5) {
                console.log("⚠️ [AUTO TRADING] Đã đạt giới hạn 5 lệnh, bỏ qua lần này");
                return;
            }
            
            // Quét TOÀN BỘ coins OKX
            const allSymbols = await getAllSymbols();
            console.log(`🌍 [AUTO TRADING] Quét ${allSymbols.length} coins...`);
            
            const signals = [];
            let processedCount = 0;
            
            // Quét từng coin để tìm tín hiệu tốt nhất
            for (const symbol of allSymbols) {
                try {
                    const signal = await getSignal(symbol);
                    
                    if (signal.direction !== "NONE" && signal.confidence >= 80) {
                        signal.symbol = symbol;
                        signals.push(signal);
                    }
                    
                    processedCount++;
                    
                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`Lỗi quét ${symbol}:`, error.message);
                }
            }
            
            // Sắp xếp theo confidence và lấy tín hiệu tốt nhất
            signals.sort((a, b) => b.confidence - a.confidence);
            
            let message = `🤖 *AUTO TRADING #${autoTradingCount}*\n\n`;
            message += `🌍 Đã quét ${allSymbols.length} coins\n`;
            message += `✅ Tìm thấy ${signals.length} tín hiệu ≥80%\n`;
            
            if (signals.length > 0) {
                const bestSignal = signals[0];
                
                // Kiểm tra xem đã có lệnh cho coin này chưa
                const existingTrade = openTrades.find(t => t.symbol === bestSignal.symbol);
                
                if (!existingTrade) {
                    // Tự động vào lệnh với tín hiệu tốt nhất
                    const trade = addTrade(bestSignal.symbol, bestSignal.direction, bestSignal.entry, bestSignal.sl, bestSignal.tp);
                    
                    message += `\n🎯 *TỰ ĐỘNG VÀO LỆNH:*\n`;
                    message += `${bestSignal.direction === 'LONG' ? '📈' : '📉'} ${bestSignal.symbol} | ${bestSignal.direction}\n`;
                    message += `💰 Entry: ${bestSignal.entry.toFixed(6)}\n`;
                    message += `🛑 SL: ${bestSignal.sl.toFixed(6)}\n`;
                    message += `🎯 TP: ${bestSignal.tp.toFixed(6)}\n`;
                    message += `📊 Confidence: ${bestSignal.confidence.toFixed(1)}%\n`;
                    message += `🧪 Mode: SANDBOX (Test)\n`;
                    
                    // Gửi chi tiết tín hiệu
                    const detailMessage = formatSignalMessage(bestSignal);
                    await bot.sendMessage(CHAT_ID, `🤖 *AUTO TRADING - CHI TIẾT TÍN HIỆU:*\n\n${detailMessage}`, { parse_mode: "Markdown" });
                    
                } else {
                    message += `\n⚠️ Đã có lệnh ${bestSignal.symbol}, bỏ qua\n`;
                }
                
                // Hiển thị top 3 tín hiệu khác
                if (signals.length > 1) {
                    message += `\n📊 *Top tín hiệu khác:*\n`;
                    signals.slice(1, 4).forEach((signal, index) => {
                        const icon = signal.direction === 'LONG' ? '📈' : '📉';
                        message += `${index + 2}. ${icon} ${signal.symbol} | ${signal.confidence.toFixed(1)}%\n`;
                    });
                }
            } else {
                message += `\n❌ Không có tín hiệu nào đạt ngưỡng 80%\n`;
            }
            
            message += `\n⏰ Lần trading tiếp theo: ${getNextTradingTime()}`;
            
            bot.sendMessage(CHAT_ID, message, { parse_mode: "Markdown" });
            
        } catch (error) {
            console.error("Lỗi auto trading:", error);
            bot.sendMessage(CHAT_ID, `❌ Auto Trading #${autoTradingCount} lỗi: ${error.message}`);
        }
    }, 5 * 60 * 1000); // 5 phút
}

// Lệnh tùy chỉnh auto scan
bot.onText(/\/auto_interval (.+)/, (msg, match) => {
    const minutes = parseInt(match[1]);
    if (minutes < 3 || minutes > 60) {
        return bot.sendMessage(msg.chat.id, '❌ Chu kỳ phải từ 3-60 phút');
    }
    
    // Restart auto scan với chu kỳ mới
    if (autoScanEnabled) {
        clearInterval(autoScanInterval);
        autoScanInterval = setInterval(async () => {
            // Auto scan logic here
        }, minutes * 60 * 1000);
    }
    
    bot.sendMessage(msg.chat.id, `✅ Đã đổi chu kỳ Auto Scan thành ${minutes} phút`);
});

// === OKX SANDBOX LINK ===
bot.onText(/🔗 OKX Sandbox|\/sandbox/, (msg) => {
    const sandboxMessage = `🧪 *OKX SANDBOX - DEMO TRADING*

🔗 *Links chính thức:*
• [OKX Demo Trading](https://www.okx.com/demo)
• [Futures Demo](https://www.okx.com/trade-swap-demo)
• [Spot Demo](https://www.okx.com/trade-spot-demo)

💰 *Tính năng Demo:*
• 100,000 USDT ảo miễn phí
• Giá real-time từ thị trường thật
• Tất cả tính năng như tài khoản thật
• Không rủi ro, không mất tiền

🤖 *Kết hợp với Bot:*
1. Bot auto trading ở sandbox mode
2. Bạn copy lệnh trên OKX Demo
3. So sánh kết quả
4. Test chiến lược an toàn

📊 *Cách bắt đầu:*
1. Click link OKX Demo Trading
2. Đăng ký tài khoản demo
3. Nhận 100,000 USDT ảo
4. Bắt đầu test trading

💡 *Khuyến nghị:*
• Test ít nhất 1 tháng trước khi dùng tiền thật
• Theo dõi win rate và P&L
• Học cách quản lý rủi ro`;

    bot.sendMessage(msg.chat.id, sandboxMessage, { parse_mode: "Markdown" });
});

// === AUTO TRADING MỖI 5 PHÚT ===
bot.onText(/🤖 Auto Trading|\/auto_trading/, (msg) => {
    const IS_SANDBOX = process.env.OKX_SANDBOX === 'true';
    
    if (!IS_SANDBOX) {
        return bot.sendMessage(msg.chat.id, `⚠️ *AUTO TRADING CHỈ HOẠT ĐỘNG Ở SANDBOX MODE*

🔴 Hiện tại đang ở Production Mode
🧪 Để bật Auto Trading, cần:
1. Đặt OKX_SANDBOX=true trong file .env
2. Restart bot
3. Sử dụng /mode để kiểm tra

💡 Auto Trading với tiền thật rất nguy hiểm!`, { parse_mode: "Markdown" });
    }
    
    const autoTradingMenu = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: autoTradingEnabled ? "🔴 Tắt Auto Trading" : "🟢 Bật Auto Trading", callback_data: "toggle_auto_trading" },
                ],
                [
                    { text: "⚙️ Cài Đặt Trading", callback_data: "auto_trading_settings" },
                    { text: "📊 Trạng Thái Trading", callback_data: "auto_trading_status" }
                ],
                [
                    { text: "🔗 OKX Sandbox Link", callback_data: "okx_sandbox_link" }
                ]
            ]
        }
    };
    
    const statusText = autoTradingEnabled ? "🟢 ĐANG BẬT" : "🔴 ĐANG TẮT";
    const message = `🤖 *AUTO TRADING SYSTEM*

🧪 Mode: SANDBOX (An toàn)
📊 Trạng thái: ${statusText}
⏱ Chu kỳ: 5 phút
🌍 Quét: TOÀN BỘ coins OKX
🎯 Ngưỡng: ≥80 điểm confluence
💰 Tự động vào lệnh với tín hiệu tốt nhất

${autoTradingEnabled ? '🔄 Lần trading tiếp theo: ' + getNextTradingTime() : '💡 Bật để tự động trading mỗi 5 phút'}`;

    bot.sendMessage(msg.chat.id, message, { 
        parse_mode: "Markdown", 
        ...autoTradingMenu 
    });
});

function getNextTradingTime() {
    const next = new Date(Date.now() + 5 * 60 * 1000);
    return next.toLocaleTimeString('vi-VN');
}

// Test 1 coin cụ thể
bot.onText(/\/test (.+)/, async (msg, match) => {
    const symbol = match[1].toUpperCase();
    if (!symbol.includes('-USDT-SWAP')) {
        return bot.sendMessage(msg.chat.id, '❌ Format: /test BTC-USDT-SWAP');
    }
    
    bot.sendMessage(msg.chat.id, `🔍 Đang phân tích ${symbol}...`);
    
    try {
        const signal = await getSignal(symbol);
        
        if (signal.direction === "NONE") {
            bot.sendMessage(msg.chat.id, `❌ ${symbol}: ${signal.reason}`);
        } else {
            const message = formatSignalMessage(signal);
            await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
            
            // Thêm link OKX để test
            const coinName = symbol.split('-')[0].toLowerCase();
            const okxLink = `https://www.okx.com/trade-spot/${coinName}-usdt`;
            const testMessage = `🔗 *TEST CHỈ BÁO TRÊN OKX:*
            
[📊 Mở ${symbol} trên OKX](${okxLink})

💡 *Cách test:*
1. Chuyển sang khung 15M
2. Thêm chỉ báo: EMA 9/21, RSI, MACD, Stochastic
3. So sánh với tín hiệu bot
4. Kiểm tra confluence của các chỉ báo`;
            
            bot.sendMessage(msg.chat.id, testMessage, { parse_mode: "Markdown" });
        }
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Lỗi: ${error.message}`);
    }
});

// === QUẢN LÝ LỆNH ===
bot.onText(/\/long (.+) (.+) (.+)/, (msg, match) => {
    const [_, symbol, entry, sl] = match;
    const trade = addTrade(symbol.toUpperCase(), "LONG", parseFloat(entry), parseFloat(sl));
    
    const modeIcon = trade.mode === 'SANDBOX' ? '🧪' : '🔴';
    const modeText = trade.mode === 'SANDBOX' ? 'TEST MODE' : 'REAL TRADING';
    
    bot.sendMessage(msg.chat.id, `✅ *Đã thêm lệnh LONG*

${modeIcon} *Mode:* ${modeText}
📈 Symbol: ${trade.symbol}
💰 Entry: ${trade.entry}
🛑 Stop Loss: ${trade.sl}
⏰ Thời gian: ${trade.openTime.toLocaleString('vi-VN')}

${trade.mode === 'SANDBOX' ? '🧪 Đây là lệnh TEST - Không có tiền thật!' : '⚠️ Đây là lệnh THẬT - Cẩn thận!'}

Bot sẽ tự động theo dõi và thông báo khi chạm SL.`, { parse_mode: "Markdown" });
});

bot.onText(/\/short (.+) (.+) (.+)/, (msg, match) => {
    const [_, symbol, entry, sl] = match;
    const trade = addTrade(symbol.toUpperCase(), "SHORT", parseFloat(entry), parseFloat(sl));
    
    const modeIcon = trade.mode === 'SANDBOX' ? '🧪' : '🔴';
    const modeText = trade.mode === 'SANDBOX' ? 'TEST MODE' : 'REAL TRADING';
    
    bot.sendMessage(msg.chat.id, `✅ *Đã thêm lệnh SHORT*

${modeIcon} *Mode:* ${modeText}
📉 Symbol: ${trade.symbol}
💰 Entry: ${trade.entry}
🛑 Stop Loss: ${trade.sl}
⏰ Thời gian: ${trade.openTime.toLocaleString('vi-VN')}

${trade.mode === 'SANDBOX' ? '🧪 Đây là lệnh TEST - Không có tiền thật!' : '⚠️ Đây là lệnh THẬT - Cẩn thận!'}

Bot sẽ tự động theo dõi và thông báo khi chạm SL.`, { parse_mode: "Markdown" });
});

bot.onText(/\/close (.+)/, (msg, match) => {
    const symbol = match[1].toUpperCase();
    const result = closeTrade(symbol, "Manual");
    
    if (result.success) {
        bot.sendMessage(msg.chat.id, `✅ Đã đóng lệnh ${symbol} thành công.`);
    } else {
        bot.sendMessage(msg.chat.id, `❌ ${result.message}`);
    }
});

bot.onText(/📊 Lệnh Đang Mở|\/positions/, (msg) => {
    const trades = getOpenTrades();
    
    if (trades.length === 0) {
        bot.sendMessage(msg.chat.id, "📭 Không có lệnh nào đang mở.");
        return;
    }
    
    let message = `📊 *LỆNH ĐANG MỞ (${trades.length})*\n\n`;
    trades.forEach((trade, index) => {
        const icon = trade.direction === 'LONG' ? '📈' : '📉';
        message += `${index + 1}. ${icon} *${trade.symbol}*
   Direction: ${trade.direction}
   Entry: ${trade.entry}
   Stop Loss: ${trade.sl}
   Thời gian: ${trade.openTime.toLocaleString('vi-VN')}\n\n`;
    });
    
    bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
});

bot.onText(/📈 Thống Kê|\/stats/, (msg) => {
    const stats = getTradeStats();
    bot.sendMessage(msg.chat.id, stats, { parse_mode: "Markdown" });
});

// === THEO DÕI TỰ ĐỘNG ===
// Theo dõi lệnh mỗi 30 giây
setInterval(() => {
    monitorTrades(bot, CHAT_ID);
}, 30000);

// Thông báo bot đã sẵn sàng
bot.sendMessage(CHAT_ID, `🚀 *Bot đã khởi động thành công!*

🔧 *Environment:* ${IS_SANDBOX ? '🧪 SANDBOX (Test Mode)' : '🔴 PRODUCTION (Real Trading)'}

🎯 Sẵn sàng quét tín hiệu Multi-Indicator
📊 Hệ thống: 7 chỉ báo confluence
⚡ Có thể quét TOÀN BỘ coins OKX
🌍 Từ top 50 đến tất cả coins
⏰ Auto Scan mỗi 5 phút
🤖 Auto Trading với Sandbox mode

${IS_SANDBOX ? '🧪 Đang chạy ở chế độ TEST - An toàn để thử nghiệm!' : '⚠️ Đang chạy ở chế độ REAL - Cẩn thận với giao dịch!'}

Sử dụng menu hoặc /help để bắt đầu!`, { 
    parse_mode: "Markdown", 
    ...mainMenu 
});

console.log("✅ Bot đã sẵn sàng hoạt động!");