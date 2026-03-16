// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test, console2} from "forge-std/Test.sol";
import {AgentCapabilityEnforcer} from "../src/AgentCapabilityEnforcer.sol";
import {ModeCode} from "@metamask/delegation-framework/src/utils/Types.sol";

/// @dev Mock AgentRegistry for testing
contract MockAgentRegistry {
    mapping(address => bool) public registered;
    mapping(address => uint256) public stakeAmounts;
    mapping(address => bytes32[]) public agentCaps;

    function setRegistered(address agent, bool val) external {
        registered[agent] = val;
    }

    function setStake(address agent, uint256 amount) external {
        stakeAmounts[agent] = amount;
    }

    function setCaps(address agent, bytes32[] memory caps) external {
        agentCaps[agent] = caps;
    }

    function isRegistered(address agent) external view returns (bool) {
        return registered[agent];
    }

    function stakes(address agent) external view returns (uint256) {
        return stakeAmounts[agent];
    }

    function hasCapabilities(address agent, bytes32[] calldata caps) external view returns (bool) {
        for (uint i = 0; i < caps.length; i++) {
            bool found = false;
            for (uint j = 0; j < agentCaps[agent].length; j++) {
                if (agentCaps[agent][j] == caps[i]) {
                    found = true;
                    break;
                }
            }
            if (!found) return false;
        }
        return true;
    }
}

/// @dev Mock DelegationTracker for testing
contract MockDelegationTracker {
    struct RecordedDelegation {
        bytes32 taskId;
        address from;
        address to;
        uint8 depth;
        bytes32 delegationHash;
        uint256 fee;
    }

    RecordedDelegation[] public recordings;

    function recordDelegation(
        bytes32 taskId,
        address from,
        address to,
        uint8 depth,
        bytes32 delegationHash,
        uint256 fee
    ) external {
        recordings.push(RecordedDelegation(taskId, from, to, depth, delegationHash, fee));
    }

    function getRecordingCount() external view returns (uint256) {
        return recordings.length;
    }

    function getRecording(uint256 idx) external view returns (RecordedDelegation memory) {
        return recordings[idx];
    }

    // Stubs for IDelegationTracker interface (not used in enforcer tests)
    function getPromisedFee(bytes32, address) external pure returns (uint256) { return 0; }
    function getTotalPromisedFees(bytes32) external pure returns (uint256) { return 0; }
    function hasWorkRecord(bytes32, address) external pure returns (bool) { return false; }
    function settleTask(bytes32) external {}
}

contract AgentCapabilityEnforcerTest is Test {
    AgentCapabilityEnforcer public enforcer;
    MockAgentRegistry public registry;
    MockDelegationTracker public tracker;

    address public orchestrator = makeAddr("orchestrator");
    address public subAgent = makeAddr("subAgent");

    bytes32 public constant TASK_ID = keccak256("task-1");
    bytes32 public constant CAP_DEFI = keccak256(abi.encodePacked("defi"));
    bytes32 public constant CAP_LENDING = keccak256(abi.encodePacked("lending"));
    bytes32 public constant DEL_HASH = keccak256("delegation-1");

    ModeCode internal defaultMode;

    function setUp() public {
        registry = new MockAgentRegistry();
        tracker = new MockDelegationTracker();
        enforcer = new AgentCapabilityEnforcer(address(registry), address(tracker));

        // Set up a registered agent with stake and capabilities
        registry.setRegistered(subAgent, true);
        registry.setStake(subAgent, 5000e6);
        bytes32[] memory caps = new bytes32[](2);
        caps[0] = CAP_DEFI;
        caps[1] = CAP_LENDING;
        registry.setCaps(subAgent, caps);
    }

    // ─── Helpers ─────────────────────────────────────────

    function _encodeTerms(
        bytes32 taskId,
        uint8 maxDepth,
        uint8 currentDepth,
        uint256 minStake,
        uint256 fee,
        bytes32[] memory requiredCaps
    ) internal pure returns (bytes memory) {
        AgentCapabilityEnforcer.AgentTerms memory terms = AgentCapabilityEnforcer.AgentTerms({
            taskId: taskId,
            maxDepth: maxDepth,
            currentDepth: currentDepth,
            minStake: minStake,
            fee: fee,
            requiredCaps: requiredCaps
        });
        return abi.encode(terms);
    }

    function _defaultTerms() internal pure returns (bytes memory) {
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = CAP_DEFI;
        return _encodeTerms(TASK_ID, 3, 1, 1000e6, 80e6, caps);
    }

    // ─── beforeHook Tests ─────────────────────────────────

    function test_beforeHook_validAgent() public view {
        enforcer.beforeHook(
            _defaultTerms(), "", defaultMode, "", bytes32(0), orchestrator, subAgent
        );
    }

    function test_beforeHook_unregisteredAgentFails() public {
        address unregistered = makeAddr("unregistered");
        vm.expectRevert(abi.encodeWithSelector(
            AgentCapabilityEnforcer.AgentNotRegistered.selector, unregistered
        ));
        enforcer.beforeHook(
            _defaultTerms(), "", defaultMode, "", bytes32(0), orchestrator, unregistered
        );
    }

    function test_beforeHook_insufficientStakeFails() public {
        registry.setStake(subAgent, 500e6); // below 1000e6 minStake
        vm.expectRevert(abi.encodeWithSelector(
            AgentCapabilityEnforcer.StakeInsufficient.selector, subAgent, 1000e6, 500e6
        ));
        enforcer.beforeHook(
            _defaultTerms(), "", defaultMode, "", bytes32(0), orchestrator, subAgent
        );
    }

    function test_beforeHook_missingCapabilitiesFails() public {
        bytes32[] memory wrongCaps = new bytes32[](1);
        wrongCaps[0] = keccak256(abi.encodePacked("unknown"));
        bytes memory terms = _encodeTerms(TASK_ID, 3, 1, 1000e6, 80e6, wrongCaps);

        vm.expectRevert(abi.encodeWithSelector(
            AgentCapabilityEnforcer.MissingCapabilities.selector, subAgent
        ));
        enforcer.beforeHook(terms, "", defaultMode, "", bytes32(0), orchestrator, subAgent);
    }

    function test_beforeHook_maxDepthReachedFails() public {
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = CAP_DEFI;
        bytes memory terms = _encodeTerms(TASK_ID, 3, 3, 1000e6, 80e6, caps);

        vm.expectRevert(abi.encodeWithSelector(
            AgentCapabilityEnforcer.MaxDepthReached.selector, uint8(3), uint8(3)
        ));
        enforcer.beforeHook(terms, "", defaultMode, "", bytes32(0), orchestrator, subAgent);
    }

    function test_beforeHook_exactMinStakePasses() public {
        registry.setStake(subAgent, 1000e6);
        enforcer.beforeHook(
            _defaultTerms(), "", defaultMode, "", bytes32(0), orchestrator, subAgent
        );
    }

    function test_beforeHook_multipleCapabilities() public view {
        bytes32[] memory caps = new bytes32[](2);
        caps[0] = CAP_DEFI;
        caps[1] = CAP_LENDING;
        bytes memory terms = _encodeTerms(TASK_ID, 3, 1, 1000e6, 80e6, caps);

        enforcer.beforeHook(terms, "", defaultMode, "", bytes32(0), orchestrator, subAgent);
    }

    function test_beforeHook_depthZeroPasses() public view {
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = CAP_DEFI;
        bytes memory terms = _encodeTerms(TASK_ID, 3, 0, 1000e6, 80e6, caps);

        enforcer.beforeHook(terms, "", defaultMode, "", bytes32(0), orchestrator, subAgent);
    }

    // ─── afterHook Tests ──────────────────────────────────

    function test_afterHook_recordsDelegation() public {
        enforcer.afterHook(
            _defaultTerms(), "", defaultMode, "", DEL_HASH, orchestrator, subAgent
        );

        assertEq(tracker.getRecordingCount(), 1);
        MockDelegationTracker.RecordedDelegation memory rec = tracker.getRecording(0);
        assertEq(rec.taskId, TASK_ID);
        assertEq(rec.from, orchestrator);
        assertEq(rec.to, subAgent);
        assertEq(rec.depth, 1);
        assertEq(rec.delegationHash, DEL_HASH);
        assertEq(rec.fee, 80e6);
    }

    function test_afterHook_emitsEvent() public {
        vm.expectEmit(true, true, true, true);
        emit AgentCapabilityEnforcer.AgentDelegationValidated(
            DEL_HASH, orchestrator, subAgent, TASK_ID, 1
        );

        enforcer.afterHook(
            _defaultTerms(), "", defaultMode, "", DEL_HASH, orchestrator, subAgent
        );
    }

    function test_afterHook_multipleDelegations() public {
        address subAgent2 = makeAddr("subAgent2");
        bytes32 delHash2 = keccak256("delegation-2");

        bytes32[] memory caps = new bytes32[](1);
        caps[0] = CAP_DEFI;
        bytes memory terms2 = _encodeTerms(TASK_ID, 3, 1, 500e6, 50e6, caps);

        enforcer.afterHook(_defaultTerms(), "", defaultMode, "", DEL_HASH, orchestrator, subAgent);
        enforcer.afterHook(terms2, "", defaultMode, "", delHash2, orchestrator, subAgent2);

        assertEq(tracker.getRecordingCount(), 2);
        MockDelegationTracker.RecordedDelegation memory rec2 = tracker.getRecording(1);
        assertEq(rec2.to, subAgent2);
        assertEq(rec2.fee, 50e6);
    }

    // ─── Constructor Tests ────────────────────────────────

    function test_constructor_setsImmutables() public view {
        assertEq(address(enforcer.registry()), address(registry));
        assertEq(address(enforcer.tracker()), address(tracker));
    }
}
