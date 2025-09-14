// okx.js
import axios from "axios";

const BASE_URL = "https://www.okx.com";

// Lấy dữ liệu nến từ OKX
export async function getCandles(symbol = "BTC-USDT", bar = "1H", limit = 100) {
  const res = await axios.get(`${BASE_URL}/api/v5/market/candles`, {
    params: { instId: symbol, bar, limit }
  });

  // Trả về theo thứ tự thời gian cũ -> mới
  return res.data.data
    .map(c => ({
      ts: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4])
    }))
    .reverse();
}
