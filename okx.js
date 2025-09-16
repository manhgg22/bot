// okx.js
import axios from "axios";

const BASE_URL = "https://www.okx.com";

// Lấy dữ liệu nến từ OKX (giữ nguyên hàm cũ)
export async function getCandles(symbol = "BTC-USDT", bar = "1H", limit = 100) {
  const res = await axios.get(`${BASE_URL}/api/v5/market/candles`, {
    params: { instId: symbol, bar, limit }
  });

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

// [MỚI] Hàm lấy giá thị trường hiện tại của một symbol
export async function getCurrentPrice(symbol) {
  try {
    const res = await axios.get(`${BASE_URL}/api/v5/market/ticker`, {
      params: { instId: symbol }
    });
    // API trả về một mảng, ta lấy phần tử đầu tiên và giá 'last'
    if (res.data && res.data.data && res.data.data.length > 0) {
      return Number(res.data.data[0].last);
    }
    return null; // Trả về null nếu không có dữ liệu
  } catch (error) {
    console.error(`❌ Lỗi khi lấy giá cho ${symbol}:`, error.message);
    return null;
  }
}