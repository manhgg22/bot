// dailyAnalysis.js - Phân tích đầu ngày để đưa ra dự đoán LONG/SHORT
import axios from "axios";
import { getCandles, getCurrentPrice } from "./okx.js";
import { analyzeMarketSentiment, detectCrashRisk, getDailyMarketAnalysis } from "./advancedIndicators.js";
import { calcRSI, calcEMA, calcATR, calcBollingerBands } from "./indicators.js";

/* ============== PHÂN TÍCH ĐẦU NGÀY ============== */

/**
 * Phân tích tổng thể thị trường để đưa ra khuyến nghị LONG/SHORT
 */
export async function getDailyTradingRecommendation() {
    try {
        console.log("📊 [DAILY ANALYSIS] Bắt đầu phân tích đầu ngày...");
        
        // Thu thập dữ liệu từ nhiều nguồn
        const [
            fearGreedData,
            topCoinsAnalysis,
            marketStructure,
            timeAnalysis
        ] = await Promise.all([
            getFearGreedIndex(),
            analyzeTopCoins(),
            analyzeMarketStructure(),
            getTimeBasedAnalysis()
        ]);
        
        // Tính điểm tổng hợp
        const analysis = {
            fearGreed: fearGreedData,
            topCoins: topCoinsAnalysis,
            marketStructure,
            timeAnalysis,
            recommendation: generateTradingRecommendation(fearGreedData, topCoinsAnalysis, marketStructure, timeAnalysis)
        };
        
        console.log("✅ [DAILY ANALYSIS] Hoàn thành phân tích đầu ngày");
        return analysis;
        
    } catch (error) {
        console.error("❌ [DAILY ANALYSIS] Lỗi phân tích đầu ngày:", error);
        return null;
    }
}

/**
 * Lấy Fear & Greed Index từ API
 */
async function getFearGreedIndex() {
    try {
        const response = await axios.get('https://api.alternative.me/fng/', {
            timeout: 10000
        });
        
        const data = response.data.data[0];
        const value = parseInt(data.value);
        
        return {
            value,
            classification: data.value_classification,
            timestamp: data.timestamp,
            interpretation: interpretFearGreed(value),
            score: calculateFearGreedScore(value)
        };
    } catch (error) {
        console.error("Lỗi lấy Fear & Greed Index:", error);
        return {
            value: 50,
            classification: "Neutral",
            interpretation: "Không thể lấy dữ liệu",
            score: 0
        };
    }
}

/**
 * Phân tích top coin để xác định xu hướng thị trường
 */
async function analyzeTopCoins() {
    try {
        // Lấy top 30 coin theo volume
        const response = await axios.get('https://www.okx.com/api/v5/market/tickers', {
            params: { instType: "SWAP" },
            timeout: 10000
        });
        
        const tickers = response.data.data
            .filter(t => t.settleCcy === 'USDT' && t.state === 'live')
            .sort((a, b) => Number(b.volCcy24h) - Number(a.volCcy24h))
            .slice(0, 30);
        
        let bullishCount = 0, bearishCount = 0, neutralCount = 0;
        let highRiskCount = 0, mediumRiskCount = 0, lowRiskCount = 0;
        let totalVolume = 0;
        let avgPriceChange = 0;
        
        // Phân tích từng coin
        for (let i = 0; i < Math.min(tickers.length, 20); i++) {
            const ticker = tickers[i];
            const symbol = ticker.instId;
            const priceChange = parseFloat(ticker.chg24h);
            const volume = parseFloat(ticker.volCcy24h);
            
            totalVolume += volume;
            avgPriceChange += priceChange;
            
            // Phân loại xu hướng
            if (priceChange > 2) bullishCount++;
            else if (priceChange < -2) bearishCount++;
            else neutralCount++;
            
            // Phân tích rủi ro
            try {
                const candles = await getCandles(symbol, "1H", 50);
                if (candles && candles.length >= 30) {
                    const risk = detectCrashRisk(candles);
                    if (risk) {
                        switch (risk.riskLevel) {
                            case "HIGH": highRiskCount++; break;
                            case "MEDIUM": mediumRiskCount++; break;
                            case "LOW": lowRiskCount++; break;
                        }
                    }
                }
            } catch (error) {
                console.error(`Lỗi phân tích rủi ro cho ${symbol}:`, error.message);
            }
            
            // Delay để tránh rate limit
            await sleep(100);
        }
        
        const totalAnalyzed = bullishCount + bearishCount + neutralCount;
        const bullishPercent = totalAnalyzed > 0 ? (bullishCount / totalAnalyzed) * 100 : 0;
        const bearishPercent = totalAnalyzed > 0 ? (bearishCount / totalAnalyzed) * 100 : 0;
        const avgRiskScore = calculateRiskScore(highRiskCount, mediumRiskCount, lowRiskCount);
        
        return {
            totalCoins: totalAnalyzed,
            bullishCount,
            bearishCount,
            neutralCount,
            bullishPercent,
            bearishPercent,
            avgPriceChange: avgPriceChange / Math.min(tickers.length, 20),
            riskAnalysis: {
                highRisk: highRiskCount,
                mediumRisk: mediumRiskCount,
                lowRisk: lowRiskCount,
                avgRiskScore
            },
            marketBias: determineMarketBias(bullishPercent, bearishPercent),
            score: calculateTopCoinsScore(bullishPercent, bearishPercent, avgRiskScore)
        };
        
    } catch (error) {
        console.error("Lỗi phân tích top coin:", error);
        return {
            totalCoins: 0,
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0,
            bullishPercent: 0,
            bearishPercent: 0,
            avgPriceChange: 0,
            riskAnalysis: { highRisk: 0, mediumRisk: 0, lowRisk: 0, avgRiskScore: 0 },
            marketBias: "NEUTRAL",
            score: 0
        };
    }
}

/**
 * Phân tích cấu trúc thị trường tổng thể
 */
async function analyzeMarketStructure() {
    try {
        // Phân tích BTC và ETH làm đại diện cho thị trường
        const symbols = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];
        let totalBullish = 0, totalBearish = 0;
        let avgVolatility = 0;
        
        for (const symbol of symbols) {
            try {
                const [h1Candles, h4Candles, d1Candles] = await Promise.all([
                    getCandles(symbol, "1H", 100),
                    getCandles(symbol, "4H", 50),
                    getCandles(symbol, "1D", 30)
                ]);
                
                if (h1Candles && h4Candles && d1Candles) {
                    // Phân tích xu hướng đa khung thời gian
                    const h1Trend = analyzeTrendFromCandles(h1Candles);
                    const h4Trend = analyzeTrendFromCandles(h4Candles);
                    const d1Trend = analyzeTrendFromCandles(d1Candles);
                    
                    // Tính điểm xu hướng
                    if (h1Trend === "BULLISH") totalBullish += 1;
                    else if (h1Trend === "BEARISH") totalBearish += 1;
                    
                    if (h4Trend === "BULLISH") totalBullish += 2;
                    else if (h4Trend === "BEARISH") totalBearish += 2;
                    
                    if (d1Trend === "BULLISH") totalBullish += 3;
                    else if (d1Trend === "BEARISH") totalBearish += 3;
                    
                    // Tính volatility
                    const atr = calcATR(h1Candles, 14);
                    const currentPrice = await getCurrentPrice(symbol);
                    if (atr && currentPrice) {
                        avgVolatility += (atr / currentPrice) * 100;
                    }
                }
            } catch (error) {
                console.error(`Lỗi phân tích cấu trúc cho ${symbol}:`, error.message);
            }
            
            await sleep(100);
        }
        
        const structureBias = totalBullish > totalBearish ? "BULLISH" : 
                             totalBearish > totalBullish ? "BEARISH" : "NEUTRAL";
        const structureStrength = Math.abs(totalBullish - totalBearish) / 6; // Max score = 6
        
        return {
            structureBias,
            structureStrength,
            totalBullish,
            totalBearish,
            avgVolatility: avgVolatility / symbols.length,
            score: calculateStructureScore(structureBias, structureStrength)
        };
        
    } catch (error) {
        console.error("Lỗi phân tích cấu trúc thị trường:", error);
        return {
            structureBias: "NEUTRAL",
            structureStrength: 0,
            totalBullish: 0,
            totalBearish: 0,
            avgVolatility: 0,
            score: 0
        };
    }
}

/**
 * Phân tích theo thời gian trong ngày
 */
function getTimeBasedAnalysis() {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    
    let timeScore = 0;
    let timeRecommendation = "NEUTRAL";
    let reasoning = "";
    
    // Phân tích theo giờ
    if (hour >= 8 && hour <= 12) {
        timeScore = 20; // Giờ giao dịch châu Á
        timeRecommendation = "GOOD";
        reasoning = "Giờ giao dịch chính châu Á - Volume cao";
    } else if (hour >= 14 && hour <= 18) {
        timeScore = 30; // Giờ giao dịch châu Âu
        timeRecommendation = "EXCELLENT";
        reasoning = "Giờ giao dịch chính châu Âu - Biến động mạnh";
    } else if (hour >= 20 && hour <= 24) {
        timeScore = 25; // Giờ giao dịch Mỹ
        timeRecommendation = "GOOD";
        reasoning = "Giờ giao dịch chính Mỹ - Thanh khoản tốt";
    } else {
        timeScore = 5; // Giờ giao dịch yếu
        timeRecommendation = "CAUTION";
        reasoning = "Giờ giao dịch yếu - Volume thấp";
    }
    
    // Phân tích theo ngày trong tuần
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        timeScore += 10; // Ngày trong tuần
    } else {
        timeScore -= 5; // Cuối tuần
    }
    
    return {
        hour,
        dayOfWeek,
        timeScore,
        timeRecommendation,
        reasoning
    };
}

/**
 * Tạo khuyến nghị giao dịch tổng hợp
 */
function generateTradingRecommendation(fearGreed, topCoins, marketStructure, timeAnalysis) {
    // Tính điểm tổng hợp
    let totalScore = 0;
    let bullishFactors = 0;
    let bearishFactors = 0;
    let riskFactors = [];
    
    // Điểm từ Fear & Greed
    totalScore += fearGreed.score;
    if (fearGreed.value < 30) {
        bullishFactors++;
        riskFactors.push("Thị trường quá sợ hãi - Cơ hội mua");
    } else if (fearGreed.value > 70) {
        bearishFactors++;
        riskFactors.push("Thị trường quá tham lam - Rủi ro cao");
    }
    
    // Điểm từ top coins
    totalScore += topCoins.score;
    if (topCoins.marketBias === "BULLISH") {
        bullishFactors++;
    } else if (topCoins.marketBias === "BEARISH") {
        bearishFactors++;
    }
    
    // Điểm từ cấu trúc thị trường
    totalScore += marketStructure.score;
    if (marketStructure.structureBias === "BULLISH") {
        bullishFactors++;
    } else if (marketStructure.structureBias === "BEARISH") {
        bearishFactors++;
    }
    
    // Điểm từ thời gian
    totalScore += timeAnalysis.timeScore;
    
    // Xác định khuyến nghị
    let recommendation = "NEUTRAL";
    let confidence = 50;
    let reasoning = "";
    
    if (totalScore > 60 && bullishFactors > bearishFactors) {
        recommendation = "LONG";
        confidence = Math.min(90, 50 + totalScore);
        reasoning = "Xu hướng tích cực mạnh mẽ";
    } else if (totalScore < -60 && bearishFactors > bullishFactors) {
        recommendation = "SHORT";
        confidence = Math.min(90, 50 + Math.abs(totalScore));
        reasoning = "Xu hướng tiêu cực mạnh mẽ";
    } else if (Math.abs(totalScore) < 30) {
        recommendation = "NEUTRAL";
        confidence = 30;
        reasoning = "Thị trường không có xu hướng rõ ràng";
    } else {
        recommendation = totalScore > 0 ? "LONG" : "SHORT";
        confidence = 60;
        reasoning = "Xu hướng yếu, cần thận trọng";
    }
    
    // Điều chỉnh theo rủi ro
    if (topCoins.riskAnalysis.avgRiskScore > 70) {
        confidence -= 20;
        riskFactors.push("Rủi ro thị trường cao");
    }
    
    return {
        recommendation,
        confidence: Math.max(10, Math.min(95, confidence)),
        totalScore,
        bullishFactors,
        bearishFactors,
        riskFactors,
        reasoning,
        detailedAnalysis: {
            fearGreed: fearGreed,
            topCoins: topCoins,
            marketStructure: marketStructure,
            timeAnalysis: timeAnalysis
        }
    };
}

/* ============== HELPER FUNCTIONS ============== */

function interpretFearGreed(value) {
    if (value <= 25) return "Extreme Fear - Cơ hội mua tốt";
    if (value <= 45) return "Fear - Cẩn thận";
    if (value <= 55) return "Neutral - Thị trường cân bằng";
    if (value <= 75) return "Greed - Cẩn thận";
    return "Extreme Greed - Rủi ro cao";
}

function calculateFearGreedScore(value) {
    // Điểm từ -50 đến +50
    if (value <= 25) return 30; // Extreme fear = bullish opportunity
    if (value <= 45) return 10; // Fear = slight bullish
    if (value <= 55) return 0; // Neutral
    if (value <= 75) return -10; // Greed = slight bearish
    return -30; // Extreme greed = bearish risk
}

function calculateRiskScore(highRisk, mediumRisk, lowRisk) {
    const total = highRisk + mediumRisk + lowRisk;
    if (total === 0) return 0;
    return ((highRisk * 3 + mediumRisk * 2 + lowRisk * 1) / (total * 3)) * 100;
}

function determineMarketBias(bullishPercent, bearishPercent) {
    if (bullishPercent > 60) return "STRONG_BULLISH";
    if (bullishPercent > 50) return "BULLISH";
    if (bearishPercent > 60) return "STRONG_BEARISH";
    if (bearishPercent > 50) return "BEARISH";
    return "NEUTRAL";
}

function calculateTopCoinsScore(bullishPercent, bearishPercent, riskScore) {
    let score = 0;
    
    // Điểm từ xu hướng
    if (bullishPercent > 60) score += 40;
    else if (bullishPercent > 50) score += 20;
    else if (bearishPercent > 60) score -= 40;
    else if (bearishPercent > 50) score -= 20;
    
    // Điểm từ rủi ro (rủi ro thấp = điểm cao)
    score += (100 - riskScore) * 0.2;
    
    return score;
}

function calculateStructureScore(bias, strength) {
    let score = 0;
    
    if (bias === "BULLISH") score += 30;
    else if (bias === "BEARISH") score -= 30;
    
    score += strength * 20;
    
    return score;
}

function analyzeTrendFromCandles(candles) {
    if (!candles || candles.length < 20) return "NEUTRAL";
    
    const closes = candles.map(c => c.close);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    
    const lastClose = closes.at(-1);
    const lastEma20 = ema20.at(-1);
    const lastEma50 = ema50.at(-1);
    
    if (lastClose > lastEma20 && lastEma20 > lastEma50) return "BULLISH";
    if (lastClose < lastEma20 && lastEma20 < lastEma50) return "BEARISH";
    return "NEUTRAL";
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============== EXPORT FUNCTIONS ============== */

export async function getDailyAnalysisReport() {
    const analysis = await getDailyTradingRecommendation();
    if (!analysis) return null;
    
    const { recommendation, confidence, reasoning, riskFactors, detailedAnalysis } = analysis.recommendation;
    
    const report = {
        timestamp: new Date().toISOString(),
        recommendation,
        confidence,
        reasoning,
        riskFactors,
        summary: generateSummaryReport(analysis),
        details: detailedAnalysis
    };
    
    return report;
}

function generateSummaryReport(analysis) {
    const { recommendation, confidence, reasoning, riskFactors } = analysis.recommendation;
    const { fearGreed, topCoins, marketStructure, timeAnalysis } = analysis.recommendation.detailedAnalysis;
    
    return {
        marketCondition: `${recommendation} (${confidence}% confidence)`,
        fearGreedLevel: `${fearGreed.value} - ${fearGreed.classification}`,
        marketBias: topCoins.marketBias,
        structureTrend: marketStructure.structureBias,
        timeRecommendation: timeAnalysis.timeRecommendation,
        riskLevel: topCoins.riskAnalysis.avgRiskScore > 70 ? "HIGH" : 
                  topCoins.riskAnalysis.avgRiskScore > 40 ? "MEDIUM" : "LOW",
        keyFactors: riskFactors.slice(0, 3)
    };
}
