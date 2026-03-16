// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AgentRegistry} from "../src/AgentRegistry.sol";
import {DelegationTracker} from "../src/DelegationTracker.sol";
import {AgentChainArbiter} from "../src/AgentChainArbiter.sol";
import {Attestation, DelegationHop} from "../src/interfaces/ICommon.sol";

// ─── Minimal interfaces for real on-chain contracts ──────

interface IIdentityRegistryFull {
    function register(string calldata agentURI) external returns (uint256 agentId);
}

interface IDelegationManagerFull {
    function disabledDelegations(bytes32 delegationHash) external view returns (bool);
}

/// @dev Interface to call the enforcer without importing it (avoids solc 0.8.23 version conflict)
interface IAgentCapabilityEnforcer {
    function registry() external view returns (address);
    function tracker() external view returns (address);
}

/// @title Full Integration Test — AgentChain End-to-End
/// @notice Deploys all 4 contracts on a Base mainnet fork and runs
///         the complete task lifecycle: register → claim → delegate → work → verify → settle
contract IntegrationTest is Test {

    // ─── Real Base mainnet contracts ─────────────────────
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant REPUTATION_REGISTRY = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;

    // ─── Our contracts ───────────────────────────────────
    AgentRegistry public registry;
    DelegationTracker public tracker;
    address public enforcer;  // stored as address to avoid solc version conflict
    AgentChainArbiter public arbiter;

    // ─── Actors ──────────────────────────────────────────
    address public deployer = makeAddr("deployer");
    address public user = makeAddr("user");           // task creator
    address public orchestrator = makeAddr("orchestrator");
    address public defiAgent = makeAddr("defiAgent");
    address public dataAgent = makeAddr("dataAgent");

    // ─── Constants ───────────────────────────────────────
    bytes32 public constant TASK_ID = keccak256("integration-task-1");
    bytes32 public constant CAP_DEFI = keccak256(abi.encodePacked("defi"));
    bytes32 public constant CAP_DATA = keccak256(abi.encodePacked("data"));
    bytes32 public constant CAP_LENDING = keccak256(abi.encodePacked("lending"));

    // ─── ERC-8004 IDs ────────────────────────────────────
    uint256 public orchestratorId;
    uint256 public defiAgentId;
    uint256 public dataAgentId;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        // ═══════════════════════════════════════════════════
        // Phase 1: Deploy all contracts (correct initialization order)
        // ═══════════════════════════════════════════════════

        vm.startPrank(deployer);

        // 1. Deploy AgentRegistry
        registry = new AgentRegistry(USDC, IDENTITY_REGISTRY);

        // 2. Deploy DelegationTracker
        tracker = new DelegationTracker();

        // 3. Deploy AgentCapabilityEnforcer (compiled separately as 0.8.23)
        //    We deploy it via bytecode to avoid importing the 0.8.23 contract
        enforcer = _deployEnforcer(address(registry), address(tracker));

        // 4. Deploy AgentChainArbiter
        arbiter = new AgentChainArbiter(
            address(tracker),
            DELEGATION_MANAGER,
            REPUTATION_REGISTRY,
            address(registry)
        );

        // 5. Initialize tracker (chicken-and-egg solved)
        tracker.initialize(enforcer, address(arbiter), address(registry));

        // 6. Set arbiter on registry
        registry.setArbiter(address(arbiter));

        vm.stopPrank();

        // ═══════════════════════════════════════════════════
        // Phase 2: Register agents on ERC-8004 + AgentRegistry
        // ═══════════════════════════════════════════════════

        // Register orchestrator
        vm.prank(orchestrator);
        orchestratorId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://orchestrator");

        deal(USDC, orchestrator, 10_000e6);
        vm.startPrank(orchestrator);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory orchCaps = new bytes32[](2);
        orchCaps[0] = CAP_DEFI;
        orchCaps[1] = CAP_DATA;
        registry.registerAndStake("Orchestrator", orchestratorId, orchCaps, "https://orch.agentchain.ai", 5000e6);
        vm.stopPrank();

        // Register DeFi Agent
        vm.prank(defiAgent);
        defiAgentId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://defi-agent");

        deal(USDC, defiAgent, 5000e6);
        vm.startPrank(defiAgent);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory defiCaps = new bytes32[](2);
        defiCaps[0] = CAP_DEFI;
        defiCaps[1] = CAP_LENDING;
        registry.registerAndStake("DeFi Agent", defiAgentId, defiCaps, "https://defi.agentchain.ai", 3000e6);
        vm.stopPrank();

        // Register Data Agent
        vm.prank(dataAgent);
        dataAgentId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://data-agent");

        deal(USDC, dataAgent, 3000e6);
        vm.startPrank(dataAgent);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory dataCaps = new bytes32[](1);
        dataCaps[0] = CAP_DATA;
        registry.registerAndStake("Data Agent", dataAgentId, dataCaps, "https://data.agentchain.ai", 2000e6);
        vm.stopPrank();
    }

    /// @dev Deploy AgentCapabilityEnforcer using forge's ffi to get bytecode
    ///      This avoids importing the 0.8.23 contract into our 0.8.24 test
    function _deployEnforcer(address _registry, address _tracker) internal returns (address) {
        // Get the creation bytecode from the compiled artifact
        bytes memory bytecode = vm.getCode("AgentCapabilityEnforcer.sol:AgentCapabilityEnforcer");
        // Append constructor args
        bytes memory creationCode = abi.encodePacked(bytecode, abi.encode(_registry, _tracker));
        address deployed;
        assembly {
            deployed := create(0, add(creationCode, 0x20), mload(creationCode))
        }
        require(deployed != address(0), "Enforcer deployment failed");
        return deployed;
    }

    // ═══════════════════════════════════════════════════════
    //  TEST: Full Task Lifecycle (Happy Path)
    //  register → claim → delegate → work → verify → settle
    // ═══════════════════════════════════════════════════════

    function test_fullTaskLifecycle() public {
        // ─── Step 1: User creates a task ─────────────────
        vm.prank(user);
        tracker.registerTask(TASK_ID, block.timestamp + 1 days, 200e6);

        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(t.creator, user);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Open));
        assertEq(t.feePool, 200e6);

        // ─── Step 2: Orchestrator claims the task ────────
        vm.prank(orchestrator);
        tracker.claimTask(TASK_ID);

        t = tracker.getTask(TASK_ID);
        assertEq(t.orchestrator, orchestrator);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Accepted));

        // ─── Step 3: Simulated delegation via enforcer ───
        // In production: DelegationManager.redeemDelegations() calls enforcer hooks.
        // In testing: we call recordDelegation as the enforcer (afterHook records it).
        bytes32 delHash1 = keccak256("delegation-defi-agent");
        bytes32 delHash2 = keccak256("delegation-data-agent");

        vm.startPrank(enforcer);
        tracker.recordDelegation(TASK_ID, orchestrator, defiAgent, 1, delHash1, 80e6);
        tracker.recordDelegation(TASK_ID, orchestrator, dataAgent, 1, delHash2, 50e6);
        vm.stopPrank();

        // Verify delegations were recorded
        assertEq(tracker.getDelegationCount(TASK_ID), 2);
        assertTrue(tracker.isDelegated(TASK_ID, defiAgent));
        assertTrue(tracker.isDelegated(TASK_ID, dataAgent));
        assertEq(tracker.getPromisedFee(TASK_ID, defiAgent), 80e6);
        assertEq(tracker.getPromisedFee(TASK_ID, dataAgent), 50e6);
        assertEq(tracker.getTotalPromisedFees(TASK_ID), 130e6);

        // ─── Step 4: Sub-agents submit work records ──────
        vm.prank(defiAgent);
        tracker.submitWorkRecord(TASK_ID, keccak256("defi-result-ipfs"), "Optimized Aave yield to 8.2% APY");

        vm.prank(dataAgent);
        tracker.submitWorkRecord(TASK_ID, keccak256("data-result-ipfs"), "Analyzed 30-day yield trends across 5 protocols");

        assertTrue(tracker.hasWorkRecord(TASK_ID, defiAgent));
        assertTrue(tracker.hasWorkRecord(TASK_ID, dataAgent));

        // ─── Step 5: Arbiter verifies (checkStatement) ───
        // 3-layer verification: chain integrity + stake-weighted consensus + reputation
        bytes memory demand = abi.encode(AgentChainArbiter.DemandData({
            taskId: TASK_ID,
            orchestrator: orchestrator,
            stakeThresholdBps: 7500,     // 75% stake-weighted completion
            minReputation: 0,
            reputationRequired: false    // bootstrapping
        }));

        Attestation memory emptyAttestation;
        bool verified = arbiter.checkStatement(emptyAttestation, demand, bytes32(0));
        assertTrue(verified, "checkStatement should pass: all delegations intact, 100% stake completed");

        // ─── Step 6: Task creator settles + rates ────────
        uint256 orchStakeBefore = registry.stakes(orchestrator);

        vm.prank(user);
        arbiter.settleAndRate(TASK_ID, 45); // 4.5 stars

        // Verify task is completed
        t = tracker.getTask(TASK_ID);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Completed));

        // Verify fees deducted from orchestrator's stake (80 + 50 = 130 USDC)
        uint256 orchStakeAfter = registry.stakes(orchestrator);
        assertEq(orchStakeBefore - orchStakeAfter, 130e6, "130 USDC fees deducted from orchestrator stake");
    }

    // ═══════════════════════════════════════════════════════
    //  TEST: Partial Work — Stake-Weighted Threshold
    // ═══════════════════════════════════════════════════════

    function test_partialCompletion_stakeWeighted() public {
        bytes32 taskId = keccak256("partial-task");

        vm.prank(user);
        tracker.registerTask(taskId, block.timestamp + 1 days, 200e6);

        vm.prank(orchestrator);
        tracker.claimTask(taskId);

        vm.startPrank(enforcer);
        tracker.recordDelegation(taskId, orchestrator, defiAgent, 1, keccak256("del-p-1"), 80e6);
        tracker.recordDelegation(taskId, orchestrator, dataAgent, 1, keccak256("del-p-2"), 50e6);
        vm.stopPrank();

        // Only DeFi Agent (3000 USDC stake) submits. Data Agent (2000 USDC) doesn't.
        // Stake-weighted: 3000/5000 = 60% = 6000 bps
        vm.prank(defiAgent);
        tracker.submitWorkRecord(taskId, keccak256("partial-result"), "DeFi work done");

        Attestation memory emptyAttestation;

        // 75% threshold — should fail (only 60%)
        bytes memory demandHigh = abi.encode(AgentChainArbiter.DemandData({
            taskId: taskId,
            orchestrator: orchestrator,
            stakeThresholdBps: 7500,
            minReputation: 0,
            reputationRequired: false
        }));
        assertFalse(arbiter.checkStatement(emptyAttestation, demandHigh, bytes32(0)),
            "Should fail: 60% < 75% threshold");

        // 50% threshold — should pass (60% > 50%)
        bytes memory demandLow = abi.encode(AgentChainArbiter.DemandData({
            taskId: taskId,
            orchestrator: orchestrator,
            stakeThresholdBps: 5000,
            minReputation: 0,
            reputationRequired: false
        }));
        assertTrue(arbiter.checkStatement(emptyAttestation, demandLow, bytes32(0)),
            "Should pass: 60% > 50% threshold");
    }

    // ═══════════════════════════════════════════════════════
    //  TEST: Revoked Delegation Blocks Escrow Release
    // ═══════════════════════════════════════════════════════

    function test_revokedDelegation_blocksRelease() public {
        bytes32 taskId = keccak256("revoked-task");

        vm.prank(user);
        tracker.registerTask(taskId, block.timestamp + 1 days, 200e6);

        vm.prank(orchestrator);
        tracker.claimTask(taskId);

        bytes32 revokedHash = keccak256("revoked-delegation");

        vm.startPrank(enforcer);
        tracker.recordDelegation(taskId, orchestrator, defiAgent, 1, revokedHash, 80e6);
        vm.stopPrank();

        vm.prank(defiAgent);
        tracker.submitWorkRecord(taskId, keccak256("work"), "Done");

        // Mock the real DelegationManager to report this hash as disabled
        vm.mockCall(
            DELEGATION_MANAGER,
            abi.encodeWithSelector(IDelegationManagerFull.disabledDelegations.selector, revokedHash),
            abi.encode(true)
        );

        // Verify the mock worked
        assertTrue(IDelegationManagerFull(DELEGATION_MANAGER).disabledDelegations(revokedHash));

        // checkStatement should fail — delegation chain integrity broken
        bytes memory demand = abi.encode(AgentChainArbiter.DemandData({
            taskId: taskId,
            orchestrator: orchestrator,
            stakeThresholdBps: 5000,
            minReputation: 0,
            reputationRequired: false
        }));

        Attestation memory emptyAttestation;
        assertFalse(arbiter.checkStatement(emptyAttestation, demand, bytes32(0)),
            "Should fail: revoked delegation breaks chain integrity");
    }

    // ═══════════════════════════════════════════════════════
    //  TEST: Fee Distribution — Only Working Agents Get Paid
    // ═══════════════════════════════════════════════════════

    function test_feeDistribution_onlyWorkingAgentsPaid() public {
        bytes32 taskId = keccak256("fee-task");

        vm.prank(user);
        tracker.registerTask(taskId, block.timestamp + 1 days, 200e6);

        vm.prank(orchestrator);
        tracker.claimTask(taskId);

        vm.startPrank(enforcer);
        tracker.recordDelegation(taskId, orchestrator, defiAgent, 1, keccak256("fee-del-1"), 80e6);
        tracker.recordDelegation(taskId, orchestrator, dataAgent, 1, keccak256("fee-del-2"), 50e6);
        vm.stopPrank();

        // Only DeFi Agent submits work
        vm.prank(defiAgent);
        tracker.submitWorkRecord(taskId, keccak256("fee-result"), "Work done");

        uint256 orchStakeBefore = registry.stakes(orchestrator);
        uint256 defiBalBefore = IERC20(USDC).balanceOf(defiAgent);
        uint256 dataBalBefore = IERC20(USDC).balanceOf(dataAgent);

        vm.prank(user);
        arbiter.settleAndRate(taskId, 40); // 4.0 stars

        // Only 80 USDC deducted (defi agent's fee), not 130
        assertEq(orchStakeBefore - registry.stakes(orchestrator), 80e6, "Only working agent fee deducted");

        // DeFi Agent received 80 USDC
        assertEq(IERC20(USDC).balanceOf(defiAgent) - defiBalBefore, 80e6, "DeFi agent got 80 USDC");

        // Data Agent received nothing
        assertEq(IERC20(USDC).balanceOf(dataAgent) - dataBalBefore, 0, "Data agent got nothing");
    }

    // ═══════════════════════════════════════════════════════
    //  TEST: Dispute Flow
    // ═══════════════════════════════════════════════════════

    function test_disputeAgent_flow() public {
        bytes32 taskId = keccak256("dispute-task");

        vm.prank(user);
        tracker.registerTask(taskId, block.timestamp + 1 days, 200e6);

        vm.prank(orchestrator);
        tracker.claimTask(taskId);

        // Task creator disputes an agent — submits negative ERC-8004 feedback
        vm.prank(user);
        arbiter.disputeAgent(taskId, defiAgent, "ipfs://dispute-evidence", keccak256("evidence-hash"));
        // Call succeeded — negative feedback submitted to real ERC-8004 Reputation Registry
    }

    // ═══════════════════════════════════════════════════════
    //  TEST: Task Expiry
    // ═══════════════════════════════════════════════════════

    function test_taskExpiry_afterDeadline() public {
        bytes32 taskId = keccak256("expiry-task");

        vm.prank(user);
        tracker.registerTask(taskId, block.timestamp + 1 days, 200e6);

        vm.warp(block.timestamp + 2 days);
        tracker.expireTask(taskId);

        DelegationTracker.Task memory t = tracker.getTask(taskId);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Expired));
    }

    // ═══════════════════════════════════════════════════════
    //  TEST: Deployment Wiring Verification
    // ═══════════════════════════════════════════════════════

    function test_deploymentWiring() public view {
        // Verify all contracts are wired correctly
        assertEq(IAgentCapabilityEnforcer(enforcer).registry(), address(registry));
        assertEq(IAgentCapabilityEnforcer(enforcer).tracker(), address(tracker));

        assertEq(address(arbiter.tracker()), address(tracker));
        assertEq(address(arbiter.delegationManager()), DELEGATION_MANAGER);
        assertEq(address(arbiter.reputation()), REPUTATION_REGISTRY);
        assertEq(address(arbiter.agentRegistry()), address(registry));

        assertEq(tracker.capabilityEnforcer(), enforcer);
        assertEq(tracker.arbiter(), address(arbiter));
        assertEq(tracker.agentRegistry(), address(registry));

        assertEq(address(registry.arbiter()), address(arbiter));
    }
}
