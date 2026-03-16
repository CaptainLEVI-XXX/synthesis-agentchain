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

    // Real Base mainnet contracts
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    address public deployer = makeAddr("deployer");
    address public user = makeAddr("user");
    address public orchestrator = makeAddr("orchestrator");
    address public subAgent1 = makeAddr("subAgent1");
    address public subAgent2 = makeAddr("subAgent2");
    address public enforcerAddr = makeAddr("enforcer");
    address public arbiterAddr = makeAddr("arbiter");

    bytes32 public constant TASK_ID = keccak256("task-1");
    bytes32 public constant CAP_DEFI = keccak256(abi.encodePacked("defi"));

    uint256 public orchestratorId;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        vm.startPrank(deployer);
        registry = new AgentRegistry(USDC, IDENTITY_REGISTRY);
        tracker = new DelegationTracker();
        tracker.initialize(enforcerAddr, arbiterAddr, address(registry));
        vm.stopPrank();

        // Register orchestrator on ERC-8004 + AgentRegistry
        vm.prank(orchestrator);
        orchestratorId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://orchestrator");

        deal(USDC, orchestrator, 10_000e6);
        vm.startPrank(orchestrator);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = CAP_DEFI;
        registry.registerAndStake("Orchestrator", orchestratorId, caps, "https://orch.com", 5000e6);
        vm.stopPrank();
    }

    // ─── Helpers ─────────────────────────────────────────

    function _createTask() internal returns (bytes32) {
        vm.prank(user);
        tracker.registerTask(TASK_ID, block.timestamp + 1 days, 500e6);
        return TASK_ID;
    }

    function _createAndClaimTask() internal returns (bytes32) {
        _createTask();
        vm.prank(orchestrator);
        tracker.claimTask(TASK_ID);
        return TASK_ID;
    }

    // ─── Task Registration Tests ─────────────────────────

    function test_registerTask() public {
        _createTask();
        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(t.creator, user);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Open));
        assertEq(t.feePool, 500e6);
    }

    function test_registerTask_duplicateFails() public {
        _createTask();
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.TaskAlreadyExists.selector, TASK_ID));
        tracker.registerTask(TASK_ID, block.timestamp + 1 days, 500e6);
    }

    function test_registerTask_pastDeadlineFails() public {
        vm.prank(user);
        vm.expectRevert(DelegationTracker.DeadlineInPast.selector);
        tracker.registerTask(TASK_ID, block.timestamp - 1, 500e6);
    }

    function test_registerTask_withFeePool() public {
        _createTask();
        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(t.feePool, 500e6);
    }

    // ─── Claim Task Tests ────────────────────────────────

    function test_claimTask_byRegisteredAgent() public {
        _createTask();
        vm.prank(orchestrator);
        tracker.claimTask(TASK_ID);

        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(t.orchestrator, orchestrator);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Accepted));
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

    function test_recordDelegation_byCaveatEnforcer() public {
        _createAndClaimTask();

        vm.prank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 80e6);

        assertTrue(tracker.isDelegated(TASK_ID, subAgent1));
        assertEq(tracker.getDelegationCount(TASK_ID), 1);
    }

    function test_recordDelegation_unauthorizedFails() public {
        _createAndClaimTask();

        vm.prank(user); // not the enforcer
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotCaveatEnforcer.selector, user));
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 80e6);
    }

    function test_recordDelegation_storesPromisedFee() public {
        _createAndClaimTask();

        vm.prank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 80e6);

        assertEq(tracker.getPromisedFee(TASK_ID, subAgent1), 80e6);
        assertEq(tracker.getTotalPromisedFees(TASK_ID), 80e6);
    }

    function test_recordDelegation_feeExceedsPoolFails() public {
        _createAndClaimTask();

        vm.prank(enforcerAddr);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.FeeExceedsPool.selector, 600e6, 500e6));
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 600e6); // pool is 500
    }

    function test_recordDelegation_multipleDelegations() public {
        _createAndClaimTask();

        vm.startPrank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 80e6);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent2, 1, keccak256("del-2"), 50e6);
        vm.stopPrank();

        assertEq(tracker.getDelegationCount(TASK_ID), 2);
        assertEq(tracker.getTotalPromisedFees(TASK_ID), 130e6);

        DelegationTracker.DelegationHop[] memory hops = tracker.getTaskDelegations(TASK_ID);
        assertEq(hops.length, 2);
        assertEq(hops[0].delegate, subAgent1);
        assertEq(hops[1].delegate, subAgent2);
    }

    function test_recordDelegation_taskNotAcceptedFails() public {
        _createTask(); // Open, not Accepted

        vm.prank(enforcerAddr);
        vm.expectRevert(DelegationTracker.TaskNotAccepted.selector);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 80e6);
    }

    // ─── Work Record Tests ───────────────────────────────

    function test_submitWorkRecord_byDelegatedAgent() public {
        _createAndClaimTask();

        vm.prank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 80e6);

        vm.prank(subAgent1);
        tracker.submitWorkRecord(TASK_ID, keccak256("result-1"), "Analyzed Aave yields");

        assertTrue(tracker.hasWorkRecord(TASK_ID, subAgent1));
        DelegationTracker.WorkRecord memory wr = tracker.getWorkRecord(TASK_ID, subAgent1);
        assertEq(wr.resultHash, keccak256("result-1"));
    }

    function test_submitWorkRecord_nonDelegatedFails() public {
        _createAndClaimTask();

        vm.prank(subAgent1); // not delegated
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotDelegatedAgent.selector, subAgent1));
        tracker.submitWorkRecord(TASK_ID, keccak256("result-1"), "Sneaky");
    }

    function test_submitWorkRecord_duplicateFails() public {
        _createAndClaimTask();

        vm.prank(enforcerAddr);
        tracker.recordDelegation(TASK_ID, orchestrator, subAgent1, 1, keccak256("del-1"), 80e6);

        vm.startPrank(subAgent1);
        tracker.submitWorkRecord(TASK_ID, keccak256("result-1"), "First");
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.WorkAlreadySubmitted.selector, subAgent1));
        tracker.submitWorkRecord(TASK_ID, keccak256("result-2"), "Second");
        vm.stopPrank();
    }

    // ─── Settlement Tests ────────────────────────────────

    function test_settleTask() public {
        _createAndClaimTask();

        vm.prank(arbiterAddr);
        tracker.settleTask(TASK_ID);

        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Completed));
    }

    function test_settleTask_notArbiterFails() public {
        _createAndClaimTask();

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotArbiterError.selector, user));
        tracker.settleTask(TASK_ID);
    }

    // ─── Expiry Tests ────────────────────────────────────

    function test_expireTask() public {
        _createTask();

        vm.warp(block.timestamp + 2 days); // past deadline
        tracker.expireTask(TASK_ID);

        DelegationTracker.Task memory t = tracker.getTask(TASK_ID);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Expired));
    }

    function test_expireTask_notExpiredYetFails() public {
        _createTask();

        vm.expectRevert(DelegationTracker.NotExpiredYet.selector);
        tracker.expireTask(TASK_ID);
    }

    function test_expireTask_alreadyFinalizedFails() public {
        _createAndClaimTask();

        vm.prank(arbiterAddr);
        tracker.settleTask(TASK_ID);

        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(DelegationTracker.TaskAlreadyFinalized.selector);
        tracker.expireTask(TASK_ID);
    }

    // ─── Initialize Tests ────────────────────────────────

    function test_initialize_onlyDeployer() public {
        DelegationTracker t2 = new DelegationTracker();
        vm.expectRevert(abi.encodeWithSelector(DelegationTracker.NotDeployer.selector, user));
        vm.prank(user);
        t2.initialize(enforcerAddr, arbiterAddr, address(registry));
    }

    function test_initialize_onlyOnce() public {
        vm.prank(deployer);
        vm.expectRevert(DelegationTracker.AlreadyInitialized.selector);
        tracker.initialize(enforcerAddr, arbiterAddr, address(registry));
    }
}
