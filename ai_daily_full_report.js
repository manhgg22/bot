// ai_daily_full_report.js - AI Daily Full Report
import axios from 'axios';
import dotenv from 'dotenv';
import { getAllSymbols, getCandles, getCurrentPrice } from './okx.js';
import { getAllSignalsForSymbol } from './indicators.js';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;

class DailyFullReport {
    constructor() {
        this.apiKey = GROQ_API_KEY;
        this.baseURL = 'https://api.groq.com/openai/v1';
        this.model = 'llama-3.3-70b-versatile';
    }

    /**
     * AI Daily Summary - Tổng hợp phân tích cho nhiều coins
     */
    async generateDailySummary(analysisResults) {
        try {
            const summary = `
PHÂN TÍCH TỔNG HỢP HÔM NAY:

Tổng số coins: ${analysisResults.length}
LONG signals: ${analysisResults.filter(r => r.decision === 'LONG').length}
SHORT signals: ${analysisResults.filter(r => r.decision === 'SHORT').length}
NO_TRADE: ${analysisResults.filter(r => r.decision === 'NO_TRADE').length}

Top 5 LONG:
${analysisResults.filter(r => r.decision === 'LONG').slice(0, 5).map((r, i) => `${i+1}. ${r.symbol} - ${r.confidence}% confidence - ${r.reason}`).join('\n')}

Đưa ra KẾT LUẬN: Hôm nay nên LONG hay SHORT hay đứng ngoài?
Trả JSON: {"overall_decision":"LONG/SHORT/NO_TRADE", "confidence":0.8, "summary":"Tóm tắt ngắn gọn", "top_recommendations":["BTC-USDT-SWAP", "ETH-USDT-SWAP"]}`;

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'Trader chuyên nghiệp. Phân tích tổng hợp và đưa ra quyết định cuối cùng.' },
                        { role: 'user', content: summary }
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

            return JSON.parse(response.data.choices[0].message.content);
        } catch (error) {
            console.error('Error generating summary:', error);
            return null;
        }
    }

    /**
     * Analyze ONE coin with AI - FAST
     */
    async analyzeCoinFast(symbol, marketData) {
        try {
            const signals = await getAllSignalsForSymbol(symbol);
            const change = ((parseFloat(marketData.close) - parseFloat(marketData.open)) / parseFloat(marketData.open) * 100).toFixed(2);
            
            const prompt = `${symbol}. Giá:$${marketData.close}, Daily:${change}%, Signals:${signals.length}. 
Trả JSON: {"decision":"LONG/SHORT/NO_TRADE", "confidence":0.7, "reason":"ngắn"}`;

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: 'Trader crypto. JSON ngắn: decision, confidence, reason.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.2,
                    response_format: { type: 'json_object' },
                    max_tokens: 150
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
                symbol,
                price: parseFloat(marketData.close),
                volume: marketData.volume,
                daily_change: change,
                decision: result.decision,
                confidence: result.confidence || 0.5,
                reason: result.reason || 'No reason',
                signals_count: signals.length
            };
            
        } catch (error) {
            return {
                symbol,
                decision: 'NO_TRADE',
                confidence: 0,
                reason: 'Analysis failed'
            };
        }
    }

    /**
     * Scan ALL coins + Generate Daily Report
     */
    async generateDailyReport() {
        console.log(`\n🤖 AI DAILY FULL REPORT - TẤT CẢ COINS\n`);
        console.log('='.repeat(60));
        
        // Get all symbols
        console.log('📊 Lấy danh sách coins từ OKX...');
        const symbols = await getAllSymbols();
        const swapSymbols = symbols.filter(s => s.includes('-USDT-SWAP'));
        console.log(`Found ${swapSymbols.length} SWAP pairs`);
        
        // Get TẤT CẢ coins by volume
        console.log('📊 Getting volume data for ALL coins...');
        const volumeData = [];
        
        for (const symbol of swapSymbols) {
            try {
                const candles = await getCandles(symbol, '1D', 1);
                if (candles && candles.length > 0) {
                    const lastCandle = candles[candles.length - 1];
                    const volume = parseFloat(lastCandle.volume) || 0;
                    if (volume > 0) {
                        volumeData.push({
                            symbol,
                            volume,
                            open: lastCandle.open,
                            close: lastCandle.close,
                            high: lastCandle.high,
                            low: lastCandle.low
                        });
                    }
                }
            } catch (err) {
                // Skip
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        volumeData.sort((a, b) => b.volume - a.volume);
        const totalCoins = volumeData.length;
        console.log(`✅ Found ${totalCoins} coins with volume\n`);
        
        // AI analyze each
        console.log(`🤖 AI đang phân tích ${volumeData.length} coins...\n`);
        const results = [];
        
        for (let i = 0; i < volumeData.length; i++) {
            const coin = volumeData[i];
            console.log(`[${i+1}/${volumeData.length}] ${coin.symbol}...`);
            
            const analysis = await this.analyzeCoinFast(coin.symbol, coin);
            results.push(analysis);
            
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Filter only good signals (confidence > 0.6)
        const goodSignals = results.filter(r => r.confidence > 0.6);
        const longs = goodSignals.filter(r => r.decision === 'LONG').slice(0, 10);
        const shorts = goodSignals.filter(r => r.decision === 'SHORT').slice(0, 10);
        
        // Generate summary
        const aiSummary = await this.generateDailySummary(goodSignals);
        
        console.log('\n✅ Analysis completed!');
        
        return {
            success: true,
            date: new Date().toISOString().split('T')[0],
            total_scanned: volumeData.length,
            total_signals: goodSignals.length,
            longs: longs,
            shorts: shorts,
            ai_summary: aiSummary,
            timestamp: Date.now()
        };
    }

    /**
     * Format report for Telegram
     */
    formatTelegramReport(result) {
        const { ai_summary, longs, shorts, total_scanned, total_signals } = result;
        
        let message = `🎯 *BÁO CÁO NGÀY ${result.date}*\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        // AI Summary
        if (ai_summary) {
            const emoji = ai_summary.overall_decision === 'LONG' ? '📈' : 
                         ai_summary.overall_decision === 'SHORT' ? '📉' : '⏸️';
            
            message += `${emoji} *KẾT LUẬN: ${ai_summary.overall_decision}*\n`;
            message += `🎲 Confidence: ${(ai_summary.confidence * 100).toFixed(0)}%\n`;
            message += `📝 ${ai_summary.summary}\n\n`;
            
            if (ai_summary.top_recommendations && ai_summary.top_recommendations.length > 0) {
                message += `⭐ *Top recommendations:*\n`;
                ai_summary.top_recommendations.forEach(coin => {
                    message += `• ${coin}\n`;
                });
                message += `\n`;
            }
        }
        
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `📊 *Thống kê:*\n`;
        message += `• Đã scan TOÀN BỘ: ${total_scanned} coins\n`;
        message += `• Signals: ${total_signals}\n`;
        message += `• LONG: ${longs.length}\n`;
        message += `• SHORT: ${shorts.length}\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        // Top LONGs
        if (longs.length > 0) {
            message += `📈 *TOP LONG (Top ${longs.length}):*\n\n`;
            longs.forEach((coin, i) => {
                message += `${i+1}. *${coin.symbol}*\n`;
                message += `   💰 Giá: $${coin.price.toFixed(4)}\n`;
                message += `   🎲 Confidence: ${(coin.confidence * 100).toFixed(0)}%\n`;
                message += `   📊 Signals: ${coin.signals_count}\n`;
                message += `   📝 ${coin.reason}\n`;
                message += `\n`;
            });
        }
        
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `⏰ ${new Date().toLocaleString('vi-VN')}\n`;
        
        return message;
    }
}

export default DailyFullReport;

