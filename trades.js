// trades.js - Quản lý lệnh đơn giản
import { getCurrentPrice, isSandboxMode, simulateOrder } from "./okx.js";

// Lưu trữ lệnh trong memory (đơn giản)
let openTrades = [];
let tradeHistory = [];
let tradeIdCounter = 1;

/**
 * Thêm lệnh mới
 */
export function addTrade(symbol, direction, entry, sl, tp = null) {
    const trade = {
        id: tradeIdCounter++,
        symbol: symbol.toUpperCase(),
        direction: direction.toUpperCase(),
        entry: parseFloat(entry),
        sl: parseFloat(sl),
        tp: tp ? parseFloat(tp) : null,
        openTime: new Date(),
        status: 'OPEN',
        mode: isSandboxMode() ? 'SANDBOX' : 'PRODUCTION'
    };
    
    // Nếu là sandbox mode, mô phỏng giao dịch
    if (isSandboxMode()) {
        const simulatedOrder = simulateOrder(symbol, direction, 1, entry);
        trade.simulatedOrderId = simulatedOrder.orderId;
        console.log(`🧪 [SANDBOX] Đã thêm lệnh test: ${trade.symbol} ${trade.direction} @ ${trade.entry}`);
    } else {
        console.log(`🔴 [PRODUCTION] Đã thêm lệnh thật: ${trade.symbol} ${trade.direction} @ ${trade.entry}`);
    }
    
    openTrades.push(trade);
    return trade;
}

/**
 * Đóng lệnh
 */
export function closeTrade(symbol, reason = "Manual") {
    const tradeIndex = openTrades.findIndex(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    
    if (tradeIndex === -1) {
        return { success: false, message: "Không tìm thấy lệnh" };
    }
    
    const trade = openTrades[tradeIndex];
    trade.closeTime = new Date();
    trade.closeReason = reason;
    trade.status = 'CLOSED';
    
    // Chuyển vào lịch sử
    tradeHistory.push(trade);
    openTrades.splice(tradeIndex, 1);
    
    console.log(`❌ Đã đóng lệnh: ${trade.symbol} ${trade.direction} - ${reason}`);
    
    return { success: true, trade: trade };
}

/**
 * Lấy danh sách lệnh đang mở
 */
export function getOpenTrades() {
    return [...openTrades];
}

/**
 * Theo dõi lệnh real-time
 */
export async function monitorTrades(bot, chatId) {
    if (openTrades.length === 0) return;
    
    console.log(`[MONITOR] Đang theo dõi ${openTrades.length} lệnh...`);
    
    for (const trade of openTrades) {
        try {
            const currentPrice = await getCurrentPrice(trade.symbol);
            if (!currentPrice) continue;
            
            let shouldClose = false;
            let closeReason = "";
            
            // Kiểm tra TP
            if (trade.tp) {
                if ((trade.direction === 'LONG' && currentPrice >= trade.tp) ||
                    (trade.direction === 'SHORT' && currentPrice <= trade.tp)) {
                    shouldClose = true;
                    closeReason = "Hit TP";
                }
            }
            
            // Kiểm tra SL
            if ((trade.direction === 'LONG' && currentPrice <= trade.sl) ||
                (trade.direction === 'SHORT' && currentPrice >= trade.sl)) {
                shouldClose = true;
                closeReason = "Hit SL";
            }
            
            if (shouldClose) {
                const result = closeTrade(trade.symbol, closeReason);
                if (result.success) {
                    const pnl = calculatePnL(result.trade, currentPrice);
                    const icon = pnl >= 0 ? '✅' : '❌';
                    const message = `${icon} *[${closeReason}] ${trade.symbol}*
                    
Lệnh: ${trade.direction}
Entry: ${trade.entry}
Exit: ${currentPrice}
P&L: ${pnl.toFixed(2)}%

Lý do: ${closeReason}`;
                    
                    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
                }
            }
            
        } catch (error) {
            console.error(`Lỗi monitor ${trade.symbol}:`, error.message);
        }
    }
}

/**
 * Tính P&L
 */
function calculatePnL(trade, exitPrice) {
    if (trade.direction === 'LONG') {
        return ((exitPrice - trade.entry) / trade.entry) * 100;
    } else {
        return ((trade.entry - exitPrice) / trade.entry) * 100;
    }
}

/**
 * Thống kê trading
 */
export function getTradeStats() {
    const totalTrades = tradeHistory.length;
    if (totalTrades === 0) {
        return "📊 *THỐNG KÊ TRADING*\n\nChưa có lệnh nào được đóng.";
    }
    
    const winTrades = tradeHistory.filter(t => {
        if (t.closeReason === "Hit TP") return true;
        if (t.closeReason === "Hit SL") return false;
        return false; // Manual close không tính
    });
    
    const lossTrades = tradeHistory.filter(t => t.closeReason === "Hit SL");
    
    const winRate = totalTrades > 0 ? (winTrades.length / totalTrades * 100).toFixed(1) : 0;
    
    return `📊 *THỐNG KÊ TRADING*

📈 Tổng lệnh: ${totalTrades}
✅ Thắng: ${winTrades.length}
❌ Thua: ${lossTrades.length}
📊 Win Rate: ${winRate}%
🔄 Đang mở: ${openTrades.length}

💡 *Lệnh gần nhất:*
${tradeHistory.slice(-3).map(t => 
    `• ${t.symbol} ${t.direction} - ${t.closeReason}`
).join('\n')}`;
}