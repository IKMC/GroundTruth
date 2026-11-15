// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Subscription} from "../src/Subscription.sol";
import {FieldToken} from "../src/FieldToken.sol";
import {FieldOracle} from "../src/FieldOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys the whole system and wires the contracts together.
/// Env: FORWARDER (CRE forwarder / mock forwarder for the chain), COMMITTER (backend address).
/// On Sepolia use `--gas-estimate-multiplier 900` (see docs/06-RUNBOOK.md).
contract Deploy is Script {
    uint256 public constant PRICE_PER_PERIOD = 5e6; // 5 mUSDC
    uint256 public constant PERIOD_LENGTH = 30 days;
    uint16 public constant REWARD_BPS = 7_000; // 70% of subscriptions back volunteer rewards

    function run()
        external
        returns (MockUSDC usdc, Subscription sub, FieldToken token, FieldOracle oracle)
    {
        address forwarder = vm.envAddress("FORWARDER");
        address committer = vm.envAddress("COMMITTER");

        vm.startBroadcast();
        usdc = new MockUSDC();
        sub = new Subscription(IERC20(address(usdc)), PRICE_PER_PERIOD, PERIOD_LENGTH, REWARD_BPS);
        token = new FieldToken(sub);
        oracle = new FieldOracle(forwarder, sub, token);

        token.setOracle(address(oracle));
        sub.setWiring(address(oracle), address(token));
        oracle.setCommitter(committer);
        vm.stopBroadcast();

        console.log("MockUSDC     ", address(usdc));
        console.log("Subscription ", address(sub));
        console.log("FieldToken   ", address(token));
        console.log("FieldOracle  ", address(oracle));
    }
}
