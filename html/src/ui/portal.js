/**
 * SQUEEK ROYALE — WEB3 MULTILINGUAL PORTAL CONTROLLER
 * Default Language: English (EN), switchable to Vietnamese (VI)
 * Features: 5s Auto-DNA Simulator, No-Tier Armory, Web3 Prize Calculator, Whitepaper TOC.
 */

import { squeekAudio } from './audio.js';

// ============================================================================
// 1. BILINGUAL DICTIONARY (EN default, VI)
// ============================================================================

export const TRANSLATIONS = {
  en: {
    // Navigation
    nav_home: "Home",
    nav_gameplay: "Gameplay",
    nav_armory: "Armory & Loot",
    nav_tokenomics: "Tokenomics & Pool",
    nav_whitepaper: "Whitepaper",
    nav_replay: "Play Demo Replay",
    nav_arena: "NFT Arena",

    // Common
    badge_live: "Version 1.3.0 Live",
    badge_deterministic: "100% Deterministic",
    badge_testnet: "Sepolia Testnet",
    btn_copy: "Copy",
    btn_copied: "Copied!",
    btn_pause: "Pause",
    btn_resume: "Resume",
    btn_roll: "Roll Now",

    // Home Hero
    hero_title_1: "ON-CHAIN BATTLE ROYALE",
    hero_title_2: "100 AI HAMSTERS",
    hero_title_3: "ZERO-GAS ENGINE",
    hero_desc: "The premier 2D Battle Royale powered by autonomous AI, bit-level deterministic simulation, and a verifiable 90% prize pool distribution. Each hamster carries a 256-bit on-chain DNA that dictates its unique battle traits.",
    hero_stat_bots: "AI Bots / Match",
    hero_stat_weapons: "Combat Weapons",
    hero_stat_duration: "Average Match",
    hero_stat_pool: "Prize Pool Share",

    // DNA Auto-Simulator
    dna_engine_title: "Live Autonomous Genome Engine",
    dna_engine_sub: "Auto-simulating a new on-chain DNA every 5 seconds",
    dna_simulating_next: "Next DNA in",
    dna_attr_str: "STR (Strength)",
    dna_attr_agi: "AGI (Agility)",
    dna_attr_arm: "ARM (Armor)",
    dna_attr_vit: "VIT (Vitality)",
    dna_attr_per: "PER (Perception)",
    dna_hint_str: "Damage output boost (82 + 2×STR %)",
    dna_hint_agi: "Move speed, dodge rating & attack speed",
    dna_hint_arm: "Incoming damage reduction (ARM - 2 %)",
    dna_hint_vit: "Maximum hit points (170 + 5×VIT HP)",
    dna_hint_per: "Field-of-vision radius & sniper accuracy",

    // Armory
    armory_title: "Combat Armory & Survival Loot",
    armory_sub: "Click on any weapon to inspect its full combat statistics (Tier ratings removed)",
    armory_lbl_type: "Weapon Type",
    armory_lbl_damage: "Base Damage",
    armory_lbl_cooldown: "Attack Cooldown",
    armory_lbl_range: "Effective Range",
    armory_lbl_speed: "Projectile / Swing Speed",
    armory_lbl_stun: "Stun Duration",
    armory_lbl_instant: "Instant (Melee)",
    armory_lbl_perk: "Signature Mechanic",
    armory_consumables_title: "Survival Consumables (3-Slot Bag) & Paw Chests",
    armory_consumables_sub: "150 consumable items across the arena + 70 Paw Chests",
    chest_title: "70 Paw Treasure Chests",
    chest_desc: "Scattered evenly across the arena. When a wounded hamster (< 85% HP) touches a chest, it pops open into fresh cheese, instantly restoring 65 HP. Healthy hamsters will not trigger it.",

    // Tokenomics
    tokenomics_title: "Tournament Economics & 90% Pool Distribution",
    tokenomics_sub: "Verifiable smart contract pool on Ethereum Sepolia: 0.0001 ETH entry fee",
    calc_title: "Work out your share with the simulator",
    calc_formula: "Your reward = 90% pool × your hamster's score ÷ the total score of the arena. Score = live points (1/s, ×2 with the Crown) + 50 × kill points (×2 for killing the Crown holder).",
    calc_body: "Every score comes out of the deterministic simulator, so there is nothing to estimate: run a real match yourself, pick a seed and a field size, and read each hamster's live points, kill points and score in the result table.",
    calc_note: "There is no expected return. A low score can pay back less than the 0.0001 ETH entry fee. Testnet ETH has no value.",
    calc_cta: "Open the simulator →",

    // Gameplay
    gameplay_title: "Battle Royale Gameplay & Mechanics",
    gameplay_sub: "5 phases of survival, continuous Cat Storm shrinkage, and deterministic scoring",

    // Whitepaper
    wp_title: "Official Project Whitepaper",
    wp_sub: "Game rules, hamster NFTs, on-chain matches, the spectator camera and rewards",
    wp_download: "Download Markdown (.md)",
    wp_search_ph: "Search sections..."
  },

  vi: {
    // Navigation
    nav_home: "Trang chủ",
    nav_gameplay: "Gameplay",
    nav_armory: "Kho Vũ Khí & Loot",
    nav_tokenomics: "Kinh Tế & Thưởng",
    nav_whitepaper: "Whitepaper",
    nav_replay: "Xem Demo Replay",
    nav_arena: "NFT Arena",

    // Common
    badge_live: "Version 1.3.0 Live",
    badge_deterministic: "100% Tất Định",
    badge_testnet: "Sepolia Testnet",
    btn_copy: "Sao chép",
    btn_copied: "Đã chép!",
    btn_pause: "Tạm dừng",
    btn_resume: "Tiếp tục",
    btn_roll: "Sinh mới",

    // Home Hero
    hero_title_1: "ĐẤU TRƯỜNG SINH TỒN",
    hero_title_2: "100 HAMSTER AI",
    hero_title_3: "KHÔNG TỐN GAS",
    hero_desc: "Game 2D Battle Royale tiên phong kết hợp trí tuệ nhân tạo tự động, simulator tất định bit-level và hợp đồng thông minh chia thưởng 90%. Mỗi hamster mang DNA 256-bit on-chain quy định ngoại hình và 5 chỉ số tác chiến.",
    hero_stat_bots: "Hamster AI / Trận",
    hero_stat_weapons: "Vũ Khí Chiến Đấu",
    hero_stat_duration: "Thời Lượng Trung Bình",
    hero_stat_pool: "Quỹ Thưởng Chia Theo Điểm",

    // DNA Auto-Simulator
    dna_engine_title: "Bộ Mô Phỏng Bộ Gen Tự Động",
    dna_engine_sub: "Tự động giả lập một DNA on-chain mới mỗi 5 giây",
    dna_simulating_next: "Sinh DNA tiếp theo trong",
    dna_attr_str: "STR (Sức mạnh)",
    dna_attr_agi: "AGI (Nhanh nhẹn)",
    dna_attr_arm: "ARM (Giáp trụ)",
    dna_attr_vit: "VIT (Sinh lực)",
    dna_attr_per: "PER (Tinh mắt)",
    dna_hint_str: "Gia tăng sát thương xuất chiêu (82 + 2×STR %)",
    dna_hint_agi: "Tốc chạy, né tránh & tốc độ ra đòn",
    dna_hint_arm: "Giảm sát thương nhận vào (ARM - 2 %)",
    dna_hint_vit: "Lượng máu tối đa (170 + 5×VIT HP)",
    dna_hint_per: "Tầm quan sát & độ chuẩn xác bắn tỉa",

    // Armory
    armory_title: "Kho Vũ Khí Tác Chiến & Loot",
    armory_sub: "Bấm vào bất kỳ vũ khí nào để xem thông số chi tiết (Đã lược bỏ thông tin bậc)",
    armory_lbl_type: "Loại vũ khí",
    armory_lbl_damage: "Sát thương cơ bản",
    armory_lbl_cooldown: "Hồi chiêu",
    armory_lbl_range: "Tầm hiệu dụng",
    armory_lbl_speed: "Tốc độ đạn / Vung đòn",
    armory_lbl_stun: "Thời gian choáng",
    armory_lbl_instant: "Tức thì (Cận chiến)",
    armory_lbl_perk: "Cơ chế đặc trưng",
    armory_consumables_title: "Vật Phẩm Hồi Máu (Túi 3 Ô) & Rương Phô Mai",
    armory_consumables_sub: "150 vật phẩm rải khắp đấu trường + 70 rương móng mèo",
    chest_title: "70 Rương Móng Mèo",
    chest_desc: "Phân bổ đều khắp đấu trường. Khi hamster bị thương (< 85% HP) chạm vào, rương tự mở ra phô mai hồi ngay 65 HP. Hamster đầy máu đi qua không làm tiêu hao rương.",

    // Tokenomics
    tokenomics_title: "Kinh Tế Giải Đấu & Phân Phối Thưởng 90%",
    tokenomics_sub: "Hợp đồng thông minh minh bạch trên Ethereum Sepolia: Phí tham gia 0.0001 ETH",
    calc_title: "Tự tính phần thưởng bằng simulator",
    calc_formula: "Phần thưởng = 90% quỹ × điểm hamster của bạn ÷ tổng điểm cả arena. Điểm = điểm sống (1/giây, ×2 khi giữ Vương miện) + 50 × điểm hạ gục (×2 khi hạ người giữ Vương miện).",
    calc_body: "Mọi điểm số đều do simulator tất định tính ra, nên không cần ước lượng: hãy tự chạy một trận thật, chọn seed và số hamster, rồi đọc điểm sống, điểm hạ gục và tổng điểm của từng hamster trong bảng kết quả.",
    calc_note: "Không có lợi nhuận kỳ vọng. Điểm thấp có thể nhận về ít hơn phí tham gia 0.0001 ETH. ETH testnet không có giá trị.",
    calc_cta: "Mở simulator →",

    // Gameplay
    gameplay_title: "Gameplay & Cơ Chế Đấu Trường",
    gameplay_sub: "5 giai đoạn sinh tồn, vòng bo Mèo Bão co liên tục và luật điểm tất định",

    // Whitepaper
    wp_title: "Whitepaper Toàn Văn Chính Thức",
    wp_sub: "Luật chơi, NFT hamster, trận đấu on-chain, camera xem trận và cơ chế trả thưởng",
    wp_download: "Tải file Markdown (.md)",
    wp_search_ph: "Tìm kiếm các mục..."
  }
};

// ============================================================================
// 2. WEAPON DATA (NO TIERS!)
// ============================================================================

export const WEAPONS_DATA = [
  {
    id: 'sword',
    name: { en: 'Sword', vi: 'Thanh Kiếm' },
    type: { en: 'Melee', vi: 'Cận chiến' },
    damage: 25,
    cooldown: 0.75,
    range: 46,
    speed: 0,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_sword.png',
    role: {
      en: 'Core balanced melee weapon with reliable tempo and consistent damage.',
      vi: 'Vũ khí cận chiến cốt lõi, cân bằng hoàn hảo giữa tốc độ và sát thương.'
    },
    perk: {
      en: 'Steady strike cadence, ideal for zoning unarmed hamsters and cornering enemies.',
      vi: 'Nhịp ra đòn chuẩn xác, ép góc và rỉa máu áp đảo mục tiêu tay không.'
    }
  },
  {
    id: 'dagger',
    name: { en: 'Dagger', vi: 'Dao Găm' },
    type: { en: 'Melee', vi: 'Cận chiến' },
    damage: 12,
    cooldown: 0.35,
    range: 32,
    speed: 0,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_dagger.png',
    role: {
      en: 'Ultra-fast attack speed, perfectly suited for high-AGI builds.',
      vi: 'Tốc độ vung đòn cực nhanh, thích hợp cho hamster chỉ số AGI cao.'
    },
    perk: {
      en: 'Rapid 0.35s cooldown interrupts fleeing opponents and delivers relentless flurry.',
      vi: 'Hồi chiêu thần tốc 0.35s, ngắt nhịp chạy của đối thủ đang tháo chạy.'
    }
  },
  {
    id: 'axe',
    name: { en: 'Axe', vi: 'Rìu Chiến' },
    type: { en: 'Melee', vi: 'Cận chiến' },
    damage: 38,
    cooldown: 1.15,
    range: 48,
    speed: 0,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_axe.png',
    role: {
      en: 'Heavy-hitting cleaver delivering crushing single-strike burst damage.',
      vi: 'Vũ khí hạng nặng sát thương bộc phát cực cao.'
    },
    perk: {
      en: '38 base damage shreds nearly 20% of a tank\'s maximum health in one blow.',
      vi: '38 sát thương mỗi nhát chém, thổi bay gần 20% máu của tanker chỉ trong 1 đòn.'
    }
  },
  {
    id: 'spear',
    name: { en: 'Spear', vi: 'Ngọn Giáo' },
    type: { en: 'Melee', vi: 'Cận chiến' },
    damage: 22,
    cooldown: 0.85,
    range: 85,
    speed: 0,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_spear.png',
    role: {
      en: 'Longest reach in the melee category (85u).',
      vi: 'Tầm đánh xa nhất trong nhóm cận chiến (85u).'
    },
    perk: {
      en: 'Out-ranges swords and daggers, enabling safe hit-and-run kiting.',
      vi: 'Đâm xuyên ngoài tầm với của kiếm và dao găm, hoàn hảo cho chiến thuật Hit & Run.'
    }
  },
  {
    id: 'hammer',
    name: { en: 'Hammer', vi: 'Búa Tạ' },
    type: { en: 'Melee', vi: 'Cận chiến' },
    damage: 45,
    cooldown: 1.55,
    range: 50,
    speed: 0,
    stun: 8,
    icon: 'src/assets/agy/weapons/icon_hammer.png',
    role: {
      en: 'Devastating heavy maul with built-in Stun effect.',
      vi: 'Vũ khí cận chiến hạng nặng với hiệu ứng Choáng.'
    },
    perk: {
      en: 'Applies 8 ticks (0.4s) of hard Stun, locking targets in place for lethal follow-up.',
      vi: 'Gây choáng 8 tick (0.4s), khoá cứng mục tiêu để dồn sát thương kết liễu.'
    }
  },
  {
    id: 'bow',
    name: { en: 'Bow', vi: 'Cung Tên' },
    type: { en: 'Ranged', vi: 'Tầm xa' },
    damage: 18,
    cooldown: 0.90,
    range: 220,
    speed: 520,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_bow.png',
    role: {
      en: 'Versatile mid-to-long range sniper bow.',
      vi: 'Vũ khí bắn tỉa tầm trung và xa phổ biến nhất.'
    },
    perk: {
      en: 'High arrow velocity (520 u/s) enables precision harassment from safe distances.',
      vi: 'Tốc độ bay của mũi tên 520 u/s, rỉa máu từ vị trí an toàn ngoài vòng giao tranh.'
    }
  },
  {
    id: 'crossbow',
    name: { en: 'Crossbow', vi: 'Nỏ Săn' },
    type: { en: 'Ranged', vi: 'Tầm xa' },
    damage: 34,
    cooldown: 1.55,
    range: 250,
    speed: 640,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_crossbow.png',
    role: {
      en: 'Ultimate long-range siege weapon boasting maximum arena range (250u).',
      vi: 'Vũ khí tầm xa với tầm bắn xa nhất game (250u).'
    },
    perk: {
      en: 'Lightning bolt speed (640 u/s) with 34 damage — true battlefield executioner.',
      vi: 'Đạn bay thần tốc 640 u/s với 34 sát thương, sniper đích thực của đấu trường.'
    }
  },
  {
    id: 'magic_staff',
    name: { en: 'Magic Staff', vi: 'Gậy Phép' },
    type: { en: 'Ranged', vi: 'Tầm xa' },
    damage: 20,
    cooldown: 1.20,
    range: 190,
    speed: 380,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_magic_staff.png',
    role: {
      en: 'Arcane projectile staff dealing consistent magical damage.',
      vi: 'Vũ khí phép thuật tầm xa dồn sát thương ổn định.'
    },
    perk: {
      en: 'Launches persistent arcane orbs that force opponents into defensive retreats.',
      vi: 'Bắn ra các quả cầu năng lượng ma thuật ép đối thủ phải lùi bước.'
    }
  },
  {
    id: 'seed_sling',
    name: { en: 'Seed Sling', vi: 'Ná Hạt Dưa' },
    type: { en: 'Ranged', vi: 'Tầm xa' },
    damage: 9,
    cooldown: 0.40,
    range: 170,
    speed: 600,
    stun: 0,
    icon: 'src/assets/agy/weapons/icon_seed_sling.png',
    role: {
      en: 'Rapid-fire skirmisher slingshot for newly landed hamsters.',
      vi: 'Vũ khí tầm xa bắn nhanh cho bot vừa tiếp đất tay không.'
    },
    perk: {
      en: 'Ultra-fast 0.40s cooldown and 600 u/s velocity allows relentless pressure.',
      vi: 'Bắn cực nhanh (0.40s hồi chiêu) và đạn nhanh 600 u/s, rỉa máu tức thì.'
    }
  }
];

// ============================================================================
// 3. UNARMED HAMSTER SPRITES (NO WEAPONS IN DEMO PICTURES!)
// ============================================================================

export const UNARMED_SPRITES = [
  { img: 'src/assets/agy/previews/seed_01_nori_knight_spawn_unarmed_right.png', name: 'Nori Knight' },
  { img: 'src/assets/agy/previews/seed_02_fluff_archer_spawn_unarmed_right.png', name: 'Fluff Archer' },
  { img: 'src/assets/agy/previews/seed_03_bandit_boba_spawn_unarmed_right.png', name: 'Bandit Boba' },
  { img: 'src/assets/agy/previews/seed_04_miso_ronin_spawn_unarmed_right.png', name: 'Miso Ronin' },
  { img: 'src/assets/agy/previews/seed_05_cheese_lord_spawn_unarmed_right.png', name: 'Cheese Lord' },
  { img: 'src/assets/agy/previews/seed_06_tank_ham_spawn_unarmed_right.png', name: 'Tank Ham' },
  { img: 'src/assets/agy/previews/seed_07_pudding_paw_spawn_unarmed_right.png', name: 'Pudding Paw' },
  { img: 'src/assets/agy/previews/seed_08_maple_spear_spawn_unarmed_right.png', name: 'Maple Spear' },
  { img: 'src/assets/agy/previews/seed_09_spike_mochi_spawn_unarmed_right.png', name: 'Spike Mochi' }
];

// Equipment stat bonuses
const ITEM_STATS = {
  body: [
    { str: 1, agi: 0, arm: 5, vit: 4, per: 0 },
    { str: 1, agi: 4, arm: 0, vit: 0, per: 5 },
    { str: 3, agi: 5, arm: 0, vit: 0, per: 2 },
    { str: 5, agi: 4, arm: 0, vit: 0, per: 1 },
    { str: 0, agi: 0, arm: 3, vit: 4, per: 3 },
    { str: 1, agi: 0, arm: 4, vit: 5, per: 0 },
    { str: 0, agi: 4, arm: 0, vit: 3, per: 3 },
    { str: 2, agi: 3, arm: 0, vit: 3, per: 2 },
    { str: 5, agi: 0, arm: 3, vit: 2, per: 0 },
    { str: 0, agi: 2, arm: 0, vit: 2, per: 6 },
  ],
  head: [
    { str: 0, agi: 2, arm: 0, vit: 0, per: 2 },
    { str: 0, agi: 0, arm: 4, vit: 2, per: 0 },
    { str: 0, agi: 2, arm: 0, vit: 0, per: 4 },
    { str: 3, agi: 3, arm: 0, vit: 0, per: 0 },
    { str: 3, agi: 0, arm: 0, vit: 0, per: 3 },
    { str: 0, agi: 0, arm: 1, vit: 0, per: 5 },
    { str: 0, agi: 3, arm: 0, vit: 3, per: 0 },
    { str: 2, agi: 0, arm: 0, vit: 2, per: 2 },
    { str: 0, agi: 4, arm: 0, vit: 0, per: 2 },
    { str: 0, agi: 0, arm: 0, vit: 3, per: 3 },
    { str: 4, agi: 0, arm: 0, vit: 2, per: 0 },
  ],
  back: [
    { str: 0, agi: 4, arm: 0, vit: 0, per: 0 },
    { str: 0, agi: 0, arm: 3, vit: 3, per: 0 },
    { str: 2, agi: 4, arm: 0, vit: 0, per: 0 },
    { str: 3, agi: 3, arm: 0, vit: 0, per: 0 },
    { str: 0, agi: 0, arm: 2, vit: 3, per: 1 },
    { str: 2, agi: 0, arm: 4, vit: 0, per: 0 },
    { str: 0, agi: 3, arm: 0, vit: 3, per: 0 },
    { str: 0, agi: 2, arm: 0, vit: 2, per: 2 },
    { str: 3, agi: 0, arm: 3, vit: 0, per: 0 },
    { str: 0, agi: 0, arm: 0, vit: 2, per: 4 },
    { str: 0, agi: 5, arm: 0, vit: 0, per: 1 },
  ]
};

const FIRST_NAMES = ['Nori', 'Fluff', 'Boba', 'Miso', 'Cheddar', 'Mochi', 'Pudding', 'Maple', 'Spike', 'Taro', 'Ginger', 'Biscuit', 'Toffee', 'Peanut', 'Clover', 'Yuzu', 'Pepper', 'Hazel', 'Cocoa', 'Sesame'];
const LAST_NAMES = ['Knight', 'Archer', 'Bandit', 'Ronin', 'Lord', 'Tank', 'Paw', 'Spear', 'Fang', 'Whisk', 'Tail', 'Claw', 'Crumb', 'Dash', 'Squeak', 'Nibble'];

// ============================================================================
// 4. DNA DECODER & STATS MATH
// ============================================================================

export function decodeDna(dnaStr) {
  let v;
  try {
    v = BigInt(dnaStr.trim());
  } catch (e) {
    v = 0x8a92f03b41d8e571c26490ab8ef342517865234190abcdef1234567890abcdefn;
  }

  const word = (k) => Number((v >> BigInt(16 * k)) & 0xffffn);

  const bodyIdx = word(3) % ITEM_STATS.body.length;
  const headIdx = word(4) % ITEM_STATS.head.length;
  const backIdx = word(5) % ITEM_STATS.back.length;

  const bStats = ITEM_STATS.body[bodyIdx];
  const hStats = ITEM_STATS.head[headIdx];
  const kStats = ITEM_STATS.back[backIdx];

  const stats = {
    str: 6 + bStats.str + hStats.str + kStats.str,
    agi: 6 + bStats.agi + hStats.agi + kStats.agi,
    arm: 6 + bStats.arm + hStats.arm + kStats.arm,
    vit: 6 + bStats.vit + hStats.vit + kStats.vit,
    per: 6 + bStats.per + hStats.per + kStats.per,
  };

  const name = `${FIRST_NAMES[word(9) % FIRST_NAMES.length]}${LAST_NAMES[word(10) % LAST_NAMES.length]}${(word(11) % 90) + 10}`;

  const combat = {
    damageMultiplier: 82 + 2 * stats.str,
    moveSpeed: 76 + Math.floor((stats.agi * 7) / 2),
    dodgeChance: Math.min(95, Math.round((100 + 40 * stats.agi) / 10)),
    cdReduction: 100 - (110 - stats.agi),
    armorReduction: Math.max(0, Math.min(40, stats.arm - 2)),
    maxHp: 170 + 5 * stats.vit,
    awarenessRadius: 270 + 10 * stats.per,
    aimAccuracy: Math.min(95, Math.round((150 + 45 * stats.per) / 10))
  };

  const spriteObj = UNARMED_SPRITES[word(0) % UNARMED_SPRITES.length];

  return {
    dna: '0x' + (v & ((1n << 256n) - 1n)).toString(16).padStart(64, '0'),
    name,
    avatar: spriteObj.img,
    stats,
    combat
  };
}

export function generateRandomDna() {
  let hex = '0x';
  for (let i = 0; i < 64; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

// ============================================================================
// 5. GLOBAL STATE & LANGUAGE CONTROLLER
// ============================================================================

export let currentLang = (typeof localStorage !== 'undefined' && localStorage.getItem('squeek_lang')) || 'en';
if (currentLang !== 'en' && currentLang !== 'vi') currentLang = 'en';

/**
 * Pick the string for the active language. For text built in JS:  L('Connect', 'Kết nối').
 * Static HTML uses paired elements instead — <span data-en>…</span><span data-vi>…</span> —
 * and portal.css hides whichever one does not match <html lang>, so only ONE language is
 * ever on screen. Attributes that CSS cannot hide (option text, placeholder, title) use
 * data-t-en/-vi, data-ph-en/-vi and data-title-en/-vi, swapped by setLanguage().
 * Pages that render text in JS listen for the `squeek:lang` event and re-render.
 */
export const L = (en, vi) => (currentLang === 'vi' ? vi : en);

export function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'vi') lang = 'en';
  currentLang = lang;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('squeek_lang', lang);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;

    // Attribute-level pairs (things CSS cannot hide).
    document.querySelectorAll('[data-t-en]').forEach((el) => {
      const v = el.getAttribute(`data-t-${lang}`); if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-ph-en]').forEach((el) => {
      const v = el.getAttribute(`data-ph-${lang}`); if (v != null) el.setAttribute('placeholder', v);
    });
    document.querySelectorAll('[data-title-en]').forEach((el) => {
      const v = el.getAttribute(`data-title-${lang}`); if (v != null) el.setAttribute('title', v);
    });

    // Update all text nodes with data-i18n
    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    // Update placeholders
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const key = el.getAttribute('data-i18n-ph');
      if (t[key]) el.setAttribute('placeholder', t[key]);
    });

    // Update language toggle buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
      if (btn.getAttribute('data-lang') === lang) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Re-render dynamic components if present
    if (typeof renderCurrentWeapon === 'function') renderCurrentWeapon();
    if (typeof refreshSimulatorText === 'function') refreshSimulatorText();
    window.dispatchEvent(new CustomEvent('squeek:lang', { detail: lang }));
  }
}

// ============================================================================
// 6. INITIALIZERS
// ============================================================================

// Simulator variables
let simInterval = null;
let simProgressInterval = null;
let simCountdownMs = 5000;
let isSimPaused = false;
let currentDnaData = null;
// The engine names each rolled hamster by its NFT sequence number ("Hamster #1042"),
// the same way a minted token is identified on-chain.
let engineTokenNo = 1000 + Math.floor(Math.random() * 500);

export function initDnaAutoSimulator() {
  const container = document.getElementById('autoDnaEngine');
  if (!container) return;

  const hexEl = document.getElementById('engineDnaHex');
  const avatarEl = document.getElementById('engineHamsterImg');
  const nameEl = document.getElementById('engineHamsterName');
  const btnPause = document.getElementById('btnEnginePause');
  const btnRoll = document.getElementById('btnEngineRoll');
  const btnCopy = document.getElementById('btnEngineCopy');
  const countFill = document.getElementById('engineCountdownFill');

  function renderDna(dnaStr) {
    currentDnaData = decodeDna(dnaStr);
    if (hexEl) hexEl.textContent = currentDnaData.dna;
    if (avatarEl) avatarEl.src = currentDnaData.avatar;
    if (nameEl) nameEl.textContent = `Hamster #${engineTokenNo}`;

    const t = TRANSLATIONS[currentLang];
    const s = currentDnaData.stats;
    const c = currentDnaData.combat;

    updateBar('str', s.str, `+${c.damageMultiplier - 100}% ${t.dna_hint_str}`);
    updateBar('agi', s.agi, `${c.moveSpeed} u/s · ${c.dodgeChance}% dodge · +${c.cdReduction}% cdr`);
    updateBar('arm', s.arm, `-${c.armorReduction}% damage taken`);
    updateBar('vit', s.vit, `${c.maxHp} Max HP (+${s.vit * 5})`);
    updateBar('per', s.per, `${c.awarenessRadius}u vision · ${c.aimAccuracy}% aim`);
  }

  function updateBar(key, val, hint) {
    const valEl = document.getElementById(`engVal_${key}`);
    const fillEl = document.getElementById(`engFill_${key}`);
    if (valEl) valEl.textContent = val;
    if (fillEl) {
      const pct = Math.min(100, Math.max(12, Math.round(((val - 4) / 16) * 100)));
      fillEl.style.width = pct + '%';
    }
  }

  window.refreshSimulatorText = () => {
    if (currentDnaData) renderDna(currentDnaData.dna);
    if (btnPause) btnPause.textContent = TRANSLATIONS[currentLang][isSimPaused ? 'btn_resume' : 'btn_pause'];
  };

  function rollNew() {
    engineTokenNo += 1;
    renderDna(generateRandomDna());
    simCountdownMs = 5000;
  }

  // Initial roll
  rollNew();

  // 5-second countdown timer
  const TICK_MS = 100;
  clearInterval(simInterval);
  simInterval = setInterval(() => {
    if (!isSimPaused) {
      simCountdownMs -= TICK_MS;
      if (simCountdownMs <= 0) {
        rollNew();
      }
      if (countFill) {
        const pct = Math.max(0, Math.min(100, (simCountdownMs / 5000) * 100));
        countFill.style.width = pct + '%';
      }
    }
  }, TICK_MS);

  if (btnPause) {
    btnPause.addEventListener('click', () => {
      isSimPaused = !isSimPaused;
      const t = TRANSLATIONS[currentLang];
      btnPause.textContent = isSimPaused ? t.btn_resume : t.btn_pause;
    });
  }

  if (btnRoll) {
    btnRoll.addEventListener('click', rollNew);
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (currentDnaData && navigator.clipboard) {
        navigator.clipboard.writeText(currentDnaData.dna);
        const t = TRANSLATIONS[currentLang];
        btnCopy.textContent = t.btn_copied;
        setTimeout(() => { btnCopy.textContent = t.btn_copy; }, 1800);
      }
    });
  }
}

// Armory Initializer (NO TIERS!)
let currentSelectedWeaponId = 'sword';
let renderCurrentWeapon = null;

export function initArmory() {
  const grid = document.getElementById('armoryGrid');
  const detail = document.getElementById('weaponDetail');
  if (!grid || !detail) return;

  function renderList() {
    grid.innerHTML = WEAPONS_DATA.map(w => {
      const wName = w.name[currentLang] || w.name.en;
      const wType = w.type[currentLang] || w.type.en;
      return `
        <div class="weapon-card ${w.id === currentSelectedWeaponId ? 'active' : ''}" data-id="${w.id}">
          <img src="${w.icon}" alt="${wName}" class="wp-icon" />
          <div class="wp-name">${wName}</div>
          <div class="wp-type-badge">${wType}</div>
        </div>
      `;
    }).join('');
  }

  renderCurrentWeapon = function() {
    const w = WEAPONS_DATA.find(x => x.id === currentSelectedWeaponId) || WEAPONS_DATA[0];
    const t = TRANSLATIONS[currentLang];
    const wName = w.name[currentLang] || w.name.en;
    const wType = w.type[currentLang] || w.type.en;
    const wRole = w.role[currentLang] || w.role.en;
    const wPerk = w.perk[currentLang] || w.perk.en;

    detail.innerHTML = `
      <div>
        <div class="detail-header">
          <img src="${w.icon}" alt="${wName}" />
          <div class="detail-header-info">
            <span class="badge badge-cyan">${wType}</span>
            <h3>${wName}</h3>
            <p>${wRole}</p>
          </div>
        </div>

        <div class="detail-stats-list">
          <div class="detail-stat-row">
            <span class="label">${t.armory_lbl_type}:</span>
            <span class="val">${wType}</span>
          </div>
          <div class="detail-stat-row">
            <span class="label">${t.armory_lbl_damage}:</span>
            <span class="val" style="color:var(--gold)">${w.damage} HP</span>
          </div>
          <div class="detail-stat-row">
            <span class="label">${t.armory_lbl_cooldown}:</span>
            <span class="val">${w.cooldown}s</span>
          </div>
          <div class="detail-stat-row">
            <span class="label">${t.armory_lbl_range}:</span>
            <span class="val">${w.range}u</span>
          </div>
          <div class="detail-stat-row">
            <span class="label">${t.armory_lbl_speed}:</span>
            <span class="val">${w.speed > 0 ? w.speed + ' u/s' : t.armory_lbl_instant}</span>
          </div>
          ${w.stun > 0 ? `
          <div class="detail-stat-row">
            <span class="label">${t.armory_lbl_stun}:</span>
            <span class="val" style="color:var(--neon-pink)">${w.stun * 0.05}s (${w.stun} ticks)</span>
          </div>` : ''}
        </div>
      </div>

      <div class="detail-perk-box">
        <h5>⚡ ${t.armory_lbl_perk}:</h5>
        <p>${wPerk}</p>
      </div>
    `;
    renderList();
  };

  renderCurrentWeapon();

  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.weapon-card');
    if (!card) return;
    currentSelectedWeaponId = card.getAttribute('data-id');
    renderCurrentWeapon();
  });
}

// Whitepaper Scrollspy
let tocInitDone = false;
export function initWhitepaperTOC() {
  const searchInput = document.getElementById('tocSearch');
  if (!document.querySelector('.toc-item a') || !document.querySelector('.wp-section')) return;
  if (tocInitDone) return;
  tocInitDone = true;

  window.addEventListener('scroll', () => {
    let currentId = '';
    const scrollPos = window.scrollY + 130;
    // Sections of the language not on screen are display:none (offsetParent null) — skip them.
    document.querySelectorAll('.wp-section').forEach(sec => {
      if (sec.offsetParent !== null && sec.offsetTop <= scrollPos) currentId = sec.getAttribute('id');
    });

    document.querySelectorAll('.toc-item a').forEach(link => {
      const item = link.parentElement;
      if (link.getAttribute('href') === `#${currentId}`) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('.toc-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? 'block' : 'none';
      });
    });
  }
}

// Global Nav Setup
export function initGlobalNav() {
  // Setup language toggle buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      setLanguage(lang);
    });
  });

  // Mobile menu toggle
  const mobileToggle = document.querySelector('.mobile-nav-toggle');
  const navMenu = document.querySelector('.nav-menu');
  if (mobileToggle && navMenu) {
    mobileToggle.addEventListener('click', () => {
      navMenu.classList.toggle('open');
    });
  }
  initNavFit();

  // Set initial language
  setLanguage(currentLang);
}

/**
 * The top nav is one row that must fit the screen: its content changes with the language and
 * with what the page shows in it (account pill, claim button). When it does not fit, drop the
 * brand words first (.nav-tight), then fold the menu into ☰ (.nav-fold).
 */
function initNavFit() {
  const nav = document.querySelector('.site-nav');
  const row = nav && nav.querySelector(':scope > .container');
  if (!row) return;
  let busy = false;
  const overflows = () => row.scrollWidth > row.clientWidth + 1;
  const fit = () => {
    if (busy) return;
    busy = true;
    nav.classList.remove('nav-tight', 'nav-fold');
    if (overflows()) nav.classList.add('nav-tight');
    if (overflows()) nav.classList.add('nav-fold');
    if (!nav.classList.contains('nav-fold')) nav.querySelector('.nav-menu')?.classList.remove('open');
    busy = false;
  };
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('squeek:lang', () => requestAnimationFrame(fit));
  document.fonts?.ready?.then(fit);
  const actions = nav.querySelector('.nav-actions');
  if (actions && window.MutationObserver) {
    new MutationObserver(() => requestAnimationFrame(fit))
      .observe(actions, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  }
}

// Bootstrap
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const initAll = () => {
    initGlobalNav();
    initDnaAutoSimulator();
    initArmory();
    initWhitepaperTOC();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
}


// ============================================================================
// 7. GAMEPLAY HIGHLIGHT REEL (CHAOTIC MULTI-CLIP)
// ============================================================================

export function initGameplayHighlightReel() {
  const canvas = document.getElementById('gameplayPreviewCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const clipTitleEl = document.getElementById('highlightClipTitle');
  const clipDescEl = document.getElementById('highlightClipDesc');
  const clipAliveEl = document.getElementById('highlightAliveBadge');
  const clipZoneEl = document.getElementById('highlightZoneBadge');
  const feedEl = document.getElementById('highlightKillFeed');
  const clipBtns = document.querySelectorAll('.highlight-clip-btn');
  const btnAutoCycle = document.getElementById('btnHighlightAuto');

  // Fighters are named by NFT sequence number (#1042), never by a character name.
  const CLIPS = [
    {
      id: 0,
      title: { en: 'Clip #1 · Early Loot Scramble', vi: 'Clip #1 · Hỗn Chiến Lượm Vũ Khí Đầu Trận' },
      desc: {
        en: '14 hamsters just parachuted in bare-pawed and rush for Swords, Battle Axes, Hammers and Crossbows in a bloody opening brawl!',
        vi: '14 Hamster vừa bung dù đáp đất tay không, lao vào tranh giành Kiếm, Rìu Chiến, Búa Tạ và Nỏ Săn tạo nên pha hỗn chiến đẫm máu!',
      },
      alive: 84, phase: 1, radius: '3,800u',
      zoneR: 320,
      stormIntensity: 0.25,
      fighterCount: 12,
    },
    {
      id: 1,
      title: { en: 'Clip #2 · Crown Holder Bounty Brawl', vi: 'Clip #2 · Săn Lùng Vua Giữ Vương Miện' },
      desc: {
        en: 'Hamster #1042 holds the First Blood Crown (×2 live points per second) and is surrounded by 10 hamsters piling on damage to steal the throne and a full 100% HP heal!',
        vi: 'Hamster #1042 giữ Vương Miện First Blood (×2 điểm sống/giây) bị 10 Hamster bao vây dồn sát thương để cướp ngôi và hồi 100% HP!',
      },
      alive: 42, phase: 2, radius: '1,850u',
      zoneR: 255,
      stormIntensity: 0.5,
      fighterCount: 11,
    },
    {
      id: 2,
      title: { en: 'Clip #3 · Crossbow & Supply Drop Chaos', vi: 'Clip #3 · Mưa Đạn & Hòm Tiếp Tế' },
      desc: {
        en: 'A supply drop lands in the middle of the zone! Bows, Crossbows and Magic Staffs trade crossfire while a Hammer brawler stuns everyone in reach.',
        vi: 'Hòm tiếp tế rơi giữa tâm bo! Cung Tên, Nỏ Săn và Gậy Phép xả đạn chéo cánh sẻ trong khi Đấu Sĩ Búa Tạ làm choáng hàng loạt.',
      },
      alive: 19, phase: 3, radius: '820u',
      zoneR: 205,
      stormIntensity: 0.72,
      fighterCount: 10,
    },
    {
      id: 3,
      title: { en: 'Clip #4 · Final Circle Cat Storm Clash', vi: 'Clip #4 · Vòng Bo Mèo Bão Tử Thần' },
      desc: {
        en: 'The zone has shrunk to 150u under the glowing eyes of the giant cat (45 DPS)! The last fighters battle it out for a single champion!',
        vi: 'Vòng bo thu hẹp còn 150u với mắt mèo khổng lồ rực sáng (45 DPS)! Những chiến binh cuối cùng quyết tử tìm ra nhà vô địch duy nhất!',
      },
      alive: 5, phase: 0, radius: '150u',
      zoneR: 150,
      stormIntensity: 0.95,
      fighterCount: 7,
    },
  ];
  const clipAlive = (c) => `${c.alive} / 100 ${L('ALIVE', 'CÒN SỐNG')}`;
  const clipZone = (c) => (c.phase ? `${L('PHASE', 'GIAI ĐOẠN')} ${c.phase}` : L('SUDDEN DEATH', 'ĐỐI ĐẦU CUỐI')) + ` · ${c.radius}`;
  const autoLabel = () => (autoCycle ? L('🔁 Auto-Highlight: ON', '🔁 Tự động chuyển clip: BẬT') : L('⏸ Auto-Highlight: PAUSED', '⏸ Tự động chuyển clip: TẠM DỪNG'));

  // Preload hamster sprites & weapon icons
  const spriteImgs = UNARMED_SPRITES.map((s) => {
    const im = new Image();
    im.src = s.img;
    return { im };
  });
  const weaponImgs = WEAPONS_DATA.map((w) => {
    const im = new Image();
    im.src = w.icon;
    return { im, names: w.name, id: w.id, dmg: w.damage, range: w.range };
  });

  let activeClipIdx = 0;
  let autoCycle = true;
  let clipTimer = 0;
  const CLIP_DURATION = 420; // ~7 seconds at 60fps
  let fighters = [];
  let projectiles = [];
  let sparks = [];
  let floatTexts = [];
  let slashArcs = [];
  let feedLogs = [];

  // Feed entries are kept as data and rendered in the current language, so switching
  // EN/VI re-renders the whole feed instead of leaving old lines in the other language.
  const feedLine = (f) => `${f.isCrown ? L('👑 [CROWN STOLEN] ', '👑 [CƯỚP VƯƠNG MIỆN] ') : '⚔️ '}`
    + `<b style="color:var(--gold)">${f.killer}</b> ${L('eliminated', 'hạ')} <b style="color:#ff9ec3">${f.victim}</b> `
    + `${L('with', 'bằng')} <span style="color:var(--neon-cyan)">${f.weapon[currentLang] || f.weapon.en}</span>`;
  function renderFeed() {
    if (feedEl) feedEl.innerHTML = feedLogs.map((f) => `<div class="killfeed-item">${feedLine(f)}</div>`).join('');
  }
  function pushFeed(killer, victim, weaponNames, isCrown) {
    feedLogs.unshift({ killer, victim, weapon: weaponNames, isCrown });
    if (feedLogs.length > 6) feedLogs.pop();
    renderFeed();
  }
  function renderClipText() {
    const clip = CLIPS[activeClipIdx];
    if (clipTitleEl) clipTitleEl.textContent = clip.title[currentLang] || clip.title.en;
    if (clipDescEl) clipDescEl.textContent = clip.desc[currentLang] || clip.desc.en;
    if (clipAliveEl) clipAliveEl.textContent = clipAlive(clip);
    if (clipZoneEl) clipZoneEl.textContent = clipZone(clip);
    if (btnAutoCycle) btnAutoCycle.textContent = autoLabel();
  }
  window.addEventListener('squeek:lang', () => { renderClipText(); renderFeed(); });

  function spawnClip(idx) {
    activeClipIdx = idx % CLIPS.length;
    const clip = CLIPS[activeClipIdx];
    clipTimer = 0;
    projectiles = [];
    sparks = [];
    floatTexts = [];
    slashArcs = [];

    renderClipText();

    clipBtns.forEach((btn, i) => btn.classList.toggle('active', i === activeClipIdx));

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    fighters = [];
    for (let i = 0; i < clip.fighterCount; i++) {
      const ang = (i / clip.fighterCount) * Math.PI * 2 + (Math.random() * 0.4);
      const dist = 40 + Math.random() * (clip.zoneR * 0.72);
      const sp = spriteImgs[i % spriteImgs.length];
      const wp = weaponImgs[(i * 3 + activeClipIdx) % weaponImgs.length];
      fighters.push({
        id: i,
        name: `#${1042 + i * 37}`,
        sprite: sp.im,
        weapon: wp,
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        vx: (Math.random() - 0.5) * 2.5,
        vy: (Math.random() - 0.5) * 2.5,
        hp: 100,
        maxHp: 100,
        isKing: i === 0,
        atkCd: Math.floor(Math.random() * 25),
        facing: Math.cos(ang) < 0 ? 1 : -1,
        flash: 0,
      });
    }

    feedLogs = [];
    pushFeed(fighters[0].name, '#1517', fighters[0].weapon.names, true);
    pushFeed(fighters[1].name, '#1388', fighters[1].weapon.names, false);
  }

  clipBtns.forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      spawnClip(idx);
    });
  });

  if (btnAutoCycle) {
    btnAutoCycle.addEventListener('click', () => {
      autoCycle = !autoCycle;
      btnAutoCycle.textContent = autoLabel();
    });
  }

  spawnClip(0);

  function stepAndRender() {
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const clip = CLIPS[activeClipIdx];

    clipTimer++;
    if (autoCycle && clipTimer >= CLIP_DURATION) {
      spawnClip((activeClipIdx + 1) % CLIPS.length);
    }

    // 1. Draw Arena Turf Background
    const bgGrad = ctx.createRadialGradient(cx, cy, 40, cx, cy, W * 0.65);
    bgGrad.addColorStop(0, '#273b24');
    bgGrad.addColorStop(0.65, '#1b2919');
    bgGrad.addColorStop(1, '#120b1d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle arena grid rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let r = 70; r <= 340; r += 65) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. Shrinking Safe Zone & Cat Storm Overlay outside
    const curZoneR = Math.max(95, clip.zoneR - (clipTimer / CLIP_DURATION) * 38);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, curZoneR, 0, Math.PI * 2, true);
    ctx.fillStyle = `rgba(145, 24, 92, ${0.28 + clip.stormIntensity * 0.25})`;
    ctx.fill();
    ctx.restore();

    // Glowing Zone Ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, curZoneR, 0, Math.PI * 2);
    ctx.strokeStyle = clip.stormIntensity > 0.7 ? '#ff3366' : '#00f2fe';
    ctx.lineWidth = 3;
    ctx.shadowColor = clip.stormIntensity > 0.7 ? '#ff3366' : '#00f2fe';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

    // Cat Storm menacing eyes in corners
    const eyePositions = [
      [75, 65], [W - 75, 65], [85, H - 65], [W - 85, H - 65],
    ];
    eyePositions.forEach(([ex, ey], idx) => {
      const pulse = 0.6 + 0.4 * Math.sin(clipTimer * 0.08 + idx);
      ctx.save();
      ctx.fillStyle = `rgba(255, 200, 60, ${0.45 * pulse})`;
      ctx.beginPath();
      ctx.ellipse(ex - 12, ey, 8, 4, -0.2, 0, Math.PI * 2);
      ctx.ellipse(ex + 12, ey, 8, 4, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 3. Update & Draw Fighters
    for (let i = 0; i < fighters.length; i++) {
      const f = fighters[i];
      // Find nearest target
      let nearest = null;
      let bestD = Infinity;
      for (let j = 0; j < fighters.length; j++) {
        if (i === j) continue;
        const o = fighters[j];
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d < bestD) { bestD = d; nearest = o; }
      }

      if (nearest) {
        const dx = nearest.x - f.x;
        const dy = nearest.y - f.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const distCenter = Math.hypot(f.x - cx, f.y - cy);
        if (distCenter > curZoneR - 24) {
          f.vx += ((cx - f.x) / distCenter) * 0.45;
          f.vy += ((cy - f.y) / distCenter) * 0.45;
        } else if (d > 58) {
          f.vx += (dx / d) * 0.32;
          f.vy += (dy / d) * 0.32;
        } else {
          f.vx += (-dy / d) * 0.25 + (Math.random() - 0.5) * 0.5;
          f.vy += (dx / d) * 0.25 + (Math.random() - 0.5) * 0.5;
        }
        f.facing = dx >= 0 ? 1 : -1;

        if (f.atkCd > 0) f.atkCd--;
        const isRanged = f.weapon.range > 100;
        const atkRange = isRanged ? 190 : 68;
        if (f.atkCd <= 0 && d <= atkRange) {
          f.atkCd = isRanged ? 26 : 18;
          if (isRanged) {
            projectiles.push({
              x: f.x,
              y: f.y - 6,
              vx: (dx / d) * 7.5,
              vy: (dy / d) * 7.5,
              owner: f,
              color: f.weapon.id === 'magic_staff' ? '#c28aff' : '#ffe57f',
              life: 35,
            });
          } else {
            slashArcs.push({
              x: f.x + (dx / d) * 20,
              y: f.y + (dy / d) * 20,
              ang: Math.atan2(dy, dx),
              life: 8,
              color: f.isKing ? '#f8c84d' : '#00f2fe',
            });
            hitTarget(f, nearest, 14 + Math.floor(Math.random() * 16));
          }
        }
      }

      const spd = Math.hypot(f.vx, f.vy);
      if (spd > 2.9) {
        f.vx = (f.vx / spd) * 2.9;
        f.vy = (f.vy / spd) * 2.9;
      }
      f.x += f.vx;
      f.y += f.vy;
      if (f.flash > 0) f.flash--;
    }

    // 4. Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;

      ctx.save();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6);
      ctx.stroke();
      ctx.restore();

      let hit = false;
      for (const f of fighters) {
        if (f === p.owner) continue;
        if (Math.hypot(f.x - p.x, f.y - p.y) < 22) {
          hitTarget(p.owner, f, 12 + Math.floor(Math.random() * 14));
          hit = true;
          break;
        }
      }
      if (hit || p.life <= 0) projectiles.splice(i, 1);
    }

    // 5. Draw Slash Arcs
    for (let i = slashArcs.length - 1; i >= 0; i--) {
      const s = slashArcs[i];
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3.5;
      ctx.globalAlpha = s.life / 8;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 24, s.ang - 0.85, s.ang + 0.85);
      ctx.stroke();
      ctx.restore();
      s.life--;
      if (s.life <= 0) slashArcs.splice(i, 1);
    }

    // 6. Render Fighters (sorted by Y)
    const sortedFighters = [...fighters].sort((a, b) => a.y - b.y);
    for (const f of sortedFighters) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 18, 16, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      if (f.isKing) {
        ctx.strokeStyle = 'rgba(248, 200, 77, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 26, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (f.sprite && f.sprite.complete && f.sprite.naturalWidth > 0) {
        ctx.save();
        ctx.translate(f.x, f.y);
        if (f.facing < 0) ctx.scale(-1, 1);
        if (f.flash > 0) ctx.filter = 'brightness(2.1) contrast(1.2)';
        ctx.drawImage(f.sprite, -24, -24, 48, 48);
        ctx.restore();
      } else {
        ctx.fillStyle = f.isKing ? '#f8c84d' : '#00f2fe';
        ctx.beginPath();
        ctx.arc(f.x, f.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }

      if (f.weapon?.im?.complete && f.weapon.im.naturalWidth > 0) {
        ctx.drawImage(f.weapon.im, f.x + (f.facing > 0 ? 10 : -28), f.y - 8, 20, 20);
      }

      if (f.isKing) {
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('👑', f.x, f.y - 32);
      }

      const bw = 34;
      const bh = 4;
      const bx = f.x - bw / 2;
      const by = f.y - 27;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(bx, by, bw, bh);
      const hpRatio = Math.max(0, f.hp / f.maxHp);
      ctx.fillStyle = hpRatio > 0.5 ? '#4cd97b' : hpRatio > 0.25 ? '#f8c84d' : '#ff3366';
      ctx.fillRect(bx, by, bw * hpRatio, bh);

      ctx.restore();
    }

    // 7. Sparks & Floating Damage Numbers
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.life--;
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = Math.max(0, sp.life / 14);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (sp.life <= 0) sparks.splice(i, 1);
    }

    for (let i = floatTexts.length - 1; i >= 0; i--) {
      const ft = floatTexts[i];
      ft.y -= 0.85;
      ft.life--;
      ctx.save();
      ctx.font = '800 12px "JetBrains Mono", monospace';
      ctx.fillStyle = ft.color;
      ctx.globalAlpha = Math.max(0, ft.life / 24);
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
      if (ft.life <= 0) floatTexts.splice(i, 1);
    }

    requestAnimationFrame(stepAndRender);
  }

  function hitTarget(attacker, victim, dmg) {
    victim.hp -= dmg;
    victim.flash = 4;
    for (let k = 0; k < 5; k++) {
      sparks.push({
        x: victim.x,
        y: victim.y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        life: 12,
        color: attacker.isKing ? '#f8c84d' : '#ff3366',
      });
    }
    floatTexts.push({
      x: victim.x + (Math.random() - 0.5) * 14,
      y: victim.y - 24,
      text: `-${dmg}`,
      color: dmg >= 22 ? '#f8c84d' : '#ff8a98',
      life: 24,
    });

    if (victim.hp <= 0) {
      const stoleCrown = victim.isKing;
      if (stoleCrown) {
        victim.isKing = false;
        attacker.isKing = true;
        attacker.hp = attacker.maxHp;
        floatTexts.push({
          x: attacker.x,
          y: attacker.y - 36,
          text: L('👑 CROWN + 100% HP!', '👑 VƯƠNG MIỆN + 100% HP!'),
          color: '#f8c84d',
          life: 32,
        });
      }
      pushFeed(attacker.name, victim.name, attacker.weapon.names, stoleCrown);
      const rect = canvas.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < window.innerHeight) {
        squeekAudio.playSfx(stoleCrown ? 'crown' : 'kill', { vol: 0.45 });
      }
      const ang = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 110;
      victim.x = canvas.width / 2 + Math.cos(ang) * r;
      victim.y = canvas.height / 2 + Math.sin(ang) * r;
      victim.hp = victim.maxHp;
    }
  }

  requestAnimationFrame(stepAndRender);
}

// ============================================================================
// 8. HAMSTER COLLECTION SHOWCASE & DYNAMIC WHITEPAPER.MD RENDERER
// ============================================================================

export async function initLandingCollectionShowcase() {
  const container = document.getElementById('landingNftCollectionGrid');
  if (!container) return;
  try {
    const [{ buildShowcaseHamsters, renderNftCardHtml }, { AssetLibrary }] = await Promise.all([
      import('./nft-cards.js'),
      import('../render/assets.js'),
    ]);
    const assets = new AssetLibrary();
    const showcase = buildShowcaseHamsters();
    await assets.loadHamsterLayers(showcase.map((h) => h.appearance));
    const render = () => {
      container.innerHTML = showcase.map((h) => renderNftCardHtml(h, { selectable: false })).join('');
      for (const cv of container.querySelectorAll('canvas[data-sprite]')) {
        const h = showcase.find((x) => x.id === cv.dataset.sprite);
        if (h) cv.getContext('2d').drawImage(assets.spriteFor(h.appearance, false, -1, false), 0, 0);
      }
    };
    render();
    // nft-cards.js picks its labels with L(); redraw the cards in the new language.
    window.addEventListener('squeek:lang', render);
  } catch (e) {
    console.warn('Landing NFT collection showcase skipped:', e);
  }
}

export async function initWhitepaperMarkdownLoader() {
  const mdContainer = document.getElementById('whitepaperMdContent');
  const tocList = document.getElementById('tocList');
  if (!mdContainer) return;

  try {
    // One whitepaper per language: whitepaper.md (Vietnamese) and whitepaper.en.md (English).
    // Each is split at its "## " headings into sections; the table of contents is built from them.
    const load = async (file) => {
      const res = await fetch(file, { cache: 'no-store' });
      return res.ok ? res.text() : '';
    };
    const parse = (md, lang) => {
      const sections = [];
      let cur = null;
      for (const line of md.split(/\r?\n/)) {
        const h2Match = line.match(/^##\s+(.+)$/);
        if (h2Match) {
          if (cur) sections.push(cur);
          cur = { id: `wp-${lang}-${sections.length + 1}`, lang, title: h2Match[1].trim(), lines: [] };
        } else if (cur) {
          cur.lines.push(line);
        }
      }
      if (cur) sections.push(cur);
      return sections;
    };
    const [vi, en] = await Promise.all([load('whitepaper.md'), load('whitepaper.en.md')]);
    const sections = [...parse(vi, 'vi'), ...parse(en, 'en')];
    if (!sections.length) return;

    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inlineMd = (s) => escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^)\s]*)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

    const renderSectionBody = (secLines) => {
      let html = '';
      let inCode = false;
      let codeBuf = [];
      let inTable = false;
      let tableRows = [];
      let inList = false;

      const flushTable = () => {
        if (!inTable) return;
        inTable = false;
        if (tableRows.length >= 2) {
          const headCells = tableRows[0].split('|').slice(1, -1).map((c) => `<th>${inlineMd(c.trim())}</th>`).join('');
          const bodyRows = tableRows.slice(2).map((r) => {
            const cells = r.split('|').slice(1, -1).map((c) => `<td>${inlineMd(c.trim())}</td>`).join('');
            return `<tr>${cells}</tr>`;
          }).join('');
          html += `<div class="wp-table-wrap"><table class="wp-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
        }
        tableRows = [];
      };

      const flushList = () => {
        if (inList) { html += '</ul>'; inList = false; }
      };

      for (const raw of secLines) {
        if (raw.trim().startsWith('```')) {
          flushTable();
          flushList();
          if (!inCode) {
            inCode = true;
            codeBuf = [];
          } else {
            inCode = false;
            html += `<pre class="code-block">${escapeHtml(codeBuf.join('\n'))}</pre>`;
          }
          continue;
        }
        if (inCode) {
          codeBuf.push(raw);
          continue;
        }

        const t = raw.trim();
        if (!t || t === '---') {
          flushTable();
          flushList();
          continue;
        }

        if (t.startsWith('|') && t.endsWith('|')) {
          flushList();
          inTable = true;
          tableRows.push(t);
          continue;
        } else {
          flushTable();
        }

        if (t.startsWith('### ')) {
          flushList();
          html += `<h3>${inlineMd(t.slice(4))}</h3>`;
        } else if (t.startsWith('#### ')) {
          flushList();
          html += `<h4 style="color:var(--neon-cyan);margin:16px 0 8px;">${inlineMd(t.slice(5))}</h4>`;
        } else if (t.startsWith('> ')) {
          flushList();
          html += `<div class="wp-callout">${inlineMd(t.slice(2))}</div>`;
        } else if (t.startsWith('- ') || t.startsWith('* ')) {
          if (!inList) {
            inList = true;
            html += '<ul style="padding-left:20px;margin-bottom:14px;color:var(--text);line-height:1.75;">';
          }
          html += `<li>${inlineMd(t.slice(2))}</li>`;
        } else {
          flushList();
          html += `<p>${inlineMd(t)}</p>`;
        }
      }
      flushTable();
      flushList();
      return html;
    };

    // Only the reader's language is on screen: sections carry data-vi / data-en like the page.
    mdContainer.innerHTML = sections.map((sec) => `
      <div class="wp-section" id="${sec.id}" data-${sec.lang}>
        <h2>${escapeHtml(sec.title)}</h2>
        ${renderSectionBody(sec.lines)}
      </div>
    `).join('');

    if (tocList) {
      tocList.innerHTML = sections.map((sec) => `
        <li class="toc-item" data-${sec.lang}>
          <a href="#${sec.id}">${escapeHtml(sec.title)}</a>
        </li>
      `).join('');
      initWhitepaperTOC();
    }
  } catch (err) {
    // Fallback to static embedded whitepaper sections already in DOM
  }
}

// Run extra initializers on boot
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const initExtra = () => {
    const audioBtn = document.getElementById('btnAudioToggle');
    if (audioBtn) squeekAudio.bindButton(audioBtn);
    if (document.getElementById('gameplayPreviewCanvas')) {
      squeekAudio.startBgm('portal');
    }
    initGameplayHighlightReel();
    initLandingCollectionShowcase();
    initWhitepaperMarkdownLoader();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExtra);
  } else {
    initExtra();
  }
}
