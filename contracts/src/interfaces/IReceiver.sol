// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver - receives keystone reports from the CRE forwarder
/// @notice Implementations must support the IReceiver interface through ERC165.
interface IReceiver is IERC165 {
    /// @notice Handles an incoming report.
    /// @dev If this call reverts it can be retried with a higher gas limit,
    /// so receivers should discard stale or duplicate reports instead of reverting.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
