// okx.js
import axios from "axios";

const BASE_URL = "https://www.okx.com";

/**
 * [NÂNG CẤP] Lấy dữ liệu nến từ thị trường Futures (SWAP) của OKX.
 * Symbol giờ đây sẽ có định dạng là: BTC-USDT-SWAP, ETH-USDT-SWAP, v.v.
 * Hàm này cũng đã được cập nhật để lấy cả dữ liệu Volume.
 */
// Rate limiting helper
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // 100ms giữa các request (10 req/s)

async function rateLimitedRequest(url, params) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  lastRequestTime = Date.now();
  
  try {
    const res = await axios.get(url, { params });
    return res;
  } catch (error) {
    if (error.response && error.response.status === 429) {
      // Rate limit hit, wait longer
      console.log(`Rate limit hit for ${params.instId}, waiting 2 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      // Retry once
      return await axios.get(url, { params });
    }
    throw error;
  }
}

export async function getCandles(symbol, bar = "1H", limit = 100) {
  try {
    const res = await rateLimitedRequest(`${BASE_URL}/api/v5/market/candles`, {
      instId: symbol, 
      bar, 
      limit
    });

    if (res.data.code !== '0') {
      return [];
    }

    const candles = res.data.data
      .map(c => ({
        ts: Number(c[0]),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[6]) // Lấy volCcy
      }))
      .reverse(); // Đảo ngược để có thứ tự từ cũ -> mới
    
    return candles;
  } catch (error) {
      console.error(`Lỗi khi lấy nến cho ${symbol}: ${error.message}`);
      return [];
  }
}

/**
 * Lấy giá giao dịch gần nhất (last price) cho một hợp đồng Futures.
 * Hàm này không thay đổi so với phiên bản trước.
 */
export async function getCurrentPrice(symbol) {
  try {
    const res = await rateLimitedRequest(`${BASE_URL}/api/v5/market/ticker`, {
      instId: symbol
    });
    
    if (res.data && res.data.data && res.data.data.length > 0) {
      const price = Number(res.data.data[0].last);
      return price;
    }
    
    return null;
  } catch (error) {
    console.error(`Lỗi khi lấy giá cho ${symbol}: ${error.message}`);
    return null;
  }
}

/**
 * Lấy danh sách tất cả symbol từ OKX Futures
 */
export async function getAllSymbols() {
  try {
    const response = await rateLimitedRequest(`${BASE_URL}/api/v5/public/instruments`, {
      instType: 'SWAP',
      state: 'live'
    });

    if (response.data && response.data.data) {
      // Lọc chỉ lấy các symbol có volume cao và loại bỏ các symbol không phổ biến
      const symbols = response.data.data
        .filter(item => 
          item.instId && item.instId.includes('USDT') && 
          !item.instId.includes('TEST') &&
          !item.instId.includes('DEMO')
        )
        .map(item => item.instId)
        .sort();
      
      return symbols;
    }
    
    return [];
  } catch (error) {
    console.error(`Lỗi khi lấy danh sách symbol: ${error.message}`);
    return [];
  }
}