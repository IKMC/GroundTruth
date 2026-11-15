// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {Subscription} from "../src/Subscription.sol";

contract SubscriptionTest is Base {
    function test_subscribe_splitsPaymentAndSetsExpiry() public {
        _subscribe(farmer, 2);
        // 10 mUSDC paid: 70% rewards, 30% treasury
        assertEq(sub.rewardPool(), 7e6);
        assertEq(sub.treasury(), 3e6);
        assertEq(usdc.balanceOf(address(sub)), 10e6);
        assertEq(sub.paidUntil(farmer), block.timestamp + 2 * PERIOD);
        assertTrue(sub.isActive(farmer));
    }

    function test_subscribe_extendsFromCurrentExpiryNotFromNow() public {
        _subscribe(farmer, 1);
        uint256 firstEnd = sub.paidUntil(farmer);
        vm.warp(block.timestamp + 10 days);
        _subscribe(farmer, 1);
        assertEq(sub.paidUntil(farmer), firstEnd + PERIOD);
    }

    function test_subscription_expires() public {
        _subscribe(farmer, 1);
        vm.warp(block.timestamp + PERIOD + 1);
        assertFalse(sub.isActive(farmer));
    }

    function test_subscribe_revertsOnBadPeriods() public {
        vm.expectRevert(Subscription.InvalidPeriods.selector);
        sub.subscribe(0);
        vm.expectRevert(Subscription.InvalidPeriods.selector);
        sub.subscribe(13);
    }

    function test_wiring_isOneTimeAndOwnerOnly() public {
        vm.expectRevert(Subscription.AlreadyWired.selector);
        sub.setWiring(address(1), address(2));
        vm.prank(farmer);
        vm.expectRevert();
        sub.setWiring(address(1), address(2));
    }

    function test_reserve_onlyOracleAndOnlyWithinPool() public {
        _subscribe(farmer, 1); // pool 3.5e6
        vm.expectRevert(Subscription.NotOracle.selector);
        sub.reserve(1);
        vm.startPrank(address(oracle));
        sub.reserve(3_000_000);
        assertEq(sub.availableForRewards(), 500_000);
        vm.expectRevert(Subscription.InsufficientRewardFunds.selector);
        sub.reserve(500_001);
        vm.stopPrank();
    }

    function test_payOut_onlyTokenAndOnlyReserved() public {
        _subscribe(farmer, 1);
        vm.prank(address(oracle));
        sub.reserve(1_000_000);
        vm.expectRevert(Subscription.NotToken.selector);
        sub.payOutReward(farmer, 1);
        vm.startPrank(address(token));
        vm.expectRevert(Subscription.InsufficientRewardFunds.selector);
        sub.payOutReward(farmer, 1_000_001);
        sub.payOutReward(farmer, 400_000);
        vm.stopPrank();
        assertEq(usdc.balanceOf(farmer), 400_000);
        assertEq(sub.reserved(), 600_000);
        assertEq(sub.rewardPool(), 3_100_000);
    }

    function test_treasury_withdrawOnlyOwnerAndOnlyTreasuryShare() public {
        _subscribe(farmer, 1); // treasury 1.5e6
        address team = makeAddr("team");
        vm.prank(farmer);
        vm.expectRevert();
        sub.withdrawTreasury(team, 1);
        vm.expectRevert(Subscription.InsufficientTreasury.selector);
        sub.withdrawTreasury(team, 1_500_001);
        sub.withdrawTreasury(team, 1_500_000);
        assertEq(usdc.balanceOf(team), 1_500_000);
        assertEq(sub.treasury(), 0);
        // the volunteer share can never leave through the treasury path
        assertEq(sub.rewardPool(), 3_500_000);
    }

    /// @dev Money conservation: every unit paid ends up in the pool or the treasury.
    function testFuzz_split_conservesMoney(uint8 periods) public {
        periods = uint8(bound(periods, 1, 12));
        _subscribe(farmer, periods);
        assertEq(sub.rewardPool() + sub.treasury(), uint256(periods) * PRICE);
        assertEq(usdc.balanceOf(address(sub)), sub.rewardPool() + sub.treasury());
    }
}
