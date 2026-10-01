# Wearable BLE Protocol

Tài liệu này mô tả toàn bộ dữ liệu app trao đổi với wearable theo protocol v1.

Đã đối chiếu với source firmware `BLE_Wearable_GATT` (ngày 2026-09-30). Tài liệu phía firmware là mục *BLE GATT profile* trong `README.md` của repo đó; khi đổi giao thức phải sửa cả hai nơi cùng lúc.

## 1. Service và characteristic

| Vai trò | UUID | Properties | Độ dài | Trạng thái firmware |
|---|---|---|---:|---|
| Service | `0000fe40-cc7a-482a-984a-7f2ed5b3e58f` | — | — | — |
| Control | `0000fe41-8e22-4541-9d4c-21edae82ed19` | Write | 8 byte | Hoạt động |
| Sensor Data | `0000fe42-8e22-4541-9d4c-21edae82ed19` | Read, Notify | 16 byte | Hoạt động |
| Device Status | `0000fe43-8e22-4541-9d4c-21edae82ed19` | Read, Notify | 8 byte | Hoạt động |
| NFC Event | `0000fe44-8e22-4541-9d4c-21edae82ed19` | Read, Notify | 20 byte | Có trong GATT, firmware chưa gửi gói nào |
| ECG Data | `0000fe45-8e22-4541-9d4c-21edae82ed19` | Read, Notify | 20 byte | Hoạt động |
| Debug Data | `0000fe46-8e22-4541-9d4c-21edae82ed19` | Read, Write, Notify | 20 byte | Có trong GATT, chưa triển khai: ghi vào bị bỏ qua |
| Recovery Data | `0000fe47-8e22-4541-9d4c-21edae82ed19` | Read, Notify | 24 byte | Chưa hoạt động end-to-end (xem mục 8) |

Quy ước chung:

- Các số nhiều byte dùng **little-endian**.
- App **subscribe** (notification) thay vì read. Read một characteristic chỉ trả về gói gần nhất firmware đã notify, và trả về toàn `0` nếu chưa notify lần nào.
- Khi mất kết nối, firmware dừng đo và về state `Idle`; sau khi kết nối lại app phải gửi lại lệnh bắt đầu đo.

## 2. App → thiết bị: Control (`FE41`)

App ghi 8 byte vào `FE41`. Byte `0` là mã lệnh; byte `1–7` bằng `0` trừ các lệnh có tham số.

| Byte 0 | Lệnh | Tham số (byte 1–7) | Tác dụng |
|---:|---|---|---|
| `0x01` | Bắt đầu đo | — | State `Measuring`, gửi Sensor Data mỗi giây |
| `0x02` | Dừng đo | — | State `Idle` |
| `0x03` | Yêu cầu dữ liệu hiện tại | — | Gửi ngay một gói Sensor Data (dữ liệu chỉ được làm mới khi đang đo) |
| `0x04` | Chế độ nguồn Normal | — | `power state = 1` |
| `0x05` | Chế độ nguồn Low-power | — | Dừng đo, `power state = 2`, state `Low power` |
| `0x06` | Bắt đầu ECG | — | Bắt đầu đo nếu chưa đo, chuyển sang ECG, stream `FE45`. Nếu MAX86150 không phản hồi: error `0x01`, state `Measuring` |
| `0x07` | Dừng ECG | — | Dừng ECG **và** dừng đo, state `Idle` |
| `0x08` | Kiểm tra Emergency | — | Bật cờ Emergency, state `Emergency` |
| `0x09` | Đồng bộ thời gian | Xem bên dưới | Đặt Unix time cho thiết bị |
| `0x0A` | Get recovery info | — | Chưa có tác dụng |
| `0x0B` | Bắt đầu BLE recovery | Byte `1–2`: sequence bắt đầu, `uint16 LE` | Xem mục 8 |
| `0x0C` | Dừng BLE recovery | — | Xem mục 8 |
| `0x0D` | Recovery ACK | Byte `1–2`: sequence đã nhận, `uint16 LE` | Hiện chỉ được lưu lại |
| `0x0E` | Xóa lịch sử | — | Xóa toàn bộ log trên ST25DV, không hoàn tác được |
| `0x0F` | LoRa join (OTAA) | — | Lần đầu: khởi động LoRa Basics Modem rồi join; sau `0x13`: join lại |
| `0x10` | LoRa test uplink | — | Một uplink không xác nhận trên FPort 101 (cần đã join). Payload 4 byte: bộ đếm uplink `uint32` **big-endian**, gói đầu tiên là `0` |
| `0x11` | LoRa status | — | Chỉ trả về trạng thái LoRa |
| `0x12` | LoRa TX power | Byte `1`: công suất tối đa của SX1262, `int8` dBm, `-9`–`22` | Mất khi thiết bị reset (mặc định `0` dBm) |
| `0x13` | LoRa stop | — | Rời mạng, dừng join/uplink, SX1262 ngủ |

Firmware trả lời bằng một notification `FE43` sau các lệnh `0x01`, `0x02`, `0x04`–`0x09` và sau một lệnh không hợp lệ. Các lệnh `0x03` và `0x0A`–`0x0E` không có phản hồi riêng. Các lệnh LoRa `0x0F`–`0x13` không đổi state và được trả lời bằng gói LoRa status `0x20` trên `FE46` (mục 7).

Cách app gửi lệnh (`BleManager.sendCommand`):

- Gói khác 8 byte bị từ chối ngay trong app, không ghi xuống thiết bị (kể cả ô raw HEX ở tab Debug).
- Với các lệnh có phản hồi `FE43`, app chờ notification `FE43` kế tiếp tối đa 2 giây. Error code `0x01` thì báo lỗi cho người dùng (ví dụ `0x06` trả về `Measuring` + `0x01`: MAX86150 không vào được chế độ ECG). Không có `FE43` trong 2 giây thì báo là không rõ kết quả.
- Đồng bộ thời gian sau khi kết nối cũng đi qua đường này, nên app biết thiết bị chấp nhận (`0x00`) hay từ chối (`0x01`).
- Trước khi chủ động ngắt kết nối, app gửi `0x02`. Khi thiết bị tự ngắt (`gattserverdisconnected`), app xóa số liệu hiện tại và trạng thái ECG; kết nối lại thì chạy lại toàn bộ luồng.

Mã lệnh lạ đưa thiết bị về state `Error` với error code `0x01` (gói rỗng thì bị bỏ qua, không đổi state). Ở state này firmware ngừng gửi Sensor Data cho đến khi nhận một lệnh đổi state như `0x01` hoặc `0x02`.

### Đồng bộ thời gian (`0x09`)

Đây là một command packet bình thường, 8 byte:

| Byte | Kiểu | Ý nghĩa |
|---:|---|---|
| 0 | `uint8` | `0x09` |
| 1–4 | `uint32 LE` | Unix time, giây |
| 5–6 | `uint16 LE` | Mili giây, `0`–`999` |
| 7 | `uint8` | Reserved, bắt buộc `0x00` |

Ví dụ với Unix time `1724833200` (`0x66CEDDB0`) và `500` ms: `09 B0 DD CE 66 F4 01 00`.

Mili giây lớn hơn `999` hoặc byte 7 khác `0` thì firmware báo error code `0x01` (state không đổi). Không có gói ACK riêng; kết quả nằm trong notification `FE43` ngay sau đó.

> Không được ghi thẳng Unix time dạng `uint64` vào `FE41`: byte thấp nhất của thời gian sẽ bị hiểu là một mã lệnh bất kỳ.

## 3. Thiết bị → app: Sensor Data (`FE42`)

Payload luôn dài 16 byte. Firmware gửi:

- mỗi 1 giây khi state là `Measuring` hoặc `ECG active`;
- ngay lập tức khi cờ `WORN` (`0x40`) hoặc `FALL_CANDIDATE` (`0x08`) đổi;
- một lần khi nhận lệnh `0x03`.

| Byte | Kiểu | Ý nghĩa | Cách diễn giải |
|---:|---|---|---|
| 0 | `uint8` | HR | Nhịp tim, BPM |
| 1 | `uint8` | SpO₂ | Phần trăm bão hòa oxy |
| 2–3 | `int16 LE` | Temperature | Độ C × 100; `-32768` nghĩa là chưa có giá trị hợp lệ |
| 4–5 | `uint16 LE` | Supercap | Điện áp supercapacitor, mV |
| 6 | `uint8` | Power state | `1` = Normal, `2` = Low power |
| 7 | `uint8` | Flags | Các cờ trạng thái, xem bảng dưới |
| 8–9 | `int16 LE` | Accel X | Gia tốc trục X, **mg** (thang ±4 g) |
| 10–11 | `int16 LE` | Accel Y | Gia tốc trục Y, mg |
| 12–13 | `int16 LE` | Accel Z | Gia tốc trục Z, mg |
| 14–15 | `int16 LE` | QVAR raw | Mẫu QVAR thô mới nhất, có dấu |

Lưu ý về độ tin cậy của từng trường:

- **HR / SpO₂ không có cờ hợp lệ.** Khi cảm biến MAX86150 không chạy, firmware gửi HR **giả** chạy 68→82 và SpO₂ cố định 98. Trước nhịp tim đầu tiên HR là 72. Trong phiên ECG, HR và SpO₂ giữ giá trị cuối cùng trước đó.
- **Temperature** giữ giá trị hợp lệ gần nhất khi một lần đo bị lỗi; lỗi được báo qua error code của `FE43`.
- **QVAR raw** là dữ liệu 12-bit canh trái (4 bit thấp luôn bằng `0`), khoảng 37 LSB/mV ở gain 0.5 hiện dùng. Chưa có giá trị đã lọc.
- **Accel và QVAR raw** giữ giá trị cuối khi firmware không đọc được LIS2DUXS12TR, và bằng `0` nếu chưa đọc được lần nào.

### Flags tại byte 7

| Bit | Mask | Ý nghĩa |
|---:|---:|---|
| 0–2 | `0x07` | Reserved |
| 3 | `0x08` | Có ứng viên phát hiện ngã (`FALL_CANDIDATE`); cần chương trình MLC, hiện chưa có nên luôn `0` |
| 4 | `0x10` | Emergency đang hoạt động |
| 5 | `0x20` | ECG đang hoạt động |
| 6 | `0x40` | Thiết bị đang đeo (`WORN`); nếu tắt là `NOT WORN` |
| 7 | `0x80` | Reserved |

Cờ `WORN` do firmware phân loại từ biên độ dao động của tín hiệu QVAR trong các cửa sổ 1 giây (có hysteresis); app không tự áp ngưỡng lên giá trị raw. Cờ chỉ được cập nhật khi đang đo và ngoài phiên ECG; ngưỡng trong firmware chưa được hiệu chuẩn.

App cũng tính `magnitude = sqrt(X² + Y² + Z²)` từ các byte gia tốc; đây là giá trị dẫn xuất, không nằm trực tiếp trong payload.

## 4. Device Status (`FE43`)

Payload dài 8 byte. **Không gửi định kỳ.** Firmware gửi khi:

- app bật notification cho `FE43`;
- sau các lệnh Control nêu ở mục 2;
- khi state, sensor ready, error code, power state hoặc byte flags tự thay đổi (ví dụ lỗi cảm biến nhiệt xuất hiện hoặc hết, cờ `WORN` đổi).

Điện áp supercap thay đổi thì không kích hoạt notify, nên byte `4–5` có thể cũ; giá trị mới nhất nằm ở `FE42`.

| Byte | Kiểu | Ý nghĩa |
|---:|---|---|
| 0 | `uint8` | Measurement state |
| 1 | `uint8` | Sensor ready: `1` khi khối cảm biến của firmware đã khởi tạo. **Không** cho biết từng cảm biến có hoạt động hay không |
| 2 | `uint8` | Error code |
| 3 | `uint8` | Power state: `1` = Normal, `2` = Low power |
| 4–5 | `uint16 LE` | Supercap voltage, mV |
| 6 | `uint8` | Reset counter; firmware chưa hỗ trợ, luôn `0` |
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
| `0x01` | Lệnh không hợp lệ hoặc không thực hiện được |
| `0x10` | Không có cảm biến nhiệt |
| `0x11` | Timeout cảm biến nhiệt |
| `0x12` | Lỗi bus cảm biến nhiệt |
| Giá trị khác | Unknown |

- Mã `0x10`–`0x12` là kết quả của lần đo nhiệt độ gần nhất. Chúng bị che khi đang có lỗi `0x01`.
- Giao thức chỉ báo **lỗi** của cảm biến nhiệt, không có mã "OK" riêng: `0x00` cùng với Temperature khác `-32768` nghĩa là cảm biến hoạt động.
- Các cảm biến còn lại (MAX86150, LIS2DUXS12TR) chưa có error code.

### Flags tại byte 7

| Bit | Mask | Ý nghĩa |
|---:|---:|---|
| 0–3 | `0x0F` | Protocol version (hiện là `1`) |
| 4 | `0x10` | Emergency |
| 5 | `0x20` | ECG active |
| 6 | `0x40` | Wear detected |
| 7 | `0x80` | Reserved |

Cờ `FALL_CANDIDATE` (`0x08`) không có trong `FE43` vì nibble thấp mang protocol version.

## 5. ECG Data (`FE45`)

Payload dài 20 byte. Chỉ gửi trong phiên ECG (sau lệnh `0x06`, cho đến `0x07`, `0x01`, `0x02`, `0x05` hoặc khi mất kết nối).

| Byte | Kiểu | Ý nghĩa |
|---:|---|---|
| 0 | `uint8` | Sequence number: tăng 1 mỗi gói, quay vòng sau 255, về `0` khi bắt đầu phiên mới |
| 1 | `uint8` | Số sample hợp lệ; firmware luôn gửi `9` |
| 2–19 | `int16 LE` × 9 | ECG sample 0–8 theo thứ tự thời gian |

- Tần số lấy mẫu **200 Hz**, khoảng 22 gói mỗi giây.
- 1 LSB tương ứng khoảng **0.645 µV** ở đầu vào.
- **Sequence nhảy cóc nghĩa là mất gói thật**: firmware vẫn tăng sequence khi app chưa bật notification hoặc khi hàng đợi gửi (16 gói) bị đầy.
- Nếu `sampleCount < 9` (hiện không xảy ra), các sample còn lại là padding.
- **Trạng thái phiên ECG lấy từ cờ `0x20` của `FE43`/`FE42`**, không suy ra từ việc app đã gửi `0x06`/`0x07` hay đã nhận gói `FE45`. Lý do: `0x06` có thể thất bại (MAX86150 không phản hồi → error `0x01`), phiên cũng kết thúc khi gặp `0x01`, `0x02`, `0x05`, và các gói `FE45` còn trong hàng đợi có thể đến sau notification `FE43` báo đã dừng.

## 6. NFC Event (`FE44`)

Payload dài 20 byte. Firmware đã định nghĩa 5 byte đầu nhưng **chưa gửi gói nào** trên characteristic này.

| Byte | Ý nghĩa |
|---:|---|
| 0 | NFC state |
| 1 | Last event |
| 2 | FTM status |
| 3 | Config result |
| 4 | Recovery status |
| 5–19 | Reserved |

Enum của 5 field này chưa được firmware định nghĩa, nên app giữ dạng số raw.

## 7. Debug Data (`FE46`)

Payload dài 20 byte.

| Byte | Ý nghĩa |
|---:|---|
| 0 | Debug command |
| 1–19 | Tham số hoặc response data |

Firmware mới chỉ đặt tên cho các mã lệnh `0x01`–`0x07` (set sensor rate, set BLE interval, set log interval, set power threshold, get power stats, get log info, get sensor status) và **chưa xử lý lệnh nào**: ghi vào `FE46` bị bỏ qua và không có phản hồi. Gói có byte `0` khác `0x20` được app giữ dạng raw.

### Gói `0x20`: LoRa status

Firmware notify gói này sau mỗi lệnh LoRa `0x0F`–`0x13` của `FE41` và sau mỗi sự kiện của modem. Decoder: `decodeLoraStatus()`; màn hình: `components/lora-test.tsx`.

| Byte | Kiểu | Trường | Giá trị |
|---:|---|---|---|
| 0 | `uint8` | Mã gói | `0x20` |
| 1 | `uint8` | LoRa state | `0` chưa chạy hoặc đã stop, `1` thiếu credentials, `2` đang join, `3` đã join, `4` join lỗi (LBM tự thử lại), `5` lỗi API của LBM, `0xFF` firmware build với `LBM_APP_ENABLE = 0` |
| 2 | `int8` | TX power cap | dBm, giới hạn công suất phát của SX1262 |
| 3 | `uint8` | Sự kiện modem gần nhất | `0` reset, `1` alarm, `2` joined, `3` TX done, `4` downlink, `5` join fail. Chỉ có nghĩa khi byte `10–11` > 0 |
| 4 | `uint8` | Kết quả TX gần nhất | `0` chưa gửi, `1` đã gửi, `2` có ACK |
| 5 | `int8` | Mã lỗi LBM gần nhất | `smtc_modem_return_code_t`: `0` OK, `1` not init, `2` invalid, `3` busy, `4` fail, `5` no time, `6` invalid stack ID, `7` no event |
| 6 | `uint8` | Kết quả lệnh | `0x00` OK, `0x01` firmware không có LoRa, `0x02` chưa join (cho `0x10`), `0x03` LBM từ chối (xem byte 5), `0x04` TX power ngoài `-9`…`22`, `0xFF` không phải trả lời lệnh mà là một sự kiện modem |
| 7 | `uint8` | Modem | `0` chưa khởi động, `1` đang trong `smtc_modem_init()`, `2` đã khởi động |
| 8–9 | `uint16` LE | Số uplink đã yêu cầu | |
| 10–11 | `uint16` LE | Số sự kiện modem | |
| 12–13 | `uint16` LE | Số downlink | |
| 14–15 | `uint16` LE | Số lần LBM panic | Mỗi lần panic là một lần reset MCU; đếm từ khi cấp nguồn |
| 16–17 | `uint16` LE | Số lần BUSY của SX1262 kẹt quá 100 ms | |
| 18–19 | `uint16` LE | Số lỗi SPI tới SX1262 | |

Ví dụ: `20 03 00 03 01 00 FF 02 01 00 04 00 00 00 00 00 00 00 00 00` = đã join, cap 0 dBm, sự kiện TX done, đã gửi, gói do sự kiện modem, 1 uplink, 4 sự kiện.

Firmware không tự gửi gói `0x20` khi app vừa kết nối. Vì vậy app gửi `0x11` ngay sau khi kết nối (sau đồng bộ thời gian) để lấy trạng thái hiện tại, và bỏ gói status cũ khi mất kết nối.

## 8. Recovery Data (`FE47`)

Payload dài 24 byte, gồm một record lịch sử.

| Byte | Kiểu | Ý nghĩa |
|---:|---|---|
| 0–1 | `uint16 LE` | Sequence number |
| 2–5 | `uint32 LE` | Timestamp, Unix seconds |
| 6–21 | — | Sensor Data 16 byte, cùng format với `FE42` |
| 22–23 | `uint16 LE` | CRC của record lưu trên ST25DV (không phải CRC của 24 byte này) |

Luồng dự kiến: app gửi `0x0B` kèm sequence bắt đầu, firmware phát lần lượt các record, app gửi `0x0D` để ACK và `0x0C` để dừng.

**Hiện chưa hoạt động end-to-end trong firmware**, app không nên phụ thuộc vào nó:

- hàm phát record chưa được gọi, nên `0x0B` không sinh ra gói nào;
- log chỉ được ghi khi đang đo mà không có kết nối BLE, trạng thái hiện không xảy ra vì mất kết nối là dừng đo;
- record lưu chưa được gán sequence (luôn `0`) và CRC chưa được ghi xuống bộ nhớ.

## 9. Tóm tắt dữ liệu app đang đọc

- **HR:** `FE42`, byte `0`, `uint8`, BPM. Có thể là giá trị giả khi MAX86150 không chạy.
- **SpO₂:** `FE42`, byte `1`, `uint8`, percent.
- **Temperature:** `FE42`, byte `2–3`, `int16 LE`, chia `100` để ra °C; `-32768` là không hợp lệ. Lỗi cảm biến nằm ở `FE43` byte `2`.
- **Supercap:** `FE42` byte `4–5` (mới mỗi giây) hoặc `FE43` byte `4–5` (có thể cũ), `uint16 LE`, mV.
- **Power:** `FE42` byte `6` hoặc `FE43` byte `3`; `1` = Normal, `2` = Low power.
- **Wear status:** `FE42`/`FE43`, flag byte `7`, bit `6` (`0x40`), do firmware phân loại.
- **QVAR:** `FE42`, byte `14–15`, `int16 LE`, raw; chưa có filtered value.
- **Gia tốc:** `FE42`, byte `8–13`, ba giá trị `int16 LE`, đơn vị mg; magnitude được app tính thêm.
- **ECG:** `FE45`, 9 sample `int16 LE` mỗi gói, 200 Hz.
- **LoRa test:** `FE46` gói `0x20`, xem mục 7.
- **NFC/Recovery, Debug khác `0x20`:** app đã có decoder nhưng firmware chưa phát dữ liệu trên các characteristic này.

> Lưu ý: các field được ghi là `raw`, `reserved`, `unknown` hoặc "chưa định nghĩa" không nên tự quy đổi nếu chưa có tài liệu enum/scale chính thức từ firmware.
