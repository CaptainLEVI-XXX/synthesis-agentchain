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
///         1. Delegation chain integrity — verifies MetaMask delegation hashes are live (not revoked)
///         2. Stake-weighted consensus — weights completion by agent stake, not headcount
///         3. Reputation-gated release — ERC-8004 reputation as a verification condition
/// @dev Extends the Alkahest escrow protocol with a new multi-agent trust model:
///      escrow releases ONLY when the delegation chain is intact, stake-weighted work
///      completion exceeds a threshold, and all agents meet minimum reputation.
contract AgentChainArbiter is IArbiter {
    using CustomRevert for bytes4;

    // ─── Custom Errors ─────────────────────────────────────

    error NotTaskCreator(address caller, address creator);
    error TaskNotAccepted(bytes32 taskId);
    error InvalidRating(int128 value);
    error InvalidThreshold(uint256 value);

    // ─── State ─────────────────────────────────────────────

    IDelegationTracker public immutable tracker;
    IDelegationManager public immutable delegationManager; // MetaMask DelegationManager
    IReputationRegistry public immutable reputation;       // ERC-8004 Reputation Registry
    IAgentRegistry public immutable agentRegistry;

    /// @notice Encoded in the escrow's demand field when creating the Alkahest obligation.
    ///         This is the NEW verification primitive — multi-dimensional conditions that
    ///         no existing Alkahest arbiter can express.
    struct DemandData {
        bytes32 taskId;                // EAS attestation UID = task identifier
        address orchestrator;          // who receives the full escrowed amount
        uint256 stakeThresholdBps;     // stake-weighted completion threshold (basis points, e.g., 7500 = 75%)
        int128 minReputation;          // minimum ERC-8004 reputation score (fixed-point, 1 decimal)
        bool reputationRequired;       // whether to enforce reputation gate (false for new agents)
    }

    // ─── Events ────────────────────────────────────────────

    event TaskVerified(
        bytes32 indexed taskId,
        uint256 workRecordCount,
        uint256 stakeWeightedScore,    // actual stake-weighted completion (bps)
        bool allDelegationsIntact      // whether chain integrity passed
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
    //  VERIFICATION PRIMITIVE: checkStatement()
    //  Three novel mechanisms that compose into a single
    //  multi-dimensional verification condition.
    // ═══════════════════════════════════════════════════════

    /// @notice Called by Alkahest to verify if escrow should be released.
    ///         Implements three verification layers:
    ///         1. Delegation chain integrity (are all MetaMask delegations still live?)
    ///         2. Stake-weighted consensus (is enough staked value backing completed work?)
    ///         3. Reputation gate (do all agents meet minimum ERC-8004 reputation?)
    function checkStatement(
        Attestation memory,      // obligation (unused — we verify via tracker state)
        bytes memory demand,
        bytes32                  // counteroffer (unused)
    ) external view override returns (bool) {
        DemandData memory d = abi.decode(demand, (DemandData));

        // 0. Verify the orchestrator matches
        (, address taskOrchestrator,,,,) = tracker.tasks(d.taskId);
        if (taskOrchestrator != d.orchestrator) return false;

        // Get all delegation hops for this task
        DelegationHop[] memory hops = tracker.getTaskDelegations(d.taskId);
        if (hops.length == 0) return false;

        // ─── LAYER 1: Delegation Chain Integrity ────────────
        // Verify every MetaMask delegation in the chain is still active
        // (not revoked via DelegationManager.disableDelegation()).
        // This is a NEW verification mechanism — no existing Alkahest arbiter
        // verifies multi-party delegation chain liveness.
        for (uint256 i = 0; i < hops.length; i++) {
            if (delegationManager.disabledDelegations(hops[i].delegationHash)) {
                return false;
            }
        }

        // ─── LAYER 2: Stake-Weighted Consensus ─────────────
        // Instead of "did N agents submit work?" (trivial counter), we weight
        // by stake: an agent with 5000 USDC staked completing work contributes
        // more to the consensus than one with 50 USDC.
        //
        // Formula: sum(stake of agents WITH work records) / sum(stake of ALL delegated agents)
        // Must exceed stakeThresholdBps (e.g., 75% = 7500 bps).
        uint256 totalStake = 0;
        uint256 completedStake = 0;

        for (uint256 i = 0; i < hops.length; i++) {
            uint256 agentStake = agentRegistry.stakes(hops[i].delegate);
            totalStake += agentStake;

            if (tracker.hasWorkRecord(d.taskId, hops[i].delegate)) {
                completedStake += agentStake;
            }
        }

        if (totalStake == 0) return false;

        // completedStake * 10000 / totalStake >= stakeThresholdBps
        if ((completedStake * 10_000) / totalStake < d.stakeThresholdBps) {
            return false;
        }

        // ─── LAYER 3: Reputation-Gated Release ─────────────
        // ERC-8004 reputation is a VERIFICATION CONDITION, not a side effect.
        // Escrow only releases if every agent in the chain meets minimum
        // reputation on the canonical ERC-8004 Reputation Registry.
        //
        // When reputationRequired is false (for bootstrapping), this layer is skipped.
        if (d.reputationRequired) {
            for (uint256 i = 0; i < hops.length; i++) {
                (,, uint256 erc8004Id,,,) = agentRegistry.agents(hops[i].delegate);

                address[] memory clients = reputation.getClients(erc8004Id);

                // Skip agents with no reviews (new agents are allowed through)
                if (clients.length == 0) continue;

                // Get AgentChain-specific reputation summary
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

    // ═══════════════════════════════════════════════════════
    //  SETTLEMENT + REPUTATION FEEDBACK
    // ═══════════════════════════════════════════════════════

    /// @notice Called by task creator after escrow release.
    ///         1. Submits ERC-8004 reputation feedback for all agents with work records
    ///         2. Auto-distributes promised fees from orchestrator's stake to sub-agents
    ///         3. Marks task as completed
    /// @param taskId The settled task
    /// @param rating Rating for agents (1-5 scale, 1 decimal: 10 = 1.0, 45 = 4.5, 50 = 5.0)
    function settleAndRate(bytes32 taskId, int128 rating) external {
        // Verify caller is the task creator
        (address creator, address orchestrator,,,,) = tracker.tasks(taskId);
        if (msg.sender != creator) {
            revert NotTaskCreator(msg.sender, creator);
        }

        // Validate rating range (1.0 - 5.0 with 1 decimal)
        if (rating < 10 || rating > 50) InvalidRating.selector.revertWith();

        // Get all delegation hops
        DelegationHop[] memory hops = tracker.getTaskDelegations(taskId);

        // ─── Phase 1: Reputation feedback + collect fee data ──────
        uint256 totalStake = 0;
        uint256 completedStake = 0;

        address[] memory payableAgents = new address[](hops.length);
        uint256[] memory payableFees = new uint256[](hops.length);
        uint256 payableCount = 0;

        for (uint256 i = 0; i < hops.length; i++) {
            (,, uint256 erc8004Id,,,) = agentRegistry.agents(hops[i].delegate);
            uint256 agentStake = agentRegistry.stakes(hops[i].delegate);
            totalStake += agentStake;

            if (tracker.hasWorkRecord(taskId, hops[i].delegate)) {
                completedStake += agentStake;

                // Submit POSITIVE feedback to ERC-8004 Reputation Registry
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

                // Collect fee for distribution
                uint256 fee = tracker.getPromisedFee(taskId, hops[i].delegate);
                if (fee > 0) {
                    payableAgents[payableCount] = hops[i].delegate;
                    payableFees[payableCount] = fee;
                    payableCount++;
                }
            }
        }

        // ─── Phase 2: Trustless fee distribution from orchestrator's stake ──
        if (payableCount > 0) {
            address[] memory trimmedAgents = new address[](payableCount);
            uint256[] memory trimmedFees = new uint256[](payableCount);
            for (uint256 i = 0; i < payableCount; i++) {
                trimmedAgents[i] = payableAgents[i];
                trimmedFees[i] = payableFees[i];
            }

            agentRegistry.distributeFeesFromStake(orchestrator, trimmedAgents, trimmedFees);
        }

        // ─── Phase 3: Finalize ──────────────────────────────────
        tracker.settleTask(taskId);

        uint256 stakeScore = totalStake > 0 ? (completedStake * 10_000) / totalStake : 0;
        emit TaskVerified(taskId, hops.length, stakeScore, true);
        emit ReputationSubmitted(taskId, hops.length, rating);
    }

    /// @notice Submit negative feedback / dispute for a specific agent.
    ///         Only callable by task creator.
    function disputeAgent(
        bytes32 taskId,
        address agentAddress,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        (address creator,,,,,) = tracker.tasks(taskId);
        if (msg.sender != creator) {
            revert NotTaskCreator(msg.sender, creator);
        }

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
