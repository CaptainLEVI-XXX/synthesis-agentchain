// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";

contract DelegationTracker {
    using CustomRevert for bytes4;

    // ─── Custom Errors ─────────────────────────────────────

    error TaskAlreadyExists(bytes32 taskId);
    error DeadlineInPast();
    error TaskNotOpen();
    error TaskExpiredError();
    error NotRegisteredAgent(address agent);
    error TaskNotAccepted();
    error FeeExceedsPool(uint256 total, uint256 pool);
    error NotDelegatedAgent(address agent);
    error WorkAlreadySubmitted(address agent);
    error NotExpiredYet();
    error TaskAlreadyFinalized();
    error NotDeployer(address caller);
    error AlreadyInitialized();
    error NotCaveatEnforcer(address caller);
    error NotArbiterError(address caller);
    error NotTaskCreator(address caller);

    // Types

    enum TaskStatus { Open, Accepted, Completed, Expired, Disputed }

    struct Task {
        address creator;           // user who created the task (msg.sender)
        address orchestrator;      // accepted orchestrator (address(0) if Open)
        TaskStatus status;
        uint256 deadline;
        uint256 delegationCount;   // number of delegation hops
        uint256 feePool;           // total USDC fees available for sub-agents (from orchestrator's stake)
    }

    struct DelegationHop {
        address delegator;
        address delegate;
        uint8 depth;
        bytes32 delegationHash;    // MetaMask delegation hash — for chain integrity verification
        uint256 timestamp;
    }

    struct WorkRecord {
        bytes32 resultHash;        // IPFS CID hash of full result
        string summary;            // brief human-readable summary
        uint256 timestamp;
    }

    //  State 

    address public capabilityEnforcer;   // only this address can record delegations
    address public arbiter;              // only this address can settle tasks
    address public agentRegistry;        // for validating orchestrator on claimTask

    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => DelegationHop[]) public taskDelegations;
    mapping(bytes32 => mapping(address => WorkRecord)) public workRecords;
    mapping(bytes32 => mapping(address => bool)) public isDelegated;    // quick lookup
    mapping(bytes32 => mapping(address => uint256)) public promisedFees; // taskId → agent → fee (USDC)
    mapping(bytes32 => uint256) public totalPromisedFees;                // taskId → sum of all promised fees
    mapping(bytes32 => bytes32) public intentHashes;                     // taskId → keccak256(intent) for verification

    // Events 

    event TaskRegistered(bytes32 indexed taskId, address indexed creator, uint256 deadline, bytes32 intentHash, string intent);
    event TaskAccepted(bytes32 indexed taskId, address indexed orchestrator);
    event DelegationCreated(bytes32 indexed taskId, address indexed from, address indexed to, uint8 depth);
    event WorkCompleted(bytes32 indexed taskId, address indexed agent, bytes32 resultHash);
    event TaskSettled(bytes32 indexed taskId);
    event TaskExpired(bytes32 indexed taskId);

    //  Modifiers 

    modifier onlyTaskCreator(bytes32 taskId) {
        if (msg.sender != tasks[taskId].creator) NotTaskCreator.selector.revertWith(msg.sender);
        _;
    }

    modifier onlyCaveatEnforcer() {
        if (msg.sender != capabilityEnforcer) NotCaveatEnforcer.selector.revertWith(msg.sender);
        _;
    }

    modifier onlyDelegatedAgent(bytes32 taskId) {
        if (!isDelegated[taskId][msg.sender]) NotDelegatedAgent.selector.revertWith(msg.sender);
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) NotArbiterError.selector.revertWith(msg.sender);
        _;
    }

    //  Constructor + Initialization 

    address public deployer;
    bool public initialized;

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-time initialization. Solves chicken-and-egg: deploy Tracker first,
    ///         then deploy Enforcer + Arbiter, then call initialize() with their addresses.
    function initialize(address _capabilityEnforcer, address _arbiter, address _agentRegistry) external {
        if (msg.sender != deployer) NotDeployer.selector.revertWith(msg.sender);
        if (initialized) AlreadyInitialized.selector.revertWith();
        capabilityEnforcer = _capabilityEnforcer;
        arbiter = _arbiter;
        agentRegistry = _agentRegistry;
        initialized = true;
    }

    // Task Lifecycle 

    /// @notice Register a new task with an encoded intent.
    ///         The intent string is hashed and stored on-chain for verification.
    ///         The full intent is emitted in the event for agents to read.
    /// @param taskId EAS attestation UID from Alkahest escrow
    /// @param deadline Unix timestamp when escrow expires
    /// @param feePool Total USDC budget for sub-agent fees (deducted from orchestrator's stake on settlement)
    /// @param intent Human-readable intent string (e.g., "Swap 0.1 ETH to USDC on Base")
    function registerTask(bytes32 taskId, uint256 deadline, uint256 feePool, string calldata intent) external {
        if (tasks[taskId].creator != address(0)) revert TaskAlreadyExists(taskId);
        if (deadline <= block.timestamp) DeadlineInPast.selector.revertWith();

        bytes32 intentHash = keccak256(abi.encodePacked(intent));

        tasks[taskId] = Task({
            creator: msg.sender,
            orchestrator: address(0),
            status: TaskStatus.Open,
            deadline: deadline,
            delegationCount: 0,
            feePool: feePool
        });

        intentHashes[taskId] = intentHash;

        emit TaskRegistered(taskId, msg.sender, deadline, intentHash, intent);
    }

    /// @notice Verify that a given intent matches the stored hash for a task.
    /// @param taskId The task to verify
    /// @param intent The intent string to check
    /// @return True if the intent matches the stored hash
    function verifyIntent(bytes32 taskId, string calldata intent) external view returns (bool) {
        return intentHashes[taskId] == keccak256(abi.encodePacked(intent));
    }

    /// @notice Get the stored intent hash for a task.
    function getIntentHash(bytes32 taskId) external view returns (bytes32) {
        return intentHashes[taskId];
    }

    /// @notice Orchestrator claims an open task. First qualified agent wins.
    ///         No proposal/accept step — autonomous agents pick up tasks directly.
    ///         Agent must be registered, active, and staked >= task budget.
    /// @param taskId The task to claim
    function claimTask(bytes32 taskId) external {
        if (tasks[taskId].status != TaskStatus.Open) TaskNotOpen.selector.revertWith();
        if (block.timestamp >= tasks[taskId].deadline) TaskExpiredError.selector.revertWith();
        if (!IAgentRegistry(agentRegistry).isRegistered(msg.sender)) {
            NotRegisteredAgent.selector.revertWith(msg.sender);
        }

        tasks[taskId].orchestrator = msg.sender;
        tasks[taskId].status = TaskStatus.Accepted;

        emit TaskAccepted(taskId, msg.sender);
    }

    // Delegation Recording 

    /// @notice Record a delegation hop + promised fee. Called by AgentCapabilityEnforcer.afterHook().
    /// @param fee The USDC fee promised to this agent (encoded in AgentTerms, immutable per delegation)
    function recordDelegation(
        bytes32 taskId,
        address from,
        address to,
        uint8 depth,
        bytes32 delegationHash,
        uint256 fee
    ) external onlyCaveatEnforcer {
        if (tasks[taskId].status != TaskStatus.Accepted) TaskNotAccepted.selector.revertWith();
        if (block.timestamp >= tasks[taskId].deadline) TaskExpiredError.selector.revertWith();

        // Ensure total promised fees don't exceed the task's fee pool
        uint256 newTotal = totalPromisedFees[taskId] + fee;
        if (newTotal > tasks[taskId].feePool) {
            FeeExceedsPool.selector.revertWith(newTotal, tasks[taskId].feePool);
        }

        taskDelegations[taskId].push(DelegationHop({
            delegator: from,
            delegate: to,
            depth: depth,
            delegationHash: delegationHash,
            timestamp: block.timestamp
        }));

        isDelegated[taskId][to] = true;
        tasks[taskId].delegationCount++;

        // Track promised fee for this agent
        promisedFees[taskId][to] = fee;
        totalPromisedFees[taskId] += fee;

        emit DelegationCreated(taskId, from, to, depth);
    }

    // Work Records 

    /// @notice Submit proof of work for a task. Only callable by delegated agents.
    function submitWorkRecord(
        bytes32 taskId,
        bytes32 resultHash,
        string calldata summary
    ) external onlyDelegatedAgent(taskId) {
        if (tasks[taskId].status != TaskStatus.Accepted) TaskNotAccepted.selector.revertWith();
        if (block.timestamp >= tasks[taskId].deadline) TaskExpiredError.selector.revertWith();
        if (workRecords[taskId][msg.sender].timestamp != 0) WorkAlreadySubmitted.selector.revertWith(msg.sender);

        workRecords[taskId][msg.sender] = WorkRecord({
            resultHash: resultHash,
            summary: summary,
            timestamp: block.timestamp
        });

        emit WorkCompleted(taskId, msg.sender, resultHash);
    }

    // Settlement 

    /// @notice Mark task as completed. Called after arbiter approves escrow release.
    function settleTask(bytes32 taskId) external onlyArbiter {
        if (tasks[taskId].status != TaskStatus.Accepted) TaskNotAccepted.selector.revertWith();
        tasks[taskId].status = TaskStatus.Completed;
        emit TaskSettled(taskId);
    }

    /// @notice Mark task as expired. Callable by anyone after deadline.
    function expireTask(bytes32 taskId) external {
        if (block.timestamp < tasks[taskId].deadline) NotExpiredYet.selector.revertWith();
        if (tasks[taskId].status != TaskStatus.Open && tasks[taskId].status != TaskStatus.Accepted) {
            TaskAlreadyFinalized.selector.revertWith();
        }
        tasks[taskId].status = TaskStatus.Expired;
        emit TaskExpired(taskId);
    }

    // ─── View Functions ────────────────────────────────────

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function getTaskDelegations(bytes32 taskId) external view returns (DelegationHop[] memory) {
        return taskDelegations[taskId];
    }

    function getDelegationCount(bytes32 taskId) external view returns (uint256) {
        return tasks[taskId].delegationCount;
    }

    function hasWorkRecord(bytes32 taskId, address agent) external view returns (bool) {
        return workRecords[taskId][agent].timestamp > 0;
    }

    function getWorkRecord(bytes32 taskId, address agent) external view returns (WorkRecord memory) {
        return workRecords[taskId][agent];
    }

    function getPromisedFee(bytes32 taskId, address agent) external view returns (uint256) {
        return promisedFees[taskId][agent];
    }

    function getTotalPromisedFees(bytes32 taskId) external view returns (uint256) {
        return totalPromisedFees[taskId];
    }
}
