// scanAllCoins.js - Script quét toàn bộ coin
import { getAllSymbols } from "./okx.js";
import { scanForNewSignal } from "./indicators.js";
import { filterHighQualitySignals, generateSignalReport } from "./signalFilter.js";

async function scanAllCoins() {
    console.log("🔍 Bắt đầu quét toàn bộ coin...");
    
    try {
        // Lấy danh sách tất cả symbol
        const allSymbols = await getAllSymbols();
        console.log(`📊 Tìm thấy ${allSymbols.length} symbol từ OKX Futures`);
        
        if (allSymbols.length === 0) {
            console.log("❌ Không tìm thấy symbol nào");
            return;
        }
        
        let processedCount = 0;
        let signalCount = 0;
        const allSignals = [];
        
        console.log("🚀 Bắt đầu phân tích từng coin...");
        
        for (const symbol of allSymbols) {
            try {
                console.log(`📈 Đang phân tích ${symbol} (${processedCount + 1}/${allSymbols.length})`);
                
                const signal = await scanForNewSignal(symbol);
                
                if (signal && signal.direction !== "NONE") {
                    signalCount++;
                    allSignals.push(signal);
                    console.log(`✅ Tìm thấy tín hiệu ${signal.direction} cho ${symbol} - Điểm: ${signal.score}`);
                }
                
                processedCount++;
                
                // Cập nhật tiến độ mỗi 20 coin
                if (processedCount % 20 === 0) {
                    console.log(`📊 Đã quét ${processedCount}/${allSymbols.length} coin. Tìm thấy ${signalCount} tín hiệu.`);
                }
                
                // Tránh rate limit
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.error(`❌ Lỗi quét ${symbol}:`, error.message);
            }
        }
        
        console.log(`\n🎯 KẾT QUẢ QUÉT TOÀN BỘ COIN:`);
        console.log(`📊 Tổng coin đã quét: ${processedCount}`);
        console.log(`🔥 Tổng tín hiệu tìm thấy: ${signalCount}`);
        
        if (allSignals.length > 0) {
            // Sắp xếp theo điểm số
            const sortedSignals = allSignals.sort((a, b) => b.score - a.score);
            
            console.log(`\n🏆 TOP 10 TÍN HIỆU TỐT NHẤT:`);
            for (let i = 0; i < Math.min(10, sortedSignals.length); i++) {
                const signal = sortedSignals[i];
                console.log(`${i + 1}. ${signal.symbol} - ${signal.direction} - Điểm: ${signal.score}`);
            }
            
            // Lọc tín hiệu chất lượng cao
            const highQualitySignals = await filterHighQualitySignals(sortedSignals, 60);
            console.log(`\n⭐ Tín hiệu chất lượng cao (≥60 điểm): ${highQualitySignals.length}`);
            
            if (highQualitySignals.length > 0) {
                console.log(`\n🔥 CHI TIẾT TÍN HIỆU CHẤT LƯỢNG CAO:`);
                for (const signal of highQualitySignals.slice(0, 5)) {
                    const report = await generateSignalReport(signal);
                    console.log(`\n${report}`);
                }
            }
        } else {
            console.log("❌ Không tìm thấy tín hiệu nào đạt tiêu chuẩn");
        }
        
    } catch (error) {
        console.error("❌ Lỗi khi quét all coins:", error);
    }
}

// Chạy script
scanAllCoins().then(() => {
    console.log("\n✅ Hoàn thành quét toàn bộ coin!");
    process.exit(0);
}).catch(error => {
    console.error("❌ Lỗi:", error);
    process.exit(1);
});
