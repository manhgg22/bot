// testStrategy.js - Test từng strategy
import { getCandles } from "./okx.js";
import { calcStochRSI, calcEMA, calcBollingerBands, calcATR } from "./indicators.js";

async function testStrategy() {
    console.log("🔍 Test từng strategy...");
    
    const symbol = "BTC-USDT-SWAP";
    
    try {
        const candles = await getCandles(symbol, "4H", 100);
        console.log(`📊 Lấy được ${candles.length} candles cho ${symbol}`);
        
        if (candles.length < 50) {
            console.log("❌ Không đủ dữ liệu");
            return;
        }
        
        // Test StochRSI
        console.log("\n📈 Test StochRSI:");
        const stochRSI = calcStochRSI(candles);
        if (stochRSI) {
            console.log(`  - K: ${stochRSI.k.toFixed(2)}`);
            console.log(`  - D: ${stochRSI.d.toFixed(2)}`);
            console.log(`  - Prev K: ${stochRSI.prev_k.toFixed(2)}`);
            console.log(`  - Prev D: ${stochRSI.prev_d.toFixed(2)}`);
            
            const oversoldLevel = 20;
            const overboughtLevel = 80;
            const isLongSignal = stochRSI.prev_k < oversoldLevel && stochRSI.k > oversoldLevel && stochRSI.k > stochRSI.d;
            const isShortSignal = stochRSI.prev_k > overboughtLevel && stochRSI.k < overboughtLevel && stochRSI.k < stochRSI.d;
            
            console.log(`  - Long Signal: ${isLongSignal}`);
            console.log(`  - Short Signal: ${isShortSignal}`);
        } else {
            console.log("  ❌ StochRSI null");
        }
        
        // Test EMA
        console.log("\n📈 Test EMA:");
        const closes = candles.map(c => c.close);
        const ema12 = calcEMA(closes, 12);
        const ema26 = calcEMA(closes, 26);
        
        if (ema12 && ema26) {
            const currentEma12 = ema12.at(-1);
            const currentEma26 = ema26.at(-1);
            const prevEma12 = ema12.at(-2);
            const prevEma26 = ema26.at(-2);
            
            console.log(`  - EMA12: ${currentEma12.toFixed(4)}`);
            console.log(`  - EMA26: ${currentEma26.toFixed(4)}`);
            console.log(`  - EMA12 > EMA26: ${currentEma12 > currentEma26}`);
            console.log(`  - Golden Cross: ${prevEma12 <= prevEma26 && currentEma12 > currentEma26}`);
            console.log(`  - Death Cross: ${prevEma12 >= prevEma26 && currentEma12 < currentEma26}`);
        }
        
        // Test Bollinger Bands
        console.log("\n📈 Test Bollinger Bands:");
        const bb = calcBollingerBands(candles);
        if (bb) {
            const currentPrice = candles.at(-1).close;
            console.log(`  - Price: ${currentPrice.toFixed(4)}`);
            console.log(`  - Upper: ${bb.upper.at(-1).toFixed(4)}`);
            console.log(`  - Middle: ${bb.middle.at(-1).toFixed(4)}`);
            console.log(`  - Lower: ${bb.lower.at(-1).toFixed(4)}`);
            console.log(`  - Above Upper: ${currentPrice > bb.upper.at(-1)}`);
            console.log(`  - Below Lower: ${currentPrice < bb.lower.at(-1)}`);
        }
        
    } catch (error) {
        console.error("❌ Lỗi test:", error);
    }
}

testStrategy().then(() => {
    console.log("\n✅ Hoàn thành test!");
    process.exit(0);
}).catch(error => {
    console.error("❌ Lỗi:", error);
    process.exit(1);
});
