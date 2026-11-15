// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {FieldToken} from "../src/FieldToken.sol";

contract FieldTokenTest is Base {
    address internal volunteer = makeAddr("volunteer");

    function test_mint_onlyOracle() public {
        vm.expectRevert(FieldToken.NotOracle.selector);
        token.mint(volunteer, 1);
        vm.prank(address(oracle));
        token.mint(volunteer, 5e18);
        assertEq(token.balanceOf(volunteer), 5e18);
    }

    function test_setOracle_onlyOnce() public {
        vm.expectRevert(FieldToken.OracleAlreadySet.selector);
        token.setOracle(address(1));
    }

    function test_conversions() public view {
        assertEq(token.usdcValue(10e18), 1e6); // 10 FIELD = 1 USDC
        assertEq(token.fieldValue(1e6), 10e18);
        assertEq(token.usdcValueCeil(10e18 + 1), 1e6 + 1);
        assertEq(token.usdcValue(10e18 - 1), 1e6 - 1);
    }

    function test_redeem_burnsExactUnitsAndPaysUsdc() public {
        _subscribe(farmer, 1); // pool 3.5e6
        vm.startPrank(address(oracle));
        sub.reserve(2_000_000);
        token.mint(volunteer, 20e18);
        vm.stopPrank();

        vm.prank(volunteer);
        token.redeem(5e18); // 0.5 USDC
        assertEq(usdc.balanceOf(volunteer), 500_000);
        assertEq(token.balanceOf(volunteer), 15e18);
        assertEq(sub.reserved(), 1_500_000);
    }

    function test_redeem_dustStaysWithHolder() public {
        _subscribe(farmer, 1);
        vm.startPrank(address(oracle));
        sub.reserve(1_000_000);
        token.mint(volunteer, 10e18 + 123);
        vm.stopPrank();
        vm.prank(volunteer);
        token.redeem(10e18 + 123);
        assertEq(token.balanceOf(volunteer), 123); // dust kept, not burned
        assertEq(usdc.balanceOf(volunteer), 1e6);
    }

    function test_redeem_revertsBelowOneUsdcUnit() public {
        vm.prank(address(oracle));
        token.mint(volunteer, 1e12);
        vm.prank(volunteer);
        vm.expectRevert(FieldToken.NothingToRedeem.selector);
        token.redeem(1e12); // below 10 * 1e12 wei = 1 USDC base unit
    }

    function test_redeem_revertsWithoutReservedFunds() public {
        _subscribe(farmer, 1);
        vm.prank(address(oracle));
        token.mint(volunteer, 10e18); // minted but nothing reserved: must not be redeemable
        vm.prank(volunteer);
        vm.expectRevert();
        token.redeem(10e18);
    }

    /// @dev Rounding safety: the amount the oracle reserves (ceil) is never below what
    ///      redemptions can pay out (floor), and never more than one base unit above it.
    function testFuzz_ceilCoversFloorWithinOneUnit(uint96 fieldAmount) public view {
        uint256 amount = bound(fieldAmount, 1, 1_000_000e18);
        uint256 floorValue = token.usdcValue(amount);
        uint256 ceilValue = token.usdcValueCeil(amount);
        assertGe(ceilValue, floorValue);
        assertLe(ceilValue - floorValue, 1);
    }
}
