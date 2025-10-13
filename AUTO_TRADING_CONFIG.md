# Cấu hình API OKX cho tự động giao dịch

## Thông tin API của bạn:
- **API Key**: a43bb007-d565-4ebc-81b4-24e9cad93817
- **Secret Key**: A796620B299444EEFEB4DCD71FBADCE4
- **Passphrase**: check Tài Khoản
- **Quyền**: Đọc/Giao dịch

## Cấu hình giao dịch:
- **Tổng vốn**: 100U
- **Lệnh tối đa**: 10 lệnh cùng lúc
- **Điểm tín hiệu tối thiểu**: 70/100 (giảm để có nhiều tín hiệu hơn)
- **Mục tiêu**: 100U mỗi lệnh
- **Rủi ro mỗi lệnh**: 2%

## Tính toán khối lượng theo đòn bẩy:
- **Sử dụng đòn bẩy tối đa có thể**
- **Mục tiêu**: 100U notional mỗi lệnh
- **Ví dụ**: BTC 50x → 2U, ETH 20x → 5U, SOL 100x → 1U

## Symbols được quét:
- **Top 20 coin** theo volume
- **Tần suất**: 15 giây/lần
- **Nguồn tín hiệu**: Hệ thống phân tích hiện tại của bot

## Lệnh điều khiển:
- `/auto_start` - Bắt đầu tự động giao dịch
- `/auto_stop` - Dừng tự động giao dịch
- `/auto_status` - Xem trạng thái
- `/auto_close_all` - Đóng tất cả lệnh
- `/auto_config` - Xem cấu hình

## Lưu ý quan trọng:
1. **Passphrase**: Bạn cần cung cấp passphrase chính xác trong file autoTrader.js
2. **Test trước**: Nên test trên sandbox trước khi chạy thật
3. **Theo dõi**: Luôn theo dõi bot khi chạy tự động
4. **Stop Loss**: Bot sẽ tự động đặt SL/TP
5. **Rủi ro**: Chỉ giao dịch với số tiền bạn có thể chấp nhận mất

## Cách sử dụng:
1. Cập nhật passphrase trong autoTrader.js
2. Chạy bot: `node main.js`
3. Gửi `/auto_start` để bắt đầu tự động giao dịch
4. Theo dõi qua `/auto_status`
5. Dừng bằng `/auto_stop` khi cần
