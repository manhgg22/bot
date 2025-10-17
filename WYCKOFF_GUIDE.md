# Hệ Thống Wyckoff Volume Profile + Dual RSI

## Tổng Quan

Hệ thống này kết hợp **Key Volume**, **Volume Profile** và **Dual RSI** để tạo ra tín hiệu giao dịch chất lượng cao theo phương pháp Wyckoff cho thị trường crypto.

## Các Thành Phần Chính

### 1. Volume Profile
- **POC (Point of Control)**: Mức giá có volume cao nhất
- **VAH (Value Area High)**: Mức giá cao nhất của vùng 70% volume
- **VAL (Value Area Low)**: Mức giá thấp nhất của vùng 70% volume
- **HVN (High Volume Nodes)**: Các mức giá có volume cao
- **LVN (Low Volume Nodes)**: Các mức giá có volume thấp

### 2. Key Volume Detection
- Phát hiện volume đột biến (≥1.8x volume trung bình)
- Phân loại độ mạnh: VERY_HIGH, HIGH, MEDIUM, LOW, VERY_LOW
- Phân tích xu hướng volume vs giá

### 3. Dual RSI System
- **RSI Nhanh (5)**: Cho tín hiệu sớm
- **RSI Chậm (14)**: Xác nhận xu hướng
- **Differential RSI**: Hiệu số giữa RSI nhanh và chậm
- Phát hiện crossover và divergence

## Các Lệnh Sử Dụng

### 1. Phân Tích Wyckoff Tổng Hợp
```
/wyckoff BTC
/wyckoff ETH
/wyckoff SOL
```
- Phân tích đầy đủ Volume Profile + Key Volume + Dual RSI
- Đưa ra tín hiệu LONG/SHORT với độ tin cậy
- Tính toán SL/TP dựa trên Volume Profile và ATR

### 2. Phân Tích Volume Profile
```
/volume_profile BTC
/volume_profile ETH
```
- Hiển thị POC, VAH, VAL
- Danh sách HVN và LVN
- Các mức hỗ trợ/kháng cự từ Volume Profile

### 3. Phân Tích Dual RSI
```
/dual_rsi BTC
/dual_rsi ETH
```
- Giá trị RSI nhanh và chậm
- Phân tích xu hướng và momentum
- Tín hiệu crossover và divergence

## Chiến Lược Giao Dịch

### Tín Hiệu LONG
1. **Key Volume**: Volume đột biến với nến tăng
2. **Volume Profile**: Giá phá vỡ khỏi Value Area hoặc retest VAL
3. **Dual RSI**: 
   - RSI nhanh cắt lên RSI chậm
   - Hoặc cả hai RSI oversold và hồi phục
   - Differential RSI > 0

### Tín Hiệu SHORT
1. **Key Volume**: Volume đột biến với nến giảm
2. **Volume Profile**: Giá phá vỡ khỏi Value Area hoặc retest VAH
3. **Dual RSI**:
   - RSI nhanh cắt xuống RSI chậm
   - Hoặc cả hai RSI overbought và giảm
   - Differential RSI < 0

### Quản Lý Rủi Ro
- **Stop Loss**: Dựa trên VAL (LONG) hoặc VAH (SHORT), tối thiểu 1.5x ATR
- **Take Profit**: Dựa trên VAH (LONG) hoặc VAL (SHORT), tối thiểu 2.5x ATR
- **Risk/Reward**: Tối thiểu 1:1.5

## Các Mức Độ Tin Cậy

### Cao (80-100%)
- Key Volume với độ mạnh HIGH hoặc VERY_HIGH
- Giá phá vỡ Value Area với volume cao
- Dual RSI đồng thuận mạnh

### Trung Bình (60-79%)
- Key Volume với độ mạnh MEDIUM
- Giá trong Value Area nhưng có tín hiệu RSI
- Một số chỉ báo đồng thuận

### Thấp (<60%)
- Không có Key Volume
- Tín hiệu RSI yếu
- Giá trong vùng không rõ ràng

## Lưu Ý Quan Trọng

1. **Luôn kết hợp nhiều chỉ báo**: Không dựa vào một chỉ báo duy nhất
2. **Chờ xác nhận**: Đợi retest các mức quan trọng trước khi vào lệnh
3. **Quản lý rủi ro**: Luôn đặt Stop Loss và không risk quá 2% tài khoản
4. **Theo dõi Key Volume**: Volume đột biến là tín hiệu quan trọng nhất
5. **Chú ý POC**: Mức giá quan trọng nhất trong Volume Profile

## Ví Dụ Sử Dụng

### Phân Tích BTC
```
/wyckoff BTC
```
Kết quả sẽ hiển thị:
- Tín hiệu LONG/SHORT với độ tin cậy
- POC, VAH, VAL từ Volume Profile
- Key Volume analysis
- Dual RSI signals
- Lệnh vào lệnh cụ thể

### Phân Tích Volume Profile ETH
```
/volume_profile ETH
```
Kết quả sẽ hiển thị:
- POC với volume và số trades
- Value Area (70% volume)
- Top 5 HVN và LVN
- Các mức hỗ trợ/kháng cự
- Key Volume status

## Tích Hợp Vào Hệ Thống

Hệ thống Wyckoff đã được tích hợp vào:
- **indicators.js**: Chiến lược `getSignalsWyckoffVolume`
- **main.js**: Các lệnh phân tích và menu
- **Tự động quét**: Ưu tiên tín hiệu Wyckoff trong hệ thống

## Kết Luận

Hệ thống Wyckoff Volume Profile + Dual RSI cung cấp:
- Phân tích sâu về cấu trúc thị trường
- Tín hiệu chất lượng cao với độ tin cậy
- Quản lý rủi ro dựa trên dữ liệu thực tế
- Phù hợp với thị trường crypto biến động cao

Sử dụng kết hợp với các chiến lược khác để có kết quả tốt nhất.
