// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ISqueekHamster {
    function dnaOf(uint256 tokenId) external view returns (uint256);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @title Squeek Arena 1.4 — deposit, enter, reveal, settle, claim
/// @notice
///   DEPOSIT   A hamster plays only while it is deposited here. Deposit once (deposit(), or
///             safeTransferFrom straight into this contract) and enter any number of arenas
///             without moving the NFT again. While deposited nobody can sell or transfer it,
///             so an entry can never end up belonging to a hamster its player gave away.
///             withdraw() hands it back and cancels every entry of that hamster in an arena
///             that is still taking entries (fee refunded); entries in arenas that already
///             closed stay — those matches are fixed by their seed and still pay the player.
///
///   ENTER     (Open, block.number < closeBlock) join / joinMany, paying the arena's own fee.
///             Where a hamster lands is random, drawn from the seed; nobody chooses it.
///
///   REVEAL    seed = keccak(blockhash(closeBlock + SEED_DELAY), arenaId, this, chainid):
///             computable off-chain once that block exists. pinSeed() stores it (optional).
///
///   SETTLE    The operator re-runs the deterministic simulator (version `ruleset` of the
///             arena) and posts every entry's points, plus rank and kills, in ONE transaction.
///             The contract builds the Merkle root of the points itself and keeps only that.
///
///   CONFIRM   Claims open `claimDelay` after the result (1 hour on public chains). Until then
///             the owner may void a wrong result: the arena becomes Cancelled and every entry
///             is refunded. After that the result is final ("Confirmed").
///
///   CLAIM     rewardPool * points / totalPoints, with a Merkle proof; rewardPool is the
///             arena's rewardBps of its fees. claimAcross() claims many arenas in one go.
///             What nobody claimed within SWEEP_AFTER of the end may be swept to the treasury.
///
///   Fewer than 2 entrants, or no result within `resultTimeout` of seeding: Cancelled, refunds.
///   A lone entrant does not wait for anyone: once entries close, claim() cancels the arena
///   and refunds the full fee in the same call.
///
///   ROOMS     Any player can open an arena (createRoom): start block up to ~7 days ahead,
///             2..MAX_ROOM_ENTRANTS hamsters, any preset. It runs like any other arena — the
///             operator settles it — under the default fee / reward share / ruleset of the day.
contract SqueekArena is Ownable, ReentrancyGuard, IERC721Receiver {
    enum Status { None, Open, Seeded, Settled, Cancelled, Swept }

    /// Header: ONE storage slot (248 bits) — everything join() touches.
    struct Arena {
        uint40 closeBlock;       // entries accepted while block.number < closeBlock
        uint40 seedBlock;        // the block whose hash is the seed
        uint8 maxEntrants;       // <= MAX_ENTRANTS
        uint8 entrantCount;
        uint8 preset;            // 0 standard, 1 brawler, 2 sniper
        Status status;
        uint16 ruleset;          // simulator version the match runs on (clients pick that build)
        uint32 feeGwei;          // this arena's entry fee, in gwei
        uint16 rewardBps;        // share of the fees paid back to players by points
        uint72 pot;              // fees held for this arena (wei)
    }

    /// Settlement (3 slots, written by submitResult; claims touch the last one).
    struct Result {
        bytes32 pointsRoot;      // Merkle root of keccak(keccak(abi.encode(entryIndex, points)))
        uint88 rewardPool;
        uint64 totalPoints;
        bytes8 resultHash;       // simulator resultHash (64-bit)
        uint40 settledBlock;     // block of the submitResult transaction (points, rank, kills live there)
        uint96 paidOut;          // rewards / refunds paid so far
        bytes8 replayHash;       // simulator replayHash (64-bit)
        uint40 seededAt;         // timestamp the seed was stored on-chain
        uint40 finalAt;          // timestamp it was settled or cancelled
        uint8 claimedCount;
    }

    /// One entry: one slot. No position (drop points are random), no points (Merkle tree).
    struct Entry {
        uint64 tokenId;
        address player;
        bool claimed;
        uint8 slot;              // position of this entry in its hamster's registration list
    }

    /// Everything a client shows about one arena, in one call.
    struct ArenaView {
        uint40 closeBlock;
        uint40 seedBlock;
        uint40 seededAt;
        uint16 maxEntrants;
        uint16 entrantCount;
        uint16 claimedCount;
        uint8 preset;
        Status status;
        uint16 ruleset;
        uint256 fee;
        uint16 rewardBps;
        uint256 pot;
        bytes32 seed;
        bytes32 pointsRoot;
        uint256 rewardPool;
        uint256 totalPoints;
        uint256 paidOut;
        bytes8 resultHash;
        bytes8 replayHash;
        uint40 settledBlock;
        uint40 finalAt;
        uint40 claimableAt;      // Settled: claims open at this timestamp (finalAt + claimDelay)
    }

    uint256 public constant MIN_ENTRANTS = 2;
    uint256 public constant MAX_ENTRANTS = 200;
    uint256 public constant MAX_BATCH = 100;          // arenas per createArenas call
    uint256 public constant MAX_OPEN = 50;            // open arenas one hamster may be entered in at once
    uint256 public constant MIN_REWARD_BPS = 5_000;   // players always get at least half the fees
    uint256 public constant SWEEP_AFTER = 90 days;    // unclaimed money may go to the treasury after this
    uint40 public constant SEED_DELAY = 2;            // blocks between closeBlock and the seed block
    uint256 public constant MAX_ROOM_ENTRANTS = 100;  // a player-made room holds at most 100 hamsters
    uint256 public constant MIN_ROOM_LEAD = 5;        // a room starts at least this many blocks ahead
    uint256 public constant MAX_ROOM_LEAD = 50_400;   // ... and at most ~7 days ahead (12 s blocks)

    ISqueekHamster public immutable hamsters;
    uint64 public immutable resultTimeout;            // seconds after seeding before anyone may cancel
    uint64 public immutable claimDelay;               // seconds after a result before it can be claimed

    // defaults for NEW arenas (each arena keeps the values it was created with) — one slot
    address public operator;
    uint32 public entryFeeGwei;
    uint16 public rewardBps;
    uint16 public ruleset;

    uint256 public treasury;
    Arena[] private _arenas;
    mapping(uint256 => bytes32) private _seed;
    mapping(uint256 => Result) private _result;
    mapping(uint256 => Entry[]) private _entries;
    /// tokenId => (arenaId / 256) => bit (arenaId % 256): is this token entered in that arena?
    mapping(uint256 => mapping(uint256 => uint256)) private _joined;
    /// deposits: who may play (and withdraw) each hamster held here
    mapping(uint256 => address) public depositorOf;
    mapping(address => uint256[]) private _depositsOf;
    mapping(uint256 => uint256) private _depositPos;
    /// tokenId => registrations (arenaId << 8 | entryIndex) that may still be open
    mapping(uint256 => uint64[]) private _regs;

    event OperatorChanged(address operator);
    event DefaultsChanged(uint256 entryFee, uint16 rewardBps, uint16 ruleset);
    event ArenaCreated(uint256 indexed arenaId, uint40 closeBlock, uint16 maxEntrants, uint8 preset, uint16 ruleset, uint256 fee, uint16 rewardBps);
    event RoomCreated(uint256 indexed arenaId, address indexed creator);
    event Deposited(address indexed owner, uint256 indexed tokenId);
    event Withdrawn(address indexed owner, uint256 indexed tokenId, uint256 refund);
    event Joined(uint256 indexed arenaId, address indexed player, uint256 indexed tokenId, uint256 entryIndex);
    event Left(uint256 indexed arenaId, address indexed player, uint256 indexed tokenId, uint256 refund);
    event SeedDrawn(uint256 indexed arenaId, bytes32 seed);
    event Rearmed(uint256 indexed arenaId, uint40 seedBlock);
    event ResultPosted(uint256 indexed arenaId, bytes32 pointsRoot, bytes8 resultHash, bytes8 replayHash,
                       uint256 totalPoints, uint256 rewardPool, uint256 claimableAt);
    event ResultVoided(uint256 indexed arenaId);
    event Cancelled(uint256 indexed arenaId);
    event Claimed(uint256 indexed arenaId, address indexed player, uint256 indexed entryIndex, uint256 amount);
    event Refunded(uint256 indexed arenaId, address indexed player, uint256 indexed entryIndex, uint256 amount);
    event Swept(uint256 indexed arenaId, uint256 amount);

    error NotOperator();
    error BadArena();
    error BadSetting();
    error WrongStatus(Status have);
    error TooEarly();
    error TooLate();
    error WrongFee();
    error NotDepositor();
    error AlreadyJoined();
    error ArenaFull();
    error TooManyOpen();
    error SeedExpired();
    error BadPoints();
    error BadProof();
    error AlreadyClaimed();
    error NotHamster();

    constructor(address owner_, address hamsters_, uint256 entryFee_, uint64 resultTimeout_, uint64 claimDelay_)
        Ownable(owner_)
    {
        hamsters = ISqueekHamster(hamsters_);
        resultTimeout = resultTimeout_;
        claimDelay = claimDelay_;
        operator = owner_;
        _setDefaults(entryFee_, 9_000, 1);
    }

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    function _arena(uint256 id) private view returns (Arena storage a) {
        if (id >= _arenas.length) revert BadArena();
        a = _arenas[id];
    }

    // ================================================================== admin
    function setOperator(address op) external onlyOwner {
        operator = op;
        emit OperatorChanged(op);
    }

    /// @notice Fee, reward share and simulator version for arenas created from now on.
    ///         Arenas that already exist keep the values they were created with.
    function setDefaults(uint256 entryFee_, uint16 rewardBps_, uint16 ruleset_) external onlyOwner {
        _setDefaults(entryFee_, rewardBps_, ruleset_);
    }

    function _setDefaults(uint256 fee, uint16 bps, uint16 rs) private {
        if (fee % 1 gwei != 0 || fee / 1 gwei > type(uint32).max) revert BadSetting();
        if (bps < MIN_REWARD_BPS || bps > 10_000 || rs == 0) revert BadSetting();
        entryFeeGwei = uint32(fee / 1 gwei);
        rewardBps = bps;
        ruleset = rs;
        emit DefaultsChanged(fee, bps, rs);
    }

    /// @notice Default entry fee for new arenas, in wei.
    function entryFee() external view returns (uint256) { return uint256(entryFeeGwei) * 1 gwei; }

    function createArena(uint40 closeBlock, uint16 maxEntrants, uint8 preset) external onlyOperator returns (uint256 id) {
        if (closeBlock <= block.number) revert TooLate();
        if (maxEntrants < MIN_ENTRANTS || maxEntrants > MAX_ENTRANTS || preset > 2) revert BadArena();
        id = _push(closeBlock, uint8(maxEntrants), preset);
    }

    /// @notice Any player: open a room. Entries close (the match starts) at `startBlock`, between
    ///         MIN_ROOM_LEAD and MAX_ROOM_LEAD blocks from now; 2..MAX_ROOM_ENTRANTS hamsters.
    function createRoom(uint40 startBlock, uint16 maxEntrants, uint8 preset) external returns (uint256 id) {
        if (startBlock < block.number + MIN_ROOM_LEAD) revert TooLate();
        if (startBlock > block.number + MAX_ROOM_LEAD) revert TooEarly();
        if (maxEntrants < MIN_ENTRANTS || maxEntrants > MAX_ROOM_ENTRANTS || preset > 2) revert BadArena();
        id = _push(startBlock, uint8(maxEntrants), preset);
        emit RoomCreated(id, msg.sender);
    }

    /// @notice A schedule: `count` arenas, the i-th closing at firstClose + i * everyBlocks.
    function createArenas(uint40 firstClose, uint40 everyBlocks, uint16 count, uint16 maxEntrants, uint8 preset, bool presetCycle)
        external onlyOperator returns (uint256 firstId)
    {
        if (firstClose <= block.number) revert TooLate();
        if (count == 0 || count > MAX_BATCH || everyBlocks == 0) revert BadArena();
        if (maxEntrants < MIN_ENTRANTS || maxEntrants > MAX_ENTRANTS || preset > 2) revert BadArena();
        firstId = _arenas.length;
        for (uint256 i = 0; i < count; i++) {
            uint8 p = presetCycle ? uint8((uint256(preset) + i) % 3) : preset;
            _push(firstClose + uint40(i) * everyBlocks, uint8(maxEntrants), p);
        }
    }

    function _push(uint40 closeBlock, uint8 maxEntrants, uint8 preset) private returns (uint256 id) {
        id = _arenas.length;
        uint32 fee = entryFeeGwei;
        uint16 bps = rewardBps;
        uint16 rs = ruleset;
        _arenas.push(Arena({closeBlock: closeBlock, seedBlock: closeBlock + SEED_DELAY, maxEntrants: maxEntrants,
                            entrantCount: 0, preset: preset, status: Status.Open, ruleset: rs, feeGwei: fee,
                            rewardBps: bps, pot: 0}));
        emit ArenaCreated(id, closeBlock, maxEntrants, preset, rs, uint256(fee) * 1 gwei, bps);
    }

    function withdrawTreasury(address payable to) external onlyOwner {
        uint256 amt = treasury;
        treasury = 0;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "withdraw failed");
    }

    /// @notice Owner, during the claim delay: the posted result is wrong. The arena is
    ///         cancelled and every entry gets its fee back.
    function voidResult(uint256 arenaId) external onlyOwner {
        Arena storage a = _arena(arenaId);
        Result storage r = _result[arenaId];
        if (a.status != Status.Settled) revert WrongStatus(a.status);
        if (block.timestamp >= uint256(r.finalAt) + claimDelay) revert TooLate();
        treasury -= uint256(a.pot) - r.rewardPool;          // the cut taken at settlement goes back
        a.status = Status.Cancelled;
        r.finalAt = uint40(block.timestamp);
        emit ResultVoided(arenaId);
        emit Cancelled(arenaId);
    }

    /// @notice Owner, SWEEP_AFTER after an arena ended: what nobody claimed goes to the treasury.
    function sweep(uint256 arenaId) external onlyOwner {
        Arena storage a = _arena(arenaId);
        Result storage r = _result[arenaId];
        if (a.status != Status.Settled && a.status != Status.Cancelled) revert WrongStatus(a.status);
        if (block.timestamp < uint256(r.finalAt) + SWEEP_AFTER) revert TooEarly();
        uint256 owed = a.status == Status.Settled ? r.rewardPool : a.pot;
        uint256 amount = owed - r.paidOut;
        treasury += amount;
        a.status = Status.Swept;
        emit Swept(arenaId, amount);
    }

    /// @notice A hamster sent here with a plain transferFrom (not deposit / safeTransferFrom)
    ///         has no depositor; the owner can send it back to whoever it came from.
    function recoverHamster(uint256 tokenId, address to) external onlyOwner {
        if (depositorOf[tokenId] != address(0)) revert NotDepositor();
        hamsters.transferFrom(address(this), to, tokenId);
    }

    // ================================================================== deposit
    /// @notice Deposit hamsters (approve this contract first, or use safeTransferFrom instead).
    function deposit(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            hamsters.transferFrom(msg.sender, address(this), tokenIds[i]);      // reverts unless msg.sender owns it
            _recordDeposit(msg.sender, tokenIds[i]);
        }
    }

    /// @dev safeTransferFrom(owner, arena, id) deposits in one step, no approval needed.
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata) external returns (bytes4) {
        if (msg.sender != address(hamsters) || from == address(0)) revert NotHamster();
        _recordDeposit(from, tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }

    function _recordDeposit(address owner_, uint256 tokenId) private {
        depositorOf[tokenId] = owner_;
        _depositPos[tokenId] = _depositsOf[owner_].length;
        _depositsOf[owner_].push(tokenId);
        emit Deposited(owner_, tokenId);
    }

    /// @notice Take hamsters back. Every entry of theirs in an arena that is still taking
    ///         entries is cancelled and its fee refunded; entries in closed arenas stay.
    function withdraw(uint256[] calldata tokenIds) external nonReentrant {
        uint256 refund;
        for (uint256 k = 0; k < tokenIds.length; k++) {
            uint256 tokenId = tokenIds[k];
            if (depositorOf[tokenId] != msg.sender) revert NotDepositor();
            uint256 r = _leaveOpen(tokenId, msg.sender);
            refund += r;
            // forget the deposit (swap-and-pop in the owner's list)
            uint256[] storage list = _depositsOf[msg.sender];
            uint256 pos = _depositPos[tokenId];
            uint256 last = list[list.length - 1];
            list[pos] = last;
            _depositPos[last] = pos;
            list.pop();
            delete _depositPos[tokenId];
            delete depositorOf[tokenId];
            hamsters.transferFrom(address(this), msg.sender, tokenId);
            emit Withdrawn(msg.sender, tokenId, r);
        }
        if (refund > 0) _pay(msg.sender, refund);
    }

    /// Cancel `tokenId`'s entries in arenas still taking entries; return the fees to refund.
    function _leaveOpen(uint256 tokenId, address player) private returns (uint256 refund) {
        uint64[] storage regs = _regs[tokenId];
        for (uint256 i = 0; i < regs.length; i++) {
            uint256 arenaId = regs[i] >> 8;
            Arena storage a = _arenas[arenaId];
            if (a.status != Status.Open || block.number >= a.closeBlock) continue;     // closed: the entry stays
            uint256 fee = uint256(a.feeGwei) * 1 gwei;
            _removeEntry(arenaId, a, uint256(regs[i] & 0xff));
            a.pot -= uint72(fee);
            _joined[tokenId][arenaId >> 8] &= ~(uint256(1) << (arenaId & 255));
            refund += fee;
            emit Left(arenaId, player, tokenId, fee);
        }
        delete _regs[tokenId];
    }

    /// Swap-and-pop an entry out of an arena that is still open (its order is not fixed yet).
    function _removeEntry(uint256 arenaId, Arena storage a, uint256 idx) private {
        Entry[] storage es = _entries[arenaId];
        uint256 last = es.length - 1;
        if (idx != last) {
            Entry memory m = es[last];
            es[idx] = m;
            _regs[m.tokenId][m.slot] = uint64((arenaId << 8) | idx);
        }
        es.pop();
        a.entrantCount -= 1;
    }

    // ================================================================== enter
    function join(uint256 arenaId, uint256 tokenId) external payable returns (uint256 entryIndex) {
        uint256 fee;
        (entryIndex, fee) = _join(arenaId, tokenId);
        if (msg.value != fee) revert WrongFee();
    }

    /// @notice Enter several arenas (or several hamsters) in one transaction; msg.value must
    ///         be the sum of the arenas' fees.
    function joinMany(uint256[] calldata arenaIds, uint256[] calldata tokenIds) external payable {
        if (arenaIds.length != tokenIds.length) revert BadArena();
        uint256 total;
        for (uint256 i = 0; i < arenaIds.length; i++) {
            (, uint256 fee) = _join(arenaIds[i], tokenIds[i]);
            total += fee;
        }
        if (msg.value != total) revert WrongFee();
    }

    function _join(uint256 arenaId, uint256 tokenId) private returns (uint256 entryIndex, uint256 fee) {
        Arena storage a = _arena(arenaId);
        if (a.status != Status.Open) revert WrongStatus(a.status);
        if (block.number >= a.closeBlock) revert TooLate();
        if (depositorOf[tokenId] != msg.sender) revert NotDepositor();
        uint256 bit = uint256(1) << (arenaId & 255);
        uint256 word = _joined[tokenId][arenaId >> 8];
        if (word & bit != 0) revert AlreadyJoined();
        if (a.entrantCount >= a.maxEntrants) revert ArenaFull();
        uint64[] storage regs = _regs[tokenId];
        if (regs.length >= MAX_OPEN) {
            _prune(regs);
            if (regs.length >= MAX_OPEN) revert TooManyOpen();
        }
        _joined[tokenId][arenaId >> 8] = word | bit;
        entryIndex = a.entrantCount;
        _entries[arenaId].push(Entry({tokenId: uint64(tokenId), player: msg.sender, claimed: false, slot: uint8(regs.length)}));
        regs.push(uint64((arenaId << 8) | entryIndex));
        fee = uint256(a.feeGwei) * 1 gwei;
        a.entrantCount += 1;
        a.pot += uint72(fee);
        emit Joined(arenaId, msg.sender, tokenId, entryIndex);
    }

    /// Drop registrations whose arena no longer takes entries (they cannot be cancelled anyway).
    function _prune(uint64[] storage regs) private {
        uint256 i = 0;
        while (i < regs.length) {
            Arena storage a = _arenas[regs[i] >> 8];
            if (a.status == Status.Open && block.number < a.closeBlock) { i++; continue; }
            uint256 last = regs.length - 1;
            if (i != last) {
                uint64 moved = regs[last];
                regs[i] = moved;
                _entries[moved >> 8][moved & 0xff].slot = uint8(i);
            }
            regs.pop();
        }
    }

    // ================================================================== seed (permissionless)
    function _pin(uint256 arenaId, Arena storage a) private {
        if (a.status != Status.Open) revert WrongStatus(a.status);
        if (block.number < a.closeBlock) revert TooEarly();
        if (a.entrantCount < MIN_ENTRANTS) {
            _cancel(arenaId, a);
            return;
        }
        if (block.number <= a.seedBlock) revert TooEarly();
        bytes32 bh = blockhash(a.seedBlock);
        if (bh == bytes32(0)) revert SeedExpired();
        bytes32 seed = keccak256(abi.encode(bh, arenaId, address(this), block.chainid));
        _seed[arenaId] = seed;
        a.status = Status.Seeded;
        _result[arenaId].seededAt = uint40(block.timestamp);
        emit SeedDrawn(arenaId, seed);
    }

    function _cancel(uint256 arenaId, Arena storage a) private {
        a.status = Status.Cancelled;
        _result[arenaId].finalAt = uint40(block.timestamp);
        emit Cancelled(arenaId);
    }

    /// @notice Store the seed (optional); an arena that closed with fewer than 2 is cancelled.
    function pinSeed(uint256 arenaId) external { _pin(arenaId, _arena(arenaId)); }

    /// @notice The seed block slipped out of the 256-block window before anyone stored it.
    function rearm(uint256 arenaId) external {
        Arena storage a = _arena(arenaId);
        if (a.status != Status.Open || block.number <= a.seedBlock || blockhash(a.seedBlock) != bytes32(0)) revert WrongStatus(a.status);
        a.seedBlock = uint40(block.number) + SEED_DELAY;
        emit Rearmed(arenaId, a.seedBlock);
    }

    // ================================================================== settle
    /// @param points  score of every entry, in entry order — the payout key (Merkle root built here)
    /// @param stats   rank and kills of every entry, for display only: byte 0 = format (1), then
    ///                per entry [rank uint8, kills uint8]. Not stored: read from this tx's calldata.
    function submitResult(uint256 arenaId, uint32[] calldata points, bytes calldata stats, bytes8 resultHash, bytes8 replayHash)
        external onlyOperator
    {
        Arena storage a = _arena(arenaId);
        if (a.status == Status.Open) {
            _pin(arenaId, a);
            if (a.status == Status.Cancelled) return;
        }
        if (a.status != Status.Seeded) revert WrongStatus(a.status);
        uint256 n = points.length;
        if (n != a.entrantCount || (stats.length != 0 && stats.length != 1 + 2 * n)) revert BadPoints();
        (bytes32 root, uint256 total) = _rootOf(points);
        if (total == 0) revert BadPoints();
        uint256 pool = (uint256(a.pot) * a.rewardBps) / 10_000;
        Result storage r = _result[arenaId];
        r.pointsRoot = root;
        r.rewardPool = uint88(pool);
        r.totalPoints = uint64(total);
        r.resultHash = resultHash;
        r.settledBlock = uint40(block.number);
        r.replayHash = replayHash;
        r.finalAt = uint40(block.timestamp);
        treasury += a.pot - pool;
        a.status = Status.Settled;
        emit ResultPosted(arenaId, root, resultHash, replayHash, total, pool, block.timestamp + claimDelay);
    }

    /// Merkle root (OpenZeppelin convention: sorted pairs, odd node carried up) of the points.
    function _rootOf(uint32[] calldata points) private pure returns (bytes32 root, uint256 total) {
        uint256 n = points.length;
        bytes32[] memory layer = new bytes32[](n);
        unchecked {
            for (uint256 i = 0; i < n; ++i) {
                uint256 p = points[i];
                total += p;
                bytes32 leaf;
                assembly ("memory-safe") {
                    mstore(0x00, i)
                    mstore(0x20, p)
                    mstore(0x00, keccak256(0x00, 0x40))
                    leaf := keccak256(0x00, 0x20)
                }
                layer[i] = leaf;
            }
            while (n > 1) {
                uint256 m = (n + 1) >> 1;
                for (uint256 i = 0; i < m; ++i) {
                    uint256 l = i << 1;
                    if (l + 1 < n) {
                        bytes32 x = layer[l];
                        bytes32 y = layer[l + 1];
                        bytes32 h;
                        assembly ("memory-safe") {
                            switch lt(x, y)
                            case 1 { mstore(0x00, x) mstore(0x20, y) }
                            default { mstore(0x00, y) mstore(0x20, x) }
                            h := keccak256(0x00, 0x40)
                        }
                        layer[i] = h;
                    } else {
                        layer[i] = layer[l];
                    }
                }
                n = m;
            }
        }
        root = layer[0];
    }

    /// @notice Anyone, once a seeded arena got no result within resultTimeout; or the owner,
    ///         any time before a result: cancel, everyone takes a refund.
    function cancelStale(uint256 arenaId) external {
        Arena storage a = _arena(arenaId);
        bool stale = (a.status == Status.Seeded && block.timestamp > uint256(_result[arenaId].seededAt) + resultTimeout);
        if (!stale && !(msg.sender == owner() && (a.status == Status.Open || a.status == Status.Seeded)))
            revert WrongStatus(a.status);
        _cancel(arenaId, a);
    }

    // ================================================================== payouts
    /// @notice Pay one entry to the player who entered it (anyone may trigger it).
    function claim(uint256 arenaId, uint256 entryIndex, uint32 points, bytes32[] calldata proof) external nonReentrant {
        (address to, uint256 amount) = _claim(arenaId, entryIndex, points, proof);
        if (amount > 0) _pay(to, amount);
    }

    /// @notice Several entries of one arena (points/proofs ignored for a cancelled arena).
    function claimMany(uint256 arenaId, uint256[] calldata entryIndexes, uint32[] calldata points, bytes32[][] calldata proofs)
        external nonReentrant
    {
        uint256 n = entryIndexes.length;
        if (n != points.length || n != proofs.length) revert BadPoints();
        address to;
        uint256 owed;
        for (uint256 i = 0; i < n; i++) {
            (address p, uint256 amt) = _claim(arenaId, entryIndexes[i], points[i], proofs[i]);
            if (p != to) { if (owed > 0) _pay(to, owed); to = p; owed = 0; }
            owed += amt;
        }
        if (owed > 0) _pay(to, owed);
    }

    /// @notice Entries of many arenas in one transaction ("claim everything").
    function claimAcross(uint256[] calldata arenaIds, uint256[] calldata entryIndexes, uint32[] calldata points, bytes32[][] calldata proofs)
        external nonReentrant
    {
        uint256 n = arenaIds.length;
        if (n != entryIndexes.length || n != points.length || n != proofs.length) revert BadPoints();
        address to;
        uint256 owed;
        for (uint256 i = 0; i < n; i++) {
            (address p, uint256 amt) = _claim(arenaIds[i], entryIndexes[i], points[i], proofs[i]);
            if (p != to) { if (owed > 0) _pay(to, owed); to = p; owed = 0; }
            owed += amt;
        }
        if (owed > 0) _pay(to, owed);
    }

    function _claim(uint256 arenaId, uint256 entryIndex, uint32 points, bytes32[] calldata proof)
        private returns (address player, uint256 amount)
    {
        Arena storage a = _arena(arenaId);
        Entry storage e = _entries[arenaId][entryIndex];
        if (e.claimed) revert AlreadyClaimed();
        Result storage r = _result[arenaId];
        player = e.player;
        // closed with fewer than 2: no match — cancel here so the refund needs nobody else
        if (a.status == Status.Open && block.number >= a.closeBlock && a.entrantCount < MIN_ENTRANTS) _cancel(arenaId, a);
        if (a.status == Status.Settled) {
            if (block.timestamp < uint256(r.finalAt) + claimDelay) revert TooEarly();
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(entryIndex, points))));
            if (!MerkleProof.verifyCalldata(proof, r.pointsRoot, leaf)) revert BadProof();
            amount = (uint256(r.rewardPool) * points) / r.totalPoints;
            emit Claimed(arenaId, player, entryIndex, amount);
        } else if (a.status == Status.Cancelled) {
            amount = uint256(a.feeGwei) * 1 gwei;
            emit Refunded(arenaId, player, entryIndex, amount);
        } else {
            revert WrongStatus(a.status);
        }
        e.claimed = true;
        r.claimedCount += 1;
        r.paidOut += uint96(amount);
    }

    function _pay(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "payout failed");
    }

    // ================================================================== views
    function arenaCount() external view returns (uint256) { return _arenas.length; }

    function rewardFor(uint256 arenaId, uint256 points) external view returns (uint256) {
        Result storage r = _result[arenaId];
        if (_arena(arenaId).status != Status.Settled || r.totalPoints == 0) return 0;
        return (uint256(r.rewardPool) * points) / r.totalPoints;
    }

    function getArena(uint256 arenaId) public view returns (ArenaView memory v) {
        Arena storage a = _arena(arenaId);
        Result storage r = _result[arenaId];
        v.closeBlock = a.closeBlock;
        v.seedBlock = a.seedBlock;
        v.seededAt = r.seededAt;
        v.maxEntrants = a.maxEntrants;
        v.entrantCount = a.entrantCount;
        v.claimedCount = r.claimedCount;
        v.preset = a.preset;
        v.status = a.status;
        v.ruleset = a.ruleset;
        v.fee = uint256(a.feeGwei) * 1 gwei;
        v.rewardBps = a.rewardBps;
        v.pot = a.pot;
        v.seed = _seed[arenaId];
        v.pointsRoot = r.pointsRoot;
        v.rewardPool = r.rewardPool;
        v.totalPoints = r.totalPoints;
        v.paidOut = r.paidOut;
        v.resultHash = r.resultHash;
        v.replayHash = r.replayHash;
        v.settledBlock = r.settledBlock;
        v.finalAt = r.finalAt;
        v.claimableAt = a.status == Status.Settled ? uint40(uint256(r.finalAt) + claimDelay) : 0;
    }

    /// @notice Up to `count` arenas starting at `from`, in one call.
    function getArenas(uint256 from, uint256 count) external view returns (ArenaView[] memory out) {
        uint256 n = _arenas.length;
        uint256 end = from + count > n ? n : from + count;
        out = new ArenaView[](end > from ? end - from : 0);
        for (uint256 i = from; i < end; i++) out[i - from] = getArena(i);
    }

    /// @notice Has `tokenId` entered `arenaId`?
    function tokenInArena(uint256 arenaId, uint256 tokenId) external view returns (bool) {
        return _joined[tokenId][arenaId >> 8] & (uint256(1) << (arenaId & 255)) != 0;
    }

    /// @notice Entries in join order (= bot ids in the simulator once entries close), with DNA.
    function getEntries(uint256 arenaId) external view returns (Entry[] memory entries, uint256[] memory dnas) {
        _arena(arenaId);
        entries = _entries[arenaId];
        dnas = new uint256[](entries.length);
        for (uint256 i = 0; i < entries.length; i++) dnas[i] = hamsters.dnaOf(entries[i].tokenId);
    }

    /// @notice Hamsters `owner_` has deposited here.
    function depositsOf(address owner_) external view returns (uint256[] memory) { return _depositsOf[owner_]; }

    /// @notice Arenas `tokenId` is entered in that may still be open (closed ones drop out over time).
    function registrationsOf(uint256 tokenId) external view returns (uint256[] memory arenaIds, uint256[] memory entryIndexes) {
        uint64[] storage regs = _regs[tokenId];
        arenaIds = new uint256[](regs.length);
        entryIndexes = new uint256[](regs.length);
        for (uint256 i = 0; i < regs.length; i++) { arenaIds[i] = regs[i] >> 8; entryIndexes[i] = regs[i] & 0xff; }
    }
}
