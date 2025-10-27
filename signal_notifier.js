// signal_notifier.js - CHỈ GỬI TÍN HIỆU, KHÔNG AUTO TRADE
import dotenv from 'dotenv';

dotenv.config();

class SignalNotifier {
    constructor(bot = null) {
        this.bot = bot;
        this.sentSignals = new Set(); // Track để tránh trùng
    }

    /**
     * Xử lý signal - CHỈ GỬI QUA TELEGRAM, KHÔNG AUTO TRADE
     */
    async processSignal(signal) {
        const symbol = signal.symbol;
        
        console.log(`📡 Tín hiệu nhận được: ${symbol} - ${signal.direction} (Score: ${signal.score})`);
        
        // CHECK TRÙNG
        const signalKey = `${symbol}_${signal.direction}`;
        if (this.sentSignals.has(signalKey)) {
            console.log(`⏭️ Signal ${signalKey} đã gửi rồi, skip.`);
            return false;
        }
        
        // AI PHÂN TÍCH (nếu có)
        let aiDecision = 'UNKNOWN';
        let aiConfidence = 0;
        let aiReason = 'No AI analysis';
        
        if (process.env.AI_ENABLED === 'true') {
            console.log(`🤖 AI đang phân tích ${symbol}...`);
            try {
                const { default: DailyTradingAdvisor } = await import('./ai_daily_advisor.js');
                const advisor = new DailyTradingAdvisor();
                const aiResult = await advisor.getDailyRecommendation(symbol);
                
                if (aiResult.success) {
                    aiDecision = aiResult.data.decision;
                    aiConfidence = aiResult.data.confidence;
                    aiReason = aiResult.data.reason;
                    
                    console.log(`🤖 AI Decision: ${aiDecision} (${(aiConfidence * 100).toFixed(0)}% confidence)`);
                }
            } catch (error) {
                console.warn('⚠️ AI failed:', error.message);
            }
        }
        
        // GỬI TÍN HIỆU QUA TELEGRAM
        const message = `
🎯 *TÍN HIỆU GIAO DỊCH - ${symbol}*

📊 *Indicators:*
• ${signal.direction} Signal
• Score: ${signal.score} điểm
• Entry: ${signal.price}
• Stop Loss: ${signal.sl}
• Take Profit: ${signal.tp || 'N/A'}
${signal.strategy ? `• Strategy: ${signal.strategy}` : ''}

${aiDecision !== 'UNKNOWN' ? `🤖 *AI Phân Tích:*
• Quyết định: ${aiDecision}
• Confidence: ${(aiConfidence * 100).toFixed(0)}%
• ${aiReason}` : ''}

⚠️ *Bạn tự quyết định vào lệnh.*
`;
        
        if (this.bot && process.env.TELEGRAM_CHAT_ID) {
            try {
                await this.bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
                this.sentSignals.add(signalKey);
                console.log(`✅ Đã gửi signal ${symbol} qua Telegram`);
                return true;
            } catch (error) {
                console.error(`❌ Lỗi gửi Telegram: ${error.message}`);
            }
        }
        
        return false;
    }
}

export default SignalNotifier;

