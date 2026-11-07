---
name: modular-3d-asset-pipeline
description: >-
  Quy trình chuẩn sản xuất Asset 3D Modular sắc nét 4K cho NECROBURG qua Blender MCP.
  Sử dụng skill này bất cứ khi nào tạo mới, chỉnh sửa, sơn texture, rig xương hoặc
  kiểm định chất lượng nhân vật (UNIT_*), vũ khí/phụ kiện rời (WP_*, EQ_*), khung gầm
  (CHAS_*) và mô-đun công trình (MOD_*), đảm bảo kiến trúc Modular tách khối 100%,
  nhân vật Base T-Pose chuẩn, texture 4K Opaque RGB không bị trong suốt ở góc Right Side
  và không có điểm chia cắt Front/Back.
---

# Quy Trình Sản Xuất Asset 3D Modular Sắc Nét (NECROBURG Standard)

Skill này định nghĩa quy trình kỹ thuật bắt buộc đã được nghiệm thu thực tế trên `UNIT_ZOMBIE_ARCHER` để tạo ra mô hình 3D sắc nét như concept 2D, **không bị mờ nhòe**, **không bị thủng trong suốt ở góc nghiêng (`Right Side`)**, **không có đường chia cắt `Front`/`Back`**, và **tuân thủ tuyệt đối kiến trúc Modular** (tránh dựng một khối lớn duy nhất gây lỗi chiếu texture và lỗi biến dạng khi hoạt ảnh).

---

## 1. Nguyên Tắc Cốt Lõi: 1 Nhân Vật Base Dùng Chung (`CHAR_ZOMBIE_BASE`) + Trang Phục & Vũ Khí Modular

> **QUY TẮC BẤT DI BẤT DỊCH:**
> 1. **Chỉ dùng 1 Nhân vật Base duy nhất (`CHAR_ZOMBIE_BASE`) cho mọi chủng loại Zombie!** Tuyệt đối **KHÔNG** dựng lại cơ thể Zombie từ đầu cho từng đơn vị (`Infantry`, `Archer`, `Alpha`, `Cavalry Rider`). Các đơn vị Zombie khác nhau chỉ là cùng một `CHAR_ZOMBIE_BASE` được thay đổi **Trang phục / Mũ giáp (`OUTFIT_*`, `EQ_*`)** và gắn **Vũ khí cầm tay / Phụ kiện đeo lưng (`WP_*`, `EQ_*`)** vào các nút Socket xương.
> 2. Tuyệt đối **KHÔNG** vẽ hoặc dựng một nhân vật/công trình kèm toàn bộ vũ khí, khiên, cung tên, phụ kiện thành **một khối mesh liền (monolithic mesh)** rồi cố gắng chiếu texture hay gán xương.

### 1.1. Kiến trúc Nhân vật Base dùng chung (`CHAR_ZOMBIE_BASE`) & Lắp ghép Trang phục / Vũ khí
1. **Nhân vật Base dùng chung (`CHAR_ZOMBIE_BASE` — Đã hoàn thiện & nghiệm thu):**
   - **Tư thế gốc:** Dáng **T-Pose ngang chuẩn** (`Frame 0`: hai cánh tay giơ ngang `90°` song song mặt đất, hai chân đứng thẳng tách nhẹ tạo khe hở rõ ràng giữa hai đùi/cẳng chân).
   - **5 Sub-Mesh Modular kín (Watertight Sub-Meshes):**
     - `Body`: Đầu + Thân cơ bản (có thể bật/tắt hoặc thay thế lớp trang phục `OUTFIT_*` bên ngoài).
     - `Arm.L`: Cánh tay trái tách rời từ hốc vai (`X = +0.125m .. +0.52m`), đầu vai thuôn nhẹ cắm ngập vào ống tay áo.
     - `Arm.R`: Cánh tay phải tách rời từ hốc vai (`X = -0.125m .. -0.52m`).
     - `Leg.L`: Chân trái tách rời từ dưới gấu váy (`Z = 0.00m .. 0.25m`).
     - `Leg.R`: Chân phải tách rời từ dưới gấu váy (`Z = 0.00m .. 0.25m`).
   - **Khung xương 14-bone `Armature` + Hoạt ảnh dùng chung:** `Root`, `Hips`, `Spine`, `Head`, `Shoulder.L/R`, `Arm.L/R`, `Forearm.L/R`, `Thigh.L/R`, `Shin.L/R` kèm hoạt ảnh `T-Pose`, `Walk Cycle`, `Idle`, `Attack_Melee`, `Shoot_Bow`, `Ride_Pose`.
2. **Cách tạo tất cả các chủng loại Zombie từ `CHAR_ZOMBIE_BASE` (Chỉ làm Trang phục `OUTFIT_*` & Vũ khí `WP_*`, `EQ_*`):**
   - Mỗi bộ trang phục (`OUTFIT_Archer_CloakHood`, `OUTFIT_Infantry_Tunic`, `OUTFIT_Alpha_Waistcloth`) và mỗi vũ khí/phụ kiện (`EQ_KettleHelm`, `EQ_SpikedPauldron`, `EQ_BoneQuiver`, `EQ_RoundShield`, `WP_CurvedBow`, `WP_Spear`, `WP_Broadsword`, `WP_BoneCleaver`, `WP_HeavyLance`) phải được dựng thành **Mesh Modular riêng biệt** có đảo UV riêng.
   - Gắn vào `CHAR_ZOMBIE_BASE` thông qua các nút Socket con của xương (`Head_Socket`, `Body_Outfit_Socket`, `Shoulder_Socket.L/R`, `Back_Socket`, `Hand_Socket.L`, `Hand_Socket.R`).
   - Nhờ đó, toàn bộ đội quân Zombie giữ được tỷ lệ hình thể, màu da `#687D63`, chuyển động mượt mà đồng nhất 100% và không bao giờ phát sinh lỗi mesh hay lỗi đường nối trên cơ thể.

### 1.2. Đối với Khung gầm & Mô-đun Công trình (`CHAS_*`, `MOD_*`)
- Phải phân rã thành bộ **Kit Modular** (theo triết lý tái sử dụng `28:1` của Wanderburg), mỗi bộ phận là một Object độc lập có tâm xoay (Origin/Pivot) riêng:
  - `Base_Static`: Đế vuông chuẩn lưới (`2.0m × 2.0m` hoặc `4.0m × 4.0m`), cố định trên sàn xe.
  - `Yaw_Pivot`: Nút xoay `360°` chứa thân tháp pháo phía trên.
  - `Pitch_Pivot` / `Actuator_*`: Bộ phận chuyển động độc lập (cần máy bắn đá, cánh nỏ xương, tay xương đánh trống, lò xo mũi đục).
  - `Wheel_*`: Từng bánh xe tách rời có Origin tại tâm trục quay.
  - `SiegeShield_*`: Tấm chắn gầm xe đóng/mở khi chuyển trạng thái `March Mode` ↔ `Siege Mode`.
  - `Prop_*`: Chậu lửa dịch hạch (`#32E6B2`), cờ rách (`#8C2D2D`), lồng xương (`#D8D0C0`), giá để giáo.
- Xem bảng phân rã chi tiết từng Asset tại: [modular-decomposition-table.md](./references/modular-decomposition-table.md).

---

## 2. Quy Chuẩn Chống Lỗi Trong Suốt Ở Góc `Right Side` (100% Opaque RGB)

### Nguyên nhân gây lỗi trong suốt (`bị trong suốt`) trước đây
Khi nới rộng biên lưới 3D (`+8mm margin`) rồi dùng kênh Alpha của ảnh turnaround kết hợp `mat.blend_method = 'CLIP'` (Blender) hoặc `alphaTest = 0.45` (Three.js), các mặt đa giác ở rìa trên/dưới cánh tay T-Pose và hai bên hông váy có pháp tuyến vuông góc với góc nhìn `Right Side` sẽ rơi vào vùng `alpha = 0` và bị cắt thủng thành các lỗ trong suốt.

### Giải pháp bắt buộc
1. **Lưới Hình học Bám khít 100% (`Tight Geometric Contours`):**
   - Mỗi lát cắt theo chiều cao `Z` của `Body`, `Arm.L`, `Arm.R`, `Leg.L`, `Leg.R` phải đặt đúng theo đường bao thực tế `(fx0, fx1, yf, yb)` đo từ mask của ảnh turnaround, **không cộng biên rỗng**.
   - Chi tiết gấu áo/váy rách phải được chuyển thành **độ cao hình học thật `z_hem(theta)`** trên các vòng đỉnh đáy của `Body`.
2. **Texture Atlas 24-bit RGB (`100% Opaque`) + Giãn biên vô hạn (`EDT Dilation`):**
   - Sau khi vẽ các đảo UV lên Atlas `4096×4096`, dùng `scipy.ndimage.distance_transform_edt` để lấp đầy toàn bộ các pixel nền ngoài đảo UV bằng màu của pixel biên gần nhất.
   - Lưu file kết quả ở định dạng **RGB 24-bit (không có kênh Alpha)**.
3. **Cấu hình Material chuẩn trong Blender & Three.js:**
   - Trong Blender MCP:
     ```python
     mat.blend_method = 'OPAQUE'
     mat.use_backface_culling = False
     bsdf.inputs['Roughness'].default_value = 1.0
     bsdf.inputs['Metallic'].default_value = 0.0
     ```
   - Trong Three.js (`dist/index.html`):
     ```javascript
     m.side = THREE.DoubleSide;
     m.transparent = false;
     m.alphaTest = 0.0;
     m.depthWrite = true;
     ```

---

## 3. Quy Chuẩn Xóa Bỏ Điểm Chia Cắt `Front` và `Back` (Seamless Tri-Planar)

### Nguyên nhân gây đường chia cắt dọc bên hông (`điểm chia cắt front và back`)
1. Ảnh concept 2D có **viền mực đen silhouette (`6–9px`)** bao quanh mép ngoài nhân vật ở cột `Front` và `Back`. Nếu chiếu trực tiếp ảnh gốc lên lưới 3D, viền đen ngoài cùng của `Front` và `Back` sẽ rơi đúng vào hai bên hông (`NY ≈ 0`), tạo thành vệt đen dọc chia đôi mũ trùm, đầu, sườn và mặt trong hai chân.
2. Nếu chỉ chiếu `Front + Back` theo tọa độ `(X, Z)` lên khối trụ mà bỏ qua cột `Right Side` `(Y, Z)`, tại vùng hông (`|NX| -> 1`), đạo hàm `dX/dtheta -> 0` khiến pixel bị kéo giãn ngang bệt màu.
3. Trên cột `Right Side` của ảnh T-Pose 2D, cánh tay phải hướng thẳng vào camera nằm đè lên vùng mạn sườn dưới nách (`Y = 312..389px`), kèm theo mảng bóng tối hình tam giác dưới hốc nách.

### Quy trình 4 bước xử lý Seamless bắt buộc (trong [bake_seamless_multiview_atlas.py](./scripts/bake_seamless_multiview_atlas.py))
1. **Khắc khe hở giữa hai chân (`Inter-Leg Gap Carving`):**
   - Trước khi chạy `binary_fill_holes` trên mask nhân vật, bắt buộc xóa vùng khe hở giữa 2 chân (`fg1[585:, 270:319] = False` ở cột `Front` và `fg1[585:, 1108:1160] = False` ở cột `Back`) để hai chân tách rời hoàn toàn, không bao giờ in vệt đen/xám dọc mặt trong đùi và cẳng chân.
2. **Bóc lớp viền đen Silhouette 2D ngoài cùng (`Outer Silhouette Rim Stripping`):**
   - Tạo bản ảnh `arr1_seamless` chuyên dụng cho Atlas 3D bằng cách tính khoảng cách vào tâm `dist_in = distance_transform_edt(mask_all)` và thay thế toàn bộ vành biên ngoài (`dist_in <= 5.5px`, hoặc `dist_in <= 9.0px` có độ sáng `lum < 75`) bằng màu thịt/vải bên trong (`interior_core`).
3. **Làm sạch vùng cánh tay đè lên mạn sườn ở cột `Right Side` (`Side Arm-Overlap Inpainting`):**
   - Trên cột `Right Side` (`X = 662..780px`, giữ nguyên mép vải đỏ sau lưng ở `X < 668px`):
     - Vùng khăn choàng vai (`Y = 312..338px`): đối xứng gương từ các dòng vải đỏ phía trên (`Y = 284..311px`) để mép khăn choàng khớp đúng độ cao `Z = 0.736m` của `Front` và `Back`.
     - Vùng chuyển tiếp (`Y = 339..343px`): pha mượt 5 dòng giữa vải đỏ và da sườn xanh.
     - Vùng mạn sườn & bóng tối dưới nách (`Y = 344..389px`): lấy mẫu từ các dòng da sườn xanh sạch bên dưới (`Y = 394..409px`), xóa sạch 100% hình cắt cánh tay và tam giác tối dưới nách.
4. **Hòa trộn Tri-Planar Cosine (`Front` ↔ `Side` ↔ `Back`):**
   - Phóng to ảnh nguồn lên **2× (`2752×1536`)** bằng `LANCZOS` + `UnsharpMask(radius=1.1, percent=145, threshold=2)` để giữ trọn độ sắc nét 4K.
   - Trên `Body`, kết hợp cả 3 phép chiếu `col_f(X, Z)`, `col_s(Y, Z)`, `col_b(X, Z)` bằng hàm trọng số mượt `0.5 - 0.5 * cos(pi * t)`.
   - Tại vùng mạn sườn bên phải (`NX < 0`, `Z = 0.45m .. 0.74m`), mở rộng vùng ưu tiên `col_s` lên `|NY| <= 0.66` để toàn bộ mảng sườn xanh lấy từ một nguồn duy nhất, chỉ chuyển giao sang `col_f` / `col_b` trong vùng `|NY| ∈ [0.66 .. 0.92]` (nơi cả 3 hình chiếu đều đã nằm trong vùng vải đỏ).

---

## 4. Quy Trình Thực Thi Từng Bước Tự Động (`Autonomous Concept-First 3D Flow — No Approval Pause`)

> **QUY TẮC BẮT BUỘC (LUỒNG TỰ ĐỘNG TỪ CONCEPT ĐẾN 3D & WEB — KHÔNG DỪNG CHỜ DUYỆT):**
> 1. **Bước 0 — Sinh Ảnh Concept / Turnaround (`Front | Right Side | Back`) Bằng Prompt (`dist/assets/reference/`):**
>    - Mọi Asset 3D (HeroBase Zombie, Base Người Dân, Trang Phục, Vũ Khí, 10 Động Vật, Công Trình/Props) **bắt buộc phải được sinh từ Ảnh Concept / Turnaround 3 góc trước** để đảm bảo đúng phong cách `Wanderburg × Necroburg` (viền mực đen Comic đậm, mảng màu Hand-Painted Matte sắc nét).
>    - **Chạy tự động 100% không dừng chờ User duyệt:** Sau khi sinh Ảnh Concept lưu vào `dist/assets/reference/`, Agent lập tức chuyển sang Bước 1..4 (Chiếu Texture Tri-Planar từ Concept -> Dựng 3D GLB -> Gán Rig & Full Animation [Di chuyển, Nghỉ, Tấn công, Ngủ...] & VFX -> Render 3 góc kiểm định & Đưa lên Web `dist/index.html`) mà **không dừng lại hỏi duyệt giữa chừng**. Khi nào cần duyệt thủ công, User sẽ yêu cầu cập nhật rule sau.

Khi dựng một nhân vật hoặc asset mới, chạy tuần tự các script chuẩn trong thư mục `scripts/` của skill này:

1. **Bước 1 — Bóc tách đường bao T-Pose & Nướng Atlas 4K Opaque Seamless:**
   - Chạy [bake_seamless_multiview_atlas.py](./scripts/bake_seamless_multiview_atlas.py):
     ```bash
     python3 .agents/skills/modular-3d-asset-pipeline/scripts/bake_seamless_multiview_atlas.py
     ```
   - Đầu ra:
     - `/tmp/archer_tpose_grids.npz`: Tọa độ lưới 3D kín của 5 sub-mesh (`Body`, `Arm.L`, `Arm.R`, `Leg.L`, `Leg.R`).
     - `./dist/assets/textures/<ASSET_ID>_atlas.png`: Texture Atlas `4096×4096` RGB Opaque không đường nối.
2. **Bước 2 — Dựng Mesh Modular, Gán Rig 14 Xương & Tạo Hoạt ảnh trong Blender MCP:**
   - Thực thi [build_modular_character_blender.py](./scripts/build_modular_character_blender.py) qua công cụ `mcp_blender_execute_blender_code`:
     ```python
     exec(open('/home/huyker/Downloads/studio/gamerea/.agents/skills/modular-3d-asset-pipeline/scripts/build_modular_character_blender.py').read())
     ```
   - Script tự động:
     - Tạo 5 sub-mesh gắn vào `Armature` 14 xương (`Root`, `Hips`, `Spine`, `Head`, `Shoulder.L/R`, `Arm.L/R`, `Forearm.L/R`, `Thigh.L/R`, `Shin.L/R`).
     - Tạo 110 frame hoạt ảnh: `Frame 0` (**T-Pose**), `Frames 10..58` (**Walk Cycle**), `Frames 65..110` (**Idle Breathing**).
     - Xuất `./dist/assets/models/<ASSET_ID>.glb` với `blend_method = 'OPAQUE'`.
     - Render cả 3 góc trực giao (`front.png`, `side.png`, `back.png`) **VÀ** 3 góc kiểm định 3D trực tiếp từ `.glb` (`glb_front_right_45.png`, `glb_right_side.png`, `glb_back_right_45.png`).
3. **Bước 3 — Ghép Bảng 3-View & Kiểm định bắt buộc góc nghiêng `45°` / `Right Side`:**
   - Chạy [composite_3view_sheet.py](./scripts/composite_3view_sheet.py) để xuất `./dist/assets/renders/<ASSET_ID>_3view.png`.
   - **BẮT BUỘC** dùng `read_file` xem ảnh ghép 3 góc nghiêng (`Front-Right 45°`, `Right Side Ortho`, `Back-Right 45°`) của file `.glb` thực tế trước khi báo cáo hoàn thành.

---

## 5. Checklist Nghiệm Thu Bắt Buộc Trước Khi Bàn Giao

- [ ] **Kiến trúc Modular:** Đã tách thành các sub-mesh độc lập (`Body`, `Arm.L`, `Arm.R`, `Leg.L`, `Leg.R` cho nhân vật; `Base_Static`, `Yaw_Pivot`, `Wheel_*`, `SiegeShield_*`, `Prop_*` cho xe/tháp). Không dựng 1 khối lớn.
- [ ] **Đúng giai đoạn:** Với nhân vật, hoàn thành và duyệt **Nhân vật Base dáng T-Pose** trước khi gắn vũ khí/phụ kiện rời.
- [ ] **Không bị trong suốt (`100% Opaque`):** Texture là `RGB` 24-bit không có vùng `alpha = 0`, material đặt `OPAQUE` + `DoubleSide`, nhìn từ góc `Right Side` không bị thủng rỗng ở cánh tay hay gấu váy.
- [ ] **Không có điểm chia cắt `Front`/`Back` (`Seamless Side`):** Đã bóc viền đen silhouette 2D ngoài cùng và làm sạch bóng cánh tay đè trên mạn sườn `Right Side`; kiểm tra ảnh render `.glb` ở góc `45°` và `Right Side` thấy chuyển màu mượt tự nhiên.
- [ ] **Sắc nét 4K:** Texture Atlas `4096×4096` lấy mẫu từ ảnh nâng cấp Lanczos 2× + UnsharpMask, hiển thị rõ từng mảng vá, rỉ sét, vết mục trên WebGL viewer.
- [ ] **Đầy đủ chuyển động:** Nhân vật có cả hoạt ảnh tại chỗ (`T-Pose`, `Walk Cycle`, `Idle`) và di chuyển vị trí thực tế trên sa bàn (`WASD` / `Auto Roam`).
