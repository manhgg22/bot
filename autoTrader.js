// autoTrader.js - Hệ thống tự động giao dịch OKX
import crypto from 'crypto';
import axios from 'axios';
import { getAllSignalsForSymbol } from './indicators.js';
import { getCurrentPrice } from './okx.js';

// Cấu hình API OKX
const API_CONFIG = {
    apiKey: "a43bb007-d565-4ebc-81b4-24e9cad93817",
    secretKey: "A796620B299444EEFEB4DCD71FBADCE4",
    passphrase: "YOUR_REAL_PASSPHRASE_HERE", // ⚠️ THAY BẰNG PASSPHRASE THỰC TẾ CỦA BẠN
    baseURL: "https://www.okx.com",
    sandbox: true // ⚠️ ĐẶT TRUE ĐỂ TEST TRÊN SANDBOX TRƯỚC
};

// Cấu hình giao dịch
const TRADING_CONFIG = {
    totalCapital: 100, // Tổng vốn 100U
    maxPositions: 10, // Tối đa 10 lệnh cùng lúc
    minSignalScore: 70, // Điểm tín hiệu tối thiểu (giảm để có nhiều tín hiệu hơn)
    riskPerTrade: 0.02, // Rủi ro 2% mỗi lệnh
    maxLeverage: 100, // Đòn bẩy tối đa (tăng lên để có thể đạt 100U)
    targetNotional: 100 // Mục tiêu khối lượng 100U mỗi lệnh
};

class OKXAutoTrader {
    constructor() {
        this.baseURL = API_CONFIG.sandbox ? 
            "https://www.okx.com" : 
            "https://www.okx.com";
        this.apiKey = API_CONFIG.apiKey;
        this.secretKey = API_CONFIG.secretKey;
        this.passphrase = API_CONFIG.passphrase;
        this.openPositions = new Map();
        this.isTrading = false;
    }

    // Tạo signature cho API request
    createSignature(timestamp, method, requestPath, body = '') {
        const message = timestamp + method + requestPath + body;
        return crypto
            .createHmac('sha256', this.secretKey)
            .update(message)
            .digest('base64');
    }

    // Tạo headers cho API request
    createHeaders(method, requestPath, body = '') {
        const timestamp = new Date().toISOString();
        const signature = this.createSignature(timestamp, method, requestPath, body);
        
        return {
            'OK-ACCESS-KEY': this.apiKey,
            'OK-ACCESS-SIGN': signature,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': this.passphrase,
            'Content-Type': 'application/json'
        };
    }

    // Lấy thông tin tài khoản
    async getAccountInfo() {
        try {
            const requestPath = '/api/v5/account/balance';
            const headers = this.createHeaders('GET', requestPath);
            
            const response = await axios.get(this.baseURL + requestPath, { headers });
            return response.data;
        } catch (error) {
            console.error('Lỗi lấy thông tin tài khoản:', error.response?.data || error.message);
            return null;
        }
    }

    // Lấy danh sách tất cả symbols
    async getAllSymbols() {
        try {
            const requestPath = '/api/v5/public/instruments?instType=SWAP';
            const response = await axios.get(this.baseURL + requestPath);
            
            if (response.data.code === '0') {
                return response.data.data
                    .filter(instrument => 
                        instrument.state === 'live' && 
                        instrument.settleCcy === 'USDT' &&
                        !instrument.instId.includes('USDC')
                    )
                    .map(instrument => instrument.instId)
                    .slice(0, 50); // Lấy top 50 coin
            }
            return [];
        } catch (error) {
            console.error('Lỗi lấy danh sách symbols:', error.message);
            return [];
        }
    }

    // Lấy thông tin đòn bẩy của symbol
    async getLeverageInfo(symbol) {
        try {
            const requestPath = `/api/v5/public/instruments?instType=SWAP&instId=${symbol}`;
            const response = await axios.get(this.baseURL + requestPath);
            
            if (response.data.code === '0' && response.data.data.length > 0) {
                const instrument = response.data.data[0];
                return {
                    maxLeverage: parseInt(instrument.maxLeverage) || 20,
                    minSize: parseFloat(instrument.minSz) || 0.01,
                    tickSize: parseFloat(instrument.tickSz) || 0.01
                };
            }
            return null;
        } catch (error) {
            console.error(`Lỗi lấy thông tin đòn bẩy ${symbol}:`, error.message);
            return null;
        }
    }

    // Tính toán khối lượng giao dịch - Mục tiêu 100U mỗi lệnh
    async calculatePositionSize(symbol, signalScore) {
        const leverageInfo = await this.getLeverageInfo(symbol);
        if (!leverageInfo) return null;

        // Sử dụng đòn bẩy tối đa có thể để đạt 100U
        const maxLeverage = Math.min(leverageInfo.maxLeverage, TRADING_CONFIG.maxLeverage);
        
        // Tính khối lượng để đạt 100U notional
        const targetNotional = TRADING_CONFIG.targetNotional;
        const positionSize = targetNotional / maxLeverage;
        
        // Làm tròn theo tick size
        const roundedSize = Math.floor(positionSize / leverageInfo.tickSize) * leverageInfo.tickSize;
        
        // Đảm bảo không nhỏ hơn minimum size
        const finalSize = Math.max(roundedSize, leverageInfo.minSize);
        
        return {
            size: finalSize,
            leverage: maxLeverage,
            notional: finalSize * maxLeverage,
            actualNotional: finalSize * maxLeverage
        };
    }

    // Đặt đòn bẩy cho symbol
    async setLeverage(symbol, leverage) {
        try {
            const requestPath = '/api/v5/account/set-leverage';
            const body = JSON.stringify({
                instId: symbol,
                lever: leverage.toString(),
                mgnMode: 'cross' // Cross margin
            });

            const headers = this.createHeaders('POST', requestPath, body);
            const response = await axios.post(this.baseURL + requestPath, body, { headers });
            
            return response.data.code === '0';
        } catch (error) {
            console.error(`Lỗi đặt đòn bẩy ${symbol}:`, error.response?.data || error.message);
            return false;
        }
    }

    // Đặt lệnh mua/bán
    async placeOrder(symbol, side, size, price, slPrice, tpPrice) {
        try {
            const requestPath = '/api/v5/trade/order';
            const body = JSON.stringify({
                instId: symbol,
                tdMode: 'cross',
                side: side.toLowerCase(),
                ordType: 'market',
                sz: size.toString(),
                slTriggerPx: slPrice.toString(),
                slOrdPx: slPrice.toString(),
                tpTriggerPx: tpPrice.toString(),
                tpOrdPx: tpPrice.toString()
            });

            const headers = this.createHeaders('POST', requestPath, body);
            const response = await axios.post(this.baseURL + requestPath, body, { headers });
            
            if (response.data.code === '0') {
                console.log(`✅ Đặt lệnh thành công: ${side} ${symbol} ${size} @ ${price}`);
                return response.data.data[0];
            } else {
                console.error(`❌ Lỗi đặt lệnh:`, response.data);
                return null;
            }
        } catch (error) {
            console.error(`Lỗi đặt lệnh ${symbol}:`, error.response?.data || error.message);
            return null;
        }
    }

    // Xử lý tín hiệu và đặt lệnh
    async processSignal(signal) {
        if (this.openPositions.size >= TRADING_CONFIG.maxPositions) {
            console.log('⚠️ Đã đạt số lệnh tối đa, bỏ qua tín hiệu');
            return false;
        }

        if (signal.score < TRADING_CONFIG.minSignalScore) {
            console.log(`⚠️ Điểm tín hiệu ${signal.score} < ${TRADING_CONFIG.minSignalScore}, bỏ qua`);
            return false;
        }

        const symbol = signal.symbol;
        const leverageInfo = await this.getLeverageInfo(symbol);
        if (!leverageInfo) return false;

        // Tính toán khối lượng
        const positionInfo = await this.calculatePositionSize(symbol, signal.score);
        if (!positionInfo) return false;

        // Đặt đòn bẩy
        const leverageSet = await this.setLeverage(symbol, positionInfo.leverage);
        if (!leverageSet) return false;

        // Tính SL/TP
        const currentPrice = await getCurrentPrice(symbol);
        if (!currentPrice) return false;

        let slPrice, tpPrice;
        if (signal.direction === 'LONG') {
            slPrice = currentPrice * (1 - (signal.sl - signal.price) / signal.price);
            tpPrice = currentPrice * (1 + (signal.tp - signal.price) / signal.price);
        } else {
            slPrice = currentPrice * (1 + (signal.price - signal.sl) / signal.price);
            tpPrice = currentPrice * (1 - (signal.price - signal.tp) / signal.price);
        }

        // Đặt lệnh
        const orderResult = await this.placeOrder(
            symbol,
            signal.direction,
            positionInfo.size,
            currentPrice,
            slPrice,
            tpPrice
        );

        if (orderResult) {
            this.openPositions.set(symbol, {
                orderId: orderResult.ordId,
                symbol: symbol,
                side: signal.direction,
                size: positionInfo.size,
                entryPrice: currentPrice,
                slPrice: slPrice,
                tpPrice: tpPrice,
                leverage: positionInfo.leverage,
                timestamp: Date.now()
            });

            console.log(`🎯 Lệnh ${signal.direction} ${symbol}:`);
            console.log(`   Khối lượng: ${positionInfo.size} (đòn bẩy ${positionInfo.leverage}x)`);
            console.log(`   Notional: ${positionInfo.actualNotional.toFixed(2)}U`);
            console.log(`   Entry: ${currentPrice}`);
            console.log(`   SL: ${slPrice}`);
            console.log(`   TP: ${tpPrice}`);
            console.log(`   Điểm tín hiệu: ${signal.score}/100`);

            return true;
        }

        return false;
    }

    // Kiểm tra và đóng lệnh
    async checkAndClosePositions() {
        for (const [symbol, position] of this.openPositions) {
            try {
                const currentPrice = await getCurrentPrice(symbol);
                if (!currentPrice) continue;

                let shouldClose = false;
                let closeReason = '';

                if (position.side === 'LONG') {
                    if (currentPrice >= position.tpPrice) {
                        shouldClose = true;
                        closeReason = 'Take Profit';
                    } else if (currentPrice <= position.slPrice) {
                        shouldClose = true;
                        closeReason = 'Stop Loss';
                    }
                } else {
                    if (currentPrice <= position.tpPrice) {
                        shouldClose = true;
                        closeReason = 'Take Profit';
                    } else if (currentPrice >= position.slPrice) {
                        shouldClose = true;
                        closeReason = 'Stop Loss';
                    }
                }

                if (shouldClose) {
                    await this.closePosition(symbol, closeReason);
                }
            } catch (error) {
                console.error(`Lỗi kiểm tra lệnh ${symbol}:`, error.message);
            }
        }
    }

    // Đóng lệnh
    async closePosition(symbol, reason) {
        try {
            const position = this.openPositions.get(symbol);
            if (!position) return false;

            const requestPath = '/api/v5/trade/close-position';
            const body = JSON.stringify({
                instId: symbol,
                mgnMode: 'cross'
            });

            const headers = this.createHeaders('POST', requestPath, body);
            const response = await axios.post(this.baseURL + requestPath, body, { headers });

            if (response.data.code === '0') {
                this.openPositions.delete(symbol);
                console.log(`✅ Đóng lệnh ${symbol}: ${reason}`);
                return true;
            }
        } catch (error) {
            console.error(`Lỗi đóng lệnh ${symbol}:`, error.message);
        }
        return false;
    }

    // Bắt đầu tự động giao dịch
    async startAutoTrading() {
        if (this.isTrading) {
            console.log('⚠️ Bot đã đang giao dịch');
            return;
        }

        this.isTrading = true;
        console.log('🚀 Bắt đầu tự động giao dịch...');

        // Kiểm tra tài khoản
        const accountInfo = await this.getAccountInfo();
        if (!accountInfo) {
            console.log('❌ Không thể kết nối API OKX');
            this.isTrading = false;
            return;
        }

        console.log('✅ Kết nối API OKX thành công');

        // Vòng lặp giao dịch chính
        setInterval(async () => {
            try {
                // Kiểm tra và đóng lệnh
                await this.checkAndClosePositions();

                // Quét tín hiệu mới từ hệ thống hiện tại
                const symbols = await this.getAllSymbols();
                
                for (const symbol of symbols.slice(0, 20)) { // Quét top 20 coin
                    if (this.openPositions.has(symbol)) continue;

                    const signal = await getAllSignalsForSymbol(symbol);
                    if (signal.direction !== 'NONE' && signal.score >= TRADING_CONFIG.minSignalScore) {
                        console.log(`🔔 Tìm thấy tín hiệu ${signal.direction} cho ${symbol} (điểm: ${signal.score})`);
                        await this.processSignal(signal);
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay giữa các lệnh
                    }
                }
            } catch (error) {
                console.error('Lỗi trong vòng lặp giao dịch:', error.message);
            }
        }, 15000); // Kiểm tra mỗi 15 giây để bắt tín hiệu nhanh hơn
    }

    // Dừng tự động giao dịch
    stopAutoTrading() {
        this.isTrading = false;
        console.log('⏹️ Dừng tự động giao dịch');
    }

    // Lấy thống kê giao dịch
    getTradingStats() {
        return {
            openPositions: this.openPositions.size,
            maxPositions: TRADING_CONFIG.maxPositions,
            totalCapital: TRADING_CONFIG.totalCapital,
            isTrading: this.isTrading,
            positions: Array.from(this.openPositions.values())
        };
    }
}

export default OKXAutoTrader;
