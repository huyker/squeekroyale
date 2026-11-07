// Seed and Merkle helpers that must hash EXACTLY like SqueekArena.sol (chain/test checks it).
// Shared by the browser (dapp, viewer, admin), the operator and the autopilot.
//
//   seed  = keccak256(abi.encode(blockhash(seedBlock), arenaId, arenaContract, chainId))
//   leaf  = keccak256(bytes.concat(keccak256(abi.encode(uint256 entryIndex, uint32 points))))
//   node  = keccak256(sorted(left, right))           (OpenZeppelin MerkleProof convention)
//   an odd node at the end of a layer is carried up unchanged
import { ethers } from '../vendor/ethers.min.js';

const coder = ethers.AbiCoder.defaultAbiCoder();

/** The arena seed, from the hash of its seed block (what the contract stores). */
export function seedFromBlockHash(blockHash, arenaId, contract, chainId) {
  return ethers.keccak256(coder.encode(['bytes32', 'uint256', 'address', 'uint256'], [blockHash, arenaId, contract, chainId])).toLowerCase();
}

export function leafOf(entryIndex, points) {
  return ethers.keccak256(ethers.concat([ethers.keccak256(coder.encode(['uint256', 'uint32'], [entryIndex, points]))]));
}

const hashPair = (a, b) => (BigInt(a) < BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a])));

/** Merkle tree over every entry's points (join order). { root, total, proof(i) }. */
export function pointsTree(points) {
  if (!points.length) throw new Error('no points');
  const layers = [points.map((p, i) => leafOf(i, p))];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1], next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  return {
    root: layers[layers.length - 1][0].toLowerCase(),
    total: points.reduce((s, v) => s + Number(v), 0),
    proof(i) {
      const out = [];
      for (let l = 0; l < layers.length - 1; l++) {
        const sib = i ^ 1;
        if (sib < layers[l].length) out.push(layers[l][sib]);
        i >>= 1;
      }
      return out;
    },
  };
}

/** claimMany arguments for some entry indexes of a settled arena (points = all entries). */
export function claimArgs(points, indexes) {
  const t = pointsTree(points);
  return { entryIndexes: indexes, points: indexes.map((i) => points[i]), proofs: indexes.map((i) => t.proof(i)) };
}

/**
 * submitResult's `stats` bytes: format 1 = [0x01, then per entry rank uint8, kills uint8].
 * Display data only (the payout key is the points); it lives in the result transaction.
 */
export function encodeStats(stats) {
  const b = new Uint8Array(1 + 2 * stats.length);
  b[0] = 1;
  stats.forEach((s, i) => { b[1 + 2 * i] = Math.min(255, s.rank); b[2 + 2 * i] = Math.min(255, s.kills); });
  return ethers.hexlify(b);
}
export function decodeStats(hex, n) {
  const b = ethers.getBytes(hex || '0x');
  if (b.length !== 1 + 2 * n || b[0] !== 1) return null;
  return Array.from({ length: n }, (_, i) => ({ rank: b[1 + 2 * i], kills: b[2 + 2 * i] }));
}

/** A simulator 64-bit hash as the contract stores it (bytes8). */
export const hashToBytes8 = (h) => '0x' + String(h).replace(/^0x/, '').padStart(16, '0').slice(-16);
