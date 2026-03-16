// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentRegistry, IIdentityRegistry} from "../src/AgentRegistry.sol";

/// @notice Minimal interface for ERC-8004 registration (agent calls directly)
interface IIdentityRegistryFull {
    function register(string calldata agentURI) external returns (uint256 agentId);
}

contract AgentRegistryTest is Test {
    AgentRegistry public registry;

    // Real Base mainnet contracts
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    address public deployer = makeAddr("deployer");
    address public agent1 = makeAddr("agent1");
    address public agent2 = makeAddr("agent2");
    address public arbiterAddr = makeAddr("arbiter");

    // ERC-8004 identity token IDs (set during setUp)
    uint256 public agent1Id;
    uint256 public agent2Id;

    bytes32 public constant CAP_DEFI = keccak256(abi.encodePacked("defi"));
    bytes32 public constant CAP_LENDING = keccak256(abi.encodePacked("lending"));
    bytes32 public constant CAP_YIELD = keccak256(abi.encodePacked("yield"));

    function setUp() public {
        // Fork Base mainnet
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        vm.startPrank(deployer);
        registry = new AgentRegistry(USDC, IDENTITY_REGISTRY);
        vm.stopPrank();

        // Agents register their own ERC-8004 identities (they own the NFTs)
        vm.prank(agent1);
        agent1Id = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://agent1");

        vm.prank(agent2);
        agent2Id = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://agent2");

        // Deal USDC to test agents
        deal(USDC, agent1, 10_000e6);
        deal(USDC, agent2, 5_000e6);

        // Approve registry to spend USDC
        vm.prank(agent1);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        vm.prank(agent2);
        IERC20(USDC).approve(address(registry), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────

    function _caps(bytes32 c1) internal pure returns (bytes32[] memory) {
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = c1;
        return caps;
    }

    function _caps2(bytes32 c1, bytes32 c2) internal pure returns (bytes32[] memory) {
        bytes32[] memory caps = new bytes32[](2);
        caps[0] = c1;
        caps[1] = c2;
        return caps;
    }

    function _registerAgent1() internal {
        vm.prank(agent1);
        registry.registerAndStake("Agent1", agent1Id, _caps2(CAP_DEFI, CAP_LENDING), "https://agent1.com", 1000e6);
    }

    // ─── Registration Tests ─────────────────────────────

    function test_registerAndStake_success() public {
        _registerAgent1();
        assertTrue(registry.isRegistered(agent1));
        assertEq(registry.stakes(agent1), 1000e6);
    }

    function test_registerAndStake_erc8004IdSet() public {
        _registerAgent1();
        AgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.erc8004Id, agent1Id);
    }

    function test_registerAndStake_duplicateFails() public {
        _registerAgent1();
        vm.prank(agent1);
        vm.expectRevert();
        registry.registerAndStake("Agent1", agent1Id, _caps(CAP_DEFI), "https://agent1.com", 500e6);
    }

    function test_registerAndStake_zeroStakeFails() public {
        vm.prank(agent1);
        vm.expectRevert();
        registry.registerAndStake("Agent1", agent1Id, _caps(CAP_DEFI), "https://agent1.com", 0);
    }

    function test_registerAndStake_noCapsFails() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(agent1);
        vm.expectRevert();
        registry.registerAndStake("Agent1", agent1Id, empty, "https://agent1.com", 100e6);
    }

    function test_registerAndStake_notERC8004OwnerFails() public {
        // agent1 tries to register with agent2's ERC-8004 identity
        vm.prank(agent1);
        vm.expectRevert();
        registry.registerAndStake("Agent1", agent2Id, _caps(CAP_DEFI), "https://agent1.com", 1000e6);
    }

    function test_register_withoutStake() public {
        vm.prank(agent1);
        registry.register("Agent1", agent1Id, _caps(CAP_DEFI), "https://agent1.com");
        assertTrue(registry.isRegistered(agent1));
        assertEq(registry.stakes(agent1), 0);
    }

    function test_register_notERC8004OwnerFails() public {
        vm.prank(agent1);
        vm.expectRevert();
        registry.register("Agent1", agent2Id, _caps(CAP_DEFI), "https://agent1.com");
    }

    // ─── Staking Tests ──────────────────────────────────

    function test_addStake() public {
        _registerAgent1();
        vm.prank(agent1);
        registry.addStake(500e6);
        assertEq(registry.stakes(agent1), 1500e6);
    }

    function test_unstake() public {
        _registerAgent1();
        uint256 balBefore = IERC20(USDC).balanceOf(agent1);
        vm.prank(agent1);
        registry.unstake(400e6);
        assertEq(registry.stakes(agent1), 600e6);
        assertEq(IERC20(USDC).balanceOf(agent1), balBefore + 400e6);
    }

    function test_unstake_insufficientFails() public {
        _registerAgent1();
        vm.prank(agent1);
        vm.expectRevert();
        registry.unstake(2000e6);
    }

    // ─── ENS Tests ──────────────────────────────────────

    function test_linkENSName() public {
        _registerAgent1();
        vm.prank(agent1);
        registry.linkENSName("agent1.eth");
        AgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.ensName, "agent1.eth");
    }

    function test_linkENSName_notRegisteredFails() public {
        vm.prank(agent2);
        vm.expectRevert();
        registry.linkENSName("agent2.eth");
    }

    // ─── Capability Tests ───────────────────────────────

    function test_hasCapabilities_true() public {
        _registerAgent1();
        assertTrue(registry.hasCapabilities(agent1, _caps(CAP_DEFI)));
        assertTrue(registry.hasCapabilities(agent1, _caps2(CAP_DEFI, CAP_LENDING)));
    }

    function test_hasCapabilities_missing() public {
        _registerAgent1();
        assertFalse(registry.hasCapabilities(agent1, _caps(CAP_YIELD)));
    }

    function test_hasCapabilities_inactiveAgent() public {
        _registerAgent1();
        vm.prank(agent1);
        registry.deactivate();
        assertFalse(registry.hasCapabilities(agent1, _caps(CAP_DEFI)));
    }

    function test_updateCapabilities() public {
        _registerAgent1();
        vm.prank(agent1);
        registry.updateCapabilities(_caps(CAP_YIELD));

        assertTrue(registry.hasCapabilities(agent1, _caps(CAP_YIELD)));
        assertFalse(registry.hasCapabilities(agent1, _caps(CAP_DEFI)));
    }

    function test_updateCapabilities_emptyFails() public {
        _registerAgent1();
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(agent1);
        vm.expectRevert();
        registry.updateCapabilities(empty);
    }

    // ─── Discovery Tests ────────────────────────────────

    function test_getAgentsByCapability() public {
        _registerAgent1();
        address[] memory agents_ = registry.getAgentsByCapability(CAP_DEFI);
        assertEq(agents_.length, 1);
        assertEq(agents_[0], agent1);
    }

    function test_getAgentsByCapability_multipleAgents() public {
        _registerAgent1();
        vm.prank(agent2);
        registry.registerAndStake("Agent2", agent2Id, _caps(CAP_DEFI), "https://agent2.com", 500e6);

        address[] memory agents_ = registry.getAgentsByCapability(CAP_DEFI);
        assertEq(agents_.length, 2);
    }

    // ─── Deactivate Tests ───────────────────────────────

    function test_deactivate() public {
        _registerAgent1();
        vm.prank(agent1);
        registry.deactivate();
        assertFalse(registry.isRegistered(agent1));
    }

    // ─── Arbiter Setup Tests ────────────────────────────

    function test_setArbiter_onlyDeployer() public {
        vm.prank(deployer);
        registry.setArbiter(arbiterAddr);
        assertEq(registry.arbiter(), arbiterAddr);
    }

    function test_setArbiter_nonDeployerFails() public {
        vm.prank(agent1);
        vm.expectRevert("Not deployer");
        registry.setArbiter(arbiterAddr);
    }

    function test_setArbiter_onlyOnce() public {
        vm.startPrank(deployer);
        registry.setArbiter(arbiterAddr);
        vm.expectRevert("Arbiter already set");
        registry.setArbiter(makeAddr("other"));
        vm.stopPrank();
    }

    // ─── Fee Distribution Tests ─────────────────────────

    function _setupFeeDistribution() internal {
        // Register orchestrator (agent1) with 5000 USDC stake
        _registerAgent1();
        vm.prank(agent1);
        registry.addStake(4000e6); // total 5000e6

        // Register agent2
        vm.prank(agent2);
        registry.registerAndStake("Agent2", agent2Id, _caps(CAP_YIELD), "https://agent2.com", 500e6);

        // Set arbiter
        vm.prank(deployer);
        registry.setArbiter(arbiterAddr);
    }

    function test_distributeFeesFromStake_success() public {
        _setupFeeDistribution();

        address[] memory agents_ = new address[](1);
        agents_[0] = agent2;
        uint256[] memory fees = new uint256[](1);
        fees[0] = 80e6;

        uint256 agent2BalBefore = IERC20(USDC).balanceOf(agent2);

        vm.prank(arbiterAddr);
        registry.distributeFeesFromStake(agent1, agents_, fees);

        assertEq(registry.stakes(agent1), 4920e6); // 5000 - 80
        assertEq(IERC20(USDC).balanceOf(agent2), agent2BalBefore + 80e6);
    }

    function test_distributeFeesFromStake_multipleAgents() public {
        _setupFeeDistribution();

        address agent3 = makeAddr("agent3");
        deal(USDC, agent3, 1000e6);

        // agent3 registers ERC-8004 identity
        vm.prank(agent3);
        uint256 agent3Id = IIdentityRegistryFull(IDENTITY_REGISTRY).register("ipfs://agent3");

        vm.startPrank(agent3);
        IERC20(USDC).approve(address(registry), type(uint256).max);
        registry.registerAndStake("Agent3", agent3Id, _caps(CAP_DEFI), "https://agent3.com", 200e6);
        vm.stopPrank();

        address[] memory agents_ = new address[](2);
        agents_[0] = agent2;
        agents_[1] = agent3;
        uint256[] memory fees = new uint256[](2);
        fees[0] = 80e6;
        fees[1] = 50e6;

        vm.prank(arbiterAddr);
        registry.distributeFeesFromStake(agent1, agents_, fees);

        assertEq(registry.stakes(agent1), 4870e6); // 5000 - 130
    }

    function test_distributeFeesFromStake_onlyArbiter() public {
        _setupFeeDistribution();

        address[] memory agents_ = new address[](1);
        agents_[0] = agent2;
        uint256[] memory fees = new uint256[](1);
        fees[0] = 80e6;

        vm.prank(agent1); // not the arbiter
        vm.expectRevert();
        registry.distributeFeesFromStake(agent1, agents_, fees);
    }

    function test_distributeFeesFromStake_insufficientStakeFails() public {
        _setupFeeDistribution();

        address[] memory agents_ = new address[](1);
        agents_[0] = agent2;
        uint256[] memory fees = new uint256[](1);
        fees[0] = 6000e6; // more than 5000 stake

        vm.prank(arbiterAddr);
        vm.expectRevert();
        registry.distributeFeesFromStake(agent1, agents_, fees);
    }

    function test_distributeFeesFromStake_lengthMismatchFails() public {
        _setupFeeDistribution();

        address[] memory agents_ = new address[](2);
        agents_[0] = agent2;
        agents_[1] = makeAddr("agent3");
        uint256[] memory fees = new uint256[](1);
        fees[0] = 80e6;

        vm.prank(arbiterAddr);
        vm.expectRevert("Length mismatch");
        registry.distributeFeesFromStake(agent1, agents_, fees);
    }

    // ─── Update Tests ───────────────────────────────────

    function test_updateEndpoint() public {
        _registerAgent1();
        vm.prank(agent1);
        registry.updateEndpoint("https://new-endpoint.com");
        AgentRegistry.Agent memory a = registry.getAgent(agent1);
        assertEq(a.endpoint, "https://new-endpoint.com");
    }

    function test_updateEndpoint_notRegisteredFails() public {
        vm.prank(agent2);
        vm.expectRevert();
        registry.updateEndpoint("https://agent2.com");
    }
}
