// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC - TESTNET ONLY stable-coin stand-in with an open faucet
/// @dev Never deploy this to a network where the token has real value.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can mint test funds to any address.
    function faucet(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
