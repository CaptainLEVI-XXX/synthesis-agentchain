// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArbiter} from "./interfaces/IArbiter.sol";
import {Attestation, DelegationHop} from "./interfaces/ICommon.sol";
import {IDelegationTracker} from "./interfaces/IDelegationTracker.sol";
import {IDelegationManager} from "./interfaces/IDelegationManager.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";

/// @title AgentChainArbiter
/// @notice Alkahest arbiter with three novel verification mechanisms:
///         1. Delegation chain integrity — verifies MetaMask delegation hashes are live
///         2. Stake-weighted consensus — weights completion by agent stake
///         3. Reputation-gated release — ERC-8004 reputation as a condition
/// @dev Implements Alkahest IArbiter. Called by Alkahest during collectEscrowRaw().
contract AgentChainArbiter is IArbiter {
    using CustomRevert for bytes4;

    // ─── Custom Errors ─────────────────────────────────────

    error NotTaskCreator(address caller, address creator);
    error TaskNotAccepted(bytes32 taskId);
    error InvalidRating(int128 value);
    error TaskNotSettleable(bytes32 taskId);

    // ─── State ─────────────────────────────────────────────

    IDelegationTracker public immutable tracker;
    IDelegationManager public immutable delegationManager;
    IReputationRegistry public immutable reputation;
    IAgentRegistry public immutable agentRegistry;

    /// @notice Encoded in Alkahest escrow's demand field. Contains ONLY verification params.
    ///         taskId and orchestrator are derived from the obligation UID (= escrow UID = taskId)
    ///         and tracker state, NOT from demand data (fixes C1 audit issue).
    struct DemandData {
        uint256 stakeThresholdBps;     // e.g., 7500 = 75%
        int128 minReputation;
        bool reputationRequired;
    }

    // ─── Events ────────────────────────────────────────────

    event TaskVerified(
        bytes32 indexed taskId,
        uint256 workRecordCount,
        uint256 stakeWeightedScore,
        bool allDelegationsIntact
    );
    event ReputationSubmitted(bytes32 indexed taskId, uint256 agentCount, int128 rating);

    // ─── Constructor ───────────────────────────────────────

    constructor(
        address _tracker,
        address _delegationManager,
        address _reputation,
        address _agentRegistry
    ) {
        tracker = IDelegationTracker(_tracker);
        delegationManager = IDelegationManager(_delegationManager);
        reputation = IReputationRegistry(_reputation);
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ═══════════════════════════════════════════════════════
    //  ALKAHEST ARBITER: checkObligation()
    //  Called by Alkahest escrow during collectEscrowRaw().
    // ═══════════════════════════════════════════════════════

    /// @notice Called by Alkahest to verify if escrow should be released.
    ///         Derives taskId from obligation.uid (= escrow UID).
    ///         Reads orchestrator from tracker state.
    function checkObligation(
        Attestation memory obligation,
        bytes memory demand,
        bytes32                  // fulfilling (unused)
    ) external view override returns (bool) {
        DemandData memory d = abi.decode(demand, (DemandData));

        // taskId = escrow UID = obligation attestation UID (fix C1)
        bytes32 taskId = obligation.uid;

        // Read orchestrator from tracker state (not from demand)
        (, address taskOrchestrator,,,,,,) = tracker.tasks(taskId);
        if (taskOrchestrator == address(0)) return false;

        // Get all delegation hops for this task
        DelegationHop[] memory hops = tracker.getTaskDelegations(taskId);
        if (hops.length == 0) return false;

        // ─── LAYER 1: Delegation Chain Integrity ────────────
        for (uint256 i = 0; i < hops.length; i++) {
            if (delegationManager.disabledDelegations(hops[i].delegationHash)) {
                return false;
            }
        }

        // ─── LAYER 2: Stake-Weighted Consensus ─────────────
        uint256 totalStake = 0;
        uint256 completedStake = 0;

        for (uint256 i = 0; i < hops.length; i++) {
            uint256 agentStake = agentRegistry.stakes(hops[i].delegate);
            totalStake += agentStake;

            if (tracker.hasWorkRecord(taskId, hops[i].delegate)) {
                completedStake += agentStake;
            }
        }

        if (totalStake == 0) return false;

        if ((completedStake * 10_000) / totalStake < d.stakeThresholdBps) {
            return false;
        }

        // ─── LAYER 3: Reputation-Gated Release ─────────────
        if (d.reputationRequired) {
            for (uint256 i = 0; i < hops.length; i++) {
                (,, uint256 erc8004Id,,,) = agentRegistry.agents(hops[i].delegate);

                address[] memory clients = reputation.getClients(erc8004Id);
                if (clients.length == 0) continue;

                (uint64 count, int128 avgRating,) = reputation.getSummary(
                    erc8004Id,
                    clients,
                    "agentchain",
                    ""
                );

                if (count > 0 && avgRating < d.minReputation) {
                    return false;
                }
            }
        }

        return true;
    }

    /// @notice Called by task creator to submit reputation and trigger settlement.
    function settleAndRate(bytes32 taskId, int128 rating) external {
        (address creator, address orchestrator,,,,,,) = tracker.tasks(taskId);
        if (msg.sender != creator) {
            revert NotTaskCreator(msg.sender, creator);
        }

        if (rating < 10 || rating > 50) InvalidRating.selector.revertWith();

        DelegationHop[] memory hops = tracker.getTaskDelegations(taskId);

        // ─── Reputation feedback ─────────────────────────────
        uint256 totalStake = 0;
        uint256 completedStake = 0;

        for (uint256 i = 0; i < hops.length; i++) {
            (,, uint256 erc8004Id,,,) = agentRegistry.agents(hops[i].delegate);
            uint256 agentStake = agentRegistry.stakes(hops[i].delegate);
            totalStake += agentStake;

            if (tracker.hasWorkRecord(taskId, hops[i].delegate)) {
                completedStake += agentStake;

                reputation.giveFeedback(
                    erc8004Id,
                    rating,
                    1,
                    "agentchain",
                    "delegation",
                    "",
                    "",
                    bytes32(0)
                );
            }
        }

        // ─── Settle: collect from Alkahest + distribute ──────
        tracker.settleTask(taskId);

        uint256 stakeScore = totalStake > 0 ? (completedStake * 10_000) / totalStake : 0;
        emit TaskVerified(taskId, hops.length, stakeScore, true);
        emit ReputationSubmitted(taskId, hops.length, rating);
    }

    /// @notice Submit negative feedback. Only for Accepted or Completed tasks (fix L6).
    function disputeAgent(
        bytes32 taskId,
        address agentAddress,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        (address creator,, uint8 status,,,,,) = tracker.tasks(taskId);
        if (msg.sender != creator) {
            revert NotTaskCreator(msg.sender, creator);
        }
        // Only allow disputes for active or completed tasks (fix L6)
        if (status == 0 || status == 3) revert TaskNotSettleable(taskId); // Open=0, Expired=3

        (,, uint256 erc8004Id,,,) = agentRegistry.agents(agentAddress);

        reputation.giveFeedback(
            erc8004Id,
            -10,
            1,
            "agentchain",
            "dispute",
            "",
            feedbackURI,
            feedbackHash
        );
    }
}
