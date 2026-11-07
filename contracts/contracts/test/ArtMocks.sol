// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HamsterGenome} from "../HamsterGenome.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// Test-only renderers for SqueekHamster.setArt.
contract ArtMock {
    function imageURI(uint256 tokenId, uint256, HamsterGenome.Traits calldata t) external pure returns (string memory) {
        return string.concat("https://art.example/", _u(tokenId), "?str=", _u(t.str));
    }
    function _u(uint256 v) private pure returns (string memory s) {
        if (v == 0) return "0";
        while (v > 0) { s = string.concat(string(abi.encodePacked(bytes1(uint8(48 + v % 10)))), s); v /= 10; }
    }
}

contract BrokenArtMock {
    function imageURI(uint256, uint256, HamsterGenome.Traits calldata) external pure returns (string memory) {
        revert("broken");
    }
}

/// Test-only: an ERC-721 that is not a Squeek Hamster, to check the arena refuses it.
contract ForeignSender {
    function poke(address arena, uint256 tokenId) external returns (bytes4) {
        (bool ok, bytes memory r) = arena.call(abi.encodeWithSignature(
            "onERC721Received(address,address,uint256,bytes)", address(this), msg.sender, tokenId, ""));
        require(ok, "rejected");
        return abi.decode(r, (bytes4));
    }
    function noop(IERC721) external {}
}
