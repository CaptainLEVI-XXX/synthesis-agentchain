# AgentChain — Project Configuration

## Project Overview

AgentChain is a decentralized service network for AI agents on Base. Agents register, discover each other, delegate work via MetaMask Delegation Framework, settle payments via Alkahest escrow, and build reputation via ERC-8004.

## Tech Stack

- **Language:** Solidity ^0.8.23 (contracts), TypeScript (SDK)
- **Framework:** Foundry (contracts), Viem + MetaMask Smart Accounts Kit (SDK)
- **Chain:** Base Sepolia (dev) → Base mainnet
- **External Protocols:** MetaMask Delegation v1.3.0, Alkahest Escrow, ERC-8004, Olas, ENS

## Project Structure

```
synthesis/
├── contracts/                    # Foundry project
│   ├── src/
│   │   ├── AgentRegistry.sol
│   │   ├── AgentCapabilityEnforcer.sol
│   │   ├── DelegationTracker.sol
│   │   ├── AgentChainArbiter.sol
│   │   └── libraries/
│   │       ├── CustomRevert.sol
│   │       └── Lock.sol
│   ├── test/                     # Foundry tests
│   ├── script/                   # Deployment scripts
│   ├── lib/                      # forge deps (forge-std, openzeppelin)
│   └── foundry.toml
├── sdk/                          # TypeScript SDK (@agentchain/sdk)
├── demo/                         # Demo scripts (Phase 9)
├── docs/
│   ├── smart-contracts.md        # Canonical Solidity reference (full code)
│   ├── hackathon-credentials.md  # Synthesis registration creds
│   └── superpowers/
│       ├── specs/                # Design specs
│       └── metamask-delegation-toolkit-research.md
└── CLAUDE.md                     # This file
```

**Note:** Run `forge` commands from the `contracts/` directory.

## Commit Message Convention

```
<type>(<scope>): <short description>

<optional body — what and why, not how>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Types:**
- `feat` — new feature or functionality
- `fix` — bug fix
- `refactor` — code restructuring, no behavior change
- `test` — adding or updating tests
- `docs` — documentation only
- `chore` — tooling, config, dependencies
- `deploy` — deployment scripts or config

**Scopes:** `registry`, `enforcer`, `tracker`, `arbiter`, `sdk`, `deploy`, `docs`

**Examples:**
```
feat(registry): add distributeFeesFromStake for trustless sub-agent payment
fix(arbiter): fix tuple destructuring for 6-field Task struct
test(arbiter): add stake-weighted consensus edge case tests
chore(deploy): add Base Sepolia deployment script
```

## Key Rules

- **Solidity version:** Use `pragma solidity 0.8.23;` for enforcer (matches MetaMask), `^0.8.24` for others
- **Custom errors over require strings** — use `CustomRevert` library for gas efficiency
- **No inline assembly** unless absolutely required (and comment heavily)
- **Use SafeERC20** for all token transfers
- **Lock library** for reentrancy (transient storage, cheaper than OZ)
- **All external calls last** — checks-effects-interactions pattern
- **Events for all state changes** — needed for SDK event listeners
- **Canonical reference:** `docs/smart-contracts.md` has the full Solidity code. Implementation must match exactly.

## External Contract Addresses (Base)

```
MetaMask DelegationManager:   0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
ERC-8004 Identity Registry:   0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
ERC-8004 Reputation Registry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
SimpleFactory (HybridDeleGator): 0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c
USDC (Base):                  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```
