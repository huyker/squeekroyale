#!/usr/bin/env python3
"""
Builds:
1. /tmp/bare_zombie_base_grids.npz:
   - Sculpted bare-headed, bare-chested CHAR_ZOMBIE_BASE geometry (`bare_body_xyz`)
   - Separate OUTFIT_Archer_HoodCloak geometry (`outfit_archer_xyz`)
2. ./dist/assets/textures/CHAR_ZOMBIE_BASE_atlas.png (4096x4096 24-bit Opaque RGB):
   - Razor-sharp, 100% unblurred stylized Zombie Face with bold dark outline, brow ridges, cheekbones, jaw, and necrotic details!
   - Clean, unblurred Undead Skin (#687D63) across the skull, scalp, neck, torso, and arms
   - Crisp exposed Ancient Bone ribcage (#D8D0C0) on chest & spine on back
   - Minimalist dark ash/leather waistcloth (#2C221E / #3A3F45) below the belt
3. Also generates 3 additional Modular Outfit Atlases (4096x4096 24-bit Opaque RGB):
   - ./dist/assets/textures/OUTFIT_Infantry_MailTunic_atlas.png (Rusted Iron Chainmail + Crimson Tunic)
   - ./dist/assets/textures/OUTFIT_Alpha_BoneLord_atlas.png (Bone Rib Armor + Plague Runes + Crimson War Kilt)
   - ./dist/assets/textures/OUTFIT_Necro_CultRobe_atlas.png (Dark Charred Cultist Robe + Glowing Plague Trim & Runes)
"""
import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TEX_DIR = "/home/huyker/Downloads/studio/gamerea/dist/assets/textures"
ARCHER_ATLAS = os.path.join(TEX_DIR, "UNIT_ZOMBIE_ARCHER_atlas.png")
BASE_ATLAS   = os.path.join(TEX_DIR, "CHAR_ZOMBIE_BASE_atlas.png")

def build_bare_base_grids_and_atlases():
    grids = dict(np.load("/tmp/archer_tpose_grids.npz"))
    body_xyz = grids["body_xyz"].copy()   # shape (65, 56, 3)
    outfit_xyz = grids["body_xyz"].copy() # original Archer Hood + Cloak + Tunic

    Nu, Nv, _ = body_xyz.shape
    n_seg = Nu - 1 # 64

    # 1. Sculpt bare_body_xyz:
    for iv in range(Nv):
        for iu in range(Nu):
            x, y, z = body_xyz[iu, iv]
            if z > 1.00:
                z = 1.00 + (z - 1.00) * 0.45
            if z > 0.70:
                ang = (2.0 * math.pi * (iu % n_seg)) / float(n_seg)
                front_cos = max(0.0, -math.sin(ang))
                z_face_w = math.exp(-((z - 0.93) / 0.085) ** 2)
                face_preserve = (front_cos ** 2.2) * z_face_w
                neck_w = math.exp(-((z - 0.79) / 0.065) ** 2)
                cowl_w = np.clip((z - 0.80) / 0.20, 0.0, 1.0) * (1.0 - 0.85 * face_preserve)
                shrink_x = 1.0 - 0.24 * neck_w - 0.18 * cowl_w
                shrink_y = 1.0 - 0.24 * neck_w - (0.24 * cowl_w if y > 0 else 0.08 * cowl_w)
                x *= shrink_x
                y *= shrink_y
            body_xyz[iu, iv] = (x, y, z)

    # Also create a sleeveless tunic/armor shell grid (`outfit_tunic_xyz`, +4mm offset, only up to neck z <= 0.80m)
    tunic_xyz = body_xyz.copy()
    for iv in range(Nv):
        cx = float(np.mean(outfit_xyz[:-1, iv, 0]))
        cy = float(np.mean(outfit_xyz[:-1, iv, 1]))
        for iu in range(Nu):
            dx = outfit_xyz[iu, iv, 0] - cx
            dy = outfit_xyz[iu, iv, 1] - cy
            dist = max(1e-5, math.hypot(dx, dy))
            outfit_xyz[iu, iv, 0] += (dx / dist) * 0.004
            outfit_xyz[iu, iv, 1] += (dy / dist) * 0.004

            dx2 = tunic_xyz[iu, iv, 0] - cx
            dy2 = tunic_xyz[iu, iv, 1] - cy
            dist2 = max(1e-5, math.hypot(dx2, dy2))
            tunic_xyz[iu, iv, 0] += (dx2 / dist2) * 0.004
            tunic_xyz[iu, iv, 1] += (dy2 / dist2) * 0.004

    grids["bare_body_xyz"] = body_xyz
    grids["outfit_archer_xyz"] = outfit_xyz
    grids["outfit_tunic_xyz"] = tunic_xyz
    np.savez("/tmp/bare_zombie_base_grids.npz", **grids)
    print("Saved /tmp/bare_zombie_base_grids.npz")

    # 2. Build CHAR_ZOMBIE_BASE_atlas.png (4096x4096 24-bit Opaque RGB — ZERO BLUR, RAZOR-SHARP FACE!)
    im = Image.open(ARCHER_ATLAS).convert("RGB")
    arr = np.array(im, dtype=np.float32)
    H, W, _ = arr.shape
    yy, xx = np.mgrid[0:H, 0:W]

    # Exact color tone of the original Zombie face center (around px=1669, py=980): RGB ≈ (138, 152, 134)
    # and darker undead skin shading on sides/back: RGB ≈ (108, 126, 102)
    ang_u = ((xx - 40.0) / 2172.0) * (2.0 * math.pi)
    front_glow = np.maximum(0.0, -np.sin(ang_u)) # 1.0 at Front (px=1669), 0 on sides/back
    # Fine hand-painted style cellular texture (high-frequency + medium-frequency, NO blurry diagonal stripes!)
    tex_grain = (
        np.sin(xx * 0.055) * np.cos(yy * 0.055) * 3.0 +
        np.sin((xx + yy) * 0.12) * 1.8
    )
    skin_r = np.clip(110.0 + 26.0 * (front_glow ** 1.4) + tex_grain, 76, 152)
    skin_g = np.clip(128.0 + 24.0 * (front_glow ** 1.4) + tex_grain * 1.1, 92, 168)
    skin_b = np.clip(104.0 + 28.0 * (front_glow ** 1.4) + tex_grain * 0.9, 72, 146)

    # Identify genuine Zombie Face pixels inside the interior face diamond (free of any red hood rim):
    r_orig, g_orig, b_orig = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    # The genuine face interior in UNIT_ZOMBIE_ARCHER_atlas is a diamond/hexagon centered at (1668, 1110):
    # - Top forehead peak at (1668, 635), widening to temples at (1425..1915, y=880..1240), tapering to chin at (1540..1800, y=1545)
    dx_f = np.abs(xx - 1668.0)
    max_half_w = np.where(
        yy < 880,
        65.0 + (yy - 635.0) * (185.0 / 245.0),
        np.where(
            yy <= 1250,
            250.0 - 0.04 * np.abs(yy - 1040.0),
            250.0 - (yy - 1250.0) * (120.0 / 300.0)
        )
    )
    in_face_region = (yy >= 635) & (yy <= 1550) & (dx_f <= max_half_w)
    # Exclude ONLY genuine red hood cloth (r > g + 14 and r > b + 14 and g < 130 so warm bone eyeballs are 100% untouched!)
    is_red_cloth_only = (r_orig > g_orig + 14.0) & (r_orig > b_orig + 14.0) & (g_orig < 130.0)
    keep_face_mask = in_face_region & (~is_red_cloth_only)

    # Softly blend the 22px transition border around the face diamond so there is zero harsh seam between the original face skin and the surrounding bare skull skin!
    border_dist = max_half_w - dx_f
    top_dist = yy - 635.0
    bot_dist = 1550.0 - yy
    edge_dist = np.minimum(border_dist, np.minimum(top_dist, bot_dist))
    face_blend_w = np.where(keep_face_mask, np.clip(edge_dist / 24.0, 0.0, 1.0), 0.0)

    in_upper_body = (xx <= 2230) & (yy < 2850)
    for c_idx, clean_ch in enumerate((skin_r, skin_g, skin_b)):
        orig_ch = arr[:, :, c_idx]
        arr[:, :, c_idx] = np.where(in_upper_body, orig_ch * face_blend_w + clean_ch * (1.0 - face_blend_w), orig_ch)

    # Clean any red sleeve pixels on armL / armR (xx > 2230, yy < 2050)
    arm_red = (xx > 2230) & (yy < 2050) & (r_orig > g_orig + 6.0)
    arr[:, :, 0] = np.where(arm_red, skin_r, arr[:, :, 0])
    arr[:, :, 1] = np.where(arm_red, skin_g, arr[:, :, 1])
    arr[:, :, 2] = np.where(arm_red, skin_b, arr[:, :, 2])

    # Below waist (xx <= 2230, yy >= 2850): Minimalist dark ash/leather loincloth (#2C221E / #3A3F45)
    lower_red = (xx <= 2230) & (yy >= 2850) & (r_orig > g_orig + 10.0)
    lum = np.clip((0.35 * r_orig + 0.45 * g_orig + 0.20 * b_orig) / 88.0, 0.50, 1.25)
    arr[:, :, 0] = np.where(lower_red, np.clip(56.0 * lum, 28, 86), arr[:, :, 0])
    arr[:, :, 1] = np.where(lower_red, np.clip(52.0 * lum, 26, 80), arr[:, :, 1])
    arr[:, :, 2] = np.where(lower_red, np.clip(50.0 * lum, 24, 76), arr[:, :, 2])

    out_im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(out_im)

    # 3. Hand-paint crisp, bold stylized facial & anatomical lines so the bare face has 100% sharp contours (zero missing cheek lines!):
    dark_ink   = (34, 38, 34)
    mid_shadow = (74, 88, 70)
    hi_skin    = (164, 178, 156)
    bone_col   = (216, 208, 192)

    # A) Subtle anatomical brow wrinkles (matching the original hand-painted style; face diamond blends seamlessly into skull skin)
    draw.line([(1520, 725), (1668, 708), (1815, 725)], fill=mid_shadow, width=10)
    draw.line([(1555, 668), (1668, 654), (1780, 668)], fill=mid_shadow, width=8)

    # B) Cranial sutures & undead scalp scars on top/back of skull
    draw.line([(1669, 200), (1650, 410), (1669, 610)], fill=dark_ink, width=9)
    draw.line([(1340, 430), (1650, 410), (1970, 440)], fill=dark_ink, width=8)
    draw.line([(583,  220), (595,  520), (583,  920)], fill=dark_ink, width=9)
    for cx, cy, cr in ((1150, 580, 42), (850, 780, 48), (583, 640, 52), (320, 760, 44)):
        draw.ellipse([cx - cr, cy - int(cr*0.7), cx + cr, cy + int(cr*0.7)], fill=mid_shadow, outline=dark_ink, width=5)

    # C) Exposed Ancient Bone Ribcage (#D8D0C0) on the Front Chest (centered at px = 1669, py = 1750..2480)
    draw.line([(1669, 1720), (1669, 2380)], fill=dark_ink, width=36)
    draw.line([(1669, 1730), (1669, 2370)], fill=bone_col, width=20)
    for ry in (1780, 1940, 2100, 2260):
        for side in (-1, 1):
            pts = [
                (1669 + side * 28,  ry),
                (1669 + side * 140, ry - 22),
                (1669 + side * 265, ry + 18),
                (1669 + side * 355, ry + 68),
            ]
            draw.line(pts, fill=dark_ink, width=32)
            draw.line(pts, fill=bone_col, width=18)

    # D) Exposed Spine Vertebrae (#D8D0C0) on the Back (centered at px = 583, py = 1680..2650)
    for vy in range(1700, 2650, 95):
        draw.ellipse([583 - 28, vy - 22, 583 + 28, vy + 22], fill=dark_ink)
        draw.ellipse([583 - 19, vy - 14, 583 + 19, vy + 14], fill=bone_col)

    # Sharpen the entire Bare Base Atlas (NO Gaussian blur!)
    out_im = out_im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=135, threshold=2))
    out_im.save(BASE_ATLAS, format="PNG", optimize=False)
    print("Saved razor-sharp 4096x4096 Bare Base Atlas:", BASE_ATLAS)

    # ==============================================================================
    # 4. GENERATE 3 NEW MODULAR OUTFIT ATLASES (4096x4096 24-bit Opaque RGB)
    # ==============================================================================
    base_arr = np.array(out_im, dtype=np.float32)

    # OUTFIT 2: OUTFIT_Infantry_MailTunic_atlas.png
    # Bare head + Rusted Iron Chainmail hauberk on shoulders/upper chest & sleeves + tattered Crimson Surcoat + Leather belt
    inf_im = out_im.copy()
    inf_draw = ImageDraw.Draw(inf_im)
    # Paint chainmail torso (py = 1580..2850, px = 40..2212) and chainmail short sleeves on armL/armR
    inf_arr = np.array(inf_im, dtype=np.float32)
    # Chainmail ring pattern
    ring_pat = (np.sin(xx * 0.28) * np.cos(yy * 0.28) * 14.0) + (np.cos(xx * 0.55 + yy * 0.55) * 8.0)
    mail_r = np.clip(62.0 + ring_pat, 36, 96)
    mail_g = np.clip(68.0 + ring_pat, 40, 104)
    mail_b = np.clip(74.0 + ring_pat, 44, 112)

    # Upper chest/back chainmail (py = 1580..2220)
    in_mail = (xx <= 2212) & (yy >= 1580) & (yy < 2280)
    inf_arr[:, :, 0] = np.where(in_mail, mail_r, inf_arr[:, :, 0])
    inf_arr[:, :, 1] = np.where(in_mail, mail_g, inf_arr[:, :, 1])
    inf_arr[:, :, 2] = np.where(in_mail, mail_b, inf_arr[:, :, 2])

    # Tattered Crimson Infantry Surcoat / Tunic (py = 2120..3650) over chainmail skirt
    in_surcoat = (xx <= 2212) & (yy >= 2120) & (yy < 2840)
    cloth_wave = np.sin(xx * 0.04) * 8.0
    inf_arr[:, :, 0] = np.where(in_surcoat, np.clip(136.0 + cloth_wave, 88, 162), inf_arr[:, :, 0])
    inf_arr[:, :, 1] = np.where(in_surcoat, np.clip(44.0  + cloth_wave * 0.3, 24, 62), inf_arr[:, :, 1])
    inf_arr[:, :, 2] = np.where(in_surcoat, np.clip(44.0  + cloth_wave * 0.3, 24, 62), inf_arr[:, :, 2])

    inf_im = Image.fromarray(inf_arr.astype(np.uint8), mode="RGB")
    inf_draw = ImageDraw.Draw(inf_im)
    # Iron collar & shoulder straps + chest emblem
    inf_draw.line([(40, 1585), (2212, 1585)], fill=dark_ink, width=24)
    inf_draw.line([(40, 2120), (2212, 2120)], fill=dark_ink, width=20)
    # Vertical leather straps & iron buckle on chest (px=1669)
    for sx in (1480, 1858):
        inf_draw.line([(sx, 1585), (sx, 2850)], fill=(44, 34, 30), width=42)
        inf_draw.line([(sx, 1585), (sx, 2850)], fill=(92, 72, 56), width=22)
    inf_im.save(os.path.join(TEX_DIR, "OUTFIT_Infantry_MailTunic_atlas.png"), format="PNG")

    # OUTFIT 3: OUTFIT_Alpha_BoneLord_atlas.png
    # Bare head with glowing Plague eyes (#32E6B2) + Heavy Ancient Bone Chest Harness + Crimson War Kilt with gold/plague trim
    alp_arr = base_arr.copy()
    # Make eyes glow Necro Plague Green (#32E6B2 = 50, 230, 178) inside eye sockets (px=1420..1910, py=840..1120)
    in_eyes = (xx >= 1420) & (xx <= 1910) & (yy >= 840) & (yy <= 1120) & (r_orig > 165) & (g_orig > 165)
    alp_arr[:, :, 0] = np.where(in_eyes, 50.0,  alp_arr[:, :, 0])
    alp_arr[:, :, 1] = np.where(in_eyes, 230.0, alp_arr[:, :, 1])
    alp_arr[:, :, 2] = np.where(in_eyes, 178.0, alp_arr[:, :, 2])
    # Crimson war-kilt below belt (yy >= 2950, xx <= 2212)
    in_kilt = (xx <= 2212) & (yy >= 2950) & (alp_arr[:, :, 0] < 95.0)
    alp_arr[:, :, 0] = np.where(in_kilt, np.clip(alp_arr[:, :, 0] * 2.1, 70, 148), alp_arr[:, :, 0])
    alp_arr[:, :, 1] = np.where(in_kilt, np.clip(alp_arr[:, :, 1] * 0.75, 22, 54), alp_arr[:, :, 1])
    alp_arr[:, :, 2] = np.where(in_kilt, np.clip(alp_arr[:, :, 2] * 0.75, 22, 54), alp_arr[:, :, 2])

    alp_im = Image.fromarray(np.clip(alp_arr, 0, 255).astype(np.uint8), mode="RGB")
    alp_draw = ImageDraw.Draw(alp_im)
    # Crossed Bone Bandoliers & Plague Rune Chest Seal
    alp_draw.line([(1320, 1600), (2010, 2780)], fill=dark_ink, width=54)
    alp_draw.line([(1320, 1600), (2010, 2780)], fill=bone_col, width=32)
    alp_draw.line([(2010, 1600), (1320, 2780)], fill=dark_ink, width=54)
    alp_draw.line([(2010, 1600), (1320, 2780)], fill=bone_col, width=32)
    # Glowing Plague Rune Medallion in center of chest (1669, 2080)
    alp_draw.ellipse([1669 - 95, 2080 - 95, 1669 + 95, 2080 + 95], fill=(44, 34, 30), outline=bone_col, width=14)
    alp_draw.ellipse([1669 - 55, 2080 - 55, 1669 + 55, 2080 + 55], fill=(50, 230, 178))
    alp_im.save(os.path.join(TEX_DIR, "OUTFIT_Alpha_BoneLord_atlas.png"), format="PNG")

    # OUTFIT 4: OUTFIT_Necro_CultRobe_atlas.png
    # Dark Charred Necromancer Cultist Robe (#2C221E / #3A3F45) with Plague Green (#32E6B2) & Tarnished Gold (#E6B84D) runes
    orig_full = np.array(Image.open(ARCHER_ATLAS).convert("RGB"), dtype=np.float32)
    r_f, g_f, b_f = orig_full[:, :, 0], orig_full[:, :, 1], orig_full[:, :, 2]
    cult_arr = orig_full.copy()
    # Convert all red hood/cloak/robe cloth (is_red_all) to Dark Charred Obsidian/Iron (#2C221E / #3A3F45)
    is_red_all = (r_f > g_f + 10.0) & (r_f > b_f + 10.0)
    c_lum = np.clip((0.35 * r_f + 0.45 * g_f + 0.20 * b_f) / 88.0, 0.45, 1.30)
    cult_arr[:, :, 0] = np.where(is_red_all, np.clip(44.0 * c_lum, 20, 72), cult_arr[:, :, 0])
    cult_arr[:, :, 1] = np.where(is_red_all, np.clip(48.0 * c_lum, 22, 78), cult_arr[:, :, 1])
    cult_arr[:, :, 2] = np.where(is_red_all, np.clip(58.0 * c_lum, 28, 92), cult_arr[:, :, 2])
    # Glowing Plague eyes
    in_eyes_orig = (xx >= 1420) & (xx <= 1910) & (yy >= 840) & (yy <= 1120) & (r_f > 165) & (g_f > 165)
    cult_arr[:, :, 0] = np.where(in_eyes_orig, 50.0,  cult_arr[:, :, 0])
    cult_arr[:, :, 1] = np.where(in_eyes_orig, 230.0, cult_arr[:, :, 1])
    cult_arr[:, :, 2] = np.where(in_eyes_orig, 178.0, cult_arr[:, :, 2])

    cult_im = Image.fromarray(np.clip(cult_arr, 0, 255).astype(np.uint8), mode="RGB")
    cult_draw = ImageDraw.Draw(cult_im)
    # Paint glowing Plague Green (#32E6B2) & Gold (#E6B84D) necromantic trim along robe & chest
    for rx in (1480, 1858):
        cult_draw.line([(rx, 1620), (rx, 3750)], fill=(230, 184, 77), width=18)
        cult_draw.line([(rx, 1620), (rx, 3750)], fill=(50, 230, 178), width=8)
    for ry in (1950, 2250, 2550, 3150, 3450):
        cult_draw.ellipse([1669 - 45, ry - 45, 1669 + 45, ry + 45], outline=(50, 230, 178), width=10)
    cult_im.save(os.path.join(TEX_DIR, "OUTFIT_Necro_CultRobe_atlas.png"), format="PNG")
    print("Saved 3 additional 4K Modular Outfit Atlases!")

if __name__ == "__main__":
    build_bare_base_grids_and_atlases()
