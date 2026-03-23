// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {AgentRegistry} from "../src/AgentRegistry.sol";
import {DelegationTracker} from "../src/DelegationTracker.sol";
import {AgentChainArbiter} from "../src/AgentChainArbiter.sol";
import {Attestation} from "../src/interfaces/ICommon.sol";

interface IIdentityRegistry {
    function register(string calldata uri) external returns (uint256);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee;
        address recipient; uint256 amountIn;
        uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata) external payable returns (uint256);
}

interface IWETH {
    function deposit() external payable;
    function approve(address, uint256) external returns (bool);
}

interface IDelegationManager {
    function redeemDelegations(bytes[] calldata, bytes32[] calldata, bytes[] calldata) external;
    function getDomainHash() external view returns (bytes32);
}

interface IEnforcer {
    function registry() external view returns (address);
    function tracker() external view returns (address);
}

// Must match MetaMask Types.sol exactly
struct Delegation {
    address delegate;
    address delegator;
    bytes32 authority;
    Caveat[] caveats;
    uint256 salt;
    bytes signature;
}

struct Caveat {
    address enforcer;
    bytes terms;
    bytes args;
}

// Must match AgentCapabilityEnforcer.AgentTerms exactly
struct AgentTerms {
    bytes32 taskId;
    uint8 maxDepth;
    uint8 currentDepth;
    uint256 minStake;
    uint256 fee;
    bytes32[] requiredCaps;
}

contract IntegrationTest is Test {

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant REPUTATION = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant DELEGATION_MGR = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address constant DELEGATOR_IMPL = 0x48dBe696A4D990079e039489bA2053B36E8FFEC4;
    address constant ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;

    bytes32 constant ROOT_AUTHORITY = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    bytes32 constant DELEGATION_TYPEHASH = keccak256(
        "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
    );
    bytes32 constant CAVEAT_TYPEHASH = keccak256("Caveat(address enforcer,bytes terms)");

    AgentRegistry public registry;
    DelegationTracker public tracker;
    address public enforcer;
    AgentChainArbiter public arbiter;

    uint256 constant ORCH_KEY = 0xB0B;
    uint256 constant SWAP_KEY = 0xCA1;
    uint256 constant USER_KEY = 0xA11CE;

    address public userEOA;
    address public orchSA;
    address public swapSA;

    bytes32 constant CAP_SWAP = keccak256(abi.encodePacked("uniswap-swap"));
    bytes32 constant CAP_LP = keccak256(abi.encodePacked("uniswap-lp"));

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));
        userEOA = vm.addr(USER_KEY);

        // Deploy AgentChain
        registry = new AgentRegistry(USDC, IDENTITY);
        tracker = new DelegationTracker();
        enforcer = _deployEnforcer(address(registry), address(tracker));
        arbiter = new AgentChainArbiter(address(tracker), DELEGATION_MGR, REPUTATION, address(registry));
        tracker.initialize(enforcer, address(arbiter), address(registry), USDC, address(0), address(0), bytes32(0));

        // Deploy smart accounts
        orchSA = _deploySA(vm.addr(ORCH_KEY));
        swapSA = _deploySA(vm.addr(SWAP_KEY));

        // Register orchestrator from smart account
        vm.deal(orchSA, 1 ether);
        deal(USDC, orchSA, 10_000e6);
        vm.startPrank(orchSA);
        uint256 oid = IIdentityRegistry(IDENTITY).register("ipfs://orch");
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory c1 = new bytes32[](2); c1[0] = CAP_SWAP; c1[1] = CAP_LP;
        registry.registerAndStake("Orchestrator", oid, c1, "http://localhost:3003", 5000e6);
        IWETH(WETH).deposit{value: 0.002 ether}();
        IWETH(WETH).approve(ROUTER, type(uint256).max);
        vm.stopPrank();

        // Register swap agent from smart account
        vm.deal(swapSA, 1 ether);
        deal(USDC, swapSA, 5_000e6);
        vm.startPrank(swapSA);
        uint256 sid = IIdentityRegistry(IDENTITY).register("ipfs://swap");
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory c2 = new bytes32[](1); c2[0] = CAP_SWAP;
        registry.registerAndStake("SwapAgent", sid, c2, "http://localhost:3002", 2000e6);
        vm.stopPrank();

        // Fund user
        vm.deal(userEOA, 1 ether);
        deal(USDC, userEOA, 50_000e6);
        vm.prank(userEOA);
        IERC20(USDC).approve(address(tracker), type(uint256).max);
    }

    function test_fullMainnetFlow() public {
        bytes32 taskId = keccak256("mainnet-1");

        // Step 1: User registers intent
        vm.prank(userEOA);
        tracker.registerTask(taskId, block.timestamp + 1 days, 5000e6, 200e6, "Swap 0.002 ETH to USDC");
        console2.log("1. Task registered");

        // Step 2: Orchestrator claims
        vm.prank(orchSA);
        tracker.claimTask(taskId);
        console2.log("2. Orchestrator claimed:", orchSA);

        // Step 3: Real delegation + real swap via DelegationManager
        uint256 usdcBefore = IERC20(USDC).balanceOf(orchSA);
        _redeemDelegation(taskId);
        uint256 usdcReceived = IERC20(USDC).balanceOf(orchSA) - usdcBefore;
        console2.log("3. Delegation redeemed. USDC from swap:", usdcReceived);
        assertTrue(usdcReceived > 0, "Real swap produced USDC");
        assertTrue(tracker.isDelegated(taskId, swapSA), "Delegation recorded on-chain");

        // Step 4: Work records
        vm.prank(swapSA);
        tracker.submitWorkRecord(taskId, keccak256(abi.encode(usdcReceived)), "SWAP|WETH->USDC");
        vm.prank(orchSA);
        tracker.submitWorkRecord(taskId, keccak256("orch"), "Orchestrated swap");
        console2.log("4. Work records submitted");

        // Step 5: Verify
        Attestation memory att;
        att.uid = taskId;
        bytes memory demand = abi.encode(AgentChainArbiter.DemandData({stakeThresholdBps: 5000, minReputation: 0, reputationRequired: false}));
        assertTrue(arbiter.checkObligation(att, demand, bytes32(0)));
        console2.log("5. 3-layer verification PASSED");

        // Step 6: Settlement
        uint256 swapBefore = IERC20(USDC).balanceOf(swapSA);
        vm.prank(userEOA);
        arbiter.settleAndRate(taskId, 45);
        assertEq(IERC20(USDC).balanceOf(swapSA) - swapBefore, 80e6);
        console2.log("6. Settlement: SwapAgent=80 USDC, Task COMPLETED");
    }

    /// @notice FLOW B: Alkahest Escrow Path (EOA User)
    ///         Shows: multi-agent delegation, 3-layer verification, revocation detection
    ///         Alkahest escrow is simulated (deployed on Base Sepolia, not mainnet)
    function test_fullMainnetFlowB() public {
        bytes32 taskId = keccak256("mainnet-flowb-1");

        // Deploy a PriceAgent smart account
        uint256 PRICE_KEY = 0xDA7A;
        address priceSA = _deploySA(vm.addr(PRICE_KEY));
        vm.deal(priceSA, 1 ether);
        deal(USDC, priceSA, 2_000e6);
        vm.startPrank(priceSA);
        uint256 pid = IIdentityRegistry(IDENTITY).register("ipfs://price");
        IERC20(USDC).approve(address(registry), type(uint256).max);
        bytes32[] memory pc = new bytes32[](1);
        pc[0] = keccak256(abi.encodePacked("uniswap-price"));
        registry.registerAndStake("PriceAgent", pid, pc, "http://localhost:3001", 500e6);
        vm.stopPrank();

        // ═══ Step 1: User registers intent with feePool ═══
        vm.prank(userEOA);
        tracker.registerTask(taskId, block.timestamp + 1 days, 5000e6, 300e6, "Provide LP with 0.002 ETH in best pool");
        console2.log("B1. Task registered with 300 USDC feePool");

        // ═══ Step 2: Orchestrator claims ═══
        vm.prank(orchSA);
        tracker.claimTask(taskId);
        console2.log("B2. Orchestrator claimed:", orchSA);

        // ═══ Step 3: Delegate to PriceAgent (read-only task, no execution) ═══
        _redeemDelegationTo(taskId, priceSA, PRICE_KEY,
            keccak256(abi.encodePacked("uniswap-price")), 20e6, 2);

        assertTrue(tracker.isDelegated(taskId, priceSA), "PriceAgent delegation recorded");
        assertEq(tracker.getPromisedFee(taskId, priceSA), 20e6);
        console2.log("B3a. PriceAgent delegation recorded. Fee: 20 USDC");

        // ═══ Step 4: Delegate to SwapAgent (executes real swap) ═══
        uint256 usdcBefore = IERC20(USDC).balanceOf(orchSA);
        _redeemDelegation(taskId); // reuses existing helper — delegates to swapSA with 80 USDC fee
        uint256 usdcReceived = IERC20(USDC).balanceOf(orchSA) - usdcBefore;
        console2.log("B3b. SwapAgent delegation + REAL swap. USDC:", usdcReceived);

        assertEq(tracker.getDelegationCount(taskId), 2, "Two delegation hops");
        assertEq(tracker.getTotalPromisedFees(taskId), 100e6, "Total fees: 20 + 80 = 100 USDC");

        // ═══ Step 5: All agents submit work records ═══
        vm.prank(priceSA);
        tracker.submitWorkRecord(taskId, keccak256("price-data"), "ETH/USDC:3000bp=$2500|liquidity=9.8e15");
        vm.prank(swapSA);
        tracker.submitWorkRecord(taskId, keccak256(abi.encode(usdcReceived)), "SWAP|WETH->USDC|V3");
        vm.prank(orchSA);
        tracker.submitWorkRecord(taskId, keccak256("lp-orchestrated"), "Orchestrated price+swap for LP");
        console2.log("B4. All 3 agents submitted work records");

        // ═══ Step 6: 3-layer verification ═══
        Attestation memory att;
        att.uid = taskId;
        bytes memory demand = abi.encode(AgentChainArbiter.DemandData({
            stakeThresholdBps: 5000, minReputation: 0, reputationRequired: false
        }));
        assertTrue(arbiter.checkObligation(att, demand, bytes32(0)), "Verification PASSED");
        console2.log("B5. checkObligation PASSED (all 3 layers)");

        // ═══ Step 7: Test delegation revocation (Layer 1) ═══
        // Mock: revoke the SwapAgent's delegation
        bytes32 swapDelHash = tracker.getTaskDelegations(taskId)[1].delegationHash;
        vm.mockCall(DELEGATION_MGR,
            abi.encodeWithSelector(IDelegationManager.getDomainHash.selector),
            abi.encode(bytes32(0)) // won't be called
        );
        vm.mockCall(DELEGATION_MGR,
            abi.encodeWithSignature("disabledDelegations(bytes32)", swapDelHash),
            abi.encode(true)
        );
        assertFalse(arbiter.checkObligation(att, demand, bytes32(0)), "FAILS when delegation revoked");
        vm.clearMockedCalls();
        console2.log("B6. Revocation check: CORRECTLY FAILS when delegation is revoked");

        // ═══ Step 8: Settlement with multi-agent fee distribution ═══
        uint256 priceBefore = IERC20(USDC).balanceOf(priceSA);
        uint256 swapBefore = IERC20(USDC).balanceOf(swapSA);
        uint256 orchBefore = IERC20(USDC).balanceOf(orchSA);

        vm.prank(userEOA);
        arbiter.settleAndRate(taskId, 40); // 4.0 stars

        assertEq(uint8(tracker.getTask(taskId).status), 2, "Task Completed");
        assertEq(IERC20(USDC).balanceOf(priceSA) - priceBefore, 20e6, "PriceAgent: 20 USDC");
        assertEq(IERC20(USDC).balanceOf(swapSA) - swapBefore, 80e6, "SwapAgent: 80 USDC");

        uint256 orchMargin = IERC20(USDC).balanceOf(orchSA) - orchBefore;
        assertEq(orchMargin, 200e6, "Orchestrator margin: 200 USDC");

        console2.log("B7. Settlement complete:");
        console2.log("    PriceAgent: 20 USDC");
        console2.log("    SwapAgent: 80 USDC");
        console2.log("    Orchestrator: 200 USDC margin");
        console2.log("    Task: COMPLETED with 4.0 star reputation");
    }

    // ─── Delegation Helpers ──────────────────────────────

    /// @dev Redeem delegation to a specific agent (for PriceAgent — no execution, just recording)
    function _redeemDelegationTo(
        bytes32 taskId, address delegateSA, uint256, /* delegateKey */
        bytes32 capability, uint256 fee, uint256 salt
    ) internal {
        Delegation memory del = _buildDelegation(taskId, delegateSA, capability, fee, 100e6, salt);

        // EIP-712 sign
        {
            bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01",
                IDelegationManager(DELEGATION_MGR).getDomainHash(),
                _hashDelegation(del)
            ));
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORCH_KEY, digest);
            del.signature = abi.encodePacked(r, s, v);
        }

        // Build redemption arrays and execute
        _executeRedemption(del, delegateSA, abi.encodePacked(orchSA, uint256(0), bytes("")));
    }

    function _buildDelegation(
        bytes32 taskId, address delegate, bytes32 capability, uint256 fee, uint256 minStake, uint256 salt
    ) internal view returns (Delegation memory) {
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = capability;

        Caveat[] memory caveats = new Caveat[](1);
        caveats[0] = Caveat(enforcer, abi.encode(AgentTerms(taskId, 3, 1, minStake, fee, caps)), "");

        return Delegation({
            delegate: delegate,
            delegator: orchSA,
            authority: ROOT_AUTHORITY,
            caveats: caveats,
            salt: salt,
            signature: ""
        });
    }

    function _executeRedemption(Delegation memory del, address executor, bytes memory execData) internal {
        Delegation[] memory chain = new Delegation[](1);
        chain[0] = del;

        bytes[] memory pcs = new bytes[](1);
        pcs[0] = abi.encode(chain);
        bytes32[] memory modes = new bytes32[](1);
        modes[0] = bytes32(0);
        bytes[] memory execs = new bytes[](1);
        execs[0] = execData;

        vm.prank(executor);
        IDelegationManager(DELEGATION_MGR).redeemDelegations(pcs, modes, execs);
    }

    function _redeemDelegation(bytes32 taskId) internal {
        Delegation memory del = _buildDelegation(taskId, swapSA, CAP_SWAP, 80e6, 1000e6, 1);

        // EIP-712 sign
        {
            bytes32 digest = keccak256(abi.encodePacked(
                "\x19\x01",
                IDelegationManager(DELEGATION_MGR).getDomainHash(),
                _hashDelegation(del)
            ));
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORCH_KEY, digest);
            del.signature = abi.encodePacked(r, s, v);
        }

        // Build swap calldata
        bytes memory swapData = abi.encodeWithSelector(
            ISwapRouter.exactInputSingle.selector,
            ISwapRouter.ExactInputSingleParams(WETH, USDC, 3000, orchSA, 0.002 ether, 0, 0)
        );

        _executeRedemption(del, swapSA, abi.encodePacked(ROUTER, uint256(0), swapData));
    }

    function _deploySA(address owner) internal returns (address) {
        return address(new ERC1967Proxy(DELEGATOR_IMPL,
            abi.encodeWithSignature("initialize(address,string[],uint256[],uint256[])", owner, new string[](0), new uint256[](0), new uint256[](0))
        ));
    }

    function _deployEnforcer(address r, address t) internal returns (address) {
        bytes memory bc = vm.getCode("AgentCapabilityEnforcer.sol:AgentCapabilityEnforcer");
        address d;
        assembly { d := create(0, add(bc, 0x20), mload(bc)) }
        // Need to pass constructor args — bc is just bytecode, not creation code with args
        bytes memory cc = abi.encodePacked(bc, abi.encode(r, t));
        assembly { d := create(0, add(cc, 0x20), mload(cc)) }
        require(d != address(0));
        return d;
    }

    function _hashDelegation(Delegation memory d) internal pure returns (bytes32) {
        bytes32[] memory ch = new bytes32[](d.caveats.length);
        for (uint i = 0; i < d.caveats.length; i++) {
            ch[i] = keccak256(abi.encode(CAVEAT_TYPEHASH, d.caveats[i].enforcer, keccak256(d.caveats[i].terms)));
        }
        return keccak256(abi.encode(DELEGATION_TYPEHASH, d.delegate, d.delegator, d.authority, keccak256(abi.encodePacked(ch)), d.salt));
    }
}
