// tradeManager.js
import dotenv from "dotenv";
dotenv.config();

const openTrades = []; 
const tradeHistory = []; 
const RR = Number(process.env.RR || 2);
const LOSS_STREAK_THRESHOLD = 3;

// [NÂNG CẤP] Hàm này giờ sẽ kiểm tra lệnh trùng lặp
export function addTrade(symbol, direction, entry, sl, bot, chatId) {
  // Tự động làm sạch tên symbol (xóa khoảng trắng, viết hoa)
  const cleanSymbol = symbol.trim().toUpperCase();

  // [LOGIC MỚI] Kiểm tra xem đã có lệnh cho symbol này đang được theo dõi chưa
  const existingTrade = openTrades.find(t => t.symbol === cleanSymbol);
  if (existingTrade) {
    bot.sendMessage(
      chatId, 
      `⚠️ Bạn đã có một lệnh ${existingTrade.direction} cho ${cleanSymbol} đang được theo dõi. Vui lòng đóng lệnh cũ bằng lệnh \`/close ${cleanSymbol}\` trước khi mở một lệnh mới.`
    );
    return; // Dừng lại, không thêm lệnh mới
  }

  // Nếu không có lệnh cũ, tiếp tục thêm lệnh mới như bình thường
  const risk = Math.abs(entry - sl);
  const tp = direction === "LONG" ? entry + risk * RR : entry - risk * RR;

  openTrades.push({ symbol: cleanSymbol, direction, entry, sl, tp }); // Sử dụng tên đã được làm sạch
  bot.sendMessage(
    chatId,
    `✅ Theo dõi lệnh ${direction} ${cleanSymbol}\n📍 Entry: ${entry}\n🛑 SL: ${sl}\n🎯 TP: ${tp} (RR 1:${RR})`
  );
}

// [NÂNG CẤP] Đảm bảo hàm closeTrade cũng dùng tên đã được làm sạch
export function closeTrade(symbol, bot, chatId, reason = "Đóng lệnh theo dõi") {
  const cleanSymbol = symbol.trim().toUpperCase();
  const idx = openTrades.findIndex(t => t.symbol === cleanSymbol);

  if (idx !== -1) {
    const closedTrade = openTrades.splice(idx, 1)[0];

    if (reason === "Hit TP") {
      closedTrade.result = "WIN";
    } else if (reason === "Hit SL") {
      closedTrade.result = "LOSS";
    } else {
      closedTrade.result = "CLOSED_MANUALLY";
    }
    
    tradeHistory.push(closedTrade);

    if (closedTrade.result === "LOSS") {
      const recentTrades = tradeHistory.slice(-LOSS_STREAK_THRESHOLD);
      const isLossStreak = recentTrades.length === LOSS_STREAK_THRESHOLD && recentTrades.every(t => t.result === 'LOSS');

      if (isLossStreak) {
        const warningMessage = `
🔥🔥 *[CẢNH BÁO QUẢN LÝ VỐN]* 🔥🔥
Bạn đã thua **${LOSS_STREAK_THRESHOLD}** lệnh liên tiếp!
**Gợi ý:**
- Tạm dừng giao dịch.
- Xem lại các lệnh thua để tìm lý do.
- Giảm khối lượng giao dịch.
`;
        bot.sendMessage(chatId, warningMessage, { parse_mode: "Markdown" });
      }
    }

  } else {
    bot.sendMessage(chatId, `⚠️ Không tìm thấy lệnh ${cleanSymbol} đang theo dõi để đóng.`);
  }
}

export function getOpenTrades() {
  return openTrades;
}

export function getTradeStats() {
    const totalTrades = tradeHistory.length;
    if (totalTrades === 0) {
        return "Bạn chưa có lệnh nào được ghi nhận trong lịch sử.";
    }

    const wins = tradeHistory.filter(t => t.result === 'WIN').length;
    const losses = tradeHistory.filter(t => t.result === 'LOSS').length;
    const manualCloses = totalTrades - wins - losses;
    const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0;

    return `
📊 *THỐNG KÊ GIAO DỊCH* 📊
- Tổng số lệnh đã đóng: *${totalTrades}*
- Số lệnh thắng (Hit TP): *${wins}* ✅
- Số lệnh thua (Hit SL): *${losses}* ❌
- Số lệnh đóng thủ công: *${manualCloses}*
- Tỷ lệ thắng (Win/Loss): *${winRate}%*
`;
}