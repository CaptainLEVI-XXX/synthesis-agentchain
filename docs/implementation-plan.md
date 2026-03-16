# AgentChain — Implementation Plan

**Created:** 2026-03-15
**Deadline:** 2026-03-25
**Reference:** `docs/smart-contracts.md` (canonical Solidity), `docs/superpowers/specs/2026-03-14-agentchain-design.md` (design spec)

## Implementation Phases

### Phase 1: Foundry Project Setup (Day 1)

**Goal:** Scaffold project, install dependencies, compile skeleton contracts.

- [ ] **1.1** Initialize Foundry project (`forge init --no-commit`)
- [ ] **1.2** Install dependencies:
  - `forge install OpenZeppelin/openzeppelin-contracts`
  - `forge install metamask/delegation-framework` (for CaveatEnforcer base)
  - `forge install ethereum-attestation-service/eas-contracts` (for IArbiter/Attestation types)
- [ ] **1.3** Configure `foundry.toml`:
  - Remappings for `@openzeppelin/`, `@metamask/`, `@eas/`
  - Solidity version `0.8.23` (matches MetaMask enforcer)
  - Base Sepolia RPC URL, etherscan API key
  - Optimizer on (200 runs)
- [ ] **1.4** Create `src/libraries/CustomRevert.sol` and `src/libraries/Lock.sol` (copy from spec)
- [ ] **1.5** Verify: `forge build` compiles with zero errors

**Output:** Clean Foundry project that compiles.

---

### Phase 2: AgentRegistry.sol (Day 1-2)

**Goal:** Implement agent registration, staking, ERC-8004 identity, ENS display, fee distribution.

- [ ] **2.1** Create `src/AgentRegistry.sol` — copy from `docs/smart-contracts.md` Section 1
- [ ] **2.2** Create `test/mocks/MockIdentityRegistry.sol` — minimal ERC-8004 mock
- [ ] **2.3** Create `test/mocks/MockERC20.sol` — simple USDC mock (mint + approve)
- [ ] **2.4** Create `test/AgentRegistry.t.sol`:
  - `test_registerAndStake_success`
  - `test_registerAndStake_duplicateFails`
  - `test_registerAndStake_zeroStakeFails`
  - `test_register_withoutStake`
  - `test_addStake` / `test_unstake`
  - `test_linkENSName`
  - `test_updateCapabilities`
  - `test_hasCapabilities_true` / `test_hasCapabilities_missing`
  - `test_deactivate`
  - `test_setArbiter_onlyDeployer` / `test_setArbiter_onlyOnce`
  - `test_distributeFeesFromStake_success`
  - `test_distributeFeesFromStake_onlyArbiter`
  - `test_distributeFeesFromStake_insufficientStakeFails`
  - `test_distributeFeesFromStake_correctBalances`
- [ ] **2.5** Verify: all tests pass (`forge test --match-contract AgentRegistryTest -vvv`)

**Output:** Fully tested AgentRegistry with fee distribution.

---

### Phase 3: DelegationTracker.sol (Day 2-3)

**Goal:** Implement task lifecycle, delegation recording, fee tracking, work records.

- [ ] **3.1** Create `src/DelegationTracker.sol` — copy from `docs/smart-contracts.md` Section 3
- [ ] **3.2** Create `test/DelegationTracker.t.sol`:
  - `test_registerTask` / `test_registerTask_duplicateFails`
  - `test_registerTask_withFeePool`
  - `test_claimTask_byRegisteredAgent` / `test_claimTask_unregisteredFails`
  - `test_claimTask_alreadyClaimedFails`
  - `test_recordDelegation_byCaveatEnforcer` / `test_recordDelegation_unauthorizedFails`
  - `test_recordDelegation_storesPromisedFee`
  - `test_recordDelegation_feeExceedsPoolFails`
  - `test_submitWorkRecord_byDelegatedAgent` / `test_submitWorkRecord_nonDelegatedFails`
  - `test_submitWorkRecord_duplicateFails`
  - `test_settleTask` / `test_expireTask`
- [ ] **3.3** Verify: all tests pass

**Output:** Fully tested DelegationTracker with fee tracking.

---

### Phase 4: AgentCapabilityEnforcer.sol (Day 3-4)

**Goal:** Implement custom MetaMask caveat enforcer with 7-param hooks.

- [ ] **4.1** Create `src/AgentCapabilityEnforcer.sol` — copy from `docs/smart-contracts.md` Section 2
- [ ] **4.2** Verify it inherits `CaveatEnforcer` correctly from MetaMask dependency
- [ ] **4.3** Create `test/AgentCapabilityEnforcer.t.sol`:
  - `test_beforeHook_validAgent`
  - `test_beforeHook_unregisteredFails`
  - `test_beforeHook_insufficientStakeFails`
  - `test_beforeHook_missingCapsFails`
  - `test_beforeHook_depthLimitFails`
  - `test_afterHook_recordsDelegationAndFee`
- [ ] **4.4** Verify: all tests pass

**Output:** Fully tested enforcer. Built-in enforcer composition tests come in integration phase.

---

### Phase 5: AgentChainArbiter.sol (Day 4-5)

**Goal:** Implement 3-layer Alkahest arbiter with trustless fee distribution.

- [ ] **5.1** Create `src/AgentChainArbiter.sol` — copy from `docs/smart-contracts.md` Section 4
- [ ] **5.2** Create `test/mocks/MockDelegationManager.sol` — mock `disabledDelegations()`
- [ ] **5.3** Create `test/mocks/MockReputationRegistry.sol` — mock `getSummary()`, `getClients()`, `giveFeedback()`
- [ ] **5.4** Create `test/AgentChainArbiter.t.sol`:
  - **Chain integrity:** `test_checkStatement_chainIntegrity_allLive_passes` / `_revokedDelegation_fails`
  - **Stake-weighted:** `test_checkStatement_stakeWeighted_aboveThreshold_passes` / `_belowThreshold_fails` / `_highStakeAgentMatters`
  - **Reputation gate:** `test_checkStatement_reputationGate_aboveMin_passes` / `_belowMin_fails` / `_newAgentSkipped` / `_disabled_passes`
  - **Edge cases:** `test_checkStatement_wrongOrchestrator_false` / `_noHops_fails`
  - **Settlement:** `test_settleAndRate_onlyAgentsWithWorkRecordsGetFeedback` / `_correctTags` / `_nonCreatorFails`
  - **Fee distribution:** `test_settleAndRate_distributesFeesFromStake` / `_onlyPaysAgentsWithWorkRecords` / `_orchestratorStakeReduced`
  - **Disputes:** `test_disputeAgent_submitsNegativeFeedback` / `_nonCreatorFails`
- [ ] **5.5** Verify: all tests pass

**Output:** Fully tested 3-layer arbiter with trustless fee distribution.

---

### Phase 6: Integration Tests (Day 5-6)

**Goal:** End-to-end flow test across all contracts.

- [ ] **6.1** Create `test/Integration.t.sol`:
  - `test_fullFlow_register_escrow_delegate_redeemDeFiAction_settle_reputation`
  - `test_fullFlow_subDelegationChain_budgetAttenuates`
  - `test_fullFlow_delegationRevocation_disablesDelegation`
  - `test_fullFlow_deadlineExpiry`
  - `test_fullFlow_depthLimit_blocksDeepChains`
  - `test_fullFlow_feeDistribution_endToEnd`
  - `test_fullFlow_feeDistribution_agentWithoutWorkGetsNothing`
- [ ] **6.2** Deploy all contracts in test, wire up `initialize()` and `setArbiter()`
- [ ] **6.3** Verify: full flow works end-to-end

**Output:** Confidence that all contracts work together.

---

### Phase 7: Deployment Scripts (Day 6)

**Goal:** Deploy to Base Sepolia with correct ordering.

- [ ] **7.1** Create `script/Deploy.s.sol`:
  ```
  1. Deploy AgentRegistry(USDC, IdentityRegistry)
  2. Deploy DelegationTracker()
  3. Deploy AgentCapabilityEnforcer(registry, tracker)
  4. Deploy AgentChainArbiter(tracker, delegationManager, reputation, registry)
  5. Call tracker.initialize(enforcer, arbiter, registry)
  6. Call registry.setArbiter(arbiter)
  ```
- [ ] **7.2** Create `.env.example` with required vars (RPC_URL, PRIVATE_KEY, contract addresses)
- [ ] **7.3** Deploy to Base Sepolia: `forge script script/Deploy.s.sol --broadcast --verify`
- [ ] **7.4** Record deployed addresses in `docs/deployed-addresses.md`
- [ ] **7.5** Verify on Basescan

**Output:** Contracts live on Base Sepolia, verified on Basescan.

---

### Phase 8: SDK Core (Day 6-8)

**Goal:** TypeScript SDK for agent registration, delegation, and escrow interaction.

- [ ] **8.1** Initialize SDK package: `sdk/` with `package.json`, `tsconfig.json`
- [ ] **8.2** Install deps: `viem`, `@metamask/smart-accounts-kit`
- [ ] **8.3** Create contract ABIs from Foundry artifacts (`forge inspect`)
- [ ] **8.4** Implement `sdk/core/registry.ts` — register, stake, capability queries
- [ ] **8.5** Implement `sdk/core/accounts.ts` — HybridDeleGator creation via SimpleFactory
- [ ] **8.6** Implement `sdk/core/delegation.ts` — caveat composition, sub-delegation, depth tracking
- [ ] **8.7** Implement `sdk/core/escrow.ts` — Alkahest makeStatement, collectPayment
- [ ] **8.8** Implement `sdk/core/reputation.ts` — ERC-8004 getSummary queries
- [ ] **8.9** Implement `sdk/core/discovery.ts` — capability search + reputation filter
- [ ] **8.10** Implement `sdk/core/olas-bridge.ts` — mech-client wrapper (Olas bounty)
- [ ] **8.11** Implement `sdk/types/index.ts` — TypeScript types
- [ ] **8.12** Create `sdk/index.ts` — main `AgentChain` export

**Output:** Working SDK that can register agents, create delegations, and interact with escrow.

---

### Phase 9: Demo / Proof-of-Concept (Day 8-9)

**Goal:** Demonstrate full flow with real agents on Base Sepolia.

- [ ] **9.1** Create demo script: register 3 agents (orchestrator + 2 sub-agents)
- [ ] **9.2** Create task with Alkahest escrow (test USDC)
- [ ] **9.3** Orchestrator claims task, creates delegations with fees
- [ ] **9.4** Sub-agents redeem delegations, submit work records
- [ ] **9.5** Run checkStatement verification (3 layers)
- [ ] **9.6** Settle + rate → fees distributed, reputation submitted
- [ ] **9.7** Verify on Basescan: delegation chain, fee transfers, ERC-8004 feedback
- [ ] **9.8** Olas integration: 10+ mech requests (bounty requirement)

**Output:** Live demo showing full AgentChain flow on Base Sepolia.

---

### Phase 10: Submission (Day 9-10)

**Goal:** Polish, document, and submit to Synthesis hackathon.

- [ ] **10.1** Update design spec with final deployed addresses
- [ ] **10.2** Write README.md with setup instructions
- [ ] **10.3** Record conversation log (hackathon requirement)
- [ ] **10.4** Open-source the repo (hackathon requirement)
- [ ] **10.5** Submit via Synthesis API:
  ```bash
  curl -X POST https://synthesis.devfolio.co/submit \
    -H "Authorization: Bearer sk-synth-376c35..." \
    -H "Content-Type: application/json" \
    -d '{ ... }'
  ```
- [ ] **10.6** Verify submission on Devfolio

**Output:** Submitted hackathon project.

---

## Bounty Alignment

| Bounty | Key Deliverable | Phase |
|--------|----------------|-------|
| Agents that Trust ($2,500) | Full protocol — delegation chains + verification | 1-6 |
| Arkhai/Alkahest ($900) | AgentChainArbiter with 3-layer verification | 5 |
| MetaMask Delegation | AgentCapabilityEnforcer + 5 built-in enforcers | 4 |
| ERC-8004 | Identity + Reputation deep integration | 2, 5 |
| ENS Open Integration ($300) | ENS display names throughout SDK | 2, 8 |
| Olas Marketplace ($500) | mech-client bridge + 10 requests | 8, 9 |

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| MetaMask dependency doesn't compile with our Solidity version | Pin `pragma solidity 0.8.23` for enforcer, match their version |
| Alkahest contracts not deployed on Base Sepolia | Mock IArbiter + IEAS for tests, verify deployment before demo |
| Time pressure (10 days remaining) | Contracts are highest priority. SDK can be minimal. Demo can use scripts. |
| ERC-8004 registry behavior differs from spec | Fork test against real deployed contract on Base |
