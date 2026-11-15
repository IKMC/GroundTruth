// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Subscription} from "../src/Subscription.sol";
import {FieldToken} from "../src/FieldToken.sol";
import {FieldOracle} from "../src/FieldOracle.sol";

/// @dev Deploys and wires the whole system exactly like script/Deploy.s.sol.
abstract contract Base is Test {
    uint256 internal constant PRICE = 5e6;
    uint256 internal constant PERIOD = 30 days;
    uint16 internal constant REWARD_BPS = 7_000;

    address internal forwarder = makeAddr("forwarder");
    address internal committer = makeAddr("committer");
    address internal farmer = makeAddr("farmer");

    MockUSDC internal usdc;
    Subscription internal sub;
    FieldToken internal token;
    FieldOracle internal oracle;

    function setUp() public virtual {
        usdc = new MockUSDC();
        sub = new Subscription(IERC20(address(usdc)), PRICE, PERIOD, REWARD_BPS);
        token = new FieldToken(sub);
        oracle = new FieldOracle(forwarder, sub, token);
        token.setOracle(address(oracle));
        sub.setWiring(address(oracle), address(token));
        oracle.setCommitter(committer);
    }

    function _subscribe(address who, uint256 periods) internal {
        usdc.faucet(who, PRICE * periods);
        vm.startPrank(who);
        usdc.approve(address(sub), PRICE * periods);
        sub.subscribe(periods);
        vm.stopPrank();
    }
}
