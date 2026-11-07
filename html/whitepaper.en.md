# Squeek Royale — Whitepaper

## 1. What Squeek Royale is

Squeek Royale is a top-down 2D battle royale. Up to 100 hamsters fight on a round island until **exactly one** is left standing.

Nobody steers a hamster. Each one is an AI that decides for itself when to loot, fight, dodge, run from the storm or hunt the Crown. Players do three things:

- **Own hamsters:** every hamster is an NFT. Its DNA sets its looks, equipment and stats, and never changes.
- **Send hamsters into battle:** enter scheduled matches, or **create your own room** and let others join.
- **Watch and collect:** replay your matches, follow your hamster, and collect a reward based on its score.

Everything happens on two pages: the **home page** (introduction and this whitepaper) and the **player hub `/play`**.

> Every match is fully decided before it is played back. Playback speed, seeking, camera angle or your device cannot change who wins.

## 2. Game rules

### 2.1. A match

- **Hamsters:** 2 to 100 hamsters per match, chosen by whoever creates it.
- **Map:** a round island with houses, trees, rocks, crates, bushes and stumps. Houses, tree trunks and props block movement and projectiles.
- **Length:** about 2 minutes. The smallest safe circle is reached at 130 s, sudden death starts at 135 s, and a match ends at 240 s at the latest.
- **Bare paws:** every hamster starts with **Paws** (5 damage). Weapons are picked up on the map.

### 2.2. Parachute drop

- Hamsters parachute onto **random drop points**. Nobody, the owner included, can choose one.
- Drop points are always inside the island's safe ring, at least 375 units apart and clear of obstacles.
- Hamsters land between about 1.5 and 3.5 s. Until they land they cannot be seen or hit.

### 2.3. The Cat Storm

The island is round from the start and the safe circle **shrinks continuously**, without pauses. Outside it rages the Cat Storm: purple fog, storm clouds and giant glowing cat eyes.

| Phase | Time | Safe radius | Damage outside |
|---|---|---|---|
| 1 | 0 – 25 s | down to 3,800 | 4 HP/s |
| 2 | 25 – 55 s | down to 2,400 | 8 HP/s |
| 3 | 55 – 85 s | down to 1,200 | 16 HP/s |
| 4 | 85 – 110 s | down to 450 | 28 HP/s |
| 5 | 110 – 130 s | down to 150 | 45 HP/s |
| Sudden death | from 135 s | smaller every 5 s, minimum 90 | +9 HP/s every 5 s |

- Storm damage **ignores armor** and gives nobody a kill.
- Each circle's centre can drift from the previous one, so the final circle is not always in the middle of the island.

### 2.4. Weapons

A hamster swaps to a **higher-tier** weapon when it walks over one; the old weapon is left on the ground. When a hamster is knocked out, its weapon and bag items drop.

| Weapon | Type | Damage | Cooldown | Range | Tier | Special |
|---|---|---|---|---|---|---|
| Dagger | Melee | 12 | 0.35 s | 32 | 1 | Fast single-target stab |
| Sword | Melee | 25 | 0.75 s | 46 | 3 | ~60° cleave, hits everyone in the arc |
| Axe | Melee | 38 | 1.15 s | 48 | 5 | ~70° cleave |
| Spear | Melee | 22 | 0.85 s | 85 | 4 | Pierces along a line |
| Hammer | Melee | 45 | 1.55 s | 50 | 6 | Slams a 55-radius area, **stuns 0.4 s** |
| Bow | Ranged | 18 | 0.9 s | 220 | 2 | Arrows at 520 units/s |
| Crossbow | Ranged | 34 | 1.55 s | 250 | 6 | Bolts at 640 units/s |
| Magic Staff | Ranged | 20 | 1.2 s | 190 | 4 | Orbs at 380 units/s |

- Ranged shots lead a moving target and can miss. Houses, trees and rocks block them.
- Targets can **dodge**. The chance depends on the target's AGI and the attacker's accuracy: at most 52% against melee and 38% against ranged attacks, higher while dashing.
- **Dash:** 2.9× speed for 0.25 s, 3.2 s cooldown. Hamsters dash to escape, get back into the safe zone, close in or dodge a shot.

### 2.5. Healing items

Hamsters carry a **3-slot bag** and eat automatically when their health drops. While eating they move at 60% speed and cannot attack.

| Item | Instant heal | Heal over time | Eating time | Note |
|---|---|---|---|---|
| Sunflower Seed | 25 | — | 0.3 s | |
| Cheese Wedge | 10 | +55 over 4 s | 0.5 s | |
| Honey Milk | 100 | — | 1.2 s | A hit stops the meal; the item stays in the bag |
| Golden Strawberry | 45 | — | 0.4 s | +35% run speed for 3 s |

- **Treasure chests:** 70 chests are scattered over the island. A hurt hamster touching one heals 65 HP at once.
- **Supply crates:** they land at 20, 45, 70 and 95 s, 3 at a time, always where the zone will still be safe 10 s later. Opening one takes 0.5 s and gives:
  - a strong weapon (usually a crossbow, hammer or axe);
  - 80 HP;
  - one healing item.

### 2.6. The Crown

- The hamster that scores the **first knockout** of the match receives the Crown.
- Knocking out the Crown holder steals the Crown and **fully heals** the new holder.
- If the holder dies in the storm, the Crown drops. The first hamster to touch it picks it up and is fully healed too.
- The holder earns **double survival points** and is hunted by the whole island. Knocking out the holder counts as **double knockout points**.

### 2.7. Knockouts, score and rank

- A **knockout** goes to the last hamster that dealt damage within 2 s before the target died, if it is still alive.
- **Score** for each hamster:
  - 1 point per second alive (×2 while wearing the Crown);
  - **50 points** per knockout (×2 for knocking out the Crown holder).
- **Rank** is survival order: a hamster knocked out when N are left places N-th, and the last survivor is rank 1.
- Rank decides who wins. **Score decides the reward.** A 3rd-place hamster with many knockouts can earn more than the runner-up.

### 2.8. Always exactly one winner

- When one hamster is left, it wins.
- If the last hamsters fall at the same instant, the winner is chosen by: least damage taken, then most damage dealt, then most knockouts, then the lowest number.
- At 240 s, if several hamsters are still alive, the same rule picks the winner among them.

### 2.9. Three match modes

| Mode | Differences |
|---|---|
| **Standard** | The rules above |
| **Brawler** | Loot favours melee weapons; the storm closes faster and hits harder, sudden death from 110 s |
| **Sniper** | Loot favours bows, crossbows and staffs; hamsters engage from further away; same storm as Standard |

## 3. Hamster NFTs

### 3.1. DNA

Every hamster is an ERC-721 NFT from the **Squeek Hamster** collection (symbol SQHAM), capped at 10,000. At mint it receives a **256-bit DNA**. The DNA never changes and decides:

- looks: fur colour, pattern, eyes;
- three equipment pieces: **outfit, headwear, back item** (headwear and back can be empty);
- five combat stats;
- temperament: aggression, caution, love of looting.

### 3.2. Equipment and stats

Each stat = **6 base points** + the outfit + the headwear + the back item. An outfit gives 10 points, headwear and back items 6 each, an empty slot 4. A hamster's stat total is always **48 – 52**: hamsters differ in how their points are spread, not in total strength.

| Stat | Effect in a match | Range |
|---|---|---|
| **STR** (Strength) | Multiplies damage dealt | 94% – 118% |
| **AGI** (Agility) | Run speed, dodging, shorter cooldowns | 97 – 146 units/s; cooldown 104% – 90% |
| **ARM** (Armor) | Reduces damage from other hamsters (not storm damage) | 4% – 17% |
| **VIT** (Vitality) | Maximum health | 200 – 255 HP |
| **PER** (Perception) | Accuracy and how far it spots opponents | sight 330 – 480 units |

### 3.3. Temperament

The DNA also sets a temperament, which shapes how the AI plays:

| Temperament | Play style |
|---|---|
| Berserker | Very aggressive, jumps into every fight |
| Hunter | Aggressive and bold, hunts down targets |
| Scavenger | Goes for loot, chests and supply crates first |
| Survivor | Cautious, avoids bad fights |
| Tactician | Balanced |

### 3.4. The NFT card

Each card shows the hamster, its name, a short DNA, the five stats, equipment, combat values and temperament. The frame comes in four rarities set by the DNA:

| Frame | Average score |
|---|---|
| Mythic · Blazing Red | above 8/10 |
| Epic · Violet | 6 – 8/10 |
| Rare · Leaf Green | 4 – 5/10 |
| Worn · Old Wood | below 4/10 |

Frame rarity is a collectible trait. Strength in a match comes from the five stats in 3.2.

### 3.5. Minting

- Mint up to 10 hamsters per transaction.
- Minting is currently free; you only pay gas.
- The DNA is created at mint and the hamster can play right away.

## 4. Entering matches

### 4.1. The schedule

Matches are scheduled ahead, up to 7 days out, at a fixed interval. The player hub always shows the **next open match** so you can join right away.

Each match has a maximum number of hamsters, a mode (Standard / Brawler / Sniper), an entry fee, a reward share and a start time. These are fixed when the match is created.

### 4.2. Create your own room

Any player can open a room of their own, right in the player hub:

- **Start time:** from a few minutes up to 7 days ahead. At that time entries close and the match is played.
- **Maximum hamsters:** 2 to 100.
- **Mode:** Standard, Brawler or Sniper.

A player's room runs exactly like a scheduled match: same entry fee, same rules, same rewards, and the result is posted automatically.

- **Only 1 player joined:** no match takes place. From the start time, that player presses claim and gets a **100% refund** at once.
- **2 players or more:** the match is played as usual.

### 4.3. Depositing a hamster

A hamster can only play while it is **deposited** in the arena contract.

- Deposit once, then enter as many matches as you like.
- While deposited the hamster is still yours but **cannot be transferred or sold**, so a hamster entered in a match cannot change hands halfway.
- Each hamster can be entered in at most **50 open matches** at a time.
- In **My Hamsters**, every hamster card shows whether it is in your wallet or deposited, with a **Deposit** or **Withdraw** button. Your first match entry also deposits the hamster for you.

### 4.4. Entering a match

- Pick a match, pick a deposited hamster and pay the **entry fee** (currently 0.0001 ETH).
- You can enter **several matches in one transaction**.
- A hamster enters each match only once.
- Entries close at a set block. After that the line-up is locked.

### 4.5. Withdrawing a hamster

You can take your hamster back to your wallet at any time.

- Its matches that are **still open** are cancelled and the **entry fees are refunded** to you.
- Matches that have **already closed** still play with that hamster, and their rewards still go to the wallet that entered it.

## 5. How a match is decided on the blockchain

### 5.1. The match seed

- When entries close, the match seed is the **hash of a block mined after the close**, combined with the match number, the contract address and the network.
- That block does not exist while entries are open, so **nobody can know the seed in advance**: not the players, not the operators.
- The seed decides everything random in the match: the map, the drop points, where weapons and items lie, how the storm moves, the supply crates, and every dodge and missed shot.
- A hamster's DNA does not depend on the seed: it brings the same stats to every match.

### 5.2. Deterministic simulation

- Matches are simulated by a **deterministic** engine: the same seed, the same hamsters and the same rules version always give **the same result**, on any machine.
- Each match records the rules version it was played under. An old match is always checked against its own rules, even after the game is rebalanced.

### 5.3. Posting the result

Once a match is simulated, its result is written to the blockchain in **one transaction**:

- every hamster's score, which the contract turns into a **Merkle root** used for payouts;
- every hamster's **rank and knockouts**;
- the result hash (resultHash) and the replay hash (replayHash).

### 5.4. Confirmation

- A newly posted result is **pending confirmation** for 1 hour. During that hour, if the result turns out to be wrong, the owner can void it: the match is **cancelled** and everyone is refunded.
- After the hour the result is **final (Confirmed)** and nobody can change it. Rewards open for claiming.
- The play page shows **Confirmed** only for matches past that hour. Win/loss, rank, knockouts and the transaction hash are all read from the blockchain.

### 5.5. Anyone can verify

Every match you replay is rebuilt in your browser from the seed and the line-up on the blockchain, then compared with the result recorded on-chain. The player hub shows **Confirmed** only for matches that reproduce the on-chain result exactly.

### 5.6. Cancelled matches

A match is cancelled and every entry fully refunded when:

- fewer than 2 hamsters entered by the start time (the only player takes the refund at once, no waiting);
- no result is posted within 24 hours of the seed (anyone may then cancel it);
- the owner voids the result during the confirmation hour.

## 6. Rewards

### 6.1. The prize pool

- **Match pot** = the entry fees of every hamster.
- **90%** of the pot is the **prize pool**, shared among players by score.
- **10%** goes to the project treasury.
- The entry fee and reward share can change for matches created later, but never below 50% for players. Every match keeps the terms it was created with.

### 6.2. The formula

> A hamster's reward = Prize pool × The hamster's score ÷ Total score of the match

Example: 100 hamsters at 0.0001 ETH → a 0.01 ETH pot and a 0.009 ETH prize pool. A hamster scoring 300 out of 9,000 total points earns 0.009 × 300 ÷ 9,000 = 0.0003 ETH, three times its entry fee.

Every hamster scores something, because every second alive counts. Hamsters that survive longer and knock out more earn a bigger share.

### 6.3. Claiming

- Claim once the match is **Confirmed**, i.e. 1 hour after the result.
- Each claim carries a **Merkle proof** of your score. The play page builds it for you.
- **Claim all:** rewards and refunds from many matches in **one transaction**.
- Money always goes to **the wallet that entered** the hamster in that match, even if the hamster changed hands later.

### 6.4. Claim window

Rewards and refunds can be claimed for **90 days** after a match ends. After that, whatever is unclaimed goes to the project treasury.

## 7. The player hub (/play)

Connect MetaMask on the Sepolia network to open the player hub. It has these sections:

| Section | What you can do |
|---|---|
| **Battle Arena** | Browse matches by tab — *Open*, *Registered*, *Finished*, *All*; **create a room**; open a match by its **Match ID**; join by **clicking the picture of the hamster** you want to send; click a match card to open **the match's own page** |
| **My Hamsters** | Mint new hamsters; see their NFT cards, stats and equipment; **deposit** or **withdraw** them |
| **Leaderboard** | Players ranked across confirmed matches |
| **Match History** | **Your** matches: win/loss, rank, knockouts, score, reward; replay any of them |
| **On-chain Records** | Match ID, wallet, result, rank, knockouts, transaction hash and **Confirmed** status; the **Claim all rewards** button (one transaction) |

## 8. Replaying matches

### 8.1. Every match has its own page

- Every match has **its own link**: `/play?match=<match number>`. Click a match card, or open a match from **Match History**, to reach its page; the browser's Back button takes you back to the list.
- The match page shows the start time with a countdown, the mode, the number of hamsters, the entry fee, the prize pool, your hamsters in the match, and the join / claim buttons.
- **Share:** the **🔗 Share** button copies the match's link. Whoever opens it sees an invitation to that match and lands right on it after connecting a wallet.

### 8.2. Live and replay

- You can watch **matches your hamster plays in**.
- **Live:** at the start time the match plays by itself on its page, in **real time**. Arrive late and you join at the moment it is at; no seeking, no pausing.
- **Replay:** a finished match has a **▶ Replay** button to watch it again from the start (pause allowed, no seeking).
- Hamster names, health bars and effects are always shown.
- **Your hamster stands out:** its name in **dark red**, bold, with a ▼ marker, a red ring at its feet, and visible even when the camera is far away.

### 8.3. Three camera modes

| Mode | How it works |
|---|---|
| **Auto (director)** | The camera looks 6 s ahead and cuts to the best action: the Crown changing hands, knockouts, big brawls, supply crates, and the final when 3 hamsters remain. In quiet moments it pulls back to show the safe zone. Each shot holds at least 1.8 s so it never jitters |
| **Follow** | Click a hamster to stick to it |
| **Free** | Scroll to zoom, drag to pan, click the minimap to jump there |

The **👤 Follow yourself** button zooms the camera in close on your hamster and follows it. With several hamsters in the match, each press moves to the next one, living ones first.

Press **Space** to pause / resume a replay.

### 8.4. On screen

- **Status bar:** hamsters alive, clock, storm phase and damage, the Crown holder, camera mode.
- **Kill feed:** the last 7 knockouts with the weapon used.
- **Live scoreboard:** the top 8 by score, split into survival and knockout points.
- **Minimap:** the safe circle and every hamster (gold is the Crown holder).
- **Hamster inspector:** temperament, health, weapon, bag, equipment, the five stats, and what the AI is focusing on right now.
- **Effects:** weapon-specific swings, damage numbers, DODGE, stuns, heals, dash trails, the Crown's glow.

### 8.5. Result screen

- The winner, its knockouts, damage and survival time.
- The Crown timeline.
- Full standings: rank, score, survival points, knockout points, knockouts, damage dealt and taken, healing, time of knockout, weapon.
- The match hashes, to check against the result on the blockchain.

### 8.6. Gameplay preview

The home page has a **Gameplay preview**: highlight clips playing on a loop (the opening brawl, the Crown hunt, supply crates, the final circle), no wallet needed.

## 9. Fairness and transparency

- **Nobody picks the outcome:** the seed comes from a block that does not exist while entries are open, and it sets the drop points.
- **Nobody changes a hamster:** DNA, equipment and stats are fixed at mint; a deposited hamster cannot change hands.
- **Anyone can verify:** re-simulating a match from on-chain data always reproduces the posted result.
- **There is a safety net:** a 1-hour confirmation window to correct a wrong result; full refunds when a match does not take place.
- **Money goes to the right person:** rewards are paid to the wallet that entered, and nobody can claim them for someone else.

## 10. Roadmap

### Phase 1 — ETH

The current phase. Everything in the game is paid in **ETH**:

- minting hamsters (currently free, gas only);
- entry fees;
- the 90% prize pool shared by score, and refunds;
- all the rules, NFTs, deposits, match schedule, confirmation and rewards described in this whitepaper.

### Phase 2 — The Squeek Royale token

- Launch of **Squeek Royale's own token**, **replacing ETH** in the game: entry fees, prize pools and other payments are all in the token.
- **New mechanisms** built around the token. Details will be announced before Phase 2 starts.
- Hamster NFTs carry over unchanged: DNA, equipment and stats stay the same in Phase 2.

## 11. Network and contracts

Squeek Royale runs on the **Ethereum Sepolia testnet**.

| Contract | Address |
|---|---|
| Squeek Hamster (NFT) | `0xe4F5EfF02521a2795929Bb95e5cC7a0AEeE1A9f4` |
| Squeek Arena | `0x6caDE76e89930Dc64818697f8D3788ecA46551Eb` |

- Connect with MetaMask on the Sepolia network.
- NFT card art may be upgraded later. Names, DNA, equipment and stats never change.
- The collection supports royalties on resales (at most 10%).
