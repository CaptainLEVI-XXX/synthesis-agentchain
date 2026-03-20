// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AgentRegistry} from "../src/AgentRegistry.sol";
import {DelegationTracker} from "../src/DelegationTracker.sol";
import {AgentChainArbiter} from "../src/AgentChainArbiter.sol";
import {IAlkahestEscrow} from "../src/interfaces/IAlkahestEscrow.sol";
import {Attestation, DelegationHop} from "../src/interfaces/ICommon.sol";

interface IIdentityRegistryFull {
    function register(string calldata agentURI) external returns (uint256 agentId);
}

interface IDelegationManagerFull {
    function disabledDelegations(bytes32 delegationHash) external view returns (bool);
}

interface IAgentCapabilityEnforcer {
    function registry() external view returns (address);
    function tracker() external view returns (address);
}

/// @title AgentChain Integration Test — Dual Entry End-to-End
/// @notice Runs on a Base mainnet fork with REAL external contracts:
///         - ERC-8004 IdentityRegistry + ReputationRegistry
///         - MetaMask DelegationManager
///         - USDC
///
///         Tests TWO flows:
///         Flow A (Entry Point A): Intent-based delegation via ERC-4337 smart account
///
///         Flow B (Entry Point B):  Intent-based delegation for EOA users
///       
contract Demo is Test {

    // ─── Real Base mainnet contracts ─────────────────────
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant REPUTATION_REGISTRY = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;

    // ─── Our contracts ───────────────────────────────────
    AgentRegistry public registry;
    DelegationTracker public tracker;
    address public enforcer;
    AgentChainArbiter public arbiter;

    // ─── Actors ──────────────────────────────────────────
    address public deployer = makeAddr("deployer");
    address public user = makeAddr("user");
    address public orchestrator = makeAddr("orchestrator");
    address public swapAgent = makeAddr("swapAgent");
    address public priceAgent = makeAddr("priceAgent");

    // ─── Capabilities ────────────────────────────────────
    bytes32 public constant CAP_SWAP = keccak256(abi.encodePacked("uniswap-swap"));
    bytes32 public constant CAP_LP = keccak256(abi.encodePacked("uniswap-lp"));
    bytes32 public constant CAP_PRICE = keccak256(abi.encodePacked("uniswap-price"));

    // ─── ERC-8004 IDs ────────────────────────────────────
    uint256 public orchestratorId;
    uint256 public swapAgentId;
    uint256 public priceAgentId;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        // ═══════════════════════════════════════════════════
        // Deploy AgentChain contracts
        // ═══════════════════════════════════════════════════

        vm.startPrank(deployer);

        registry = new AgentRegistry(USDC, IDENTITY_REGISTRY);
        tracker = new DelegationTracker();
        enforcer = _deployEnforcer(address(registry), address(tracker));

        arbiter = new AgentChainArbiter(
            address(tracker),
            DELEGATION_MANAGER,
            REPUTATION_REGISTRY,
            address(registry)
        );

        // Alkahest + EAS as address(0) for mainnet fork tests
        // (Alkahest is deployed on Base Sepolia, tested separately)
        tracker.initialize(enforcer, address(arbiter), address(registry), USDC, address(0), address(0), bytes32(0));

        vm.stopPrank();

        // ═══════════════════════════════════════════════════
        // Register agents with real ERC-8004 on Base mainnet
        // ═══════════════════════════════════════════════════

        // Orchestrator (LPAgent) — capability: swap + lp
        vm.prank(orchestrator);
        orchestratorId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://orchestrator");
        deal(USDC, orchestrator, 10_000e6);
        vm.startPrank(orchestrator);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory orchCaps = new bytes32[](2);
        orchCaps[0] = CAP_SWAP;
        orchCaps[1] = CAP_LP;
        registry.registerAndStake("LPAgent", orchestratorId, orchCaps, "http://localhost:3003", 5000e6);
        vm.stopPrank();

        // SwapAgent — capability: swap
        vm.prank(swapAgent);
        swapAgentId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://swap-agent");
        deal(USDC, swapAgent, 5000e6);
        vm.startPrank(swapAgent);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory swapCaps = new bytes32[](1);
        swapCaps[0] = CAP_SWAP;
        registry.registerAndStake("SwapAgent", swapAgentId, swapCaps, "http://localhost:3002", 2000e6);
        vm.stopPrank();

        // PriceAgent — capability: price
        vm.prank(priceAgent);
        priceAgentId = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://price-agent");
        deal(USDC, priceAgent, 2000e6);
        vm.startPrank(priceAgent);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory priceCaps = new bytes32[](1);
        priceCaps[0] = CAP_PRICE;
        registry.registerAndStake("PriceAgent", priceAgentId, priceCaps, "http://localhost:3001", 500e6);
        vm.stopPrank();

        // Fund user
        deal(USDC, user, 100_000e6);
        vm.prank(user);
        IERC20(USDC).approve(address(tracker), type(uint256).max);
    }

    // ═══════════════════════════════════════════════════════
    //  FLOW A: Intent-Based Delegation (ERC-4337 Smart Account)
    //  User delegates DeFi execution to AI agents.
    //  No Alkahest escrow. Fees from feePool.
    // ═══════════════════════════════════════════════════════

    function test_flowA_intentBasedDelegation() public {
        bytes32 taskId = keccak256("flow-a-task");

        // ─── 1. User posts intent + deposits feePool ─────
        vm.prank(user);
        tracker.registerTask(
            taskId,
            block.timestamp + 1 days,
            5000e6,                // deposit (reference — user's funds in their smart account)
            200e6,                 // feePool (deposited to tracker for agent payments)
            "Provide liquidity with 2 ETH in best ETH/USDC pool on Uniswap"
        );

        DelegationTracker.Task memory t = tracker.getTask(taskId);
        assertEq(t.creator, user);
        assertFalse(t.hasEscrow, "Flow A: no Alkahest escrow");
        assertEq(t.intent, "Provide liquidity with 2 ETH in best ETH/USDC pool on Uniswap");
        assertEq(IERC20(USDC).balanceOf(address(tracker)), 200e6, "Tracker holds 200 USDC feePool");

        // ─── 2. Orchestrator (LPAgent) claims task ───────
        vm.prank(orchestrator);
        tracker.claimTask(taskId);
        assertTrue(tracker.isDelegated(taskId, orchestrator));

        // ─── 3. Orchestrator delegates to PriceAgent + SwapAgent ──
        // (In production: MetaMask DelegationManager validates via our enforcer)
        // (Here: we record delegation hops as the enforcer would)
        vm.startPrank(enforcer);
        tracker.recordDelegation(taskId, orchestrator, priceAgent, 1, keccak256("del-price"), 10e6);
        tracker.recordDelegation(taskId, orchestrator, swapAgent, 1, keccak256("del-swap"), 40e6);
        vm.stopPrank();

        assertEq(tracker.getDelegationCount(taskId), 2);
        assertEq(tracker.getTotalPromisedFees(taskId), 50e6);

        // ─── 4. Sub-agents complete work ─────────────────
        // PriceAgent: queried pool prices via Uniswap
        vm.prank(priceAgent);
        tracker.submitWorkRecord(taskId, keccak256("price-data"), "ETH/USDC: $2501, V3 3000bp pool, liquidity: 9.8e15");

        // SwapAgent: executed swap via Uniswap Trading API
        vm.prank(swapAgent);
        tracker.submitWorkRecord(taskId, keccak256("swap-txid-0xabc"), "Swapped 1 ETH -> 2501 USDC via UniswapX gasless. TxID: 0xabc");

        // Orchestrator: added LP position
        vm.prank(orchestrator);
        tracker.submitWorkRecord(taskId, keccak256("lp-txid-0xdef"), "Added ETH/USDC LP V3, range $2300-$2700. TxID: 0xdef");

        // ─── 5. Verify all work recorded ─────────────────
        assertTrue(tracker.hasWorkRecord(taskId, priceAgent));
        assertTrue(tracker.hasWorkRecord(taskId, swapAgent));
        assertTrue(tracker.hasWorkRecord(taskId, orchestrator));

        // ─── 6. Settlement: fees distributed from feePool ──
        uint256 priceBefore = IERC20(USDC).balanceOf(priceAgent);
        uint256 swapBefore = IERC20(USDC).balanceOf(swapAgent);
        uint256 orchBefore = IERC20(USDC).balanceOf(orchestrator);

        vm.prank(user);
        arbiter.settleAndRate(taskId, 45); // 4.5 stars

        t = tracker.getTask(taskId);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Completed));

        // PriceAgent got 10 USDC
        assertEq(IERC20(USDC).balanceOf(priceAgent) - priceBefore, 10e6, "PriceAgent: 10 USDC");
        // SwapAgent got 40 USDC
        assertEq(IERC20(USDC).balanceOf(swapAgent) - swapBefore, 40e6, "SwapAgent: 40 USDC");
        // Orchestrator got remaining 150 USDC (200 - 10 - 40)
        assertEq(IERC20(USDC).balanceOf(orchestrator) - orchBefore, 150e6, "Orchestrator: 150 USDC margin");
        // Tracker empty
        assertEq(IERC20(USDC).balanceOf(address(tracker)), 0, "Tracker: empty");

        console2.log("=== Flow A PASSED: Intent-Based Delegation ===");
        console2.log("Delegations: orchestrator -> priceAgent (10 USDC) + swapAgent (40 USDC)");
        console2.log("Orchestrator margin: 150 USDC from 200 USDC feePool");
    }

    // ═══════════════════════════════════════════════════════
    //  FLOW B: Alkahest Escrow (EOA User)
    //  User deposits into Alkahest, agents work, arbiter verifies.
    //  (Alkahest calls mocked since it's on Base Sepolia not mainnet)
    // ═══════════════════════════════════════════════════════

    function test_flowB_alkahestEscrow() public {
        bytes32 taskId = keccak256("flow-b-task");

        // ─── 1. Simulate createTask with Alkahest ────────
        // In production: createTask() calls Alkahest.doObligationFor()
        // Here: we use registerTask + deal USDC to simulate the full deposit
        // In production: createTask() deposits into Alkahest + keeps feePool
        // For test: registerTask with feePool to simulate agent fee distribution
        vm.prank(user);
        tracker.registerTask(taskId, block.timestamp + 1 days, 5000e6, 200e6, "Swap 5000 USDC to ETH");

        DelegationTracker.Task memory t = tracker.getTask(taskId);
        assertEq(t.creator, user);

        // ─── 2. Orchestrator claims ──────────────────────
        vm.prank(orchestrator);
        tracker.claimTask(taskId);

        // ─── 3. Delegation to SwapAgent ──────────────────
        vm.prank(enforcer);
        tracker.recordDelegation(taskId, orchestrator, swapAgent, 1, keccak256("del-b-swap"), 100e6);

        // ─── 4. SwapAgent does work ──────────────────────
        vm.prank(swapAgent);
        tracker.submitWorkRecord(taskId, keccak256("swap-result"), "Swapped 5000 USDC to 2 ETH. TxID: 0x789");

        // ─── 5. Verify via checkObligation (3-layer) ────
        // Simulate what Alkahest would call
        Attestation memory obligation;
        obligation.uid = taskId; // Arbiter derives taskId from obligation.uid

        bytes memory demand = abi.encode(AgentChainArbiter.DemandData({
            stakeThresholdBps: 5000, // 50% threshold
            minReputation: 0,
            reputationRequired: false
        }));

        bool verified = arbiter.checkObligation(obligation, demand, bytes32(0));
        assertTrue(verified, "checkObligation: delegation intact, 100% stake completion");

        // ─── 6. Verify Layer 1: delegation chain integrity ──
        // Mock a revoked delegation and verify it fails
        vm.mockCall(
            DELEGATION_MANAGER,
            abi.encodeWithSelector(IDelegationManagerFull.disabledDelegations.selector, keccak256("del-b-swap")),
            abi.encode(true)
        );
        assertFalse(arbiter.checkObligation(obligation, demand, bytes32(0)),
            "checkObligation: FAILS when delegation revoked");

        // Clear mock
        vm.clearMockedCalls();

        // ─── 7. Settle via Path B (delegation-only) ──────
        vm.prank(user);
        arbiter.settleAndRate(taskId, 40); // 4.0 stars

        t = tracker.getTask(taskId);
        assertEq(uint8(t.status), uint8(DelegationTracker.TaskStatus.Completed));

        console2.log("=== Flow B PASSED: Alkahest Escrow (simulated) ===");
        console2.log("3-layer verification: delegation integrity + stake-weighted + reputation");
    }

    // ═══════════════════════════════════════════════════════
    //  SHARED: Deployment Wiring Verification
    // ═══════════════════════════════════════════════════════

    function test_deploymentWiring() public view {
        assertEq(IAgentCapabilityEnforcer(enforcer).registry(), address(registry));
        assertEq(IAgentCapabilityEnforcer(enforcer).tracker(), address(tracker));
        assertEq(address(arbiter.tracker()), address(tracker));
        assertEq(address(arbiter.agentRegistry()), address(registry));
        assertEq(tracker.capabilityEnforcer(), enforcer);
        assertEq(tracker.arbiter(), address(arbiter));
        assertEq(tracker.agentRegistry(), address(registry));
    }

    // ─── Helpers ─────────────────────────────────────────

    function _deployEnforcer(address _registry, address _tracker) internal returns (address) {
        bytes memory bytecode = vm.getCode("AgentCapabilityEnforcer.sol:AgentCapabilityEnforcer");
        bytes memory creationCode = abi.encodePacked(bytecode, abi.encode(_registry, _tracker));
        address deployed;
        assembly {
            deployed := create(0, add(creationCode, 0x20), mload(creationCode))
        }
        require(deployed != address(0), "Enforcer deployment failed");
        return deployed;
    }
}
