// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Subscription} from "./Subscription.sol";

/// @title FieldToken (FIELD) - the volunteer reward token
/// @notice Fully backed: FIELD can only be minted for rewards the oracle already reserved in
///         the Subscription reward pool, and redeeming burns FIELD for that USDC.
///         Rate: 10 FIELD = 1 USDC.
contract FieldToken is ERC20, Ownable {
    uint256 public constant FIELD_PER_USDC = 10;
    // FIELD has 18 decimals, USDC has 6, so 1 USDC unit = FIELD_PER_USDC * 1e12 FIELD wei.
    uint256 private constant UNIT = FIELD_PER_USDC * 1e12;

    Subscription public immutable SUBSCRIPTION;
    address public oracle;

    event OracleSet(address indexed oracle);
    event Redeemed(address indexed account, uint256 fieldBurned, uint256 usdcPaid);

    error NotOracle();
    error OracleAlreadySet();
    error ZeroAddress();
    error NothingToRedeem();

    constructor(Subscription subscription_)
        ERC20("Field Truth Token", "FIELD")
        Ownable(msg.sender)
    {
        SUBSCRIPTION = subscription_;
    }

    function setOracle(address oracle_) external onlyOwner {
        if (oracle != address(0)) revert OracleAlreadySet();
        if (oracle_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        emit OracleSet(oracle_);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != oracle) revert NotOracle();
        _mint(to, amount);
    }

    /// @notice USDC value of a FIELD amount, rounded down (what a redemption pays).
    function usdcValue(uint256 fieldAmount) public pure returns (uint256) {
        return fieldAmount / UNIT;
    }

    /// @notice USDC value rounded up (what the oracle must reserve so payouts are always covered).
    function usdcValueCeil(uint256 fieldAmount) public pure returns (uint256) {
        return (fieldAmount + UNIT - 1) / UNIT;
    }

    /// @notice FIELD that a USDC amount can back.
    function fieldValue(uint256 usdcAmount) public pure returns (uint256) {
        return usdcAmount * UNIT;
    }

    /// @notice Burn FIELD and receive backed USDC. Dust below 1 USDC base unit stays with you.
    function redeem(uint256 fieldAmount) external {
        uint256 usdcOut = usdcValue(fieldAmount);
        if (usdcOut == 0) revert NothingToRedeem();
        uint256 burnAmount = usdcOut * UNIT;
        _burn(msg.sender, burnAmount);
        SUBSCRIPTION.payOutReward(msg.sender, usdcOut);
        emit Redeemed(msg.sender, burnAmount, usdcOut);
    }
}
