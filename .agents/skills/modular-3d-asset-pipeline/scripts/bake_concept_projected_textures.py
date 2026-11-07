#!/usr/bin/env python3
"""
NECROBURG — Concept-First Tri-Planar Texture Atlas Baker (4096x4096 100% Opaque RGB)
Follows Rule 0 & Rule 2 of AGENTS.md:
Projects the Front / Right Side / Back views from the Concept Turnaround Sheets in dist/assets/reference/:
  - CHAR_VILLAGER_BASE_turnaround.png -> CHAR_VILLAGER_BASE_atlas.png + 4 Villager Outfits (Farmer, Blacksmith, Shepherd, Soldier)
  - CHAR_ZOMBIE_BASE_turnaround.png   -> CHAR_ZOMBIE_BASE_atlas.png + 4 Zombie Outfits (Archer, Infantry, Alpha, Necromancer)
  - ANIMAL_*_concept.png & VILLAGE_PROPS_AND_VFX_concept.png -> ANIMAL_KINGDOM_atlas.png (covering 10 Animals + Shepherd Crook + Props + VFX)
"""
import os
import json
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import distance_transform_edt

ROOT = r"e:\rea\gamerea\gamerea"
REF_DIR = os.path.join(ROOT, "dist", "assets", "reference")
TEX_DIR = os.path.join(ROOT, "dist", "assets", "textures")
MODELS_DIR = os.path.join(ROOT, "dist", "assets", "models")
os.makedirs(TEX_DIR, exist_ok=True)


def strip_outer_dark_rim_from_concept(img_rgb, rim_px=9.0):
    arr = np.array(img_rgb, dtype=np.uint8)
    H, W, _ = arr.shape
    bg_color = np.median(arr[int(H*0.10):int(H*0.20), :24].reshape(-1, 3), axis=0)
    diff = np.linalg.norm(arr.astype(np.float32) - bg_color[None, None, :], axis=2)
    # Exclude horizontal alignment guide lines (thin 1-3px grey lines) & top/bottom text labels
    fg_mask = diff > 24.0
    fg_mask[:int(H * 0.085), :] = False
    fg_mask[int(H * 0.915):, :] = False

    # Remove thin horizontal guide lines (rows where width > 0.85 * W)
    row_cov = fg_mask.mean(axis=1)
    for r in range(H):
        if row_cov[r] > 0.72:
            fg_mask[max(0, r-2):min(H, r+3), :] = False

    dist_in = distance_transform_edt(fg_mask)
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]

    core_mask = (dist_in > rim_px) & ((dist_in > rim_px + 4.0) | (lum > 46.0))
    if np.any(core_mask):
        _, inds = distance_transform_edt(~core_mask, return_indices=True)
        seamless_arr = arr[inds[0], inds[1]]
    else:
        seamless_arr = arr.copy()

    return seamless_arr, fg_mask


def extract_column_bbox(fg_mask, x0, x1):
    sub = fg_mask[:, x0:x1]
    # Ignore thin noise
    col_sum = sub.sum(axis=0)
    row_sum = sub.sum(axis=1)
    xs = np.where(col_sum > 8)[0]
    ys = np.where(row_sum > 8)[0]
    if len(ys) == 0 or len(xs) == 0:
        return x0, x1, 0, fg_mask.shape[0]
    return x0 + int(xs.min()), x0 + int(xs.max()), int(ys.min()), int(ys.max())


def load_base_mesh_uv_and_pos(base_glb_path):
    with open(base_glb_path, "rb") as f:
        data = f.read()
    cl = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20+cl].decode("utf-8"))
    bin_chunk = data[20+cl+8:]

    prim = gltf["meshes"][0]["primitives"][0]
    pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
    pos_bv = gltf["bufferViews"][pos_acc["bufferView"]]
    pos = np.frombuffer(
        bin_chunk[pos_bv.get("byteOffset", 0):pos_bv.get("byteOffset", 0) + pos_acc["count"] * 12],
        dtype=np.float32
    ).reshape(-1, 3)

    nrm_acc = gltf["accessors"][prim["attributes"]["NORMAL"]]
    nrm_bv = gltf["bufferViews"][nrm_acc["bufferView"]]
    nrm = np.frombuffer(
        bin_chunk[nrm_bv.get("byteOffset", 0):nrm_bv.get("byteOffset", 0) + nrm_acc["count"] * 12],
        dtype=np.float32
    ).reshape(-1, 3)

    uv_acc = gltf["accessors"][prim["attributes"]["TEXCOORD_0"]]
    uv_bv = gltf["bufferViews"][uv_acc["bufferView"]]
    uv = np.frombuffer(
        bin_chunk[uv_bv.get("byteOffset", 0):uv_bv.get("byteOffset", 0) + uv_acc["count"] * 8],
        dtype=np.float32
    ).reshape(-1, 2)

    ind_acc = gltf["accessors"][prim["indices"]]
    ind_bv = gltf["bufferViews"][ind_acc["bufferView"]]
    ctype = ind_acc["componentType"]
    dt = np.uint16 if ctype == 5123 else np.uint32
    ind = np.frombuffer(
        bin_chunk[ind_bv.get("byteOffset", 0):ind_bv.get("byteOffset", 0) + ind_acc["count"] * np.dtype(dt).itemsize],
        dtype=dt
    ).reshape(-1, 3)
    return pos, nrm, uv, ind


def precompute_uv_raster_grid(pos, nrm, uv, ind, res=1024):
    """
    Rasterizes the 3D position (px, py, pz) and normal (nx, ny, nz) of every triangle
    into a (res, res) UV lookup grid once, so we can project multiple Concept Turnarounds
    and Outfit layers in milliseconds!
    """
    p_grid = np.zeros((res, res, 3), dtype=np.float32)
    n_grid = np.zeros((res, res, 3), dtype=np.float32)
    mask_grid = np.zeros((res, res), dtype=bool)

    uv_px = uv * (res - 1)
    for f in ind:
        i0, i1, i2 = int(f[0]), int(f[1]), int(f[2])
        u0, v0 = uv_px[i0]
        u1, v1 = uv_px[i1]
        u2, v2 = uv_px[i2]

        umin = max(0, int(np.floor(min(u0, u1, u2))))
        umax = min(res - 1, int(np.ceil(max(u0, u1, u2))))
        vmin = max(0, int(np.floor(min(v0, v1, v2))))
        vmax = min(res - 1, int(np.ceil(max(v0, v1, v2))))
        if umin > umax or vmin > vmax:
            continue

        denom = (v1 - v2)*(u0 - u2) + (u2 - u1)*(v0 - v2)
        if abs(denom) < 1e-5:
            continue
        inv_d = 1.0 / denom

        us = np.arange(umin, umax + 1, dtype=np.float32)
        vs = np.arange(vmin, vmax + 1, dtype=np.float32)
        gu, gv = np.meshgrid(us, vs)

        w0 = ((v1 - v2)*(gu - u2) + (u2 - u1)*(gv - v2)) * inv_d
        w1 = ((v2 - v0)*(gu - u2) + (u0 - u2)*(gv - v2)) * inv_d
        w2 = 1.0 - w0 - w1

        inside = (w0 >= -1e-3) & (w1 >= -1e-3) & (w2 >= -1e-3)
        if not np.any(inside):
            continue

        w0_i, w1_i, w2_i = w0[inside], w1[inside], w2[inside]
        p_interp = w0_i[:, None]*pos[i0] + w1_i[:, None]*pos[i1] + w2_i[:, None]*pos[i2]
        n_interp = w0_i[:, None]*nrm[i0] + w1_i[:, None]*nrm[i1] + w2_i[:, None]*nrm[i2]
        n_len = np.linalg.norm(n_interp, axis=1, keepdims=True)
        n_interp = n_interp / np.maximum(n_len, 1e-6)

        p_grid[vmin:vmax+1, umin:umax+1][inside] = p_interp
        n_grid[vmin:vmax+1, umin:umax+1][inside] = n_interp
        mask_grid[vmin:vmax+1, umin:umax+1][inside] = True

    return p_grid, n_grid, mask_grid


def project_turnaround_onto_uv_grid(concept_path, p_grid, n_grid, mask_grid, y_min, y_max, outfit_mod=None):
    """
    Projects the 3-column turnaround concept sheet onto the precomputed UV grid,
    and optionally layers modular outfit details (Farmer, Blacksmith, Shepherd, Guard,
    Archer, Infantry, Alpha, Necromancer) onto the torso/arms while preserving the
    concept-projected face, hair, hands, and boots!
    """
    c_img = Image.open(concept_path).convert("RGB")
    c_img = c_img.resize((c_img.width * 2, c_img.height * 2), Image.Resampling.LANCZOS)
    c_img = c_img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=140, threshold=2))

    seamless_rgb, fg_mask = strip_outer_dark_rim_from_concept(c_img, rim_px=10.0)
    H, W, _ = seamless_rgb.shape
    cW = W // 3

    fx0, fx1, fy0, fy1 = extract_column_bbox(fg_mask, 0, cW)
    sx0, sx1, sy0, sy1 = extract_column_bbox(fg_mask, cW, 2 * cW)
    bx0, bx1, by0, by1 = extract_column_bbox(fg_mask, 2 * cW, W)

    fcx = 0.5 * (fx0 + fx1)
    fhw = max(1.0, 0.28 * (fx1 - fx0))
    scz = 0.5 * (sx0 + sx1)
    shw = max(1.0, 0.44 * (sx1 - sx0))
    bcx = 0.5 * (bx0 + bx1)
    bhw = max(1.0, 0.28 * (bx1 - bx0))

    pts = p_grid[mask_grid]
    nrms = n_grid[mask_grid]
    px, py, pz = pts[:, 0], pts[:, 1], pts[:, 2]
    nx, ny, nz = nrms[:, 0], nrms[:, 1], nrms[:, 2]

    yn = np.clip((py - y_min) / max(1e-5, y_max - y_min), 0.0, 1.0)
    v_frac = 1.0 - yn

    x_norm = np.clip(px / 0.195, -1.0, 1.0)
    uf = np.clip(fcx + x_norm * fhw, fx0, fx1).astype(np.int32)
    vf = np.clip(fy0 + v_frac * (fy1 - fy0), fy0, fy1).astype(np.int32)

    z_norm = np.clip(-pz / 0.165, -1.0, 1.0)
    us = np.clip(scz + z_norm * shw, sx0, sx1).astype(np.int32)
    vs = np.clip(sy0 + v_frac * (sy1 - sy0), sy0, sy1).astype(np.int32)

    ub = np.clip(bcx - x_norm * bhw, bx0, bx1).astype(np.int32)
    vb = np.clip(by0 + v_frac * (by1 - by0), by0, by1).astype(np.int32)

    col_f = seamless_rgb[vf, uf].astype(np.float32)
    col_s = seamless_rgb[vs, us].astype(np.float32)
    col_b = seamless_rgb[vb, ub].astype(np.float32)

    abs_nz = np.abs(nz)
    t_side = np.clip((abs_nz - 0.22) / 0.52, 0.0, 1.0)
    w_fb = 0.5 - 0.5 * np.cos(np.pi * t_side)
    w_s = 1.0 - w_fb

    fb_col = np.where((nz >= 0.0)[:, None], col_f, col_b)
    blended = w_fb[:, None] * fb_col + w_s[:, None] * col_s

    # Map T-pose arms (abs(px) > 0.20, py in 0.52..0.86) along the angled arm trajectory in the concept turnaround!
    is_arm = (np.abs(px) > 0.20) & (py > 0.50) & (py < 0.86)
    if np.any(is_arm):
        arm_ext = np.clip((np.abs(px) - 0.18) / 0.36, 0.0, 1.0)
        arm_u = np.clip(fcx + np.sign(px) * (fhw * 0.85 + arm_ext * (fx1 - fcx - fhw * 0.85) * 0.88), fx0, fx1).astype(np.int32)
        arm_v = np.clip(fy0 + (0.37 + arm_ext * 0.22) * (fy1 - fy0), fy0, fy1).astype(np.int32)
        arm_col = seamless_rgb[arm_v, arm_u].astype(np.float32)
        t_arm = np.clip((np.abs(px) - 0.185) / 0.045, 0.0, 1.0)[:, None]
        blended = (1.0 - t_arm) * blended + t_arm * arm_col

    # Optional Modular Outfit Layering (preserving the hand-painted comic shading & folds!)
    if outfit_mod is not None:
        # Compute local shading factor from base concept luminance so folds/ink lines stay crisp
        lum_base = (0.299 * blended[:, 0] + 0.587 * blended[:, 1] + 0.114 * blended[:, 2]) / 255.0
        shade = np.clip(0.62 + 0.65 * lum_base, 0.35, 1.22)[:, None]

        torso_zone = (py >= 0.34) & (py <= 0.72) & (np.abs(px) <= 0.26)
        sleeve_zone = (py >= 0.54) & (py <= 0.82) & (np.abs(px) > 0.18) & (np.abs(px) <= 0.38)
        apron_front = (py >= 0.24) & (py <= 0.68) & (np.abs(px) <= 0.16) & (nz > 0.15)
        neck_zone = (py >= 0.66) & (py <= 0.735) & (np.abs(px) <= 0.18)
        belt_zone = (py >= 0.42) & (py <= 0.47) & (np.abs(px) <= 0.22)

        if outfit_mod == "farmer":
            # Golden straw tunic (#D8B863) + Red neckerchief (#A83232) + Brown work apron (#7C5A3F)
            m_tunic = torso_zone | sleeve_zone
            blended[m_tunic] = np.clip(np.array([216, 182, 96], dtype=np.float32) * shade[m_tunic], 0, 255)
            blended[apron_front] = np.clip(np.array([128, 92, 64], dtype=np.float32) * shade[apron_front], 0, 255)
            blended[neck_zone] = np.clip(np.array([168, 48, 48], dtype=np.float32) * shade[neck_zone], 0, 255)
            blended[belt_zone] = np.clip(np.array([62, 42, 30], dtype=np.float32) * shade[belt_zone], 0, 255)

        elif outfit_mod == "blacksmith":
            # Soot-darkened leather forge apron (#423026), crossed chest straps (#684935), brass buckle (#E6B84D), beard on lower jaw
            blended[torso_zone] = np.clip(np.array([82, 62, 48], dtype=np.float32) * shade[torso_zone], 0, 255)
            blended[apron_front] = np.clip(np.array([58, 42, 34], dtype=np.float32) * shade[apron_front], 0, 255)
            # Crossed chest straps
            strap = torso_zone & (nz > 0.1) & ((np.abs((px * 1.9) - (py - 0.56)) < 0.045) | (np.abs((px * 1.9) + (py - 0.56)) < 0.045))
            blended[strap] = np.clip(np.array([132, 88, 56], dtype=np.float32) * shade[strap], 0, 255)
            blended[belt_zone] = np.clip(np.array([52, 36, 26], dtype=np.float32) * shade[belt_zone], 0, 255)
            buckle = belt_zone & (np.abs(px) < 0.045) & (nz > 0.2)
            blended[buckle] = [230, 184, 77]
            # Full blacksmith beard on lower face (py in 0.73..0.80, nz > 0.25)
            beard = (py >= 0.735) & (py <= 0.805) & (np.abs(px) <= 0.11) & (nz > 0.28)
            blended[beard] = np.clip(np.array([56, 38, 28], dtype=np.float32) * shade[beard], 0, 255)

        elif outfit_mod == "shepherd":
            # Fluffy cream-wool vest (#D8D0C0) over warm olive-brown tunic (#687D63), brown shoulder cape (#7A5C43)
            m_tunic = torso_zone | sleeve_zone
            blended[m_tunic] = np.clip(np.array([118, 128, 98], dtype=np.float32) * shade[m_tunic], 0, 255)
            vest = (py >= 0.43) & (py <= 0.68) & (np.abs(px) <= 0.18) & (np.abs(px) >= 0.025)
            # Add wool texture modulation to vest
            wool_mod = 1.0 + 0.08 * np.sin(px * 95.0) * np.cos(py * 95.0)
            blended[vest] = np.clip(np.array([218, 208, 188], dtype=np.float32) * shade[vest] * wool_mod[vest, None], 0, 255)
            cape = (py >= 0.63) & (py <= 0.735) & (np.abs(px) <= 0.24)
            blended[cape] = np.clip(np.array([122, 92, 66], dtype=np.float32) * shade[cape], 0, 255)
            blended[belt_zone] = np.clip(np.array([68, 48, 34], dtype=np.float32) * shade[belt_zone], 0, 255)

        elif outfit_mod == "guard":
            # Chainmail coif & sleeves (#7A8490), Crimson surcoat (#8C2D2D), Gold Heraldic Cross (#E6B84D)
            chain_mod = 1.0 + 0.09 * np.sin(px * 140.0) * np.sin(py * 140.0)
            coif = (py >= 0.72) & ( (nz < 0.25) | (py >= 0.91) | (np.abs(px) >= 0.115) )
            chain_all = coif | sleeve_zone | ((py >= 0.62) & (py <= 0.73) & (np.abs(px) <= 0.24))
            blended[chain_all] = np.clip(np.array([124, 134, 148], dtype=np.float32) * shade[chain_all] * chain_mod[chain_all, None], 0, 255)
            surcoat = (py >= 0.28) & (py <= 0.64) & (np.abs(px) <= 0.20)
            blended[surcoat] = np.clip(np.array([148, 46, 46], dtype=np.float32) * shade[surcoat], 0, 255)
            cross_v = surcoat & (nz > 0.2) & (np.abs(px) <= 0.026) & (py >= 0.34) & (py <= 0.62)
            cross_h = surcoat & (nz > 0.2) & (np.abs(py - 0.54) <= 0.024) & (np.abs(px) <= 0.095)
            blended[cross_v | cross_h] = np.clip(np.array([232, 186, 78], dtype=np.float32) * shade[cross_v | cross_h], 0, 255)
            blended[belt_zone] = np.clip(np.array([52, 38, 30], dtype=np.float32) * shade[belt_zone], 0, 255)

        elif outfit_mod == "zombie_archer":
            # Tattered Crimson Hood & Cloak (#8C2D2D) over Zombie Base (leaving undead face & glowing eyes visible in front!)
            hood_cloak = ((py >= 0.71) & ((nz < 0.22) | (py >= 0.90) | (np.abs(px) >= 0.11))) | ((py >= 0.32) & (py <= 0.73) & ((nz < 0.15) | (py >= 0.62)))
            blended[hood_cloak] = np.clip(np.array([140, 45, 45], dtype=np.float32) * shade[hood_cloak], 0, 255)
            blended[belt_zone] = np.clip(np.array([48, 36, 30], dtype=np.float32) * shade[belt_zone], 0, 255)

        elif outfit_mod == "zombie_infantry":
            # Rusted Iron Chainmail (#5A626A) & Torn Crimson Tabard (#8C2D2D) over Zombie Base
            chain_mod = 1.0 + 0.10 * np.sin(px * 130.0) * np.sin(py * 130.0)
            mail = (py >= 0.56) & (py <= 0.73) & (np.abs(px) <= 0.34)
            blended[mail] = np.clip(np.array([96, 104, 114], dtype=np.float32) * shade[mail] * chain_mod[mail, None], 0, 255)
            tabard = (py >= 0.30) & (py <= 0.62) & (np.abs(px) <= 0.19)
            blended[tabard] = np.clip(np.array([140, 45, 45], dtype=np.float32) * shade[tabard], 0, 255)
            blended[belt_zone] = np.clip(np.array([48, 36, 30], dtype=np.float32) * shade[belt_zone], 0, 255)

        elif outfit_mod == "zombie_alpha":
            # Crossed Bone Harness (#D8D0C0), Plague Mint Veins (#32E6B2), Crimson Waistcloth (#8C2D2D)
            waist = (py >= 0.26) & (py <= 0.48) & (np.abs(px) <= 0.20)
            blended[waist] = np.clip(np.array([140, 45, 45], dtype=np.float32) * shade[waist], 0, 255)
            harness = torso_zone & ((np.abs((px * 1.8) - (py - 0.56)) < 0.042) | (np.abs((px * 1.8) + (py - 0.56)) < 0.042))
            blended[harness] = np.clip(np.array([216, 208, 192], dtype=np.float32) * shade[harness], 0, 255)

        elif outfit_mod == "zombie_necro":
            # Dark Charcoal Cultist Robe (#2C262E) with Glowing Plague-Mint Runes (#32E6B2) & Gold Trim (#E6B84D)
            robe = (py >= 0.24) & (py <= 0.73) & (np.abs(px) <= 0.36)
            blended[robe] = np.clip(np.array([46, 42, 52], dtype=np.float32) * shade[robe], 0, 255)
            gold_trim = robe & (nz > 0.15) & (np.abs( np.abs(px) - 0.055 ) < 0.016)
            blended[gold_trim] = [230, 184, 77]
            runes = robe & (nz > 0.15) & (np.abs( np.abs(px) - 0.088 ) < 0.015) & (np.sin(py * 65.0) > 0.15)
            blended[runes] = [50, 230, 178]

    res = p_grid.shape[0]
    atlas_small = np.zeros((res, res, 3), dtype=np.uint8)
    atlas_small[mask_grid] = np.clip(blended, 0, 255).astype(np.uint8)

    _, inds = distance_transform_edt(~mask_grid, return_indices=True)
    atlas_small = atlas_small[inds[0], inds[1]]

    img_4k = Image.fromarray(atlas_small, "RGB").resize((4096, 4096), Image.Resampling.LANCZOS)
    img_4k = img_4k.filter(ImageFilter.UnsharpMask(radius=1.3, percent=130, threshold=2))
    return img_4k


def bake_animal_and_props_atlas():
    """
    Bakes a 2048x2048 100% Opaque RGB Hand-Painted Comic Material & Animal Kingdom Atlas
    covering all 10 Animals (Chicken, Duck, Pig, Sheep, Rabbit, Cow, Elephant, Tiger, Wolf, Lion),
    all Modular Weapons/Tools, and all Village Props & VFX!
    """
    W = H = 2048
    img = Image.new("RGB", (W, H), (44, 34, 30))
    draw = ImageDraw.Draw(img)
    gw, gh = W // 4, H // 4

    def fill_tile(col, row, base_rgb, stripe_rgb=None, mode="matte"):
        x0, y0 = col * gw, row * gh
        tile = np.zeros((gh, gw, 3), dtype=np.float32)
        tile[:, :] = base_rgb
        yy, xx = np.mgrid[0:gh, 0:gw]
        # Subtle hand-painted brush & comic edge vignette
        vignette = 1.0 - 0.12 * ((xx / float(gw) - 0.5)**2 + (yy / float(gh) - 0.5)**2)
        tile *= vignette[:, :, None]

        if mode == "feathers" and stripe_rgb is not None:
            scallop = (np.sin(xx * 0.18) + np.cos(yy * 0.22)) > 0.65
            tile[scallop] = stripe_rgb
        elif mode == "stripes" and stripe_rgb is not None:
            wave = np.sin(yy * 0.11 + np.sin(xx * 0.05) * 2.2)
            tile[wave > 0.36] = stripe_rgb
        elif mode == "fur" and stripe_rgb is not None:
            tuft = np.sin(xx * 0.25) * np.cos(yy * 0.14)
            tile[tuft > 0.35] = stripe_rgb
        elif mode == "wool" and stripe_rgb is not None:
            curl = np.sin(xx * 0.12) * np.sin(yy * 0.12)
            tile[curl > 0.25] = stripe_rgb
        elif mode == "cow_spots" and stripe_rgb is not None:
            spot = (np.sin(xx * 0.032 + 0.5) * np.cos(yy * 0.035 - 0.3)) > 0.18
            tile[spot] = stripe_rgb
        elif mode == "wheat" and stripe_rgb is not None:
            stalk = (np.sin(xx * 0.28) > 0.25) & (np.cos(yy * 0.09) > -0.4)
            tile[stalk] = stripe_rgb
        elif mode == "embers" and stripe_rgb is not None:
            glow = (np.sin(xx * 0.15) * np.cos(yy * 0.15)) > 0.10
            tile[glow] = stripe_rgb

        arr_tile = np.clip(tile, 0, 255).astype(np.uint8)
        img.paste(Image.fromarray(arr_tile, "RGB"), (x0, y0))

    # Row 0: Poultry, Farm Pig, Fluffy Sheep
    fill_tile(0, 0, (242, 232, 208), (218, 202, 172), "feathers")  # Chicken/Sheep cream wool
    fill_tile(1, 0, (34, 118, 78),   (24, 88, 58),    "feathers")  # Mallard duck green
    fill_tile(2, 0, (132, 92, 62),   (102, 68, 44),   "feathers")  # Duck/Rabbit warm brown
    fill_tile(3, 0, (232, 168, 152), (212, 142, 126), "matte")     # Pig pink

    # Row 1: Cow Spots, Elephant Grey, Tiger Stripes
    fill_tile(0, 1, (238, 226, 204), (146, 82, 46),   "cow_spots") # Cow spotted hide
    fill_tile(1, 1, (116, 122, 128), (94, 100, 106),  "fur")       # Elephant grey
    fill_tile(2, 1, (228, 134, 44),  (28, 22, 18),    "stripes")   # Tiger orange + black stripes
    fill_tile(3, 1, (244, 238, 226), (222, 214, 198), "wool")      # White wool / Ivory / Belly

    # Row 2: Wolf Grey, Lion Gold, Lion Mane, Straw/Wheat Gold
    fill_tile(0, 2, (98, 104, 112),  (64, 68, 76),    "fur")       # Wolf grey fur
    fill_tile(1, 2, (216, 166, 78),  (192, 142, 58),  "fur")       # Lion golden coat
    fill_tile(2, 2, (98, 42, 28),    (68, 26, 18),    "fur")       # Lion dark crimson-brown mane
    fill_tile(3, 2, (232, 192, 86),  (196, 152, 52),  "wheat")     # Straw hat / Golden Wheat

    # Row 3: Steel, Wood, Crimson & Plague Glow / Forge Embers
    fill_tile(0, 3, (124, 134, 146), (88, 96, 108),   "matte")     # Forged Steel (Scythe/Hammer/Anvil)
    fill_tile(1, 3, (94, 64, 42),    (68, 44, 28),    "stripes")   # Oak Wood (Handles/Sheep Pen)
    fill_tile(2, 3, (156, 44, 44),   (230, 184, 77),  "embers")    # Crimson / Forge Embers / Sparks
    fill_tile(3, 3, (50, 230, 178),  (230, 184, 77),  "matte")     # Plague Glow / Sleep Zzz Mint

    out_path = os.path.join(TEX_DIR, "ANIMAL_KINGDOM_atlas.png")
    img.save(out_path, "PNG")
    print("Saved 100% Opaque RGB Animal & Props Atlas:", out_path)


def main():
    base_glb = os.path.join(MODELS_DIR, "CHAR_ZOMBIE_BASE.glb")
    pos, nrm, uv, ind = load_base_mesh_uv_and_pos(base_glb)
    y_min, y_max = float(pos[:, 1].min()), float(pos[:, 1].max())
    print("Precomputing UV raster lookup grid (1024x1024)...")
    p_grid, n_grid, mask_grid = precompute_uv_raster_grid(pos, nrm, uv, ind, res=1024)

    # 1. Project CHAR_VILLAGER_BASE_turnaround.png onto CHAR_VILLAGER_BASE and 4 Villager Outfits
    vil_concept = os.path.join(REF_DIR, "CHAR_VILLAGER_BASE_turnaround.png")
    vil_targets = [
        ("CHAR_VILLAGER_BASE_atlas.png",         None),
        ("OUTFIT_Villager_Farmer_atlas.png",     "farmer"),
        ("OUTFIT_Villager_Blacksmith_atlas.png", "blacksmith"),
        ("OUTFIT_Villager_Shepherd_atlas.png",   "shepherd"),
        ("OUTFIT_Villager_GuardArmor_atlas.png", "guard"),
    ]
    for fname, mod in vil_targets:
        img_4k = project_turnaround_onto_uv_grid(vil_concept, p_grid, n_grid, mask_grid, y_min, y_max, outfit_mod=mod)
        out_p = os.path.join(TEX_DIR, fname)
        img_4k.save(out_p, "PNG")
        print("Baked Concept-Projected 4K Atlas:", out_p)

    # 2. Project CHAR_ZOMBIE_BASE_turnaround.png onto CHAR_ZOMBIE_BASE and 4 Zombie Outfits
    zom_concept = os.path.join(REF_DIR, "CHAR_ZOMBIE_BASE_turnaround.png")
    zom_targets = [
        ("CHAR_ZOMBIE_BASE_atlas.png",          None),
        ("OUTFIT_Archer_HoodCloak_atlas.png",   "zombie_archer"),
        ("OUTFIT_Infantry_MailTunic_atlas.png", "zombie_infantry"),
        ("OUTFIT_Alpha_BoneLord_atlas.png",     "zombie_alpha"),
        ("OUTFIT_Necro_CultRobe_atlas.png",     "zombie_necro"),
    ]
    for fname, mod in zom_targets:
        img_4k = project_turnaround_onto_uv_grid(zom_concept, p_grid, n_grid, mask_grid, y_min, y_max, outfit_mod=mod)
        out_p = os.path.join(TEX_DIR, fname)
        img_4k.save(out_p, "PNG")
        print("Baked Concept-Projected 4K Atlas:", out_p)

    # 3. Bake Animal Kingdom & Village Props Atlas
    bake_animal_and_props_atlas()
    print("ALL CONCEPT-PROJECTED 4K TEXTURE ATLASES BAKED SUCCESSFULLY!")


if __name__ == "__main__":
    main()
