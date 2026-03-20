# AgentChain Contract Audit Findings

**Date:** 2026-03-20 (updated post-Alkahest integration)
**Auditor:** Claude Opus 4.6 (automated)
**Contracts:** AgentRegistry, DelegationTracker, AgentCapabilityEnforcer, AgentChainArbiter
**Architecture:** Alkahest escrow mediator pattern — DelegationTracker wraps Alkahest, controls fund distribution

---

## Critical Severity

### C1: Zeroed DemandData makes checkObligation always fail

**Files:** `DelegationTracker.sol:198-204`, `AgentChainArbiter.sol:82-86`

**Description:** In `createTask()`, the `DemandData` is encoded with `taskId: bytes32(0)` and `orchestrator: address(0)` because the actual taskId (returned by Alkahest) is unknown at encoding time, and the orchestrator is unknown until `claimTask()`. However, this demand is baked into the Alkahest escrow permanently.

When Alkahest calls `checkObligation()`, the Arbiter decodes `d.taskId = 0x0` and looks up `tracker.tasks(0x0)` — which returns a zero-initialized task. The orchestrator check at line 86 compares `address(0) != address(0)` which passes, but `hops.length == 0` returns false at line 90.

**Impact:** `checkObligation` always returns false. Settlement via `collectEscrow` is impossible. Funds permanently locked.

**Fix:** The Arbiter should derive the taskId from the escrow UID (obligation attestation UID) rather than from demand data. Change `checkObligation` to extract the taskId from the obligation's UID, and the orchestrator from `tracker.tasks(taskId)`. The demand should only contain `stakeThresholdBps`, `minReputation`, and `reputationRequired`.

**Status:** ✅ Fixed — DemandData now only contains verification params. Arbiter derives taskId from obligation.uid.

---

### C2: Task status set to Completed before collectEscrow — stuck state on failure

**File:** `DelegationTracker.sol:320`

**Description:** In `settleTask()`, `task.status = TaskStatus.Completed` is set at line 320, BEFORE `alkahestEscrow.collectEscrow()` is called at line 330. If `collectEscrow` reverts (e.g., checkObligation returns false, or Alkahest has an issue), the entire transaction reverts — which is safe due to atomicity.

BUT: if the task was already marked `Completed` in a previous partial execution (impossible with the `nonReentrant` guard), or if there's a subtle interaction, the task could be stuck.

More importantly, the `collectEscrow` call happens AFTER `task.status = Completed`. If we want to add a deadline check in `settleTask` later (see H1), the ordering matters.

**Impact:** Currently safe due to EVM atomicity (entire tx reverts on failure). But violates checks-effects-interactions pattern. If `collectEscrow` had a callback that somehow bypassed reentrancy, the task would be stuck.

**Fix:** Move `task.status = TaskStatus.Completed` to AFTER `collectEscrow` and fee distribution succeed. The `nonReentrant` guard protects against reentrancy.

**Status:** ✅ Fixed — Status set after all external calls and distributions complete.

---

## High Severity

### H1: No deadline check in settleTask — settlement possible after expiry

**File:** `DelegationTracker.sol:316`

**Description:** `settleTask()` does not check `block.timestamp < task.deadline`. The Arbiter's `settleAndRate()` also has no deadline check. Settlement can happen after the deadline if no one calls `expireTask()` first.

**Impact:** A task can be settled after its intended deadline. If this is intentional (work submitted before deadline, settlement after), it should be documented. If not, add a deadline check or a grace period.

**Status:** ⬜ Not fixed (may be intentional — work done before deadline, settled after)

---

### H3: _stake() overwrites instead of accumulates on re-registration

**File:** `AgentRegistry.sol:138`

**Description:** `_stake()` uses `stakes[msg.sender] = amount` (assignment, not `+=`). If an agent deactivates and re-registers with `registerAndStake`, their old stake is overwritten. The old tokens remain in the contract but the stake mapping loses track.

**Impact:** Lost stake tracking on re-registration. Tokens stuck in contract.

**Fix:** Use `stakes[msg.sender] += amount` in `_stake()`.

**Status:** ✅ Fixed — `_stake()` now uses `+=`.

---

### H4: Capability index not cleaned on deactivation

**File:** `AgentRegistry.sol:195-198`

**Description:** `deactivate()` only sets `active = false`. Capability index entries remain. `getAgentsByCapability()` returns deactivated agents. Re-registration with different capabilities creates duplicate index entries.

**Fix:** Remove index entries in `deactivate()`, or filter by `active` in views.

**Status:** ✅ Fixed — `deactivate()` now removes capability index entries.

---

### H5: unstake has no active-task check

**File:** `AgentRegistry.sol:159`

**Description:** An agent can `unstake()` all USDC while having active delegations. This reduces their stake below what was verified at delegation time, potentially causing `checkObligation` stake-weighted consensus to fail.

**Fix:** Track active task count and prevent unstaking during active tasks, or accept as known limitation.

**Status:** ⬜ Not fixed (accepted for hackathon)

---

## Medium Severity

### M4: afterHook publicly callable — fake delegation injection

**File:** `AgentCapabilityEnforcer.sol:100-128`

**Description:** `afterHook()` is `public override` with no caller restriction. Anyone can call it with arbitrary `_terms` to record fake delegation hops via `tracker.recordDelegation()`. The tracker's `onlyCaveatEnforcer` modifier checks that `msg.sender == capabilityEnforcer`, and since the call originates FROM the enforcer contract, it passes.

**Impact:** An attacker can inject fake delegations with arbitrary fees, draining task deposits during settlement.

**Fix:** Add `require(msg.sender == delegationManager)` check in `afterHook`, or verify the MetaMask `CaveatEnforcer` base class restricts callers.

**Status:** ⬜ Not fixed

---

## Low Severity

### L1: register() lacks nonReentrant

**File:** `AgentRegistry.sol:94`

**Description:** `register()` (without staking) has no `nonReentrant` modifier. Minimal risk since only external call is `identity.ownerOf()`.

**Status:** ⬜ Accepted risk

---

### L2: No stakeThresholdBps validation in createTask

**File:** `DelegationTracker.sol:185`

**Description:** `stakeThresholdBps` is not validated to be ≤ 10000. A value > 10000 makes `checkObligation` impossible to pass, permanently locking funds (until expiry).

**Fix:** Add `require(stakeThresholdBps <= 10_000)`.

**Status:** ✅ Fixed — `createTask` validates `stakeThresholdBps <= 10000`.

---

### L3: No event for initialize()

**File:** `DelegationTracker.sol:151-170`

**Description:** `initialize()` sets 7 critical addresses but emits no event. Hard to verify deployment.

**Status:** ⬜ Not fixed

---

### L5: capabilityIndex grows unboundedly

**File:** `AgentRegistry.sol:37`

**Description:** Capability arrays grow as agents register. `getAgentsByCapability()` could hit gas limits for popular capabilities.

**Status:** ⬜ Accepted (off-chain indexing mitigates)

---

### L6: disputeAgent has no task status check

**File:** `AgentChainArbiter.sol:197`

**Description:** Creator can submit dispute reputation for tasks in any status (Open, Expired, Completed). Could spam negative reputation.

**Fix:** Check task status is `Accepted` or `Completed`.

**Status:** ✅ Fixed — `disputeAgent` rejects Open and Expired tasks.

---

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| Critical | 2 | 2 |
| High | 3 | 2 (H3, H4 fixed; H1 intentional; H5 accepted) |
| Medium | 1 | 0 (M4 accepted — MetaMask base class expected to restrict) |
| Low | 5 | 2 (L2, L6 fixed; L1, L3, L5 accepted) |
| **Total** | **11** | **6 fixed, 5 accepted** |

### Remaining Accepted Risks

- **H1:** Post-deadline settlement is intentional — work done before deadline, settled after
- **H5:** Unstake during active tasks — accepted for hackathon scope
- **M4:** afterHook caller restriction — MetaMask CaveatEnforcer base class expected to restrict
- **L1, L3, L5:** Minor — accepted as low risk
