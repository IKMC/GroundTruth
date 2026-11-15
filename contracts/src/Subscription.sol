// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Subscription - farmers pay for verified advice, the money backs volunteer rewards
/// @notice Every payment is split: `rewardBps` goes to the reward pool, the rest to the treasury
///         that keeps the app running. The reward pool is what makes the FIELD token backed:
///         the oracle can only create rewards by *reserving* pool funds first.
contract Subscription is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PERIODS = 12;
    uint16 public constant BPS = 10_000;

    IERC20 public immutable USDC;
    uint256 public immutable PRICE_PER_PERIOD; // in USDC base units
    uint256 public immutable PERIOD_LENGTH; // seconds
    uint16 public immutable REWARD_BPS; // share of each payment that backs rewards

    address public oracle; // may reserve funds
    address public token; // may pay out redemptions

    uint256 public rewardPool; // USDC set aside for volunteers (reserved or not)
    uint256 public reserved; // part of rewardPool already promised to unredeemed FIELD
    uint256 public treasury; // USDC the team can withdraw to run the app

    mapping(address farmer => uint256 timestamp) public paidUntil;

    event Subscribed(address indexed farmer, uint256 periods, uint256 amount, uint256 paidUntil);
    event WiringSet(address indexed oracle, address indexed token);
    event Reserved(uint256 amount, uint256 reservedTotal);
    event RewardPaid(address indexed to, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);

    error InvalidPeriods();
    error AlreadyWired();
    error ZeroAddress();
    error NotOracle();
    error NotToken();
    error InsufficientRewardFunds();
    error InsufficientTreasury();

    constructor(IERC20 usdc_, uint256 pricePerPeriod_, uint256 periodLength_, uint16 rewardBps_)
        Ownable(msg.sender)
    {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        require(rewardBps_ <= BPS && periodLength_ > 0 && pricePerPeriod_ > 0, "bad params");
        USDC = usdc_;
        PRICE_PER_PERIOD = pricePerPeriod_;
        PERIOD_LENGTH = periodLength_;
        REWARD_BPS = rewardBps_;
    }

    /// @notice One-time wiring, needed because the three contracts reference each other.
    function setWiring(address oracle_, address token_) external onlyOwner {
        if (oracle != address(0) || token != address(0)) revert AlreadyWired();
        if (oracle_ == address(0) || token_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        token = token_;
        emit WiringSet(oracle_, token_);
    }

    /// @notice Pay for `periods` periods of access. Requires prior USDC approval.
    function subscribe(uint256 periods) external {
        if (periods == 0 || periods > MAX_PERIODS) revert InvalidPeriods();

        uint256 amount = PRICE_PER_PERIOD * periods;
        uint256 toRewards = (amount * REWARD_BPS) / BPS;
        rewardPool += toRewards;
        treasury += amount - toRewards;

        uint256 start =
            paidUntil[msg.sender] > block.timestamp ? paidUntil[msg.sender] : block.timestamp;
        uint256 newEnd = start + periods * PERIOD_LENGTH;
        paidUntil[msg.sender] = newEnd;

        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Subscribed(msg.sender, periods, amount, newEnd);
    }

    function isActive(address farmer) public view returns (bool) {
        return paidUntil[farmer] > block.timestamp;
    }

    /// @notice USDC in the reward pool not yet promised to anyone.
    function availableForRewards() public view returns (uint256) {
        return rewardPool - reserved;
    }

    /// @notice Called by the oracle when an epoch creates rewards.
    function reserve(uint256 usdcAmount) external {
        if (msg.sender != oracle) revert NotOracle();
        if (usdcAmount > availableForRewards()) revert InsufficientRewardFunds();
        reserved += usdcAmount;
        emit Reserved(usdcAmount, reserved);
    }

    /// @notice Called by the token when a volunteer redeems FIELD.
    function payOutReward(address to, uint256 usdcAmount) external {
        if (msg.sender != token) revert NotToken();
        if (usdcAmount > reserved) revert InsufficientRewardFunds();
        reserved -= usdcAmount;
        rewardPool -= usdcAmount;
        USDC.safeTransfer(to, usdcAmount);
        emit RewardPaid(to, usdcAmount);
    }

    /// @notice The team withdraws operating funds (the non-reward share).
    function withdrawTreasury(address to, uint256 amount) external onlyOwner {
        if (amount > treasury) revert InsufficientTreasury();
        treasury -= amount;
        USDC.safeTransfer(to, amount);
        emit TreasuryWithdrawn(to, amount);
    }
}
