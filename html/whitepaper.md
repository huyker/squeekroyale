# Squeek Royale — Whitepaper

## 1. Squeek Royale là gì

Squeek Royale là game Battle Royale 2D góc nhìn từ trên xuống. Mỗi trận có tới 100 hamster chiến đấu trên một hòn đảo tròn, cho tới khi chỉ còn **đúng một** con sống sót.

Hamster không do người chơi điều khiển. Mỗi con là một AI tự quyết định nhặt đồ, đánh, né, chạy khỏi vùng bão hay đi săn Vương miện. Người chơi làm ba việc:

- **Sở hữu hamster:** mỗi hamster là một NFT. DNA của nó quyết định ngoại hình, trang bị và chỉ số, và không bao giờ thay đổi.
- **Đưa hamster ra trận:** vào các trận có sẵn trên lịch, hoặc **tự tạo phòng** và mời người khác vào.
- **Xem trận và nhận thưởng:** xem lại trận của mình, bám theo hamster của mình, nhận phần thưởng theo điểm.

Mọi thứ diễn ra trên hai trang: **trang chủ** (giới thiệu và whitepaper này) và **khu người chơi `/play`**.

> Kết quả mỗi trận đã được quyết định trọn vẹn trước khi trận được phát. Tốc độ xem, tua, góc camera hay thiết bị của bạn không thể thay đổi ai thắng.

## 2. Luật chơi

### 2.1. Một trận đấu

- **Số hamster:** từ 2 tới 100 hamster mỗi trận, do người tạo trận chọn.
- **Bản đồ:** đảo tròn có nhà, cây, đá, thùng, bụi cây và gốc cây. Nhà, thân cây và đồ vật chắn đường đi và chắn đạn.
- **Thời lượng:** khoảng 2 phút. Vòng an toàn nhỏ nhất xuất hiện ở giây thứ 130, đấu sinh tử bắt đầu từ giây 135, và trận kết thúc chậm nhất ở giây 240.
- **Bắt đầu tay không:** mọi hamster vào trận với **Móng vuốt** (5 sát thương). Vũ khí phải nhặt trên bản đồ.

### 2.2. Nhảy dù

- Hamster nhảy dù xuống một **điểm rơi ngẫu nhiên**. Không ai, kể cả chủ hamster, chọn được điểm rơi.
- Điểm rơi luôn nằm trong vành đai an toàn của đảo, cách nhau ít nhất 375 đơn vị, không trùng vật cản.
- Hamster chạm đất trong khoảng giây 1,5 – 3,5. Trước khi chạm đất nó chưa bị nhìn thấy, chưa thể bị đánh.

### 2.3. Bão Mèo (vùng bo)

Đảo tròn ngay từ đầu, và vòng an toàn **co lại liên tục**, không có lúc dừng. Ngoài vòng là Bão Mèo: sương tím, mây bão, đôi mắt mèo khổng lồ phát sáng.

| Giai đoạn | Thời gian | Bán kính vòng an toàn | Sát thương ngoài vòng |
|---|---|---|---|
| 1 | 0 – 25 giây | còn 3.800 | 4 HP/giây |
| 2 | 25 – 55 giây | còn 2.400 | 8 HP/giây |
| 3 | 55 – 85 giây | còn 1.200 | 16 HP/giây |
| 4 | 85 – 110 giây | còn 450 | 28 HP/giây |
| 5 | 110 – 130 giây | còn 150 | 45 HP/giây |
| Sinh tử | từ giây 135 | mỗi 5 giây nhỏ thêm, tối thiểu 90 | mỗi 5 giây +9 HP/giây |

- Sát thương của bão **xuyên giáp** và không tính là hạ gục cho ai.
- Tâm của mỗi vòng có thể lệch khỏi tâm vòng trước, nên vòng cuối không phải lúc nào cũng ở giữa đảo.

### 2.4. Vũ khí

Hamster tự đổi sang vũ khí **cấp cao hơn** khi đi qua; vũ khí cũ rơi lại trên đất. Khi hamster bị hạ, vũ khí và đồ trong túi của nó rơi xuống đất.

| Vũ khí | Loại | Sát thương | Hồi chiêu | Tầm | Cấp | Đặc điểm |
|---|---|---|---|---|---|---|
| Dao găm | Cận chiến | 12 | 0,35 giây | 32 | 1 | Đâm nhanh một mục tiêu |
| Kiếm | Cận chiến | 25 | 0,75 giây | 46 | 3 | Chém hình quạt ~60°, trúng mọi kẻ trong vùng |
| Rìu | Cận chiến | 38 | 1,15 giây | 48 | 5 | Chém hình quạt ~70° |
| Giáo | Cận chiến | 22 | 0,85 giây | 85 | 4 | Đâm xuyên một đường thẳng |
| Búa | Cận chiến | 45 | 1,55 giây | 50 | 6 | Nện vùng tròn bán kính 55, **làm choáng 0,4 giây** |
| Cung | Tầm xa | 18 | 0,9 giây | 220 | 2 | Tên bay 520 đơn vị/giây |
| Nỏ | Tầm xa | 34 | 1,55 giây | 250 | 6 | Mũi nỏ bay 640 đơn vị/giây |
| Gậy phép | Tầm xa | 20 | 1,2 giây | 190 | 4 | Cầu phép bay 380 đơn vị/giây |

- Đạn tầm xa ngắm trước theo hướng chạy của mục tiêu và có thể lệch. Nhà, cây, đá chặn đạn.
- Mục tiêu có thể **né**. Cơ hội né phụ thuộc chỉ số AGI của mục tiêu và độ chính xác của người đánh: tối đa 52% với đòn cận chiến, 38% với đòn tầm xa, cao hơn khi đang lướt.
- **Lướt (dash):** tăng tốc gấp 2,9 lần trong 0,25 giây, hồi 3,2 giây. Hamster lướt để chạy thoát, quay về vùng an toàn, áp sát hoặc né đạn.

### 2.5. Vật phẩm hồi máu

Hamster có **túi 3 ô** và tự ăn khi máu xuống thấp. Khi đang ăn, nó đi chậm còn 60% và không đánh được.

| Vật phẩm | Hồi ngay | Hồi theo thời gian | Thời gian ăn | Ghi chú |
|---|---|---|---|---|
| Hạt hướng dương | 25 | — | 0,3 giây | |
| Miếng phô mai | 10 | +55 trong 4 giây | 0,5 giây | |
| Sữa mật ong | 100 | — | 1,2 giây | Bị đánh trúng thì dừng ăn, vật phẩm vẫn còn trong túi |
| Dâu vàng | 45 | — | 0,4 giây | Tăng 35% tốc độ chạy trong 3 giây |

- **Rương báu:** 70 rương rải trên đảo. Hamster đang mất máu chạm vào rương được hồi ngay 65 HP.
- **Hòm tiếp tế:** rơi ở giây 20, 45, 70 và 95, mỗi lần 3 hòm, luôn rơi vào chỗ sẽ còn an toàn 10 giây sau. Mở hòm mất 0,5 giây và nhận được:
  - một vũ khí mạnh (thường là nỏ, búa, rìu);
  - hồi 80 HP;
  - một vật phẩm hồi máu.

### 2.6. Vương miện

- Hamster **hạ gục đầu tiên** của trận nhận Vương miện.
- Ai hạ người đội Vương miện sẽ cướp Vương miện và được **hồi đầy máu**.
- Nếu người đội chết vì bão, Vương miện rơi xuống đất. Hamster đầu tiên chạm vào sẽ nhặt được và cũng được hồi đầy máu.
- Người đội Vương miện được **nhân đôi điểm sống sót**, và bị cả đảo săn đuổi. Hạ được người đội tính **gấp đôi điểm hạ gục**.

### 2.7. Hạ gục, điểm và thứ hạng

- **Hạ gục** tính cho hamster cuối cùng gây sát thương trong vòng 2 giây trước khi mục tiêu chết, nếu nó vẫn còn sống.
- **Điểm** của mỗi hamster:
  - 1 điểm cho mỗi giây còn sống (×2 khi đang đội Vương miện);
  - **50 điểm** cho mỗi hạ gục (×2 nếu hạ người đội Vương miện).
- **Thứ hạng** là thứ tự sống sót: hamster bị loại khi còn N con sống thì đứng hạng N, người sống sót cuối cùng là hạng 1.
- Thứ hạng quyết định ai thắng. **Điểm quyết định phần thưởng.** Một hamster hạng 3 có nhiều hạ gục có thể nhận thưởng nhiều hơn hạng 2.

### 2.8. Luôn đúng một người thắng

- Khi chỉ còn một hamster, nó thắng.
- Nếu những con cuối cùng cùng chết trong một khoảnh khắc, người thắng được chọn theo thứ tự: nhận ít sát thương nhất, gây nhiều sát thương nhất, nhiều hạ gục nhất, số thứ tự nhỏ nhất.
- Ở giây 240, nếu vẫn còn nhiều hamster sống, cách chọn trên được áp dụng cho những con còn sống.

### 2.9. Ba chế độ trận

| Chế độ | Khác biệt |
|---|---|
| **Standard** | Luật như mô tả ở trên |
| **Brawler** | Đồ nhặt thiên về vũ khí cận chiến; bão co nhanh hơn và mạnh hơn, đấu sinh tử từ giây 110 |
| **Sniper** | Đồ nhặt thiên về cung, nỏ, gậy phép; hamster giao chiến từ khoảng cách xa hơn; bão như Standard |

## 3. Hamster NFT

### 3.1. DNA

Mỗi hamster là một NFT chuẩn ERC-721 trong bộ sưu tập **Squeek Hamster** (ký hiệu SQHAM), tối đa 10.000 con. Lúc mint, hamster nhận một **DNA 256-bit**. DNA không bao giờ thay đổi và quyết định:

- ngoại hình: màu lông, hoa văn, mắt;
- ba món trang bị: **trang phục, mũ, đồ đeo lưng** (mũ và đồ đeo lưng có thể để trống);
- năm chỉ số chiến đấu;
- tính cách: hiếu chiến, thận trọng, thích nhặt đồ.

### 3.2. Trang bị và chỉ số

Mỗi chỉ số = **6 điểm gốc** + điểm từ trang phục + mũ + đồ đeo lưng. Trang phục cho 10 điểm, mũ và đồ đeo lưng mỗi món 6 điểm, ô trống cho 4 điểm. Tổng chỉ số của một hamster luôn trong khoảng **48 – 52**: hamster khác nhau ở cách phân bổ, không ở tổng sức mạnh.

| Chỉ số | Tác dụng trong trận | Khoảng |
|---|---|---|
| **STR** (Sức mạnh) | Nhân sát thương gây ra | 94% – 118% |
| **AGI** (Nhanh nhẹn) | Tốc độ chạy, khả năng né đòn, rút ngắn hồi chiêu | 97 – 146 đơn vị/giây; hồi chiêu 104% – 90% |
| **ARM** (Giáp) | Giảm sát thương nhận từ hamster khác (không giảm sát thương bão) | 4% – 17% |
| **VIT** (Sinh lực) | Máu tối đa | 200 – 255 HP |
| **PER** (Quan sát) | Độ chính xác khi đánh và tầm phát hiện đối thủ | tầm nhìn 330 – 480 đơn vị |

### 3.3. Tính cách

DNA cũng đặt tính cách, quyết định cách AI chơi:

| Tính cách | Lối chơi |
|---|---|
| Berserker | Rất hiếu chiến, lao vào mọi trận đánh |
| Hunter | Hiếu chiến và ít thận trọng, đi săn mục tiêu |
| Scavenger | Ưu tiên nhặt đồ, rương và hòm tiếp tế |
| Survivor | Thận trọng, tránh giao chiến bất lợi |
| Tactician | Cân bằng giữa các lối chơi |

### 3.4. Thẻ NFT

Thẻ của mỗi hamster hiển thị hình hamster, tên, DNA rút gọn, năm chỉ số, trang bị, chỉ số chiến đấu và tính cách. Khung thẻ có bốn độ hiếm, được quy định bởi DNA:

| Khung | Điểm trung bình |
|---|---|
| Mythic · Đỏ rực | trên 8/10 |
| Epic · Tím | 6 – 8/10 |
| Rare · Xanh lá | 4 – 5/10 |
| Worn · Gỗ cũ | dưới 4/10 |

Độ hiếm của khung là yếu tố sưu tầm. Sức mạnh thật trong trận đến từ năm chỉ số ở mục 3.2.

### 3.5. Mint

- Mint tối đa 10 hamster mỗi giao dịch.
- Hiện mint miễn phí, người mint chỉ trả phí gas.
- DNA được tạo ngay lúc mint, và hamster dùng được ngay.

## 4. Tham gia trận

### 4.1. Lịch trận

Trận được lên lịch sẵn, có thể trước tới 7 ngày, mỗi trận cách nhau một khoảng cố định. Khu người chơi luôn hiển thị **trận đang mở gần nhất** để bạn tham gia ngay.

Mỗi trận có: số chỗ tối đa, chế độ (Standard / Brawler / Sniper), phí vào trận, tỷ lệ thưởng và giờ bắt đầu. Các thông số này cố định từ lúc trận được tạo.

### 4.2. Tự tạo phòng

Bất kỳ người chơi nào cũng tạo được phòng đấu của riêng mình, ngay trên khu người chơi:

- **Giờ bắt đầu:** từ ít phút tới tối đa 7 ngày nữa. Tới giờ này đăng ký đóng lại và trận diễn ra.
- **Số hamster tối đa:** từ 2 tới 100.
- **Chế độ:** Standard, Brawler hoặc Sniper.

Phòng của người chơi chạy y hệt trận trên lịch: cùng phí vào trận, cùng luật, cùng cách trả thưởng, và kết quả được công bố tự động.

- **Chỉ có 1 người vào phòng:** không có trận nào diễn ra. Tới giờ bắt đầu, người đó bấm nhận là được **hoàn lại 100% phí** ngay.
- **Từ 2 người trở lên:** trận diễn ra như bình thường.

### 4.3. Ký gửi hamster

Hamster chỉ ra trận được khi đã được **ký gửi** vào contract đấu trường.

- Ký gửi một lần, rồi đăng ký bao nhiêu trận cũng được.
- Trong thời gian ký gửi, hamster vẫn là của bạn nhưng **không thể chuyển hay bán**. Nhờ vậy hamster đã đăng ký trận không thể đổi chủ giữa chừng.
- Mỗi hamster đăng ký được tối đa **50 trận đang mở** cùng lúc.
- Trong mục **Hamster của tôi**, mỗi thẻ hamster ghi rõ đang ở ví hay đã ký gửi, kèm nút **Ký gửi** hoặc **Rút về ví**. Lần tham gia trận đầu tiên cũng tự ký gửi giúp bạn.

### 4.4. Đăng ký trận

- Chọn trận, chọn hamster đã ký gửi, trả **phí vào trận** (hiện là 0,0001 ETH).
- Có thể đăng ký **nhiều trận trong một giao dịch**.
- Mỗi hamster vào một trận được một lần.
- Đăng ký đóng tại một block định trước. Sau thời điểm đó danh sách người chơi bị khoá.

### 4.5. Rút hamster

Bạn có thể rút hamster về ví bất cứ lúc nào.

- Các trận **còn mở đăng ký** của hamster đó bị huỷ và **phí được hoàn lại** cho bạn.
- Các trận **đã đóng đăng ký** vẫn diễn ra với hamster đó, và phần thưởng vẫn trả về ví đã đăng ký.

## 5. Trận đấu được quyết định trên blockchain thế nào

### 5.1. Seed của trận

- Khi đăng ký đóng, seed của trận là **hash của một block được đào sau thời điểm đóng**, kết hợp với số trận, địa chỉ contract và mạng.
- Vì block đó chưa tồn tại khi đăng ký còn mở, **không ai biết trước seed**: không người chơi, không đội vận hành.
- Seed quyết định mọi yếu tố ngẫu nhiên của trận: bản đồ, điểm rơi, vị trí vũ khí và vật phẩm, đường đi của bão, hòm tiếp tế, và mọi lần né hay lệch đạn.
- DNA của hamster không phụ thuộc seed: hamster mang đúng chỉ số của mình vào mọi trận.

### 5.2. Mô phỏng tất định

- Trận được mô phỏng bằng một bộ máy **tất định**: cùng seed, cùng danh sách hamster, cùng phiên bản luật thì luôn cho **cùng một kết quả**, trên mọi máy.
- Mỗi trận ghi lại phiên bản luật nó được chơi. Trận cũ luôn được kiểm chứng bằng đúng luật của nó, kể cả khi game được cân bằng lại sau này.

### 5.3. Công bố kết quả

Sau khi trận được mô phỏng, kết quả được ghi lên blockchain trong **một giao dịch**, gồm:

- điểm của từng hamster, được contract tự gộp thành một **Merkle root** dùng để trả thưởng;
- **thứ hạng và số hạ gục** của từng hamster;
- mã băm kết quả (resultHash) và mã băm bản ghi trận (replayHash).

### 5.4. Xác nhận (Confirmed)

- Kết quả vừa công bố ở trạng thái **chờ xác nhận** trong 1 giờ. Trong thời gian này, nếu phát hiện kết quả sai, owner có thể huỷ kết quả: trận chuyển sang **huỷ** và mọi người được hoàn phí.
- Hết 1 giờ, kết quả là **chính thức (Confirmed)** và không ai thay đổi được nữa. Phần thưởng mở để nhận.
- Trang chơi chỉ hiển thị **Confirmed** cho trận đã qua thời gian chờ. Thắng/thua, thứ hạng, số hạ gục và mã giao dịch đều đọc từ blockchain.

### 5.5. Ai cũng kiểm chứng được

Mỗi trận bạn xem lại được dựng lại ngay trong trình duyệt từ seed và danh sách hamster trên blockchain, rồi so với kết quả đã ghi trên chain. Khu người chơi chỉ ghi **Confirmed** cho trận khớp đúng kết quả on-chain.

### 5.6. Trận bị huỷ

Trận bị huỷ và mọi người được hoàn đủ phí khi:

- có ít hơn 2 hamster khi tới giờ bắt đầu (người chơi duy nhất tự nhận lại phí ngay, không cần chờ);
- kết quả không được công bố trong 24 giờ sau khi có seed (khi đó ai cũng có thể huỷ trận);
- owner huỷ kết quả trong thời gian chờ xác nhận.

## 6. Cơ chế trả thưởng

### 6.1. Quỹ thưởng

- **Quỹ trận** = tổng phí vào trận của mọi hamster.
- **90%** quỹ trận là **quỹ thưởng**, chia cho người chơi theo điểm.
- **10%** vào quỹ dự án.
- Phí vào trận và tỷ lệ thưởng có thể thay đổi cho các trận tạo sau, nhưng không bao giờ thấp hơn 50% cho người chơi. Mỗi trận giữ nguyên thông số của nó từ lúc tạo.

### 6.2. Công thức

> Phần thưởng của một hamster = Quỹ thưởng × Điểm của hamster ÷ Tổng điểm của trận

Ví dụ: trận 100 hamster, phí 0,0001 ETH → quỹ trận 0,01 ETH, quỹ thưởng 0,009 ETH. Hamster đạt 300 điểm trong tổng 9.000 điểm nhận 0,009 × 300 ÷ 9.000 = 0,0003 ETH, gấp 3 lần phí vào trận.

Mọi hamster đều có điểm, vì mỗi giây sống sót đều được tính. Hamster sống lâu và hạ gục nhiều nhận phần lớn hơn.

### 6.3. Nhận thưởng

- Nhận thưởng sau khi trận **Confirmed**, tức 1 giờ sau khi có kết quả.
- Mỗi lần nhận kèm một **bằng chứng Merkle** cho điểm của bạn. Trang chơi tự tạo bằng chứng này.
- **Nhận tất cả:** gộp phần thưởng và tiền hoàn phí của nhiều trận vào **một giao dịch**.
- Tiền luôn trả về **ví đã đăng ký** hamster vào trận đó, kể cả khi hamster đã đổi chủ sau này.

### 6.4. Thời hạn nhận

Phần thưởng và tiền hoàn phí nhận được trong **90 ngày** sau khi trận kết thúc. Sau 90 ngày, phần chưa ai nhận được chuyển vào quỹ dự án.

## 7. Khu người chơi (/play)

Kết nối MetaMask trên mạng Sepolia để mở khu người chơi. Khu người chơi gồm các mục:

| Mục | Bạn làm được gì |
|---|---|
| **Đấu trường** | Xem danh sách trận theo tab *Đang mở*, *Đã đăng ký*, *Đã kết thúc*, *Tất cả*; **tạo phòng**; mở một trận theo **Match ID**; tham gia trận bằng cách **bấm vào hình hamster** muốn đưa vào; bấm vào thẻ trận để mở **trang riêng của trận** |
| **Hamster của tôi** | Mint hamster mới; xem thẻ NFT, chỉ số, trang bị; **ký gửi** hoặc **rút về ví** |
| **Bảng xếp hạng** | Xếp hạng người chơi theo các trận đã xác nhận |
| **Lịch sử trận** | Các trận **của bạn**: thắng/thua, hạng, hạ gục, điểm, phần thưởng; xem lại từng trận |
| **Bản ghi on-chain** | Mã trận, ví, kết quả, hạng, số hạ gục, mã giao dịch và trạng thái **Confirmed**; nút **Nhận toàn bộ thưởng** (1 giao dịch) |

## 8. Xem lại trận

### 8.1. Trang riêng của mỗi trận

- Mỗi trận có **đường dẫn riêng**: `/play?match=<số trận>`. Bấm vào thẻ trận, hoặc mở trận từ **Lịch sử trận**, để tới trang của trận đó; nút Back của trình duyệt đưa bạn về danh sách.
- Trang trận hiển thị: giờ bắt đầu và đồng hồ đếm ngược, chế độ, số hamster, phí vào trận, quỹ thưởng, hamster của bạn trong trận, và các nút tham gia / nhận thưởng.
- **Chia sẻ:** nút **🔗 Chia sẻ** copy đường dẫn của trận. Người nhận mở link sẽ thấy lời mời vào trận đó, kết nối ví là tới thẳng trận để tham gia.

### 8.2. Xem trực tiếp và xem lại

- Bạn xem được **những trận mà hamster của bạn tham gia**.
- **Trực tiếp:** đúng giờ trận bắt đầu, trận tự phát ngay trên trang của trận, chạy theo **thời gian thực**. Vào muộn thì xem tiếp từ đúng thời điểm đang diễn ra; không tua, không tạm dừng.
- **Xem lại:** trận đã kết thúc có nút **▶ Replay** để xem lại từ đầu (có tạm dừng, không tua).
- Tên hamster, thanh máu và hiệu ứng luôn hiển thị.
- **Hamster của bạn nổi bật:** tên màu **đỏ đậm**, chữ đậm có mũi tên ▼, vòng đỏ dưới chân, và luôn hiện kể cả khi camera ở xa.

### 8.3. Ba chế độ camera

| Chế độ | Cách hoạt động |
|---|---|
| **Auto (đạo diễn)** | Camera đọc trước 6 giây diễn biến và tự chuyển tới chỗ đáng xem nhất: Vương miện đổi chủ, pha hạ gục, hỗn chiến đông người, hòm tiếp tế, và trận chung kết khi còn 3 hamster. Lúc yên tĩnh camera lùi ra toàn cảnh vùng an toàn. Mỗi cảnh giữ ít nhất 1,8 giây để không giật |
| **Follow (theo dõi)** | Bấm vào một hamster để bám theo nó |
| **Free (tự do)** | Cuộn chuột để phóng to/thu nhỏ, kéo để di chuyển, bấm bản đồ nhỏ để nhảy tới vị trí đó |

Nút **👤 Theo dõi hamster của tôi:** camera zoom sát và bám theo hamster của bạn. Có nhiều hamster trong trận thì mỗi lần bấm chuyển sang con tiếp theo, ưu tiên con còn sống.

Phím **Space** để tạm dừng / phát tiếp khi xem lại.

### 8.4. Thông tin trên màn hình

- **Thanh trạng thái:** số hamster còn sống, đồng hồ, giai đoạn bão và sát thương bão, người đang đội Vương miện, chế độ camera.
- **Bảng hạ gục:** 7 pha hạ gục gần nhất, kèm vũ khí.
- **Bảng điểm trực tiếp:** 8 hamster điểm cao nhất, chia điểm sống sót và điểm hạ gục.
- **Bản đồ nhỏ:** vòng an toàn và vị trí hamster (vàng là Vương miện).
- **Bảng thông tin hamster:** tính cách, máu, vũ khí, túi đồ, trang bị, năm chỉ số, và điều AI đang ưu tiên làm.
- **Hiệu ứng:** đường chém theo từng vũ khí, số sát thương, chữ NÉ, choáng, hồi máu, vệt lướt, hào quang Vương miện.

### 8.5. Màn hình kết quả

- Người thắng, số hạ gục, sát thương và thời gian sống sót.
- Dòng thời gian của Vương miện.
- Bảng xếp hạng đầy đủ: hạng, điểm, điểm sống sót, điểm hạ gục, hạ gục, sát thương gây ra và nhận vào, máu đã hồi, thời điểm bị loại, vũ khí.
- Mã băm của trận để đối chiếu với kết quả trên blockchain.

### 8.6. Xem trước gameplay

Trang chủ có mục **Xem trước gameplay**: các đoạn giao tranh nổi bật chạy liên tục (hỗn chiến đầu trận, săn Vương miện, hòm tiếp tế, vòng bo cuối), không cần ví.

## 9. Công bằng và minh bạch

- **Không ai chọn được kết quả:** seed lấy từ một block chưa tồn tại khi đăng ký còn mở; điểm rơi do seed quyết định.
- **Không ai đổi được hamster:** DNA, trang bị và chỉ số cố định từ lúc mint; hamster đã ký gửi không đổi chủ được.
- **Ai cũng kiểm chứng được:** mô phỏng lại trận từ dữ liệu on-chain luôn cho đúng kết quả đã công bố.
- **Có lưới an toàn:** 1 giờ chờ xác nhận để sửa kết quả sai; hoàn phí khi trận không diễn ra.
- **Tiền luôn về đúng người:** phần thưởng trả cho ví đã đăng ký, không ai nhận thay được.

## 10. Lộ trình

### Phase 1 — ETH

Phase hiện tại. Mọi giao dịch trong game dùng **ETH**:

- mint hamster (hiện miễn phí, chỉ trả gas);
- phí vào trận;
- quỹ thưởng 90% chia theo điểm và tiền hoàn phí;
- toàn bộ luật chơi, NFT, ký gửi, lịch trận, xác nhận kết quả và trả thưởng như mô tả trong whitepaper này.

### Phase 2 — Token Squeek Royale

- Ra mắt **token riêng của Squeek Royale**, **thay thế ETH** trong game: phí vào trận, quỹ thưởng và các khoản thanh toán khác đều tính bằng token.
- Bổ sung **các cơ chế mới** xoay quanh token. Chi tiết được công bố trước khi Phase 2 bắt đầu.
- Hamster NFT giữ nguyên: DNA, trang bị và chỉ số không thay đổi khi chuyển sang Phase 2.

## 11. Mạng và contract

Squeek Royale đang chạy trên **Ethereum Sepolia testnet**.

| Contract | Địa chỉ |
|---|---|
| Squeek Hamster (NFT) | `0xe4F5EfF02521a2795929Bb95e5cC7a0AEeE1A9f4` |
| Squeek Arena (đấu trường) | `0x6caDE76e89930Dc64818697f8D3788ecA46551Eb` |

- Kết nối bằng MetaMask trên mạng Sepolia.
- Hình thẻ NFT có thể được nâng cấp sau này. Tên, DNA, trang bị và chỉ số thì không bao giờ thay đổi.
- Bộ sưu tập hỗ trợ phí bản quyền khi bán lại (tối đa 10%).
