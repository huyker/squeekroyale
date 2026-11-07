// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {HamsterGenome} from "./HamsterGenome.sol";

/// @notice Draws the card image of a hamster. Only the IMAGE is replaceable: name, DNA,
///         equipment and stats in the metadata always come from SqueekHamster itself.
interface IHamsterArt {
    /// @return a full image URI (data:image/svg+xml;base64,... or https://...)
    function imageURI(uint256 tokenId, uint256 dna, HamsterGenome.Traits calldata traits) external view returns (string memory);
}

/// @title Squeek Hamster — battle royale hamster NFT
/// @notice Minting draws a 256-bit DNA. The DNA alone fixes the hamster's look, its three
///         equipment items and the five stats those items grant (STR, AGI, ARM, VIT, PER),
///         decoded by HamsterGenome exactly like the game (src/core/hamster.js). The DNA
///         never changes, so a hamster is the same in every arena it enters.
///
///         What the owner can change later, and what not:
///           - the card IMAGE: setArt() points to an IHamsterArt renderer (built-in SVG when
///             unset or when it fails); lockArt() freezes the choice for good. Marketplaces
///             are told to refresh (EIP-4906).
///           - royalties (EIP-2981), at most MAX_ROYALTY_BPS; contractURI (collection page).
///           - never: DNA, equipment, stats, names, supply.
/// @dev Testnet randomness: DNA mixes prevrandao and the previous blockhash. Good enough
///      for cosmetics/stats on a testnet; use a VRF before anything of value depends on it.
contract SqueekHamster is ERC721Enumerable, ERC2981, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MAX_PER_TX = 10;

    uint96 public constant MAX_ROYALTY_BPS = 1_000;          // 10 %

    uint256 public mintPrice;
    uint256 public totalMinted;
    mapping(uint256 => uint256) public dnaOf;
    address public art;                 // IHamsterArt; zero = built-in SVG
    bool public artLocked;
    string public contractURI;          // collection metadata (marketplaces)

    event HamsterMinted(uint256 indexed tokenId, address indexed owner, uint256 dna);
    event MintPriceChanged(uint256 price);
    event ArtChanged(address art);
    event ArtLocked();
    event ContractURIUpdated();
    event MetadataUpdate(uint256 tokenId);                       // EIP-4906
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    error BadQuantity();
    error SoldOut();
    error WrongPayment();
    error NoToken();
    error Locked();
    error BadRoyalty();

    constructor(address owner_, uint256 mintPrice_) ERC721("Squeek Hamster", "SQHAM") Ownable(owner_) {
        mintPrice = mintPrice_;
    }

    /// @notice Mint `quantity` hamsters to the caller. Returns the first token id.
    function mint(uint256 quantity) external payable returns (uint256 firstId) {
        if (quantity == 0 || quantity > MAX_PER_TX) revert BadQuantity();
        if (totalMinted + quantity > MAX_SUPPLY) revert SoldOut();
        if (msg.value != mintPrice * quantity) revert WrongPayment();
        firstId = totalMinted + 1;
        for (uint256 i = 0; i < quantity; i++) {
            uint256 id = firstId + i;
            uint256 dna = uint256(keccak256(abi.encode(
                block.prevrandao, blockhash(block.number - 1), msg.sender, id, block.chainid, address(this))));
            dnaOf[id] = dna;
            _safeMint(msg.sender, id);
            emit HamsterMinted(id, msg.sender, dna);
        }
        totalMinted += quantity;
    }

    /// @notice Equipment + stats of a hamster (same numbers the game uses).
    function traitsOf(uint256 tokenId) public view returns (HamsterGenome.Traits memory) {
        if (dnaOf[tokenId] == 0) revert NoToken();
        return HamsterGenome.decode(dnaOf[tokenId]);
    }

    /// @notice Everything a client needs to draw and simulate a hamster in one call.
    function hamsterOf(uint256 tokenId) external view returns (uint256 dna, string memory name_, HamsterGenome.Traits memory traits) {
        dna = dnaOf[tokenId];
        if (dna == 0) revert NoToken();
        return (dna, HamsterGenome.name(dna), HamsterGenome.decode(dna));
    }

    /// @notice All token ids held by `owner` (small wallets; for UIs).
    function tokensOfOwner(address owner) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(owner);
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) ids[i] = tokenOfOwnerByIndex(owner, i);
    }

    /// @notice New card art for every hamster (zero address = built-in SVG). Stats unaffected.
    function setArt(address art_) external onlyOwner {
        if (artLocked) revert Locked();
        art = art_;
        emit ArtChanged(art_);
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    /// @notice Freeze the card art for good.
    function lockArt() external onlyOwner {
        artLocked = true;
        emit ArtLocked();
    }

    /// @notice Royalty on secondary sales (EIP-2981); receiver 0 removes it.
    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert BadRoyalty();
        if (receiver == address(0)) _deleteDefaultRoyalty();
        else _setDefaultRoyalty(receiver, bps);
    }

    function setContractURI(string calldata uri) external onlyOwner {
        contractURI = uri;
        emit ContractURIUpdated();
    }

    function supportsInterface(bytes4 id) public view override(ERC721Enumerable, ERC2981) returns (bool) {
        return id == bytes4(0x49064906) || super.supportsInterface(id);
    }

    function setMintPrice(uint256 price) external onlyOwner {
        mintPrice = price;
        emit MintPriceChanged(price);
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    // ------------------------------------------------------------------ metadata
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 dna = dnaOf[tokenId];
        HamsterGenome.Traits memory t = HamsterGenome.decode(dna);
        string memory nm = string.concat(HamsterGenome.name(dna), " #", tokenId.toString());
        string memory json = string.concat(
            '{"name":"', nm,
            '","description":"Squeek Hamster battle royale fighter. Equipment sets the stats; DNA fixes everything.",',
            '"image":"', _image(tokenId, dna, nm, t), '",',
            '"attributes":', _attributes(t), ',"dna":"', uint256(dna).toHexString(32), '"}');
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// The renderer if one is set and answers; the built-in card otherwise (never a broken token).
    function _image(uint256 tokenId, uint256 dna, string memory nm, HamsterGenome.Traits memory t) private view returns (string memory) {
        if (art != address(0)) {
            try IHamsterArt(art).imageURI(tokenId, dna, t) returns (string memory uri) {
                if (bytes(uri).length > 0) return uri;
            } catch {}
        }
        return string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(_svg(nm, t))));
    }

    function _attr(string memory k, string memory v) private pure returns (string memory) {
        return string.concat('{"trait_type":"', k, '","value":"', v, '"}');
    }

    function _num(string memory k, uint8 v) private pure returns (string memory) {
        return string.concat('{"trait_type":"', k, '","display_type":"number","value":', uint256(v).toString(), '}');
    }

    function _attributes(HamsterGenome.Traits memory t) private pure returns (string memory) {
        string memory look = string.concat(
            _attr("Fur", HamsterGenome.furName(t.fur)), ",", _attr("Pattern", HamsterGenome.patternName(t.pattern)), ",",
            _attr("Eyes", HamsterGenome.eyesName(t.eyes)), ",", _attr("Outfit", HamsterGenome.bodyName(t.body)), ",",
            _attr("Headwear", HamsterGenome.headName(t.head)), ",", _attr("Back", HamsterGenome.backName(t.back)));
        string memory stats = string.concat(
            _num("Strength", t.str), ",", _num("Agility", t.agi), ",", _num("Armor", t.arm), ",",
            _num("Vitality", t.vit), ",", _num("Perception", t.per));
        return string.concat("[", look, ",", stats, "]");
    }

    function _bar(uint256 y, string memory label, uint8 v) private pure returns (string memory) {
        return string.concat(
            '<text x="24" y="', (y + 13).toString(), '" class="l">', label, '</text>',
            '<rect x="70" y="', y.toString(), '" width="200" height="16" rx="8" fill="#2b2140"/>',
            '<rect x="70" y="', y.toString(), '" width="', (uint256(v) * 9).toString(), '" height="16" rx="8" fill="#ffd34d"/>',
            '<text x="282" y="', (y + 13).toString(), '" class="l">', uint256(v).toString(), '</text>');
    }

    function _svg(string memory nm, HamsterGenome.Traits memory t) private pure returns (string memory) {
        string memory fur = HamsterGenome.furHex(t.fur);
        string memory head = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 400"><style>.l{font:bold 13px sans-serif;fill:#f8eadb}.t{font:bold 18px sans-serif;fill:#ffd34d}</style>',
            '<rect width="320" height="400" rx="24" fill="#1a1426"/>',
            '<circle cx="160" cy="112" r="64" fill="#', fur, '" stroke="#2d2418" stroke-width="6"/>',
            '<circle cx="112" cy="62" r="20" fill="#', fur, '" stroke="#2d2418" stroke-width="5"/>',
            '<circle cx="208" cy="62" r="20" fill="#', fur, '" stroke="#2d2418" stroke-width="5"/>',
            '<circle cx="138" cy="106" r="8" fill="#2d2418"/><circle cx="182" cy="106" r="8" fill="#2d2418"/>',
            '<ellipse cx="160" cy="132" rx="26" ry="18" fill="#f8eadb"/>');
        string memory txt = string.concat(
            '<text x="160" y="208" text-anchor="middle" class="t">', nm, '</text>',
            '<text x="160" y="230" text-anchor="middle" class="l">', HamsterGenome.bodyName(t.body), ' / ',
            HamsterGenome.headName(t.head), ' / ', HamsterGenome.backName(t.back), '</text>');
        string memory bars = string.concat(
            _bar(250, "STR", t.str), _bar(276, "AGI", t.agi), _bar(302, "ARM", t.arm), _bar(328, "VIT", t.vit), _bar(354, "PER", t.per));
        return string.concat(head, txt, bars, "</svg>");
    }
}
