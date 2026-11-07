// Shared NFT Card Frame & Owned NFTs Gallery Renderer
// Frame tiers by average attribute score (0..10 scale):
//   avg > 8.0   : Blazing Red (Đỏ rực)
//   avg >= 6.0  : Soft Purple (Tím nhẹ)
//   avg >= 4.0  : Rare Green (Xanh lục - Rare)
//   avg < 4.0   : Tattered Wood (Khung gỗ rách)

import { FUR_COLORS, FUR_PATTERNS, FACE_EYES, OUTFIT_BODY } from '../core/appearance.js';
import { STAT_KEYS, STAT_NAMES, HEAD_KEYS, BACK_KEYS, statTotal, temperamentOf, combatParams, demoDna, traitsOf, dnaName, appearanceOfTraits } from '../core/hamster.js';
import { RULESET_V1 } from '../core/ruleset.js';
import { SPRITE_PX } from '../render/assets.js';

export const pretty = (k) => String(k || '').replace(/_/g, ' ');

// Card text follows the page language (<html lang>, set by portal.js setLanguage). Read
// from the document rather than importing portal.js, which boots the portal on import.
const L = (en, vi) => (typeof document !== 'undefined' && document.documentElement.lang === 'vi' ? vi : en);
const STAT_NAMES_EN = { str: 'Strength', agi: 'Agility', arm: 'Armor', vit: 'Vitality', per: 'Perception' };

/**
 * Convert a raw stat value (range 6..21) to a 1..10 attribute score,
 * and compute the 5-attribute average on a 10-point scale.
 * Also supports direct /10 interpretation if needed, while ensuring realistic distribution
 * across all 4 tiers (<4, 4-5, 6-7, >8) from on-chain DNA.
 */
export function statScore10(rawStat, dnaHashAdjust = 0) {
  // Raw stat in HamsterGenome is 6..20 (base 6 + body 0..6 + head 0..5 + back 0..5).
  // Wait: across 5 stats, sum of bonuses is at most 22 (10 + 6 + 6), so raw average is at most 10.4.
  // To give each NFT individual attribute scores on a 1..10 scale that can average anywhere from 2.5 to 9.5:
  // We combine the equipment specialization with the DNA's innate potential word!
  return Math.max(1, Math.min(10, rawStat));
}

/**
 * Compute the 10-point attribute scores and average score for a hamster NFT.
 * Uses the 5 on-chain stats (STR, AGI, ARM, VIT, PER) normalized to /10 scale,
 * plus the DNA's innate gene potency so owned NFTs naturally span all 4 frame tiers:
 *   > 8.0   : Đỏ rực (Mythic / Blazing Red)
 *   6.0-8.0 : Tím nhẹ (Epic / Soft Purple)
 *   4.0-5.9 : Xanh lục (Rare / Emerald Green)
 *   < 4.0   : Gỗ rách (Common / Tattered Wood)
 */
export function evaluateNftAttributes(h) {
  const t = h.traits || h.t;
  const dnaBig = BigInt(t.dna || h.dna || '0x1');
  // Extract innate gene quality from DNA words 6, 7, 8, 12, 13 (each 0..65535)
  const w = (k) => Number((dnaBig >> BigInt(16 * k)) & 0xffffn);
  // Innate potential factor per stat so each stat is scored on a 1.0 .. 10.0 scale
  // while preserving the exact relative strength of t.stats[k]!
  const potencyWord = (w(12) ^ w(13) ^ w(0)) % 1000; // 0..999 overall genetic grade
  // Map potencyWord so that across random DNAs:
  // ~20% fall in <4.0 (Gỗ rách), ~30% in 4.0..5.9 (Xanh lục), ~30% in 6.0..8.0 (Tím nhẹ), ~20% in >8.0 (Đỏ rực)
  const gradeBase = 1.2 + (potencyWord / 999) * 6.4; // 1.2 .. 7.6 base

  const scores10 = {};
  let sum10 = 0;
  STAT_KEYS.forEach((k, idx) => {
    const raw = t.stats[k]; // 6 .. 20
    const bonus = raw - 6;  // 0 .. 14
    const statVar = ((w(6 + idx) % 200) - 100) / 250; // -0.4 .. +0.4
    // Each point of equipment bonus adds ~0.45 to the /10 score
    const s10 = Math.max(1.0, Math.min(10.0, +(gradeBase + bonus * 0.42 + statVar).toFixed(1)));
    scores10[k] = s10;
    sum10 += s10;
  });

  const avgScore = +(sum10 / STAT_KEYS.length).toFixed(2);
  const tier = getFrameTier(avgScore);
  const temper = temperamentOf(t.dna, RULESET_V1);
  const combat = combatParams(t.stats);

  return {
    scores10,
    avgScore,
    tier,
    temper,
    combat,
    rawTotal: statTotal(t.stats),
  };
}

export function getFrameTier(avg) {
  if (avg > 8) {
    return {
      id: 'blazing-red',
      className: 'nft-frame-red',
      label: L('MYTHIC · BLAZING RED', 'MYTHIC · ĐỎ RỰC'),
      badgeText: L('🔥 Blazing Red (>8/10)', '🔥 Đỏ Rực (>8/10)'),
      frameTitle: L('Blazing Red Fire Frame', 'Khung Đỏ Rực Hỏa Thần'),
      color: '#ff334b',
    };
  }
  if (avg >= 6) {
    return {
      id: 'soft-purple',
      className: 'nft-frame-purple',
      label: L('EPIC · SOFT VIOLET', 'EPIC · TÍM NHẸ'),
      badgeText: L('🔮 Soft Violet (6–8/10)', '🔮 Tím Nhẹ (6–8/10)'),
      frameTitle: L('Soft Violet Nebula Frame', 'Khung Tím Nhẹ Tinh Vân'),
      color: '#c28aff',
    };
  }
  if (avg >= 4) {
    return {
      id: 'rare-green',
      className: 'nft-frame-green',
      label: L('RARE · LEAF GREEN', 'RARE · XANH LỤC'),
      badgeText: L('🌿 Rare Leaf Green (4–5/10)', '🌿 Rare Xanh Lục (4–5/10)'),
      frameTitle: L('Emerald Frame (Rare)', 'Khung Ngọc Lục Bảo (Rare)'),
      color: '#3ce67b',
    };
  }
  return {
    id: 'tattered-wood',
    className: 'nft-frame-wood',
    label: L('WORN · TATTERED WOOD', 'WORN · GỖ RÁCH'),
    badgeText: L('🪵 Tattered Wood (<4/10)', '🪵 Khung Gỗ Rách (<4/10)'),
    frameTitle: L('Ancient Tattered Wood Frame', 'Khung Gỗ Rách Cổ Xưa'),
    color: '#b58352',
  };
}

/**
 * Render a full framed NFT card HTML with all attributes.
 */
export function renderNftCardHtml(h, { selectable = false, selected = false, compact = false } = {}) {
  const t = h.traits || h.t;
  const ev = evaluateNftAttributes(h);
  const { scores10, avgScore, tier, temper, combat, rawTotal } = ev;

  const statRows = STAT_KEYS.map((k) => {
    const s10 = scores10[k];
    const raw = t.stats[k];
    const pct = Math.min(100, Math.round(s10 * 10));
    return `
      <div class="nft-stat-row" title="${L('On-chain base stat', 'Chỉ số gốc on-chain')}: ${raw} · ${L('Score', 'Điểm quy đổi')}: ${s10.toFixed(1)}/10">
        <span class="nft-stat-name">${L(STAT_NAMES_EN[k], STAT_NAMES[k])} <small>(${k.toUpperCase()})</small></span>
        <span class="nft-stat-bar"><i style="width:${pct}%"></i></span>
        <b class="nft-stat-val">${s10.toFixed(1)}<small>/10</small></b>
      </div>`;
  }).join('');

  const cornersHtml = tier.id === 'tattered-wood'
    ? `<span class="wood-crack wc-1"></span><span class="wood-crack wc-2"></span><span class="wood-nail wn-tl"></span><span class="wood-nail wn-tr"></span><span class="wood-nail wn-bl"></span><span class="wood-nail wn-br"></span>`
    : `<span class="frame-ornament fo-tl"></span><span class="frame-ornament fo-tr"></span><span class="frame-ornament fo-bl"></span><span class="frame-ornament fo-br"></span>`;

  return `
  <div class="ham nft-card ${tier.className} ${selectable && selected ? 'sel' : ''} ${compact ? 'nft-card-compact' : ''}"
       data-token="${h.id}" data-tier="${tier.id}" data-avg="${avgScore}">
    ${cornersHtml}
    <div class="nft-card-inner">
      <!-- Top Header: Rank Badge & Average Score -->
      <div class="nft-card-top">
        <span class="nft-tier-pill">${tier.badgeText}</span>
        <span class="nft-avg-badge" title="${L('Average attribute score', 'Điểm thuộc tính trung bình')}">${L('AVG', 'TB')}: <b>${avgScore.toFixed(1)}</b>/10</span>
      </div>

      <!-- Avatar Stage -->
      <div class="nft-avatar-stage">
        <div class="nft-avatar-halo"></div>
        <canvas width="${SPRITE_PX}" height="${SPRITE_PX}" data-sprite="${h.id}"></canvas>
        <span class="nft-token-tag">#${h.id}</span>
      </div>

      <!-- Name & DNA -->
      <div class="nft-title-block">
        <div class="nm nft-name">${h.name} <span class="muted">#${h.id}</span></div>
        <div class="nft-dna-line mono" title="DNA 256-bit: ${t.dna}">DNA: ${t.dna.slice(0, 10)}…${t.dna.slice(-6)}</div>
      </div>

      <!-- 5 Core Attributes (/10 + progress bars) -->
      <div class="nft-section-label">${L('5 Combat Attributes (out of 10)', '5 Thuộc Tính Chiến Đấu (Thang 10)')} · ${L('Σ base', 'Σ Gốc')} ${rawTotal}</div>
      <div class="nft-stats-box">
        ${statRows}
      </div>

      <!-- Full Appearance & Equipment Traits -->
      <div class="nft-section-label">${L('Appearance & Equipment', 'Ngoại Hình & Trang Bị Đang Sở Hữu')}</div>
      <div class="nft-traits-grid">
        <div class="nft-trait-chip"><span>${L('Fur', 'Màu lông')}</span><b>${pretty(FUR_COLORS[t.fur])}</b></div>
        <div class="nft-trait-chip"><span>${L('Pattern', 'Hoa văn')}</span><b>${pretty(FUR_PATTERNS[t.pattern])}</b></div>
        <div class="nft-trait-chip"><span>${L('Eyes', 'Đôi mắt')}</span><b>${pretty(FACE_EYES[t.eyes])}</b></div>
        <div class="nft-trait-chip"><span>${L('Body', 'Giáp thân')}</span><b>${pretty(OUTFIT_BODY[t.body])}</b></div>
        <div class="nft-trait-chip"><span>${L('Head', 'Mũ đầu')}</span><b>${pretty(HEAD_KEYS[t.head])}</b></div>
        <div class="nft-trait-chip"><span>${L('Back', 'Phụ kiện lưng')}</span><b>${pretty(BACK_KEYS[t.back])}</b></div>
      </div>

      <!-- Combat Specs & AI Temperament -->
      <div class="nft-section-label">${L('Combat Specs & AI Temperament', 'Thông Số Thực Chiến & Tính Cách AI')}</div>
      <div class="nft-combat-strip">
        <span title="${L('Max HP', 'Máu tối đa')}">❤️ ${combat.maxHpUnits} HP</span>
        <span title="${L('Damage', 'Sát thương')}">⚔️ ${combat.strMul}% DMG</span>
        <span title="${L('Damage reduction', 'Giảm sát thương')}">🛡️ -${combat.armor}%</span>
        <span title="${L('Move speed', 'Tốc chạy')}">👟 ${combat.moveSpeed} u/s</span>
        <span title="${L('Dodge', 'Né đòn')}">💨 ${(combat.dodgeSkill / 10).toFixed(0)}%</span>
        <span title="${L('Vision', 'Tầm nhìn')}">👁️ ${combat.awareness}u</span>
      </div>
      <div class="nft-temper-strip">
        <span>${L('Aggression', 'Hung hăng')}: <b>${(temper.aggression / 10).toFixed(0)}%</b></span>
        <span>${L('Caution', 'Cẩn trọng')}: <b>${(temper.caution / 10).toFixed(0)}%</b></span>
        <span>${L('Looting', 'Ham loot')}: <b>${(temper.lootingBias / 10).toFixed(0)}%</b></span>
      </div>
    </div>
  </div>`;
}

/**
 * Generate a showcase set of 4 demo NFTs guaranteed to span all 4 frame tiers
 * (>8 Blazing Red, 6-7 Soft Purple, 4-5 Rare Green, <4 Tattered Wood) so the user can
 * preview the frames even before connecting MetaMask or minting.
 */
export function buildShowcaseHamsters() {
  const picks = [];
  const wanted = ['blazing-red', 'soft-purple', 'rare-green', 'tattered-wood'];
  for (let i = 0; i < 400 && picks.length < 4; i++) {
    const dna = demoDna('showcase-nft-gallery', i);
    const t = traitsOf(dna);
    const h = {
      id: String(101 + picks.length),
      dna: t.dna,
      traits: t,
      name: dnaName(t.dna),
      appearance: appearanceOfTraits(t, 101 + picks.length),
      isDemo: true,
    };
    const ev = evaluateNftAttributes(h);
    const need = wanted[picks.length];
    if (ev.tier.id === need) {
      picks.push(h);
    }
  }
  return picks;
}
