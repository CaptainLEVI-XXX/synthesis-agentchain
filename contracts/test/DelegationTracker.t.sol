// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DelegationTracker} from "../src/DelegationTracker.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

interface IIdentityRegistryFull {
    function register(string calldata agentURI) external returns (uint256 agentId);
}

contract DelegationTrackerTest is Test {
    DelegationTracker public tracker;
    AgentRegistry public registry;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    address public deployer = makeAddr("deployer");
    address public user = makeAddr("user");
    address public orchestrator = makeAddr("orchestrator");
    address public subAgent1 = makeAddr("subAgent1");
    address public subAgent2 = makeAddr("subAgent2");
    address public enforcerAddr = makeAddr("enforcer");
    address public arbiterAddr = makeAddr("arbiter");

    bytes32 public constant TASK_ID = keccak256("test-task-1");
    bytes32 public constant CAP_DEFI = keccak256(abi.encodePacked("defi"));

    uint256 public orchestratorId;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        vm.startPrank(deployer);
        registry = new AgentRegistry(USDC, IDENTITY_REGISTRY);
        tracker = new DelegationTracker();
        // Initialize with Alkahest/EAS as address(0) — tests use registerTask
        tracker.initialize(enforcerAddr, arbiterAddr, address(registry), USDC, address(0), address(0), bytes32(0));
        vm.stopPrank();

        // Register orchestrator
        vm.prank(orchestrator);
        orchestratorId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://orchestrator");
        deal(USDC, orchestrator, 10_000e6);
        vm.startPrank(orchestrator);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = CAP_DEFI;
        registry.registerAndStake("Orchestrator", orchestratorId, caps, "https://orch.com", 5000e6);
        vm.stopPrank();

        // Fund user for fee pool deposits
        deal(USDC, user, 100_000e6);
        vm.prank(user);
        IERC20(USDC).approve(address(tracker), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────

    function _createTask() internal returns (bytes32) {
        vm.prank(user);
        tracker.registerTask(TASK_ID, block.timestamp + 1 days, 5000e6, 100e6, "Swap 5000 USDC to ETH");
        return TASK_ID;
    }

    function _createAndClaimTask() internal returns (bytes32) {
        _createTask();
        vm.prank(orchestrator);
        tracker.claimTask(TASK_ID);
        return TASK_ID;
    }

    // ─── Task Registration Tests ─────────────────────────

    function test_registerTask_storesMetadata() public {
        _createTask();
        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(t.creator, user);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Open));
        assertEq(t.deposit, 5000e6);
        assertEq(t.intent, "Swap 5000 USDC to ETH");
    }

    function test_registerTask_pullsFeePool() public {
        uint256 balBefore = IERC20(USDC).balanceOf(user);
        _createTask();
        uint256 balAfter = IERC20(USDC).balanceOf(user);
        // User paid 100 USDC fee pool
        assertEq(balBefore - balAfter, 100e6);
        assertEq(IERC20(USDC).balanceOf(address(tracker)), 100e6);
    }

    function test_registerTask_duplicateFails() public {
        _createTask();
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.TaskAlreadyExists.selector, TASK_ID));
        tracker.registerTask(TASK_ID, block.timestamp + 1 days, 5000e6, 100e6, "Duplicate");
    }

    function test_registerTask_pastDeadlineFails() public {
        vm.prank(user);
        vm.expectRevert(DelegationTracker.DeadlineInPast.selector);
        tracker.registerTask(TASK_ID, block.timestamp - 1, 5000e6, 0, "Past deadline");
    }

    // ─── Claim Task Tests ────────────────────────────────

    function test_claimTask_success() public {
        _createTask();
        vm.prank(orchestrator);
        tracker.claimTask(TASK_ID);

        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(t.orchestrator, orchestrator);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Accepted));
    }

    function test_claimTask_setsOrchestratorAsDelegated() public {
        _createTask();
        vm.prank(orchestrator);
        tracker.claimTask(TASK_ID);
        assertTrue(tracker.isDelegated(TASK_ID, orchestrator));
    }

    function test_claimTask_unregisteredFails() public {
        _createTask();
        vm.prank(user); // not registered as agent
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotRegisteredAgent.selector, user));
        tracker.claimTask(TASK_ID);
    }

    function test_claimTask_alreadyClaimedFails() public {
        _createAndClaimTask();
        vm.prank(orchestrator);
        vm.expectRevert(DelegationTracker.TaskNotOpen.selector);
        tracker.claimTask(TASK_ID);
    }

    // ─── Delegation Recording Tests ──────────────────────

    function test_recordDelegation_success() public {
        _createAndClaimTask();
        vm.prank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);

        assertTrue(tracker.isDelegated(TASK_ID, subAgent1));
        assertEq(tracker.getDelegationCount(TASK_ID), 1);
        assertEq(tracker.getPromisedFee(TASK_ID, subAgent1), 20e6);
        assertEq(tracker.getTotalPromisedFees(TASK_ID), 20e6);
    }

    function test_recordDelegation_duplicateFails() public {
        _createAndClaimTask();
        vm.startPrank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.AlreadyDelegated.selector, subAgent1));
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1b"), 10e6);
        vm.stopPrank();
    }

    function test_recordDelegation_feeExceedsDepositFails() public {
        _createAndClaimTask();
        vm.prank(enforcerAddr);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.FeeExceedsDeposit.selector, 6000e6, 5000e6));
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 6000e6);
    }

    function test_recordDelegation_unauthorizedFails() public {
        _createAndClaimTask();
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotCaveatEnforcer.selector, user));
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);
    }

    function test_recordDelegation_multipleDelegations() public {
        _createAndClaimTask();
        vm.startPrank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent2, 1, keccak256("del-2"), 30e6);
        vm.stopPrank();

        assertEq(tracker.getDelegationCount(TASK_ID), 2);
        assertEq(tracker.getTotalPromisedFees(TASK_ID), 50e6);
    }

    // ─── Work Record Tests ───────────────────────────────

    function test_submitWorkRecord_success() public {
        _createAndClaimTask();
        vm.prank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);

        vm.prank(subAgent1);
        tracker.submitWorkRecord(TASK_ID, keccak256("result-1"), "Swapped ETH, TxID: 0xabc");

        assertTrue(tracker.hasWorkRecord(TASK_ID, subAgent1));
        DelegationTracker.WorkRecord memory wr = tracker.getWorkRecord(TASK_ID, subAgent1);
        assertEq(wr.resultHash, keccak256("result-1"));
    }

    function test_submitWorkRecord_byOrchestrator() public {
        _createAndClaimTask();
        vm.prank(orchestrator);
        tracker.submitWorkRecord(TASK_ID, keccak256("orch-result"), "Added LP position");
        assertTrue(tracker.hasWorkRecord(TASK_ID, orchestrator));
    }

    function test_submitWorkRecord_nonDelegatedFails() public {
        _createAndClaimTask();
        vm.prank(subAgent1);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotDelegatedAgent.selector, subAgent1));
        tracker.submitWorkRecord(TASK_ID, keccak256("result"), "Sneaky");
    }

    function test_submitWorkRecord_duplicateFails() public {
        _createAndClaimTask();
        vm.prank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);

        vm.startPrank(subAgent1);
        tracker.submitWorkRecord(TASK_ID, keccak256("result-1"), "First");
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.WorkAlreadySubmitted.selector, subAgent1));
        tracker.submitWorkRecord(TASK_ID, keccak256("result-2"), "Second");
        vm.stopPrank();
    }

    // ─── Settlement Tests ────────────────────────────────

    function test_settleTask_distributesFees() public {
        _createAndClaimTask();

        vm.startPrank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent2, 1, keccak256("del-2"), 30e6);
        vm.stopPrank();

        vm.prank(subAgent1);
        tracker.submitWorkRecord(TASK_ID, keccak256("r1"), "Work done");
        vm.prank(subAgent2);
        tracker.submitWorkRecord(TASK_ID, keccak256("r2"), "Work done");

        // Path B (delegation-only): tracker holds 100e6 feePool from registerTask
        // Sub-agents get 20 + 30 = 50 USDC, orchestrator gets remaining 50 USDC

        uint256 sub1Before = IERC20(USDC).balanceOf(subAgent1);
        uint256 sub2Before = IERC20(USDC).balanceOf(subAgent2);
        uint256 orchBefore = IERC20(USDC).balanceOf(orchestrator);

        vm.prank(arbiterAddr);
        tracker.settleTask(TASK_ID);

        // Sub-agents got promised fees from feePool
        assertEq(IERC20(USDC).balanceOf(subAgent1) - sub1Before, 20e6);
        assertEq(IERC20(USDC).balanceOf(subAgent2) - sub2Before, 30e6);
        // Orchestrator got remaining feePool (100 - 50 = 50 USDC)
        assertEq(IERC20(USDC).balanceOf(orchestrator) - orchBefore, 50e6);
    }

    function test_settleTask_onlyWorkingAgentsPaid() public {
        _createAndClaimTask();

        vm.startPrank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 20e6);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent2, 1, keccak256("del-2"), 30e6);
        vm.stopPrank();

        // Only subAgent1 submits work
        vm.prank(subAgent1);
        tracker.submitWorkRecord(TASK_ID, keccak256("r1"), "Work done");

        uint256 sub1Before = IERC20(USDC).balanceOf(subAgent1);
        uint256 sub2Before = IERC20(USDC).balanceOf(subAgent2);

        vm.prank(arbiterAddr);
        tracker.settleTask(TASK_ID);

        // subAgent1 got 20 USDC, subAgent2 got nothing (no work)
        assertEq(IERC20(USDC).balanceOf(subAgent1) - sub1Before, 20e6);
        assertEq(IERC20(USDC).balanceOf(subAgent2), sub2Before);
    }

    function test_settleTask_notArbiterFails() public {
        _createAndClaimTask();
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotArbiterError.selector, user));
        tracker.settleTask(TASK_ID);
    }

    // ─── Expiry Tests ────────────────────────────────────

    function test_expireTask_success() public {
        _createTask();

        vm.warp(block.timestamp + 2 days);

        // Simulate: Alkahest reclaimExpired sends working capital back to tracker
        // Tracker already holds 100e6 feePool + simulate 4900e6 from Alkahest
        deal(USDC, address(tracker), IERC20(USDC).balanceOf(address(tracker)) + 4900e6);
        vm.mockCall(address(0), abi.encodeWithSelector(bytes4(keccak256("reclaimExpired(bytes32)"))), abi.encode());

        uint256 userBefore = IERC20(USDC).balanceOf(user);

        vm.prank(user);
        tracker.expireTask(TASK_ID);

        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Expired));
        // User gets full deposit refunded (5000 USDC)
        assertEq(IERC20(USDC).balanceOf(user) - userBefore, 5000e6);
    }

    function test_expireTask_onlyCreator() public {
        _createTask();
        vm.warp(block.timestamp + 2 days);

        vm.prank(orchestrator); // not the creator
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotTaskCreator.selector, orchestrator));
        tracker.expireTask(TASK_ID);
    }

    function test_expireTask_notExpiredYetFails() public {
        _createTask();
        vm.prank(user);
        vm.expectRevert(DelegationTracker.NotExpiredYet.selector);
        tracker.expireTask(TASK_ID);
    }

    function test_expireTask_alreadyFinalizedFails() public {
        _createAndClaimTask();

        // Settle first (Path B — delegation-only)
        vm.prank(arbiterAddr);
        tracker.settleTask(TASK_ID);

        // Try to expire
        vm.warp(block.timestamp + 2 days);
        vm.prank(user);
        vm.expectRevert(DelegationTracker.TaskAlreadyFinalized.selector);
        tracker.expireTask(TASK_ID);
    }

    // ─── Initialize Tests ────────────────────────────────

    function test_initialize_onlyDeployer() public {
        DelegationTracker t2 = new DelegationTracker();
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotDeployer.selector, user));
        vm.prank(user);
        t2.initialize(enforcerAddr, arbiterAddr, address(registry), USDC, address(0), address(0), bytes32(0));
    }

    function test_initialize_onlyOnce() public {
        vm.prank(deployer);
        vm.expectRevert(DelegationTracker.AlreadyInitialized.selector);
        tracker.initialize(enforcerAddr, arbiterAddr, address(registry), USDC, address(0), address(0), bytes32(0));
    }

    function test_initialize_setsState() public view {
        assertEq(tracker.capabilityEnforcer(), enforcerAddr);
        assertEq(tracker.arbiter(), arbiterAddr);
        assertEq(tracker.agentRegistry(), address(registry));
        assertEq(address(tracker.paymentToken()), USDC);
    }
}
