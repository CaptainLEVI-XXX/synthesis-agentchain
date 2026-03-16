// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {AgentChainArbiter} from "../src/AgentChainArbiter.sol";
import {Attestation, DelegationHop} from "../src/interfaces/ICommon.sol";

// ─── Mock Contracts ──────────────────────────────────────

contract MockDelegationTrackerArbiter {
    struct Task {
        address creator;
        address orchestrator;
        uint8 status;
        uint256 deadline;
        uint256 delegationCount;
        uint256 feePool;
    }

    mapping(bytes32 => Task) public tasks;
    mapping(bytes32 => DelegationHop[]) internal _delegations;
    mapping(bytes32 => mapping(address => bool)) public _hasWork;
    mapping(bytes32 => mapping(address => uint256)) public _promisedFees;
    bool public settled;

    function setTask(bytes32 taskId, address creator, address orchestrator, uint8 status, uint256 deadline, uint256 delegationCount, uint256 feePool) external {
        tasks[taskId] = Task(creator, orchestrator, status, deadline, delegationCount, feePool);
    }

    function addDelegation(bytes32 taskId, address delegator, address delegate, uint8 depth, bytes32 delegationHash) external {
        _delegations[taskId].push(DelegationHop(delegator, delegate, depth, delegationHash, block.timestamp));
    }

    function setWorkRecord(bytes32 taskId, address agent, bool hasWork) external {
        _hasWork[taskId][agent] = hasWork;
    }

    function setPromisedFee(bytes32 taskId, address agent, uint256 fee) external {
        _promisedFees[taskId][agent] = fee;
    }

    function getTaskDelegations(bytes32 taskId) external view returns (DelegationHop[] memory) {
        return _delegations[taskId];
    }

    function hasWorkRecord(bytes32 taskId, address agent) external view returns (bool) {
        return _hasWork[taskId][agent];
    }

    function getPromisedFee(bytes32 taskId, address agent) external view returns (uint256) {
        return _promisedFees[taskId][agent];
    }

    function settleTask(bytes32) external {
        settled = true;
    }
}

contract MockDelegationManagerArbiter {
    mapping(bytes32 => bool) public disabledDelegations;

    function setDisabled(bytes32 hash, bool disabled) external {
        disabledDelegations[hash] = disabled;
    }
}

contract MockReputationRegistry {
    struct FeedbackRecord {
        uint256 agentId;
        int128 value;
        string tag1;
        string tag2;
    }

    FeedbackRecord[] public feedbacks;
    mapping(uint256 => address[]) public _clients;
    mapping(uint256 => int128) public _avgRating;
    mapping(uint256 => uint64) public _count;

    function setReputation(uint256 agentId, address[] memory clients, uint64 count, int128 avgRating) external {
        _clients[agentId] = clients;
        _count[agentId] = count;
        _avgRating[agentId] = avgRating;
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8,
        string calldata tag1,
        string calldata tag2,
        string calldata,
        string calldata,
        bytes32
    ) external {
        feedbacks.push(FeedbackRecord(agentId, value, tag1, tag2));
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    function getSummary(
        uint256 agentId,
        address[] calldata,
        string calldata,
        string calldata
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals) {
        return (_count[agentId], _avgRating[agentId], 1);
    }

    function getFeedbackCount() external view returns (uint256) {
        return feedbacks.length;
    }

    function getFeedback(uint256 idx) external view returns (FeedbackRecord memory) {
        return feedbacks[idx];
    }
}

contract MockAgentRegistryArbiter {
    struct AgentData {
        string name;
        string endpoint;
        uint256 erc8004Id;
        string ensName;
        uint256 registeredAt;
        bool active;
    }

    mapping(address => AgentData) public _agents;
    mapping(address => uint256) public _stakes;

    // Track fee distributions
    struct FeeDistribution {
        address orchestrator;
        address[] agents_;
        uint256[] fees;
    }
    FeeDistribution[] public distributions;

    function setAgent(address addr, uint256 erc8004Id, uint256 stake) external {
        _agents[addr] = AgentData("Agent", "https://agent.com", erc8004Id, "", block.timestamp, true);
        _stakes[addr] = stake;
    }

    function agents(address addr) external view returns (
        string memory name,
        string memory endpoint,
        uint256 erc8004Id,
        string memory ensName,
        uint256 registeredAt,
        bool active
    ) {
        AgentData memory a = _agents[addr];
        return (a.name, a.endpoint, a.erc8004Id, a.ensName, a.registeredAt, a.active);
    }

    function stakes(address agent) external view returns (uint256) {
        return _stakes[agent];
    }

    function isRegistered(address agent) external view returns (bool) {
        return _agents[agent].active;
    }

    function hasCapabilities(address, bytes32[] calldata) external pure returns (bool) {
        return true;
    }

    function distributeFeesFromStake(
        address orchestrator,
        address[] calldata agents_,
        uint256[] calldata fees
    ) external {
        distributions.push();
        FeeDistribution storage d = distributions[distributions.length - 1];
        d.orchestrator = orchestrator;
        for (uint i = 0; i < agents_.length; i++) {
            d.agents_.push(agents_[i]);
            d.fees.push(fees[i]);
        }
    }

    function getDistributionCount() external view returns (uint256) {
        return distributions.length;
    }
}

// ─── Test Contract ────────────────────────────────────────

contract AgentChainArbiterTest is Test {
    AgentChainArbiter public arbiter;
    MockDelegationTrackerArbiter public tracker;
    MockDelegationManagerArbiter public delegationMgr;
    MockReputationRegistry public reputation;
    MockAgentRegistryArbiter public registry;

    address public user = makeAddr("user");
    address public orchestrator = makeAddr("orchestrator");
    address public agent1 = makeAddr("agent1");
    address public agent2 = makeAddr("agent2");
    address public agent3 = makeAddr("agent3");

    bytes32 public constant TASK_ID = keccak256("task-1");
    bytes32 public constant DEL_HASH_1 = keccak256("del-1");
    bytes32 public constant DEL_HASH_2 = keccak256("del-2");
    bytes32 public constant DEL_HASH_3 = keccak256("del-3");

    function setUp() public {
        tracker = new MockDelegationTrackerArbiter();
        delegationMgr = new MockDelegationManagerArbiter();
        reputation = new MockReputationRegistry();
        registry = new MockAgentRegistryArbiter();

        arbiter = new AgentChainArbiter(
            address(tracker),
            address(delegationMgr),
            address(reputation),
            address(registry)
        );

        // Set up task: user created, orchestrator accepted (status=1)
        tracker.setTask(TASK_ID, user, orchestrator, 1, block.timestamp + 1 days, 2, 500e6);

        // Register agents with stakes and erc8004 IDs
        registry.setAgent(agent1, 101, 5000e6);
        registry.setAgent(agent2, 102, 3000e6);
        registry.setAgent(agent3, 103, 2000e6);

        // Add delegation hops
        tracker.addDelegation(TASK_ID, orchestrator, agent1, 1, DEL_HASH_1);
        tracker.addDelegation(TASK_ID, orchestrator, agent2, 1, DEL_HASH_2);
    }

    // ─── Helpers ─────────────────────────────────────────

    function _emptyAttestation() internal pure returns (Attestation memory) {
        return Attestation({
            uid: bytes32(0),
            schema: bytes32(0),
            time: 0,
            expirationTime: 0,
            revocationTime: 0,
            refUID: bytes32(0),
            attester: address(0),
            recipient: address(0),
            revocable: false,
            data: ""
        });
    }

    function _encodeDemand(
        bytes32 taskId,
        address orch,
        uint256 thresholdBps,
        int128 minRep,
        bool repRequired
    ) internal pure returns (bytes memory) {
        return abi.encode(AgentChainArbiter.DemandData({
            taskId: taskId,
            orchestrator: orch,
            stakeThresholdBps: thresholdBps,
            minReputation: minRep,
            reputationRequired: repRequired
        }));
    }

    // ═══════════════════════════════════════════════════════
    //  checkStatement Tests
    // ═══════════════════════════════════════════════════════

    // ─── Layer 0: Orchestrator Mismatch ──────────────────

    function test_checkStatement_wrongOrchestratorFails() public {
        address wrong = makeAddr("wrong");
        bytes memory demand = _encodeDemand(TASK_ID, wrong, 7500, 0, false);
        assertFalse(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    // ─── Layer 1: Delegation Chain Integrity ─────────────

    function test_checkStatement_allDelegationsIntact() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 7500, 0, false);
        assertTrue(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_revokedDelegationFails() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);
        delegationMgr.setDisabled(DEL_HASH_1, true); // revoke agent1's delegation

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 5000, 0, false);
        assertFalse(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_noDelegationsFails() public view {
        bytes32 emptyTaskId = keccak256("empty-task");
        // No delegations added for this task
        bytes memory demand = _encodeDemand(emptyTaskId, orchestrator, 5000, 0, false);
        assertFalse(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    // ─── Layer 2: Stake-Weighted Consensus ───────────────

    function test_checkStatement_stakeWeightedPass() public {
        // agent1: 5000 USDC, agent2: 3000 USDC
        // Only agent1 submits work → 5000/8000 = 62.5% = 6250 bps
        tracker.setWorkRecord(TASK_ID, agent1, true);

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 6000, 0, false);
        assertTrue(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_stakeWeightedFail() public {
        // agent1: 5000, agent2: 3000. Only agent2 submits → 3000/8000 = 37.5% = 3750 bps
        tracker.setWorkRecord(TASK_ID, agent2, true);

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 5000, 0, false); // need 50%
        assertFalse(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_100percentThreshold() public {
        // Both agents submit work → 100%
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 10000, 0, false);
        assertTrue(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_zeroStakeFails() public {
        // Set agents to zero stake
        registry.setAgent(agent1, 101, 0);
        registry.setAgent(agent2, 102, 0);
        tracker.setWorkRecord(TASK_ID, agent1, true);

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 5000, 0, false);
        assertFalse(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    // ─── Layer 3: Reputation-Gated Release ───────────────

    function test_checkStatement_reputationGatePass() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);

        // Set good reputation for both agents
        address[] memory clients = new address[](1);
        clients[0] = user;
        reputation.setReputation(101, clients, 5, 40); // 4.0 stars
        reputation.setReputation(102, clients, 3, 35); // 3.5 stars

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 5000, 30, true); // min 3.0
        assertTrue(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_reputationGateFail() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);

        address[] memory clients = new address[](1);
        clients[0] = user;
        reputation.setReputation(101, clients, 5, 40); // 4.0 stars — ok
        reputation.setReputation(102, clients, 3, 20); // 2.0 stars — below min

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 5000, 30, true); // min 3.0
        assertFalse(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_reputationSkippedWhenNotRequired() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);

        // Low reputation but reputationRequired = false
        address[] memory clients = new address[](1);
        clients[0] = user;
        reputation.setReputation(101, clients, 5, 10); // 1.0 stars
        reputation.setReputation(102, clients, 3, 10); // 1.0 stars

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 5000, 30, false);
        assertTrue(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    function test_checkStatement_newAgentNoReviewsPassesRepGate() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);

        // agent1 has reviews, agent2 has none (new agent)
        address[] memory clients = new address[](1);
        clients[0] = user;
        reputation.setReputation(101, clients, 5, 40); // 4.0 stars
        // agent2 (erc8004Id=102) has no clients set → empty array → skipped

        bytes memory demand = _encodeDemand(TASK_ID, orchestrator, 5000, 30, true);
        assertTrue(arbiter.checkStatement(_emptyAttestation(), demand, bytes32(0)));
    }

    // ═══════════════════════════════════════════════════════
    //  settleAndRate Tests
    // ═══════════════════════════════════════════════════════

    function test_settleAndRate_success() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);
        tracker.setPromisedFee(TASK_ID, agent1, 80e6);
        tracker.setPromisedFee(TASK_ID, agent2, 50e6);

        vm.prank(user);
        arbiter.settleAndRate(TASK_ID, 45); // 4.5 stars

        // Check task was settled
        assertTrue(tracker.settled());

        // Check fees were distributed
        assertEq(registry.getDistributionCount(), 1);

        // Check reputation feedback was submitted
        assertEq(reputation.getFeedbackCount(), 2);
        MockReputationRegistry.FeedbackRecord memory fb1 = reputation.getFeedback(0);
        assertEq(fb1.agentId, 101);
        assertEq(fb1.value, 45);
    }

    function test_settleAndRate_notCreatorFails() public {
        vm.prank(orchestrator); // not the task creator
        vm.expectRevert(abi.encodeWithSelector(
            AgentChainArbiter.NotTaskCreator.selector, orchestrator, user
        ));
        arbiter.settleAndRate(TASK_ID, 45);
    }

    function test_settleAndRate_invalidRatingTooLowFails() public {
        vm.prank(user);
        vm.expectRevert(AgentChainArbiter.InvalidRating.selector);
        arbiter.settleAndRate(TASK_ID, 5); // below 10 (1.0)
    }

    function test_settleAndRate_invalidRatingTooHighFails() public {
        vm.prank(user);
        vm.expectRevert(AgentChainArbiter.InvalidRating.selector);
        arbiter.settleAndRate(TASK_ID, 55); // above 50 (5.0)
    }

    function test_settleAndRate_onlyAgentsWithWorkGetPaid() public {
        // Only agent1 submitted work
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setPromisedFee(TASK_ID, agent1, 80e6);
        tracker.setPromisedFee(TASK_ID, agent2, 50e6); // agent2 has fee but no work

        vm.prank(user);
        arbiter.settleAndRate(TASK_ID, 40);

        // Only 1 feedback (agent1 only)
        assertEq(reputation.getFeedbackCount(), 1);
        MockReputationRegistry.FeedbackRecord memory fb = reputation.getFeedback(0);
        assertEq(fb.agentId, 101);
    }

    function test_settleAndRate_emitsEvents() public {
        tracker.setWorkRecord(TASK_ID, agent1, true);
        tracker.setWorkRecord(TASK_ID, agent2, true);
        tracker.setPromisedFee(TASK_ID, agent1, 80e6);
        tracker.setPromisedFee(TASK_ID, agent2, 50e6);

        vm.expectEmit(true, false, false, true);
        emit AgentChainArbiter.TaskVerified(TASK_ID, 2, 10000, true);

        vm.expectEmit(true, false, false, true);
        emit AgentChainArbiter.ReputationSubmitted(TASK_ID, 2, 45);

        vm.prank(user);
        arbiter.settleAndRate(TASK_ID, 45);
    }

    // ═══════════════════════════════════════════════════════
    //  disputeAgent Tests
    // ═══════════════════════════════════════════════════════

    function test_disputeAgent_success() public {
        vm.prank(user);
        arbiter.disputeAgent(TASK_ID, agent1, "ipfs://dispute", keccak256("dispute-content"));

        assertEq(reputation.getFeedbackCount(), 1);
        MockReputationRegistry.FeedbackRecord memory fb = reputation.getFeedback(0);
        assertEq(fb.agentId, 101);
        assertEq(fb.value, -10);
        assertEq(keccak256(bytes(fb.tag2)), keccak256(bytes("dispute")));
    }

    function test_disputeAgent_notCreatorFails() public {
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(
            AgentChainArbiter.NotTaskCreator.selector, orchestrator, user
        ));
        arbiter.disputeAgent(TASK_ID, agent1, "ipfs://dispute", keccak256("dispute"));
    }

    // ═══════════════════════════════════════════════════════
    //  Constructor Tests
    // ═══════════════════════════════════════════════════════

    function test_constructor_setsImmutables() public view {
        assertEq(address(arbiter.tracker()), address(tracker));
        assertEq(address(arbiter.delegationManager()), address(delegationMgr));
        assertEq(address(arbiter.reputation()), address(reputation));
        assertEq(address(arbiter.agentRegistry()), address(registry));
    }
}
