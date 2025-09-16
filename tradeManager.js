// tradeManager.js
import dotenv from "dotenv";
dotenv.config();

const openTrades = [];
const tradeHistory = []; // [MỚI] Mảng để lưu lịch sử các lệnh đã đóng
const RR = Number(process.env.RR || 2);

// [MỚI] Ngưỡng cảnh báo khi thua liên tiếp
const LOSS_STREAK_THRESHOLD = 3;

export function addTrade(symbol, direction, entry, sl, bot, chatId) {
  // Kiểm tra xem đã có lệnh cho symbol này chưa
  const existingTrade = openTrades.find(t => t.symbol === symbol);
  if (existingTrade) {
    bot.sendMessage(chatId, `⚠️ Bạn đã có một lệnh ${existingTrade.direction} cho ${symbol} đang được theo dõi. Vui lòng đóng lệnh cũ trước khi mở lệnh mới.`);
    return;
  }

  const risk = Math.abs(entry - sl);
  const tp = direction === "LONG" ? entry + risk * RR : entry - risk * RR;

  openTrades.push({ symbol, direction, entry, sl, tp });
  bot.sendMessage(
    chatId,
    `✅ Theo dõi lệnh ${direction} ${symbol}\n📍 Entry: ${entry}\n🛑 SL: ${sl}\n🎯 TP: ${tp} (RR 1:${RR})`
  );
}

// [NÂNG CẤP] Hàm closeTrade giờ sẽ ghi lại lịch sử và kiểm tra chuỗi thua
export function closeTrade(symbol, bot, chatId, reason = "Đóng lệnh theo dõi") {
  const idx = openTrades.findIndex(t => t.symbol === symbol);
  if (idx !== -1) {
    const closedTrade = openTrades.splice(idx, 1)[0];

    // Xác định kết quả lệnh
    if (reason === "Hit TP") {
      closedTrade.result = "WIN";
    } else if (reason === "Hit SL") {
      closedTrade.result = "LOSS";
    } else {
      closedTrade.result = "CLOSED_MANUALLY"; // Đóng thủ công hoặc do tín hiệu đảo chiều
    }
    
    // Thêm vào lịch sử
    tradeHistory.push(closedTrade);

    // Gửi tin nhắn thông báo đóng lệnh (giữ nguyên)
    // bot.sendMessage(chatId, `🛑 ${reason} (${symbol})`); // Tin nhắn này đã được gửi từ indicators.js, không cần gửi lại

    // [MỚI] Kiểm tra chuỗi thua
    if (closedTrade.result === "LOSS") {
      // Lấy ra N lệnh cuối cùng từ lịch sử, với N là ngưỡng cảnh báo
      const recentTrades = tradeHistory.slice(-LOSS_STREAK_THRESHOLD);
      // Kiểm tra xem tất cả các lệnh gần đây có phải là thua không
      const isLossStreak = recentTrades.length === LOSS_STREAK_THRESHOLD && recentTrades.every(t => t.result === 'LOSS');

      if (isLossStreak) {
        const warningMessage = `
🔥🔥 *[CẢNH BÁO QUẢN LÝ VỐN]* 🔥🔥
Bạn đã thua **${LOSS_STREAK_THRESHOLD}** lệnh liên tiếp!
Đây là dấu hiệu cho thấy thị trường hoặc chiến lược của bạn đang không ổn định.
**Gợi ý:**
- Tạm dừng giao dịch trong hôm nay.
- Xem lại các lệnh thua để tìm ra lý do.
- Giảm khối lượng giao dịch ở các lệnh tiếp theo.
`;
        bot.sendMessage(chatId, warningMessage, { parse_mode: "Markdown" });
      }
    }

  } else {
    bot.sendMessage(chatId, `⚠️ Không tìm thấy lệnh ${symbol} đang theo dõi để đóng.`);
  }
}

export function getOpenTrades() {
  return openTrades;
}

// [MỚI] Hàm để lấy thống kê giao dịch
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
- Số lệnh đóng thủ công: *${manualCloses}* manualmente
- Tỷ lệ thắng (Win/Loss): *${winRate}%*
`;
}