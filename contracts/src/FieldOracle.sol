// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {FieldToken} from "./FieldToken.sol";
import {Subscription} from "./Subscription.sol";

/// @title FieldOracle - on-chain home of the volunteer + NASA data fusion
/// @notice Each epoch (one day of volunteer readings):
///   1. the backend COMMITS a hash of the batch of readings (commitBatch),
///   2. a CRE workflow, run by the DON, fetches that batch and NASA POWER data, validates,
///      fuses, and delivers one signed report through the forwarder (onReport),
///   3. the contract stores the per-cell correction factors and a Merkle root of volunteer
///      rewards, and reserves backing funds for them,
///   4. volunteers claim FIELD with a Merkle proof (claim).
/// @dev Implements IReceiver directly. The forwarder address is immutable.
contract FieldOracle is Ownable, IReceiver {
    /// @dev Shape of one cell inside the report. Must match workflow/field-workflow/core/encode.ts.
    struct CellResult {
        bytes32 cellId;
        int16 tempBiasX10; // volunteer minus NASA temperature, in tenths of a degree C
        uint16 rainRatioBps; // volunteer / NASA rainfall, 10_000 = 1.0
        uint16 moistureX100; // median volunteer soil moisture, percent x 100
        uint16 qualityBps; // 0 = not attested, 10_000 = best
        uint8 accepted; // number of readings accepted for this cell
    }

    /// @dev Latest result per cell, packed into one storage slot (120 bits).
    struct StoredCell {
        uint32 epoch;
        int16 tempBiasX10;
        uint16 rainRatioBps;
        uint16 moistureX100;
        uint16 qualityBps;
        uint8 accepted;
    }

    uint16 public constant MAX_BPS = 10_000;

    // Reasons emitted with EpochSkipped
    uint8 public constant SKIP_OUT_OF_ORDER = 1;
    uint8 public constant SKIP_COMMITMENT_MISMATCH = 2;

    address public immutable FORWARDER;
    Subscription public immutable SUBSCRIPTION;
    FieldToken public immutable TOKEN;

    address public committer;
    uint256 public lastCommittedEpoch;
    uint256 public lastSettledEpoch;

    mapping(uint256 epoch => bytes32) public batchCommitment;
    mapping(uint256 epoch => bytes32) public rewardRoot;
    mapping(uint256 epoch => uint256) public epochRewards;
    mapping(uint256 epoch => uint256) public epochClaimed;
    mapping(uint256 epoch => mapping(address account => bool)) public claimed;
    mapping(bytes32 cellId => StoredCell) private _cells;

    event CommitterSet(address indexed committer);
    event BatchCommitted(uint256 indexed epoch, bytes32 batchHash);
    event CellResultPosted(
        uint256 indexed epoch,
        bytes32 indexed cellId,
        int16 tempBiasX10,
        uint16 rainRatioBps,
        uint16 moistureX100,
        uint16 qualityBps,
        uint8 accepted
    );
    event EpochSettled(
        uint256 indexed epoch,
        bytes32 batchHash,
        bytes32 rewardRoot,
        uint256 totalRewards,
        uint256 cells
    );
    event EpochSkipped(uint256 indexed epoch, uint8 reason);
    event RewardsUnfunded(uint256 indexed epoch, uint256 totalRewards);
    event RewardClaimed(uint256 indexed epoch, address indexed account, uint256 amount);

    error InvalidSender(address sender, address expected);
    error NotCommitter();
    error WrongEpoch(uint256 expected, uint256 got);
    error EmptyHash();
    error InvalidReport();
    error NoRewards();
    error AlreadyClaimed();
    error InvalidProof();
    error ExceedsEpochRewards();
    error ZeroAddress();

    modifier onlyCommitter() {
        if (msg.sender != committer) revert NotCommitter();
        _;
    }

    constructor(address forwarder_, Subscription subscription_, FieldToken token_)
        Ownable(msg.sender)
    {
        if (forwarder_ == address(0)) revert ZeroAddress();
        FORWARDER = forwarder_;
        SUBSCRIPTION = subscription_;
        TOKEN = token_;
    }

    // ------------------------------------------------------------------ admin

    function setCommitter(address committer_) external onlyOwner {
        committer = committer_;
        emit CommitterSet(committer_);
    }

    // ----------------------------------------------------------- commit phase

    /// @notice Pin the batch of volunteer readings BEFORE settlement, so the data cannot be
    ///         swapped afterwards. Epochs are consecutive: 1, 2, 3, ...
    function commitBatch(uint256 epoch, bytes32 batchHash) external onlyCommitter {
        if (epoch != lastCommittedEpoch + 1) revert WrongEpoch(lastCommittedEpoch + 1, epoch);
        if (batchHash == bytes32(0)) revert EmptyHash();
        lastCommittedEpoch = epoch;
        batchCommitment[epoch] = batchHash;
        emit BatchCommitted(epoch, batchHash);
    }

    // ------------------------------------------------------ CRE settlement

    /// @inheritdoc IReceiver
    /// @dev Stale, duplicate or mismatching reports are skipped with an event, never reverted:
    ///      a revert would only make the forwarder retry something that cannot succeed.
    function onReport(
        bytes calldata,
        /* metadata */
        bytes calldata report
    )
        external
        override
    {
        if (msg.sender != FORWARDER) revert InvalidSender(msg.sender, FORWARDER);

        (
            uint256 epoch,
            bytes32 batchHash,
            bytes32 root,
            uint256 totalRewards,
            CellResult[] memory results
        ) = abi.decode(report, (uint256, bytes32, bytes32, uint256, CellResult[]));

        if (epoch != lastSettledEpoch + 1 || epoch > lastCommittedEpoch) {
            emit EpochSkipped(epoch, SKIP_OUT_OF_ORDER);
            return;
        }
        if (batchCommitment[epoch] != batchHash) {
            emit EpochSkipped(epoch, SKIP_COMMITMENT_MISMATCH);
            return;
        }

        lastSettledEpoch = epoch;

        for (uint256 i = 0; i < results.length; i++) {
            CellResult memory r = results[i];
            if (r.qualityBps > MAX_BPS) revert InvalidReport();
            // Epochs are sequential from 1 (one per day), so they cannot approach 2**32.
            // forge-lint: disable-next-line(unsafe-typecast)
            _cells[r.cellId] = StoredCell({
                epoch: uint32(epoch),
                tempBiasX10: r.tempBiasX10,
                rainRatioBps: r.rainRatioBps,
                moistureX100: r.moistureX100,
                qualityBps: r.qualityBps,
                accepted: r.accepted
            });
            emit CellResultPosted(
                epoch,
                r.cellId,
                r.tempBiasX10,
                r.rainRatioBps,
                r.moistureX100,
                r.qualityBps,
                r.accepted
            );
        }

        if (totalRewards > 0 && root != bytes32(0)) {
            uint256 usdcNeeded = TOKEN.usdcValueCeil(totalRewards);
            if (SUBSCRIPTION.availableForRewards() >= usdcNeeded) {
                SUBSCRIPTION.reserve(usdcNeeded);
                rewardRoot[epoch] = root;
                epochRewards[epoch] = totalRewards;
            } else {
                emit RewardsUnfunded(epoch, totalRewards);
            }
        }

        emit EpochSettled(epoch, batchHash, rewardRoot[epoch], epochRewards[epoch], results.length);
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return
            interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ----------------------------------------------------------- volunteers

    /// @notice Claim FIELD for an epoch. `amount` and `proof` come from the backend; the leaf is
    ///         keccak256(bytes.concat(keccak256(abi.encode(account, amount)))).
    function claim(uint256 epoch, uint256 amount, bytes32[] calldata proof) external {
        bytes32 root = rewardRoot[epoch];
        if (root == bytes32(0)) revert NoRewards();
        if (claimed[epoch][msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, root, leaf)) revert InvalidProof();

        uint256 newTotal = epochClaimed[epoch] + amount;
        if (newTotal > epochRewards[epoch]) revert ExceedsEpochRewards();

        claimed[epoch][msg.sender] = true;
        epochClaimed[epoch] = newTotal;
        TOKEN.mint(msg.sender, amount);
        emit RewardClaimed(epoch, msg.sender, amount);
    }

    // ---------------------------------------------------------------- views

    function getCell(bytes32 cellId) external view returns (StoredCell memory) {
        return _cells[cellId];
    }

    /// @notice Maximum FIELD the next epoch can distribute. The workflow reads this and caps rewards.
    function availableRewardBudget() external view returns (uint256) {
        return TOKEN.fieldValue(SUBSCRIPTION.availableForRewards());
    }
}
