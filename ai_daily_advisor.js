// ai_daily_advisor.js - AI Daily Trading Advisor cho Telegram
import axios from 'axios';
import dotenv from 'dotenv';
import { getCurrentPrice } from './okx.js';
import { getCandles } from './okx.js';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

class DailyTradingAdvisor {
    constructor() {
        this.apiKey = GROQ_API_KEY;
        this.baseURL = 'https://api.groq.com/openai/v1';
        this.model = 'llama-3.3-70b-versatile';
    }

    /**
     * Get simplified market data for AI
     */
    async getMarketSummary(symbol) {
        try {
            // Only get LAST candle of each timeframe (not full history)
            const [currentPrice, daily, h4, h1] = await Promise.all([
                getCurrentPrice(symbol),
                getCandles(symbol, '1D', 2), // Only last 2 days
                getCandles(symbol, '4H', 3), // Only last 3 candles
                getCandles(symbol, '1H', 5)  // Only last 5 hours
            ]);

            // Get summary only
            const lastDaily = daily[daily.length - 1];
            const lastH4 = h4[h4.length - 1];
            const recentH1 = h1.slice(-3);

            return {
                symbol,
                current_price: currentPrice,
                daily_summary: {
                    open: lastDaily.open,
                    high: lastDaily.high,
                    low: lastDaily.low,
                    close: lastDaily.close,
                    volume: lastDaily.volume,
                    change: ((parseFloat(lastDaily.close) - parseFloat(lastDaily.open)) / parseFloat(lastDaily.open) * 100).toFixed(2)
                },
                h4_summary: {
                    price: lastH4.close,
                    volume: lastH4.volume
                },
                h1_recent: recentH1.map(c => ({
                    price: c.close,
                    volume: c.volume
                })),
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('Error getting market summary:', error);
            return null;
        }
    }

    /**
     * Ask AI for daily trading recommendation
     */
    async getDailyRecommendation(symbol) {
        try {
            const marketData = await this.getMarketSummary(symbol);
            
            if (!marketData) {
                return {
                    success: false,
                    error: 'Không lấy được data'
                };
            }

            const prompt = `
PHÂN TÍCH THỊ TRƯỜNG ${symbol} - ${new Date().toLocaleDateString('vi-VN')}

DỮ LIỆU:
- Giá hiện tại: $${marketData.current_price}
- Daily: O:$${marketData.daily_summary.open} H:$${marketData.daily_summary.high} L:$${marketData.daily_summary.low} C:$${marketData.daily_summary.close} (${marketData.daily_summary.change}%)
- Volume 24h: ${marketData.daily_summary.volume.toFixed(2)}

YÊU CẦU:
Trả về JSON với format:
{
  "decision": "LONG" hoặc "SHORT" hoặc "NO_TRADE",
  "confidence": 0.8,
  "reason": "Lý do ngắn gọn",
  "entry_zone": "$109000-$110000",
  "stop_loss": "$108000",
  "take_profit": "$112000",
  "risk_level": "MEDIUM",
  "notes": "Ghi chú thêm"
}

Chỉ phân tích dựa trên: Trend (bullish/bearish/neutral), Support/Resistance, Volume, Volatility.
KHÔNG đưa lời khuyên tài chính. Chỉ là phân tích kỹ thuật.
`;

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: 'Bạn là trader crypto chuyên nghiệp. Phân tích kỹ thuật súc tích, rõ ràng. Luôn trả về JSON đúng format được yêu cầu.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.2,
                    response_format: { type: 'json_object' },
                    max_tokens: 500
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const result = JSON.parse(response.data.choices[0].message.content);
            
            return {
                success: true,
                symbol,
                data: {
                    ...result,
                    current_price: marketData.current_price,
                    market_summary: {
                        daily_change: marketData.daily_summary.change,
                        volume: marketData.daily_summary.volume
                    }
                }
            };

        } catch (error) {
            console.error('Error getting AI recommendation:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Format recommendation for Telegram
     */
    formatTelegramMessage(result) {
        if (!result.success) {
            return `❌ Lỗi phân tích: ${result.error}`;
        }

        const data = result.data;
        const emoji = data.decision === 'LONG' ? '📈' : data.decision === 'SHORT' ? '📉' : '⏸️';
        const action = data.decision === 'LONG' ? 'MUỐN' : data.decision === 'SHORT' ? 'BÁN' : 'ĐỨNG NGOÀI';
        
        return `
${emoji} *KHUYẾN NGHỊ HÔM NAY*
━━━━━━━━━━━━━━━━━━━━
🎯 *Hành động:* ${action}
📊 *Ký hiệu:* ${result.symbol}
💰 *Giá hiện tại:* $${data.current_price}
🎲 *Độ tin cậy:* ${(data.confidence * 100).toFixed(0)}%

📝 *Lý do:*
${data.reason}

📍 *Vùng vào:* ${data.entry_zone}
🛑 *Stop Loss:* ${data.stop_loss}
🎯 *Take Profit:* ${data.take_profit}
⚠️ *Rủi ro:* ${data.risk_level}

💡 *Ghi chú:*
${data.notes}

📅 Thời gian: ${new Date().toLocaleString('vi-VN')}
`;
    }
}

export default DailyTradingAdvisor;

