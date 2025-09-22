// okx.js
import axios from "axios";

const BASE_URL = "https://www.okx.com";

/**
 * [NÂNG CẤP] Lấy dữ liệu nến từ thị trường Futures (SWAP) của OKX.
 * Symbol giờ đây sẽ có định dạng là: BTC-USDT-SWAP, ETH-USDT-SWAP, v.v.
 * Hàm này cũng đã được cập nhật để lấy cả dữ liệu Volume.
 */
export async function getCandles(symbol, bar = "1H", limit = 100) {
  try {
    const res = await axios.get(`${BASE_URL}/api/v5/market/candles`, {
      params: { instId: symbol, bar, limit }
    });

    // Dữ liệu OKX trả về có các cột theo thứ tự:
    // [ts, open, high, low, close, vol, volCcy]
    // - vol: Khối lượng giao dịch (tính bằng coin, ví dụ: BTC)
    // - volCcy: Khối lượng giao dịch (tính bằng tiền tệ, ví dụ: USDT)
    // Chúng ta sẽ dùng volCcy (ở vị trí thứ 6) để so sánh khối lượng giữa các coin cho nhất quán.
    return res.data.data
      .map(c => ({
        ts: Number(c[0]),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[6]) // Lấy volCcy
      }))
      .reverse(); // Đảo ngược để có thứ tự từ cũ -> mới
  } catch (error) {
      // Bắt lỗi nếu symbol không hợp lệ hoặc API có vấn đề, trả về mảng rỗng để bot không bị dừng.
      // console.error(`Lỗi khi lấy nến cho ${symbol}: ${error.message}`);
      return [];
  }
}

/**
 * Lấy giá giao dịch gần nhất (last price) cho một hợp đồng Futures.
 * Hàm này không thay đổi so với phiên bản trước.
 */
export async function getCurrentPrice(symbol) {
  try {
    const res = await axios.get(`${BASE_URL}/api/v5/market/ticker`, {
      params: { instId: symbol }
    });
    if (res.data && res.data.data && res.data.data.length > 0) {
      return Number(res.data.data[0].last);
    }
    return null;
  } catch (error) {
    console.error(`❌ Lỗi khi lấy giá cho ${symbol}:`, error.message);
    return null;
  }
}