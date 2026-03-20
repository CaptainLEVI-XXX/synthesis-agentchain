// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {CaveatEnforcer} from "@metamask/delegation-framework/src/enforcers/CaveatEnforcer.sol";
import {ModeCode} from "@metamask/delegation-framework/src/utils/Types.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IDelegationTracker} from "./interfaces/IDelegationTracker.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";

/// @title AgentCapabilityEnforcer
/// @notice Custom MetaMask caveat enforcer for AgentChain.
///         Validates agent-specific qualifications (registered, staked, capable).
///         Compose with built-in enforcers for budget, time, and target restrictions.
/// @dev Inherits CaveatEnforcer (abstract base), NOT ICaveatEnforcer directly.
///      Only overrides beforeHook and afterHook. Other hooks use empty defaults.
contract AgentCapabilityEnforcer is CaveatEnforcer {
    using CustomRevert for bytes4;

    // ─── Custom Errors 

    error AgentNotRegistered(address agent);
    error StakeInsufficient(address agent, uint256 required, uint256 actual);
    error MissingCapabilities(address agent);
    error MaxDepthReached(uint8 current, uint8 max);

    // ─── State 

    IAgentRegistry public immutable registry;
    IDelegationTracker public immutable tracker;

    /// @notice Terms structure — encoded by SDK, decoded by enforcer.
    ///         Only contains agent-specific fields. Budget/time/targets
    ///         are handled by composed built-in enforcers.
    struct AgentTerms {
        bytes32 taskId;
        uint8 maxDepth;
        uint8 currentDepth;
        uint256 minStake;
        uint256 fee;               // USDC fee promised to this sub-agent
        bytes32[] requiredCaps;
    }

    // ─── Events 

    event AgentDelegationValidated(
        bytes32 indexed delegationHash,
        address indexed delegator,
        address indexed redeemer,
        bytes32 taskId,
        uint8 depth
    );

    // ─── Constructor ───────────────────────────────────────

    constructor(address _registry, address _tracker) {
        registry = IAgentRegistry(_registry);
        tracker = IDelegationTracker(_tracker);
    }

    // ─── Hooks ─────────────────────────────────────────────

    /// @notice Validates agent qualifications before delegation execution.
    /// @dev Called by DelegationManager during redeemDelegations().
    function beforeHook(
        bytes calldata _terms,
        bytes calldata,          // _args (unused)
        ModeCode,                // _mode (unused — we allow any mode)
        bytes calldata,          // _executionCalldata (unused — target/method checks done by built-in enforcers)
        bytes32,                 // _delegationHash (unused in beforeHook)
        address,                 // _delegator (unused in beforeHook)
        address _redeemer
    ) public view override {
        AgentTerms memory t = abi.decode(_terms, (AgentTerms));

        // 1. Agent must be registered and active in AgentChain
        if (!registry.isRegistered(_redeemer)) {
            AgentNotRegistered.selector.revertWith(_redeemer);
        }

        // 2. Agent stake must meet minimum for this delegation
        uint256 agentStake = registry.stakes(_redeemer);
        if (agentStake < t.minStake) {
            // 3-arg mixed types (address, uint256, uint256) — no CustomRevert overload
            revert StakeInsufficient(_redeemer, t.minStake, agentStake);
        }

        // 3. Agent must have all required capabilities
        if (!registry.hasCapabilities(_redeemer, t.requiredCaps)) {
            MissingCapabilities.selector.revertWith(_redeemer);
        }

        // 4. Delegation depth limit
        if (t.currentDepth >= t.maxDepth) {
            MaxDepthReached.selector.revertWith(t.currentDepth, t.maxDepth);
        }
    }

    /// @notice Records delegation hop on-chain after successful execution.
    /// @dev Called by DelegationManager after the delegated action executes.
    function afterHook(
        bytes calldata _terms,
        bytes calldata,          // _args
        ModeCode,                // _mode
        bytes calldata,          // _executionCalldata
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) public override {
        AgentTerms memory t = abi.decode(_terms, (AgentTerms));

        // Record delegation hop + promised fee in tracker
        tracker.recordDelegation(
            t.taskId,
            _delegator,
            _redeemer,
            t.currentDepth,
            _delegationHash,
            t.fee
        );

        emit AgentDelegationValidated(
            _delegationHash,
            _delegator,
            _redeemer,
            t.taskId,
            t.currentDepth
        );
    }
}
