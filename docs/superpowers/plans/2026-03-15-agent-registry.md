# AgentRegistry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up Foundry project and implement AgentRegistry.sol with full test coverage.

**Architecture:** AgentRegistry is the first contract — handles agent registration with ERC-8004 identity, USDC staking, capability indexing, ENS display names, and trustless fee distribution from orchestrator stakes. All code lives in `docs/smart-contracts.md` Section 1.

**Tech Stack:** Solidity ^0.8.24, Foundry, OpenZeppelin (SafeERC20), custom libraries (CustomRevert, Lock)

---

## Chunk 1: Foundry Setup + Libraries

### Task 1: Initialize Foundry Project

**Files:**
- Create: `foundry.toml`
- Create: `src/.gitkeep` (auto by forge)
- Create: `test/.gitkeep` (auto by forge)
- Create: `script/.gitkeep` (auto by forge)

- [ ] **Step 1: Initialize Foundry**

```bash
cd /Users/saurabhyadav30/Desktop/synthesis
forge init --no-commit --no-git
```

- [ ] **Step 2: Install OpenZeppelin**

```bash
forge install OpenZeppelin/openzeppelin-contracts --no-commit --no-git
```

- [ ] **Step 3: Configure foundry.toml**

Replace the generated `foundry.toml` with:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
via_ir = false

remappings = [
    "@openzeppelin/=lib/openzeppelin-contracts/",
]

[profile.default.fuzz]
runs = 256

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC_URL}"
base = "${BASE_RPC_URL}"
```

- [ ] **Step 4: Remove default Counter contract**

```bash
rm src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```

- [ ] **Step 5: Verify clean compile**

```bash
forge build
```
Expected: compiles with 0 errors (empty project)

- [ ] **Step 6: Commit**

```bash
git init
git add -A
git commit -m "chore: initialize Foundry project with OpenZeppelin"
```

---

### Task 2: Create CustomRevert Library

**Files:**
- Create: `src/libraries/CustomRevert.sol`

- [ ] **Step 1: Create the library**

Source: `docs/smart-contracts.md` lines 62-96. Copy exactly:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Gas-efficient custom error reverts using assembly
/// @dev Usage: `using CustomRevert for bytes4;` then `ErrorName.selector.revertWith()`
library CustomRevert {
    error WrappedError(address target, bytes4 selector, bytes reason, bytes details);

    function revertWith(bytes4 selector) internal pure {
        assembly ("memory-safe") { mstore(0, selector) revert(0, 0x04) }
    }

    function revertWith(bytes4 selector, address addr) internal pure {
        assembly ("memory-safe") {
            mstore(0, selector)
            mstore(0x04, and(addr, 0xffffffffffffffffffffffffffffffffffffffff))
            revert(0, 0x24)
        }
    }

    function revertWith(bytes4 selector, uint256 value) internal pure {
        assembly ("memory-safe") { mstore(0x00, selector) mstore(0x04, value) revert(0x00, 0x24) }
    }

    function revertWith(bytes4 selector, address value1, address value2) internal pure {
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            mstore(fmp, selector)
            mstore(add(fmp, 0x04), and(value1, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(fmp, 0x24), and(value2, 0xffffffffffffffffffffffffffffffffffffffff))
            revert(fmp, 0x44)
        }
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
forge build
```
Expected: compiles successfully

---

### Task 3: Create Lock Library

**Files:**
- Create: `src/libraries/Lock.sol`

- [ ] **Step 1: Create the library**

Source: `docs/smart-contracts.md` lines 100-123. Copy exactly:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Reentrancy guard using EIP-1153 transient storage (tstore/tload)
/// @dev Cheaper than OpenZeppelin's ReentrancyGuard (~100 gas vs ~2600 gas per check)
library Lock {
    bytes32 internal constant IS_UNLOCKED_SLOT = 0xc090fc4683624cfc3884e9d8de5eca132f2d0ec062aff75d43c0465d5ceeab23;

    error ContractLocked();

    function unlock() internal {
        assembly ("memory-safe") { tstore(IS_UNLOCKED_SLOT, true) }
    }

    function lock() internal {
        assembly ("memory-safe") { tstore(IS_UNLOCKED_SLOT, false) }
    }

    function isUnlocked() internal view returns (bool unlocked) {
        assembly ("memory-safe") { unlocked := tload(IS_UNLOCKED_SLOT) }
    }
}
```

- [ ] **Step 2: Verify compile**

```bash
forge build
```
Expected: compiles successfully

- [ ] **Step 3: Commit**

```bash
git add src/libraries/
git commit -m "feat: add CustomRevert and Lock libraries"
```

---

## Chunk 2: Mock Contracts

### Task 4: Create MockERC20

**Files:**
- Create: `test/mocks/MockERC20.sol`

- [ ] **Step 1: Create mock USDC token**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20 — test token (USDC substitute)
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

---

### Task 5: Create MockIdentityRegistry

**Files:**
- Create: `test/mocks/MockIdentityRegistry.sol`

- [ ] **Step 1: Create mock ERC-8004 Identity Registry**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockIdentityRegistry — test stub for ERC-8004 Identity Registry
contract MockIdentityRegistry {
    uint256 private _nextId = 1;
    mapping(uint256 => string) public agentURIs;

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextId++;
        agentURIs[agentId] = agentURI;
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        agentURIs[agentId] = newURI;
    }

    function setMetadata(uint256, string memory, bytes memory) external {}
    function getMetadata(uint256, string memory) external pure returns (bytes memory) { return ""; }
}
```

- [ ] **Step 2: Verify mocks compile**

```bash
forge build
```
Expected: compiles successfully

- [ ] **Step 3: Commit**

```bash
git add test/mocks/
git commit -m "test: add MockERC20 and MockIdentityRegistry for testing"
```

---

## Chunk 3: AgentRegistry Contract

### Task 6: Create AgentRegistry.sol

**Files:**
- Create: `src/AgentRegistry.sol`

- [ ] **Step 1: Create the contract**

Copy the full AgentRegistry from `docs/smart-contracts.md` Section 1 (lines 159-489). This includes:
- `IIdentityRegistry` interface
- `AgentRegistry` contract with all functions:
  - Constructor, setArbiter
  - registerAndStake, register, _register, _stake
  - linkENSName
  - addStake, unstake
  - distributeFeesFromStake
  - updateCapabilities, updateEndpoint, updateAgentURI, deactivate
  - getAgentsByCapability, getAgent, isRegistered, hasCapabilities
  - _removeFromIndex

- [ ] **Step 2: Verify compile**

```bash
forge build
```
Expected: compiles successfully with 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/AgentRegistry.sol
git commit -m "feat(registry): add AgentRegistry with staking, ERC-8004 identity, and fee distribution"
```

---

## Chunk 4: AgentRegistry Tests

### Task 7: Registration Tests

**Files:**
- Create: `test/AgentRegistry.t.sol`

- [ ] **Step 1: Write test setup + registration tests**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry public registry;
    MockERC20 public usdc;
    MockIdentityRegistry public identity;

    address public deployer = makeAddr("deployer");
    address public agent1 = makeAddr("agent1");
    address public agent2 = makeAddr("agent2");
    address public arbiterAddr = makeAddr("arbiter");

    bytes32 public constant CAP_DEFI = keccak256(abi.encodePacked("defi"));
    bytes32 public constant CAP_LENDING = keccak256(abi.encodePacked("lending"));
    bytes32 public constant CAP_YIELD = keccak256(abi.encodePacked("yield"));

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockERC20("USDC", "USDC", 6);
        identity = new MockIdentityRegistry();
        registry = new AgentRegistry(address(usdc), address(identity));
        vm.stopPrank();

        // Fund agents with USDC
        usdc.mint(agent1, 10_000e6);
        usdc.mint(agent2, 5_000e6);

        // Approve registry to spend USDC
        vm.prank(agent1);
        usdc.approve(address(registry), type(uint256).max);
        vm.prank(agent2);
        usdc.approve(address(registry), type(uint256).max);
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

    function _registerAgent1() internal returns (uint256) {
        vm.prank(agent1);
        registry.registerAndStake("Agent1", _caps2(CAP_DEFI, CAP_LENDING), "https://agent1.com", "ipfs://agent1", 1000e6);
        return registry.stakes(agent1);
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
        assertGt(a.erc8004Id, 0);
    }

    function test_registerAndStake_duplicateFails() public {
        _registerAgent1();
        vm.prank(agent1);
        vm.expectRevert();
        registry.registerAndStake("Agent1", _caps(CAP_DEFI), "https://agent1.com", "ipfs://agent1", 500e6);
    }

    function test_registerAndStake_zeroStakeFails() public {
        vm.prank(agent1);
        vm.expectRevert();
        registry.registerAndStake("Agent1", _caps(CAP_DEFI), "https://agent1.com", "ipfs://agent1", 0);
    }

    function test_registerAndStake_noCapsFails() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.prank(agent1);
        vm.expectRevert();
        registry.registerAndStake("Agent1", empty, "https://agent1.com", "ipfs://agent1", 100e6);
    }

    function test_register_withoutStake() public {
        vm.prank(agent1);
        registry.register("Agent1", _caps(CAP_DEFI), "https://agent1.com", "ipfs://agent1");
        assertTrue(registry.isRegistered(agent1));
        assertEq(registry.stakes(agent1), 0);
    }
}
```

- [ ] **Step 2: Run tests**

```bash
forge test --match-contract AgentRegistryTest -vvv
```
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/AgentRegistry.t.sol
git commit -m "test(registry): add registration tests"
```

---

### Task 8: Staking + ENS Tests

**Files:**
- Modify: `test/AgentRegistry.t.sol`

- [ ] **Step 1: Add staking and ENS tests** (append to the contract)

```solidity
    // ─── Staking Tests ──────────────────────────────────

    function test_addStake() public {
        _registerAgent1();
        vm.prank(agent1);
        registry.addStake(500e6);
        assertEq(registry.stakes(agent1), 1500e6);
    }

    function test_unstake() public {
        _registerAgent1();
        uint256 balBefore = usdc.balanceOf(agent1);
        vm.prank(agent1);
        registry.unstake(400e6);
        assertEq(registry.stakes(agent1), 600e6);
        assertEq(usdc.balanceOf(agent1), balBefore + 400e6);
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
```

- [ ] **Step 2: Run tests**

```bash
forge test --match-contract AgentRegistryTest -vvv
```
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/AgentRegistry.t.sol
git commit -m "test(registry): add staking and ENS tests"
```

---

### Task 9: Capability + Discovery Tests

**Files:**
- Modify: `test/AgentRegistry.t.sol`

- [ ] **Step 1: Add capability and discovery tests** (append)

```solidity
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
        registry.registerAndStake("Agent2", _caps(CAP_DEFI), "https://agent2.com", "ipfs://agent2", 500e6);

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
```

- [ ] **Step 2: Run tests**

```bash
forge test --match-contract AgentRegistryTest -vvv
```
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/AgentRegistry.t.sol
git commit -m "test(registry): add capability, discovery, and deactivation tests"
```

---

### Task 10: Fee Distribution + Arbiter Tests

**Files:**
- Modify: `test/AgentRegistry.t.sol`

- [ ] **Step 1: Add fee distribution and arbiter tests** (append)

```solidity
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
        registry.registerAndStake("Agent2", _caps(CAP_YIELD), "https://agent2.com", "ipfs://agent2", 500e6);

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

        uint256 agent2BalBefore = usdc.balanceOf(agent2);

        vm.prank(arbiterAddr);
        registry.distributeFeesFromStake(agent1, agents_, fees);

        assertEq(registry.stakes(agent1), 4920e6); // 5000 - 80
        assertEq(usdc.balanceOf(agent2), agent2BalBefore + 80e6);
    }

    function test_distributeFeesFromStake_multipleAgents() public {
        _setupFeeDistribution();

        address agent3 = makeAddr("agent3");
        usdc.mint(agent3, 1000e6);
        vm.startPrank(agent3);
        usdc.approve(address(registry), type(uint256).max);
        registry.registerAndStake("Agent3", _caps(CAP_DEFI), "https://agent3.com", "ipfs://agent3", 200e6);
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
```

- [ ] **Step 2: Run all tests**

```bash
forge test --match-contract AgentRegistryTest -vvv
```
Expected: ALL tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/AgentRegistry.t.sol
git commit -m "test(registry): add arbiter setup and fee distribution tests"
```

---

### Task 11: Update Endpoint + Agent URI Tests

**Files:**
- Modify: `test/AgentRegistry.t.sol`

- [ ] **Step 1: Add remaining update tests** (append)

```solidity
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
```

- [ ] **Step 2: Run full test suite**

```bash
forge test --match-contract AgentRegistryTest -vvv
```
Expected: ALL tests PASS

- [ ] **Step 3: Final commit**

```bash
git add test/AgentRegistry.t.sol
git commit -m "test(registry): add update endpoint tests — AgentRegistry complete"
```

---

## Summary

After completing all tasks:
- **Foundry project** initialized with OpenZeppelin
- **Libraries**: CustomRevert.sol, Lock.sol
- **Mocks**: MockERC20, MockIdentityRegistry
- **AgentRegistry.sol**: Full implementation matching `docs/smart-contracts.md`
- **~20 tests** covering: registration, staking, ENS, capabilities, discovery, deactivation, arbiter setup, fee distribution, updates

**Next contract:** DelegationTracker.sol (separate plan)
