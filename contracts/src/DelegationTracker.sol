// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";
import {IAlkahestEscrow, IEAS} from "./interfaces/IAlkahestEscrow.sol";
import {CustomRevert} from "./libraries/CustomRevert.sol";
import {Lock} from "./libraries/Lock.sol";

/// @title DelegationTracker
/// @notice Task lifecycle + delegation recording + Alkahest escrow mediator.
///
///         This contract acts as the SINGLE entry point for users AND the mediator
///         for all fund flows. It creates Alkahest escrows with itself as recipient,
///         so that on settlement it receives ALL funds and distributes them:
///           → Sub-agents get their promised fees (for completed work)
///           → Orchestrator gets the remainder
///
///         Fund flow:
///           createTask:   User USDC → this contract → Alkahest escrow
///           settleTask:   Alkahest escrow → this contract → sub-agents + orchestrator
///           expireTask:   Alkahest escrow → this contract → user (refund)
contract DelegationTracker {
    using SafeERC20 for IERC20;
    using CustomRevert for bytes4;

    // ─── Custom Errors ─────────────────────────────────────

    error TaskAlreadyExists(bytes32 taskId);
    error DeadlineInPast();
    error TaskNotOpen();
    error TaskExpiredError();
    error NotRegisteredAgent(address agent);
    error TaskNotAccepted();
    error FeeExceedsDeposit(uint256 totalFees, uint256 deposit);
    error NotDelegatedAgent(address agent);
    error AlreadyDelegated(address agent);
    error WorkAlreadySubmitted(address agent);
    error NotExpiredYet();
    error TaskAlreadyFinalized();
    error NotDeployer(address caller);
    error AlreadyInitialized();
    error NotCaveatEnforcer(address caller);
    error NotArbiterError(address caller);
    error NotTaskCreator(address caller);
    error ZeroDeposit();
    error InvalidStakeThreshold();

    // ─── Types ───────────────────────────────────────────────

    enum TaskStatus { Open, Accepted, Completed, Expired, Disputed }

    struct Task {
        address creator;
        address orchestrator;
        TaskStatus status;
        uint256 deadline;
        uint256 delegationCount;
        uint256 deposit;           // total USDC amount (in Alkahest or as reference)
        bool hasEscrow;            // true = Alkahest escrow, false = delegation-only
        string intent;
    }

    struct DelegationHop {
        address delegator;
        address delegate;
        uint8 depth;
        bytes32 delegationHash;
        uint256 timestamp;
    }

    struct WorkRecord {
        bytes32 resultHash;
        string summary;
        uint256 timestamp;
    }

    /// @notice Encoded in Alkahest escrow's demand field. Read by our Arbiter.
    ///         Only contains verification params — taskId and orchestrator are derived
    ///         from the obligation UID and tracker state.
    struct DemandData {
        uint256 stakeThresholdBps;
        int128 minReputation;
        bool reputationRequired;
    }

    // ─── State ───────────────────────────────────────────────

    IERC20 public paymentToken;
    IAlkahestEscrow public alkahestEscrow;
    IEAS public eas;
    bytes32 public fulfillmentSchema;          // EAS schema for fulfillment attestations
    address public arbiter;
    address public capabilityEnforcer;
    address public agentRegistry;

    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => DelegationHop[]) public taskDelegations;
    mapping(bytes32 => mapping(address => WorkRecord)) public workRecords;
    mapping(bytes32 => mapping(address => bool)) public isDelegated;
    mapping(bytes32 => mapping(address => uint256)) public promisedFees;
    mapping(bytes32 => uint256) public totalPromisedFees;

    // ─── Events ──────────────────────────────────────────────

    event TaskCreated(bytes32 indexed taskId, address indexed creator, uint256 deposit, uint256 deadline, string intent);
    event TaskAccepted(bytes32 indexed taskId, address indexed orchestrator);
    event DelegationCreated(bytes32 indexed taskId, address indexed from, address indexed to, uint8 depth, uint256 fee);
    event WorkCompleted(bytes32 indexed taskId, address indexed agent, bytes32 resultHash);
    event TaskSettled(bytes32 indexed taskId, address indexed orchestrator, uint256 totalFeesPaid, uint256 orchestratorPayout);
    event TaskExpired(bytes32 indexed taskId, uint256 refundAmount);
    event FeeDistributed(bytes32 indexed taskId, address indexed agent, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────

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

    modifier nonReentrant() {
        if (Lock.isLocked()) Lock.ContractLocked.selector.revertWith();
        Lock.lock();
        _;
        Lock.unlock();
    }

    // ─── Constructor + Initialization ────────────────────────

    address public deployer;
    bool public initialized;

    constructor() {
        deployer = msg.sender;
    }

    function initialize(
        address _capabilityEnforcer,
        address _arbiter,
        address _agentRegistry,
        address _paymentToken,
        address _alkahestEscrow,
        address _eas,
        bytes32 _fulfillmentSchema
    ) external {
        if (msg.sender != deployer) NotDeployer.selector.revertWith(msg.sender);
        if (initialized) AlreadyInitialized.selector.revertWith();
        capabilityEnforcer = _capabilityEnforcer;
        arbiter = _arbiter;
        agentRegistry = _agentRegistry;
        paymentToken = IERC20(_paymentToken);
        alkahestEscrow = IAlkahestEscrow(_alkahestEscrow);
        eas = IEAS(_eas);
        fulfillmentSchema = _fulfillmentSchema;
        initialized = true;
    }

    // ─── Task Creation (Alkahest Escrow Wrapper) ─────────────

    /// @notice Create a task backed by Alkahest escrow. Single entry point for users.
    ///         User approves USDC to this contract. We create the Alkahest escrow
    ///         with THIS CONTRACT as the recipient, so we control fund distribution.
    /// @param deadline Unix timestamp when task expires
    /// @param deposit Total USDC to escrow
    /// @param stakeThresholdBps Min stake-weighted completion for release (e.g., 7500 = 75%)
    /// @param intent Human-readable task description
    /// @return taskId The Alkahest escrow UID
    function createTask(
        uint256 deadline,
        uint256 deposit,
        uint256 stakeThresholdBps,
        string calldata intent
    ) external nonReentrant returns (bytes32 taskId) {
        if (deadline <= block.timestamp) DeadlineInPast.selector.revertWith();
        if (deposit == 0) ZeroDeposit.selector.revertWith();
        if (stakeThresholdBps > 10000) revert InvalidStakeThreshold();

        // 1. Pull USDC from user
        paymentToken.safeTransferFrom(msg.sender, address(this), deposit);

        // 2. Approve Alkahest to take the USDC
        paymentToken.forceApprove(address(alkahestEscrow), deposit);

        // 3. Encode demand — only verification params (fix C1)
        //    taskId + orchestrator derived from obligation UID + tracker state by Arbiter
        bytes memory demand = abi.encode(DemandData({
            stakeThresholdBps: stakeThresholdBps,
            minReputation: int128(0),
            reputationRequired: false
        }));

        // 4. Create Alkahest escrow with THIS CONTRACT as recipient
        //    Uses doObligationFor — matches real Alkahest ERC20EscrowObligation
        taskId = alkahestEscrow.doObligationFor(
            IAlkahestEscrow.ObligationData({
                arbiter: arbiter,
                demand: demand,
                token: address(paymentToken),
                amount: deposit
            }),
            uint64(deadline),
            address(this)          // recipient = this contract (mediator)
        );

        // 5. Store task metadata
        if (tasks[taskId].creator != address(0)) revert TaskAlreadyExists(taskId);

        tasks[taskId] = Task({
            creator: msg.sender,
            orchestrator: address(0),
            status: TaskStatus.Open,
            deadline: deadline,
            delegationCount: 0,
            deposit: deposit,
            hasEscrow: true,
            intent: intent
        });

        emit TaskCreated(taskId, msg.sender, deposit, deadline, intent);
    }

    /// @notice Register a task for delegation-based flow (Entry Point A) or direct Alkahest.
    ///         No Alkahest escrow created — user manages funds via MetaMask delegation.
    ///         If feePool > 0, caller must approve USDC for sub-agent fee distribution.
    function registerTask(
        bytes32 taskId,
        uint256 deadline,
        uint256 deposit,
        uint256 feePool,
        string calldata intent
    ) external nonReentrant {
        if (deadline <= block.timestamp) DeadlineInPast.selector.revertWith();
        if (tasks[taskId].creator != address(0)) revert TaskAlreadyExists(taskId);

        if (feePool > 0) {
            paymentToken.safeTransferFrom(msg.sender, address(this), feePool);
        }

        tasks[taskId] = Task({
            creator: msg.sender,
            orchestrator: address(0),
            status: TaskStatus.Open,
            deadline: deadline,
            delegationCount: 0,
            deposit: deposit,
            hasEscrow: false,
            intent: intent
        });

        emit TaskCreated(taskId, msg.sender, deposit, deadline, intent);
    }

    // ─── Task Claiming ───────────────────────────────────────

    function claimTask(bytes32 taskId) external {
        if (tasks[taskId].status != TaskStatus.Open) TaskNotOpen.selector.revertWith();
        if (block.timestamp >= tasks[taskId].deadline) TaskExpiredError.selector.revertWith();
        if (!IAgentRegistry(agentRegistry).isRegistered(msg.sender)) {
            NotRegisteredAgent.selector.revertWith(msg.sender);
        }

        tasks[taskId].orchestrator = msg.sender;
        tasks[taskId].status = TaskStatus.Accepted;
        isDelegated[taskId][msg.sender] = true;

        emit TaskAccepted(taskId, msg.sender);
    }

    // ─── Delegation Recording ────────────────────────────────

    /// @notice Record delegation hop + promised fee. Called by Enforcer afterHook.
    ///         Fee must not exceed the total deposit (all fees come from deposit).
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
        if (isDelegated[taskId][to]) AlreadyDelegated.selector.revertWith(to);

        uint256 newTotal = totalPromisedFees[taskId] + fee;
        if (newTotal > tasks[taskId].deposit) {
            FeeExceedsDeposit.selector.revertWith(newTotal, tasks[taskId].deposit);
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
        promisedFees[taskId][to] = fee;
        totalPromisedFees[taskId] += fee;

        emit DelegationCreated(taskId, from, to, depth, fee);
    }

    // ─── Work Records ────────────────────────────────────────

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

    // ─── Settlement ──────────────────────────────────────────

    /// @notice Settle task: collect from Alkahest, distribute to agents + orchestrator.
    ///         Called by Arbiter after reputation is submitted.
    ///
    ///         Flow:
    ///           1. Create fulfillment attestation (recipient = this contract)
    ///           2. Call Alkahest.collectEscrow → Alkahest calls our Arbiter.checkObligation
    ///         Two paths based on hasEscrow:
    ///           A) hasEscrow=true:  Collect from Alkahest → distribute all
    ///           B) hasEscrow=false: Distribute feePool held by this contract only
    function settleTask(bytes32 taskId) external onlyArbiter nonReentrant {
        Task storage task = tasks[taskId];
        if (task.status != TaskStatus.Accepted) TaskNotAccepted.selector.revertWith();

        // ─── Path A: Alkahest escrow — collect + distribute all ───
        if (task.hasEscrow) {
            // 1. Create fulfillment attestation (recipient = this contract)
            bytes32 fulfillmentUID = eas.attest(IEAS.AttestationRequest({
                schema: fulfillmentSchema,
                data: IEAS.AttestationRequestData({
                    recipient: address(this),
                    expirationTime: 0,
                    revocable: false,
                    refUID: taskId,
                    data: "",
                    value: 0
                })
            }));

            // 2. Collect from Alkahest → all funds come to this contract
            alkahestEscrow.collectEscrow(taskId, fulfillmentUID);

            // 3. Distribute: sub-agent fees first, remainder to orchestrator
            uint256 totalDistributed = _distributeFees(taskId);
            uint256 orchestratorPayout = task.deposit - totalDistributed;
            if (orchestratorPayout > 0) {
                paymentToken.safeTransfer(task.orchestrator, orchestratorPayout);
            }

            task.status = TaskStatus.Completed;
            emit TaskSettled(taskId, task.orchestrator, totalDistributed, orchestratorPayout);
        }
        // ─── Path B: Delegation-only — distribute feePool held by this contract ───
        else {
            // Distribute feePool: sub-agent fees first, remainder to orchestrator.
            uint256 totalDistributed = _distributeFees(taskId);

            // Send remaining held balance to orchestrator (their margin from feePool)
            uint256 remaining = paymentToken.balanceOf(address(this));
            if (remaining > 0) {
                paymentToken.safeTransfer(task.orchestrator, remaining);
            }

            task.status = TaskStatus.Completed;
            emit TaskSettled(taskId, task.orchestrator, totalDistributed, remaining);
        }
    }

    /// @dev Distribute promised fees to sub-agents with work records.
    function _distributeFees(bytes32 taskId) internal returns (uint256 totalDistributed) {
        DelegationHop[] memory hops = taskDelegations[taskId];

        for (uint256 i = 0; i < hops.length; i++) {
            address agent = hops[i].delegate;
            uint256 fee = promisedFees[taskId][agent];

            if (fee > 0 && workRecords[taskId][agent].timestamp > 0) {
                paymentToken.safeTransfer(agent, fee);
                totalDistributed += fee;
                emit FeeDistributed(taskId, agent, fee);
            }
        }
    }

    /// @notice Expire task and refund. Handles both escrow and delegation-only paths.
    ///         Only callable by task creator after deadline.
    function expireTask(bytes32 taskId) external onlyTaskCreator(taskId) nonReentrant {
        if (block.timestamp < tasks[taskId].deadline) NotExpiredYet.selector.revertWith();
        if (tasks[taskId].status != TaskStatus.Open && tasks[taskId].status != TaskStatus.Accepted) {
            TaskAlreadyFinalized.selector.revertWith();
        }

        tasks[taskId].status = TaskStatus.Expired;

        if (tasks[taskId].hasEscrow) {
            // Path A: Reclaim from Alkahest → refund full deposit to user
            alkahestEscrow.reclaimExpired(taskId);
            uint256 refund = tasks[taskId].deposit;
            if (refund > 0) {
                paymentToken.safeTransfer(tasks[taskId].creator, refund);
            }
        } else {
            // Path B: Refund any feePool held by this contract
            // For delegation-only tasks, the user's investment funds are in their
            // own smart account (managed via delegation), not here.
            // We only refund what we hold (the feePool deposited via registerTask).
            uint256 feePoolRefund = paymentToken.balanceOf(address(this));
            if (feePoolRefund > 0) {
                paymentToken.safeTransfer(tasks[taskId].creator, feePoolRefund);
            }
        }

        emit TaskExpired(taskId, tasks[taskId].deposit);
    }

    // ─── View Functions ──────────────────────────────────────

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
