// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    function isRegistered(address agent) external view returns (bool);
}

contract DelegationTracker {

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

    // Events 

    event TaskRegistered(bytes32 indexed taskId, address indexed creator, uint256 deadline);
    event TaskAccepted(bytes32 indexed taskId, address indexed orchestrator);
    event DelegationCreated(bytes32 indexed taskId, address indexed from, address indexed to, uint8 depth);
    event WorkCompleted(bytes32 indexed taskId, address indexed agent, bytes32 resultHash);
    event TaskSettled(bytes32 indexed taskId);
    event TaskExpired(bytes32 indexed taskId);

    //  Modifiers 

    modifier onlyTaskCreator(bytes32 taskId) {
        require(msg.sender == tasks[taskId].creator, "Not task creator");
        _;
    }

    modifier onlyCaveatEnforcer() {
        require(msg.sender == capabilityEnforcer, "Not caveat enforcer");
        _;
    }

    modifier onlyDelegatedAgent(bytes32 taskId) {
        require(isDelegated[taskId][msg.sender], "Not a delegated agent for this task");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Not arbiter");
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
        require(msg.sender == deployer, "Not deployer");
        require(!initialized, "Already initialized");
        capabilityEnforcer = _capabilityEnforcer;
        arbiter = _arbiter;
        agentRegistry = _agentRegistry;
        initialized = true;
    }

    // Task Lifecycle 

    /// @notice Register a new task. Called by SDK after Alkahest makeStatement().
    /// @param taskId EAS attestation UID from Alkahest escrow
    /// @param deadline Unix timestamp when escrow expires
    /// @param feePool Total USDC budget for sub-agent fees (deducted from orchestrator's stake on settlement)
    function registerTask(bytes32 taskId, uint256 deadline, uint256 feePool) external {
        require(tasks[taskId].creator == address(0), "Task already exists");
        require(deadline > block.timestamp, "Deadline in past");

        tasks[taskId] = Task({
            creator: msg.sender,
            orchestrator: address(0),
            status: TaskStatus.Open,
            deadline: deadline,
            delegationCount: 0,
            feePool: feePool
        });

        emit TaskRegistered(taskId, msg.sender, deadline);
    }

    /// @notice Orchestrator claims an open task. First qualified agent wins.
    ///         No proposal/accept step — autonomous agents pick up tasks directly.
    ///         Agent must be registered, active, and staked >= task budget.
    /// @param taskId The task to claim
    function claimTask(bytes32 taskId) external {
        require(tasks[taskId].status == TaskStatus.Open, "Task not open");
        require(block.timestamp < tasks[taskId].deadline, "Task expired");
        require(
            IAgentRegistry(agentRegistry).isRegistered(msg.sender),
            "Not a registered agent"
        );

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
        require(tasks[taskId].status == TaskStatus.Accepted, "Task not accepted");
        require(block.timestamp < tasks[taskId].deadline, "Task expired");

        // Ensure total promised fees don't exceed the task's fee pool
        require(
            totalPromisedFees[taskId] + fee <= tasks[taskId].feePool,
            "Fee exceeds pool"
        );

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
        require(tasks[taskId].status == TaskStatus.Accepted, "Task not accepted");
        require(block.timestamp < tasks[taskId].deadline, "Task expired");
        require(workRecords[taskId][msg.sender].timestamp == 0, "Already submitted");

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
        require(tasks[taskId].status == TaskStatus.Accepted, "Task not accepted");
        tasks[taskId].status = TaskStatus.Completed;
        emit TaskSettled(taskId);
    }

    /// @notice Mark task as expired. Callable by anyone after deadline.
    function expireTask(bytes32 taskId) external {
        require(block.timestamp >= tasks[taskId].deadline, "Not expired yet");
        require(
            tasks[taskId].status == TaskStatus.Open ||
            tasks[taskId].status == TaskStatus.Accepted,
            "Task already finalized"
        );
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
