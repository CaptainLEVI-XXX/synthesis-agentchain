// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {DelegationTracker} from "../src/DelegationTracker.sol";
import {AgentChainArbiter} from "../src/AgentChainArbiter.sol";

/// @title AgentChain Full Deployment - Base Sepolia
/// @notice Deploys all AgentChain contracts in the correct order and wires them up.
///
///   Deployment order:
///     1. AgentRegistry(USDC, IdentityRegistry)
///     2. DelegationTracker()
///     3. AgentCapabilityEnforcer(registry, tracker) - via vm.getCode (handles 0.8.23)
///     4. AgentChainArbiter(tracker, delegationManager, reputation, registry)
///     5. tracker.initialize(enforcer, arbiter, registry)
///     6. registry.setArbiter(arbiter)
///
///   Usage:
///     source contracts/.env
///     cd contracts
///     forge script script/Deploy.s.sol:DeployBaseSepolia \
///       --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify \
///       --etherscan-api-key $BASESCAN_API_KEY
contract DeployBaseSepolia is Script {

    // ─── External Contracts (same addresses on Base + Base Sepolia) ──

    // ERC-8004 - TESTNET addresses (different from mainnet!)
    // Verified on-chain: both have deployed code on Base Sepolia
    address constant IDENTITY_REGISTRY  = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    address constant REPUTATION_REGISTRY = 0x8004B663056A597Dffe9eCcC1965A193B7388713;

    // MetaMask Delegation Framework - deterministic, same on all chains
    address constant DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;

    // USDC on Base Sepolia (testnet USDC)
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        console2.log("=== AgentChain Deployment - Base Sepolia ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain: Base Sepolia (84532)");

        vm.startBroadcast(deployerKey);

        // ─── 1. Deploy AgentRegistry ─────────────────────
        AgentRegistry registry = new AgentRegistry(USDC, IDENTITY_REGISTRY);
        console2.log("1. AgentRegistry:", address(registry));

        // ─── 2. Deploy DelegationTracker ─────────────────
        DelegationTracker tracker = new DelegationTracker();
        console2.log("2. DelegationTracker:", address(tracker));

        // ─── 3. Deploy AgentCapabilityEnforcer ───────────
        // Uses pragma 0.8.23 (MetaMask dependency). Deploy via vm.getCode
        // which lets forge compile it with the correct solc version.
        bytes memory enforcerBytecode = abi.encodePacked(
            vm.getCode("AgentCapabilityEnforcer.sol:AgentCapabilityEnforcer"),
            abi.encode(address(registry), address(tracker))
        );
        address enforcer;
        assembly {
            enforcer := create(0, add(enforcerBytecode, 0x20), mload(enforcerBytecode))
        }
        require(enforcer != address(0), "Enforcer deployment failed");
        console2.log("3. AgentCapabilityEnforcer:", enforcer);

        // ─── 4. Deploy AgentChainArbiter ─────────────────
        AgentChainArbiter arbiter = new AgentChainArbiter(
            address(tracker),
            DELEGATION_MANAGER,
            REPUTATION_REGISTRY,
            address(registry)
        );
        console2.log("4. AgentChainArbiter:", address(arbiter));

        // ─── 5. Wire: Initialize DelegationTracker ───────
        address alkahestEscrow = vm.envOr("ALKAHEST_ESCROW", address(0));
        address easAddress = vm.envOr("EAS_ADDRESS", address(0));
        bytes32 fulfillmentSchema = vm.envOr("FULFILLMENT_SCHEMA", bytes32(0));
        tracker.initialize(enforcer, address(arbiter), address(registry), USDC, alkahestEscrow, easAddress, fulfillmentSchema);
        console2.log("5. DelegationTracker.initialize() done");

        // Registry no longer needs arbiter reference (x402 redesign)
        console2.log("6. Skipped: setArbiter removed (sub-agent fees via x402)");

        vm.stopBroadcast();

        // ─── Summary ────────────────────────────────────
        console2.log("");
        console2.log("========================================");
        console2.log("  DEPLOYMENT COMPLETE - Base Sepolia");
        console2.log("========================================");
        console2.log("");
        console2.log("AgentRegistry:           ", address(registry));
        console2.log("DelegationTracker:       ", address(tracker));
        console2.log("AgentCapabilityEnforcer: ", enforcer);
        console2.log("AgentChainArbiter:       ", address(arbiter));
        console2.log("");
        console2.log("External (pre-deployed):");
        console2.log("  USDC:                  ", USDC);
        console2.log("  IdentityRegistry:      ", IDENTITY_REGISTRY);
        console2.log("  ReputationRegistry:    ", REPUTATION_REGISTRY);
        console2.log("  DelegationManager:     ", DELEGATION_MANAGER);
        console2.log("");
        console2.log("Update agents/uniswap/CLAUDE.md with these addresses.");
    }
}

/// @title AgentChain Full Deployment - Base Mainnet
/// @notice Same deployment flow as Sepolia but with mainnet USDC.
///
///   Usage:
///     source contracts/.env
///     cd contracts
///     forge script script/Deploy.s.sol:DeployBase \
///       --rpc-url $BASE_RPC_URL --broadcast --verify \
///       --etherscan-api-key $BASESCAN_API_KEY
contract DeployBase is Script {

    address constant IDENTITY_REGISTRY  = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant REPUTATION_REGISTRY = 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63;
    address constant DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        console2.log("=== AgentChain Deployment - Base Mainnet ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain: Base (8453)");

        vm.startBroadcast(deployerKey);

        AgentRegistry registry = new AgentRegistry(USDC, IDENTITY_REGISTRY);
        console2.log("1. AgentRegistry:", address(registry));

        DelegationTracker tracker = new DelegationTracker();
        console2.log("2. DelegationTracker:", address(tracker));

        bytes memory enforcerBytecode = abi.encodePacked(
            vm.getCode("AgentCapabilityEnforcer.sol:AgentCapabilityEnforcer"),
            abi.encode(address(registry), address(tracker))
        );
        address enforcer;
        assembly {
            enforcer := create(0, add(enforcerBytecode, 0x20), mload(enforcerBytecode))
        }
        require(enforcer != address(0), "Enforcer deployment failed");
        console2.log("3. AgentCapabilityEnforcer:", enforcer);

        AgentChainArbiter arbiter = new AgentChainArbiter(
            address(tracker),
            DELEGATION_MANAGER,
            REPUTATION_REGISTRY,
            address(registry)
        );
        console2.log("4. AgentChainArbiter:", address(arbiter));

        address alkahestEscrow = vm.envOr("ALKAHEST_ESCROW", address(0));
        address easAddress = vm.envOr("EAS_ADDRESS", address(0));
        bytes32 fulfillmentSchema = vm.envOr("FULFILLMENT_SCHEMA", bytes32(0));
        tracker.initialize(enforcer, address(arbiter), address(registry), USDC, alkahestEscrow, easAddress, fulfillmentSchema);
        console2.log("5. DelegationTracker.initialize() done");

        console2.log("6. Skipped: setArbiter removed (sub-agent fees via x402)");

        vm.stopBroadcast();

        console2.log("");
        console2.log("========================================");
        console2.log("  DEPLOYMENT COMPLETE - Base Mainnet");
        console2.log("========================================");
        console2.log("");
        console2.log("AgentRegistry:           ", address(registry));
        console2.log("DelegationTracker:       ", address(tracker));
        console2.log("AgentCapabilityEnforcer: ", enforcer);
        console2.log("AgentChainArbiter:       ", address(arbiter));
    }
}
