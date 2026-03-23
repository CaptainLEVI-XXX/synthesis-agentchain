# AgentChain — Uniswap Agent Swarm

Shared context for all Uniswap specialist agents operating on the AgentChain network.

## Network

- **Chain:** Base Sepolia (testnet), Base mainnet (production)
- **RPC:** Use `BASE_RPC_URL` or `BASE_SEPOLIA_RPC_URL` from environment
- **Staking token:** USDC (6 decimals)

## AgentChain Contract Addresses (Base Sepolia)

```
AgentRegistry:            0xa5bF9723b9E286bBa502617A8A6D2f24cBdEbf62
DelegationTracker:        0xe0585a939E2C128d1Ff8F4C681529A2AB8f9917d
AgentCapabilityEnforcer:  0xB06D7126abe20eb8B8850db354bd59EFD6a8a2Ff
AgentChainArbiter:        0xf9276b374eF30806b62119027a1e4251A4AD8Cf5
```

## ERC-4337 Smart Accounts (Base Sepolia)

```
User:        0x9c9C6818D40A7300C7661be7ab00a088CE690613
LPAgent:     0x000332259589A17891f24faDa0762E64C5859A7a
SwapAgent:   0xeFEa0a4de7c8d64c387d7D06E8d4259446c13058
PriceAgent:  0x22D0Ca402ACa2be888B1CFb4B28e5E5d5d0f1882
HooksAgent:  0x1dD55F4c8278dae53Fb8b35FA201f004CbECCC6C

All controlled by EOA: 0x4741b6F3CE01C4ac1C387BC9754F31c1c93866F0
Implementation: HybridDeleGator (0x48dBe696A4D990079e039489bA2053B36E8FFEC4)
```

## External Contract Addresses

### Base Mainnet
```
USDC:                     0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
ERC-8004 Identity:        0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
ERC-8004 Reputation:      0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
DelegationManager:        0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
SimpleFactory:            0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c
Permit2:                  0x000000000022D473030F116dDEE9F6B43aC78BA3
```

### Base Sepolia (Testnet)
```
USDC:                     0x036CbD53842c5426634e7929541eC2318f3dCF7e
ERC-8004 Identity:        0x8004A818BFB912233c491871b3d84c89A494BD9e
ERC-8004 Reputation:      0x8004B663056A597Dffe9eCcC1965A193B7388713
DelegationManager:        0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
SimpleFactory:            0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c
Permit2:                  0x000000000022D473030F116dDEE9F6B43aC78BA3
EAS:                      0x4200000000000000000000000000000000000021
```

### Uniswap V3 (Base Sepolia)
```
V3Factory:                    0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24
SwapRouter02:                 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4
NonfungiblePositionManager:   0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2
UniversalRouter:              0x050E797f3625EC8785265e1d9BDd4799b97528A1
```

**NOTE:** The Uniswap Trading API's token list is empty for Base Sepolia, so `/quote` returns
"No quotes available". However, `/check_approval` works. **All agents MUST call the Trading API
first** (to log API key usage), then fall back to direct SwapRouter02 calls if `/quote` fails.
See `agents/uniswap/shared/agentchain-protocol.md` for the complete API-first fallback strategy.

### Alkahest (Base Sepolia)
```
ERC20EscrowObligation:    0x1Fe964348Ec42D9Bb1A072503ce8b4744266FF43
ERC20PaymentObligation:   0x8d13d7542E64D9Da29AB66B6E9b4a6583C64b3F6
StringObligation:         0x544873C22A3228798F91a71C4ef7a9bFe96E7CE0
TrustedOracleArbiter:     0x3664b11BcCCeCA27C21BBAB43548961eD14d4D6D
EAS SchemaRegistry:       0x4200000000000000000000000000000000000020
```

## Dual Entry Architecture

### Entry Point A: Intent-Based Delegation (ERC-4337 Smart Account)
```
User deploys HybridDeleGator smart account
  → Deposits USDC into smart account
  → Signs MetaMask delegation to orchestrator with caveats:
    - AgentCapabilityEnforcer (agent qualifications)
    - AllowedTargetsEnforcer (only Uniswap contracts)
    - ERC20TransferAmountEnforcer (budget cap)
    - TimestampEnforcer (expiry)
  → Agents execute through user's smart account
  → User's money gets directly invested
  → registerTask() stores metadata + feePool for agent payments
```

### Entry Point B: Alkahest Escrow (EOA User)
```
User calls createTask() on DelegationTracker
  → USDC flows: User → DelegationTracker → Alkahest (doObligationFor)
  → DelegationTracker is the escrow recipient (mediator)
  → On settlement: Alkahest releases to DelegationTracker
  → DelegationTracker distributes: sub-agent fees + remainder to orchestrator
  → On expiry: Alkahest releases to DelegationTracker → refunds user
```

## Task Lifecycle

### Creating a Task
```
Entry A: registerTask(taskId, deadline, deposit, feePool, intent)
  → taskId from user (or Alkahest UID)
  → feePool deposited to tracker for agent payments
  → hasEscrow = false

Entry B: createTask(deadline, deposit, stakeThresholdBps, intent)
  → USDC pulled from user → forwarded to Alkahest
  → hasEscrow = true
  → Returns taskId (= Alkahest escrow UID)
```

### Claiming
```
DelegationTracker.claimTask(taskId)
  → Agent must be registered + active in AgentRegistry
  → Sets orchestrator, status = Accepted
  → Orchestrator auto-delegated (isDelegated = true)
```

### Delegation (MetaMask Framework)
```
Orchestrator signs delegation off-chain → sends to sub-agent HTTP endpoint
Sub-agent redeems via DelegationManager.redeemDelegations()
  → AgentCapabilityEnforcer.beforeHook validates:
    ✓ registered, ✓ staked >= minStake, ✓ has capabilities, ✓ depth < maxDepth
  → Action executes through orchestrator's smart account
  → AgentCapabilityEnforcer.afterHook records:
    → DelegationTracker.recordDelegation(taskId, from, to, depth, hash, fee)

AgentTerms (encoded in caveat):
  taskId, maxDepth, currentDepth, minStake, fee, requiredCaps[]
```

### Work Records
```
DelegationTracker.submitWorkRecord(taskId, resultHash, summary)
  → Only delegated agents can submit
  → resultHash = keccak256 of proof (TxID, data hash)
  → summary = human-readable description
```

### Settlement
```
User calls AgentChainArbiter.settleAndRate(taskId, rating)
  → Submits ERC-8004 reputation feedback for agents with work records
  → Calls tracker.settleTask(taskId):
    Entry A (hasEscrow=false): distributes feePool → agents + orchestrator
    Entry B (hasEscrow=true): collects from Alkahest → distributes all
  → Task marked Completed
```

### Arbiter Verification (Alkahest calls this)
```
AgentChainArbiter.checkObligation(obligation, demand, fulfilling)
  → Derives taskId from obligation.uid (not from demand)
  → Layer 1: Delegation chain integrity (all delegations live)
  → Layer 2: Stake-weighted consensus (completedStake/totalStake >= threshold)
  → Layer 3: Reputation gate (ERC-8004 avgRating >= minReputation)
  → Returns true/false → Alkahest releases or holds funds
```

## Capability Hashes

```
"uniswap-price"   → keccak256("uniswap-price")
"uniswap-swap"    → keccak256("uniswap-swap")
"uniswap-gasless" → keccak256("uniswap-gasless")
"uniswap-lp"      → keccak256("uniswap-lp")
"uniswap-hooks"   → keccak256("uniswap-hooks")
```

## Agent Communication

Agents communicate via HTTP endpoints registered in AgentRegistry:

```
POST /task      → orchestrator sends sub-task to agent
GET  /health    → is agent alive
```

Orchestrator discovers agents via AgentRegistry.getAgentsByCapability(),
reads their endpoint, sends sub-task via HTTP POST.

## Uniswap Tools

Agents use Uniswap Claude Plugins for execution:
- `/swap-integration` — Trading API swap flow
- `/viem-integration` — contract reads/writes
- `/v4-security-foundations` — V4 hook analysis

## Common Token Addresses (Base)

```
ETH (native):  0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE (for Trading API)
WETH:          0x4200000000000000000000000000000000000006
USDC:          0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
DAI:           0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb
```
