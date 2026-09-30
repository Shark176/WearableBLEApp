# Wearable BLE Protocol

Tài liệu này mô tả toàn bộ dữ liệu app trao đổi với wearable theo protocol v1 hiện tại.

## 1. Service và characteristic

| Vai trò | UUID | Hướng | Độ dài |
|---|---|---|---:|
| Service | `0000fe40-cc7a-482a-984a-7f2ed5b3e58f` | — | — |
| Control | `0000fe41-8e22-4541-9d4c-21edae82ed19` | App → thiết bị | 8 byte |
| Sensor Data | `0000fe42-8e22-4541-9d4c-21edae82ed19` | Thiết bị → app | 16 byte |
| Device Status | `0000fe43-8e22-4541-9d4c-21edae82ed19` | Thiết bị → app | 8 byte |
| NFC Event | `0000fe44-8e22-4541-9d4c-21edae82ed19` | Thiết bị → app, tùy chọn | 20 byte |
| ECG Data | `0000fe45-8e22-4541-9d4c-21edae82ed19` | Thiết bị → app, tùy chọn | 20 byte |
| Debug Data | `0000fe46-8e22-4541-9d4c-21edae82ed19` | Hai chiều, tùy chọn | 20 byte |
| Recovery Data | `0000fe47-8e22-4541-9d4c-21edae82ed19` | Thiết bị → app, tùy chọn | 24 byte |

Các số nhiều byte dùng **little-endian**.

## 2. App → thiết bị

### Control packet — 8 byte

App ghi 8 byte vào `FE41`. Byte `0` là mã lệnh; byte `1–7` hiện được để `0`.

| Byte | Ý nghĩa |
|---:|---|
| 0 | Lệnh điều khiển |
| 1–7 | Tham số/reserved, hiện `0` |

| Giá trị byte 0 | Lệnh |
|---:|---|
| `0x01` | Bắt đầu đo |
| `0x02` | Dừng đo |
| `0x03` | Yêu cầu dữ liệu hiện tại |
| `0x04` | Chế độ nguồn Normal |
| `0x05` | Chế độ nguồn Low-power |
| `0x06` | Bắt đầu ECG |
| `0x07` | Dừng ECG |
| `0x08` | Kiểm tra Emergency |

### Đồng bộ thời gian — 8 byte

App ghi Unix epoch seconds dạng `uint64` little-endian vào characteristic điều khiển. Đây là packet thời gian riêng, không phải command packet.

## 3. Thiết bị → app: Sensor Data (`FE42`)

Payload luôn dài 16 byte.

| Byte | Kiểu | Ý nghĩa | Cách diễn giải |
|---:|---|---|---|
| 0 | `uint8` | HR | Nhịp tim, BPM |
| 1 | `uint8` | SpO₂ | Phần trăm bão hòa oxy |
| 2–3 | `int16 LE` | Temperature | Độ C × 100; `-32768` nghĩa là không hợp lệ |
| 4–5 | `uint16 LE` | Supercap | Điện áp supercapacitor, mV |
| 6 | `uint8` | Power state | Trạng thái nguồn do firmware định nghĩa |
| 7 | `uint8` | Flags | Các cờ trạng thái, xem bảng dưới |
| 8–9 | `int16 LE` | Accel X | Gia tốc trục X, raw |
| 10–11 | `int16 LE` | Accel Y | Gia tốc trục Y, raw |
| 12–13 | `int16 LE` | Accel Z | Gia tốc trục Z, raw |
| 14–15 | `uint16 LE` | QVAR raw | Giá trị QVAR raw từ firmware |

### Flags tại byte 7

| Bit | Mask | Ý nghĩa |
|---:|---:|---|
| 0–2 | `0x07` | Reserved/chưa định nghĩa |
| 3 | `0x08` | Có ứng viên phát hiện ngã (`FALL_CANDIDATE`) |
| 4 | `0x10` | Emergency đang hoạt động |
| 5 | `0x20` | ECG đang hoạt động |
| 6 | `0x40` | Thiết bị đang đeo (`WORN`); nếu tắt là `NOT WORN` |
| 7 | `0x80` | Reserved/chưa định nghĩa |

App cũng tính `magnitude = sqrt(X² + Y² + Z²)` từ các byte gia tốc; đây là giá trị dẫn xuất, không nằm trực tiếp trong payload.

## 4. Device Status (`FE43`)

Payload dài 8 byte.

| Byte | Kiểu | Ý nghĩa |
|---:|---|---|
| 0 | `uint8` | Measurement state |
| 1 | `uint8` | Sensor ready; khác `0` là sẵn sàng |
| 2 | `uint8` | Error code |
| 3 | `uint8` | Power state |
| 4–5 | `uint16 LE` | Supercap voltage, mV |
| 6 | `uint8` | Reset counter |
| 7 | `uint8` | Flags: protocol version và trạng thái |

### Measurement state tại byte 0

| Giá trị | Ý nghĩa |
|---:|---|
| `0` | Idle |
| `1` | Measuring |
| `2` | ECG active |
| `3` | Low power |
| `4` | Emergency |
| `5` | Error |
| Giá trị khác | Unknown |

### Error code tại byte 2

| Giá trị | Ý nghĩa |
|---:|---|
| `0x00` | Không lỗi |
| `0x01` | Lệnh không hợp lệ |
| `0x10` | Không có cảm biến nhiệt |
| `0x11` | Timeout cảm biến nhiệt |
| `0x12` | Lỗi bus cảm biến nhiệt |
| Giá trị khác | Unknown |

### Flags tại byte 7

| Bit | Mask | Ý nghĩa |
|---:|---:|---|
| 0–3 | `0x0F` | Protocol version |
| 4 | `0x10` | Emergency |
| 5 | `0x20` | ECG active |
| 6 | `0x40` | Wear detected |
| 7 | `0x80` | Reserved |

## 5. ECG Data (`FE45`) — tùy chọn

Payload dài 20 byte.

| Byte | Kiểu | Ý nghĩa |
|---:|---|---|
| 0 | `uint8` | Sequence number |
| 1 | `uint8` | Số sample hợp lệ, tối đa 9 |
| 2–3 | `int16 LE` | ECG sample 0 |
| 4–5 | `int16 LE` | ECG sample 1 |
| 6–7 | `int16 LE` | ECG sample 2 |
| 8–9 | `int16 LE` | ECG sample 3 |
| 10–11 | `int16 LE` | ECG sample 4 |
| 12–13 | `int16 LE` | ECG sample 5 |
| 14–15 | `int16 LE` | ECG sample 6 |
| 16–17 | `int16 LE` | ECG sample 7 |
| 18–19 | `int16 LE` | ECG sample 8 |

Nếu `sampleCount < 9`, các sample còn lại được xem là padding/không hợp lệ.

## 6. NFC Event (`FE44`) — tùy chọn

Payload dài 20 byte. Firmware hiện định nghĩa 5 byte đầu; byte `5–19` reserved và thường bằng `0`.

| Byte | Ý nghĩa |
|---:|---|
| 0 | NFC state |
| 1 | Last event |
| 2 | FTM status |
| 3 | Config result |
| 4 | Recovery status |
| 5–19 | Reserved |

Các enum chi tiết của 5 field này chưa được firmware cung cấp trong tài liệu hiện có, nên app giữ dạng số raw.

## 7. Debug Data (`FE46`) — tùy chọn

Payload dài 20 byte.

| Byte | Ý nghĩa |
|---:|---|
| 0 | Debug command |
| 1–19 | Tham số hoặc response data |

App giữ byte `1–19` dưới dạng raw vì format từng debug command phụ thuộc firmware.

## 8. Recovery Data (`FE47`) — tùy chọn

Payload dài 24 byte, gồm một record lịch sử hoàn chỉnh.

| Byte | Kiểu | Ý nghĩa |
|---:|---|---|
| 0–1 | `uint16 LE` | Sequence number |
| 2–5 | `uint32 LE` | Timestamp, Unix seconds |
| 6–21 | — | Sensor Data 16 byte, cùng format với `FE42` |
| 22–23 | `uint16 LE` | CRC |

## 9. Tóm tắt dữ liệu app đang đọc

- **HR:** `FE42`, byte `0`, `uint8`, BPM.
- **SpO₂:** `FE42`, byte `1`, `uint8`, percent.
- **Temperature:** `FE42`, byte `2–3`, `int16 LE`, chia `100` để ra °C.
- **Supercap:** `FE42` hoặc `FE43`, byte `4–5`, `uint16 LE`, mV.
- **Power:** `FE42` byte `6` hoặc `FE43` byte `3`.
- **Wear status:** `FE42`/`FE43`, flag byte `7`, bit `6` (`0x40`).
- **QVAR:** `FE42`, byte `14–15`, `uint16 LE`, raw; hiện chưa có scale, filtered value hoặc ngưỡng WORN/NOT_WORN chính thức.
- **Gia tốc:** `FE42`, byte `8–13`, ba giá trị `int16 LE`; magnitude được app tính thêm.
- **ECG/NFC/Debug/Recovery:** đã có decoder theo các characteristic tùy chọn ở trên.

> Lưu ý: các field được ghi là `raw`, `reserved`, `unknown` hoặc “chưa định nghĩa” không nên tự quy đổi nếu chưa có tài liệu enum/scale chính thức từ firmware.
