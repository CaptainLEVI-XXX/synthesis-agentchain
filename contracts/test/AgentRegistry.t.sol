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

    // Arbiter + fee distribution tests removed — x402 redesign
    // Sub-agent fees are paid off-chain via x402 Permit2

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
