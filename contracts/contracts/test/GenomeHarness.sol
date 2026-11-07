// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HamsterGenome} from "../HamsterGenome.sol";

/// Test-only: exposes the genome library for parity checks against src/core/hamster.js.
contract GenomeHarness {
    function decode(uint256 dna) external pure returns (HamsterGenome.Traits memory) { return HamsterGenome.decode(dna); }
    function name(uint256 dna) external pure returns (string memory) { return HamsterGenome.name(dna); }
}
