# AgentChain Protocol Reference

This document describes how to interact with the AgentChain protocol on Base Sepolia.
Every agent must understand these operations to participate in the network.

## Contract Addresses (Base Sepolia)

```
AgentRegistry:            0xa5bF9723b9E286bBa502617A8A6D2f24cBdEbf62
DelegationTracker:        0xe0585a939E2C128d1Ff8F4C681529A2AB8f9917d
AgentCapabilityEnforcer:  0xB06D7126abe20eb8B8850db354bd59EFD6a8a2Ff
AgentChainArbiter:        0xf9276b374eF30806b62119027a1e4251A4AD8Cf5
DelegationManager:        0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
USDC:                     0x036CbD53842c5426634e7929541eC2318f3dCF7e
EAS:                      0x4200000000000000000000000000000000000021
```

## Smart Account Addresses (MetaMask SDK — current)

```
LPAgent:     0xb378619B36F027FA54289498759f914c1322479A  (salt: agentchain-lp-v2)
SwapAgent:   0x086d25AA4Ce248e1Ca493232D02a5eec768fB0d7  (salt: agentchain-swap-v2)
PriceAgent:  0x7C303e5Dcbd7c77fb8fFAe3D6a6D648DbA955Dbd  (salt: agentchain-price-v2)
HooksAgent:  0xdfaC98E739f6318866EC009fC5AfC2B8dCa2c91E  (salt: agentchain-hooks-v2)
User:        0x893406ba1f66a1eb39834506092B126e63dd126F  (salt: agentchain-user-v2)

EOA Signer:  0x4741b6F3CE01C4ac1C387BC9754F31c1c93866F0
All smart accounts are HybridDeleGator (ERC-4337) deployed via SimpleFactory, controlled by the EOA signer.
```

## Bundler

Use Pimlico's free public bundler for Base Sepolia:
```
https://public.pimlico.io/v2/84532/rpc
```

EntryPoint v0.7: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

## How to Read a Task

Call `DelegationTracker.getTask(bytes32 taskId)` which returns:
```
Task {
  address creator,        // who posted the intent
  address orchestrator,   // who claimed it (address(0) if unclaimed)
  uint8 status,           // 0=Open, 1=Accepted, 2=Completed, 3=Expired
  uint256 deadline,       // unix timestamp
  uint256 delegationCount,
  uint256 deposit,        // total USDC amount
  bool hasEscrow,         // true if Alkahest escrow, false if delegation-only
  string intent           // human-readable task description
}
```

## How to Claim a Task

Call `DelegationTracker.claimTask(bytes32 taskId)` from your registered address.
Requirements:
- Task status must be Open
- Current time must be before deadline
- Caller must be registered in AgentRegistry (isRegistered == true)

After claiming: status becomes Accepted, you become the orchestrator.

## How to Submit a Work Record

Call `DelegationTracker.submitWorkRecord(bytes32 taskId, bytes32 resultHash, string summary)`
Requirements:
- You must be a delegated agent for this task (isDelegated[taskId][you] == true)
- Task status must be Accepted
- You haven't already submitted for this task

resultHash = keccak256 of your proof (e.g., swap TxID, price data hash)
summary = human-readable description of what you did

## How to Sign a Delegation (EIP-712)

To delegate work to a sub-agent, sign a MetaMask Delegation:

EIP-712 Domain:
```
name: "DelegationManager"
version: "1"
chainId: 84532
verifyingContract: 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
```

Delegation struct:
```
Delegation {
  address delegate,     // sub-agent's smart account
  address delegator,    // your smart account
  bytes32 authority,    // ROOT_AUTHORITY = 0xfff...fff
  Caveat[] caveats,     // [{enforcer, terms}]
  uint256 salt          // unique nonce
}
```

AgentTerms (encoded in caveat terms):
```
AgentTerms {
  bytes32 taskId,
  uint8 maxDepth,
  uint8 currentDepth,
  uint256 minStake,
  uint256 fee,           // USDC fee promised to sub-agent
  bytes32[] requiredCaps // capability hashes sub-agent must have
}
```

## How to Redeem a Delegation

Call `DelegationManager.redeemDelegations(permissionContexts, modes, executionCallDatas)` via a UserOperation through the bundler.

This triggers:
1. AgentCapabilityEnforcer.beforeHook — validates agent qualifications
2. Action executes through delegator's smart account
3. AgentCapabilityEnforcer.afterHook — records delegation hop on-chain

## How Fees Work

- Fees are promised in the delegation's AgentTerms.fee field
- Recorded on-chain via recordDelegation when delegation is redeemed
- At settlement: agents with work records get their promised fees from the feePool
- Orchestrator gets the remaining feePool (their margin)

## Capability Hashes

Capabilities are registered as keccak256 hashes:
```
"uniswap-swap"    → keccak256("uniswap-swap")
"uniswap-lp"      → keccak256("uniswap-lp")
"uniswap-price"   → keccak256("uniswap-price")
"uniswap-hooks"   → keccak256("uniswap-hooks")
"uniswap-gasless" → keccak256("uniswap-gasless")
```

## CRITICAL: Complete Orchestrator Flow (Step-by-Step)

**If you are an orchestrator (e.g., LPAgent), you MUST follow this exact sequence.
Skipping any step will break the protocol. Every step is an on-chain UserOperation.**

```
STEP 1: CLAIM THE TASK
  ─────────────────────
  IMMEDIATELY after receiving a task, claim it on-chain.
  This makes you the orchestrator and prevents other agents from claiming.

  await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [{ to: DELEGATION_TRACKER, data: encodeFunctionData({
      abi: trackerAbi, functionName: 'claimTask', args: [taskId]
    })}],
  });

STEP 2: ANALYZE THE INTENT
  ─────────────────────────
  Read pool state, check prices, decide strategy.
  This is off-chain (publicClient.readContract) — no UserOp needed.

STEP 3: DELEGATE TO SUB-AGENTS
  ─────────────────────────────
  Send HTTP POST to sub-agent servers with the sub-task.
  The sub-agent executes and returns a result.
  Example: POST http://localhost:3002/task { taskId, subIntent: "Swap 0.005 ETH to USDC" }

STEP 4: EXECUTE YOUR OWN WORK
  ────────────────────────────
  Perform your own on-chain actions (e.g., mint LP position).
  Use bundlerClient.sendUserOperation with batched calls.

STEP 5: SUBMIT WORK RECORD
  ─────────────────────────
  After ALL work is done (yours + sub-agents), submit your proof on-chain.
  resultHash = keccak256 of your main tx hash (the LP mint, swap, etc.)
  summary = human-readable description of what was accomplished.

  await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [{ to: DELEGATION_TRACKER, data: encodeFunctionData({
      abi: trackerAbi, functionName: 'submitWorkRecord',
      args: [taskId, resultHash, summary]
    })}],
  });

  You can BATCH claimTask + submitWorkRecord in a single UserOp if you
  do all work before submitting:

  await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [
      { to: DELEGATION_TRACKER, data: claimTaskCalldata },
      { to: DELEGATION_TRACKER, data: submitWorkRecordCalldata },
    ],
  });

STEP 6: WRITE RESULT TO OUTBOX
  ─────────────────────────────
  Write the result JSON to outbox/{taskId}.json so the HTTP server returns it.

NOTE: Settlement (settleAndRate) is called by the USER (task creator), NOT the agent.
```

## CRITICAL: Complete Worker Flow (Step-by-Step)

**If you are a worker agent (e.g., SwapAgent), you MUST follow this sequence
when you receive a sub-task via HTTP.**

```
STEP 1: READ THE TASK
  ────────────────────
  Read inbox/{taskId}.json to get the task details.

STEP 2: CALL UNISWAP TRADING API FIRST
  ──────────────────────────────────────
  ALWAYS call the Trading API before direct contracts (logs API key usage):
  - POST /check_approval (works on Base Sepolia)
  - POST /quote (may return "No quotes" on Base Sepolia — that's OK)

STEP 3: EXECUTE ON-CHAIN
  ───────────────────────
  If /quote returned a valid quote → use Trading API /swap flow.
  If "No quotes" → fall back to direct contract calls via UserOp.

  Use bundlerClient.sendUserOperation with batched calls:
  wrap ETH + approve + swap in ONE atomic UserOp.

STEP 4: SUBMIT WORK RECORD
  ─────────────────────────
  Submit proof of your work on-chain:

  await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [{ to: DELEGATION_TRACKER, data: encodeFunctionData({
      abi: trackerAbi, functionName: 'submitWorkRecord',
      args: [taskId, keccak256(txHash), "SWAP_EXECUTED|WETH->USDC|0.005ETH"]
    })}],
  });

STEP 5: WRITE RESULT TO OUTBOX
  ─────────────────────────────
  Write result JSON to outbox/{taskId}.json:
  {
    "taskId": "0x...",
    "success": true,
    "resultHash": "0x...",
    "summary": "SWAP_EXECUTED|...",
    "txHash": "0x..."
  }
```

## DelegationTracker ABI (for UserOps)

```typescript
const trackerAbi = [
  { name: 'claimTask', type: 'function',
    inputs: [{ name: 'taskId', type: 'bytes32' }],
    outputs: [], stateMutability: 'nonpayable' },
  { name: 'submitWorkRecord', type: 'function',
    inputs: [
      { name: 'taskId', type: 'bytes32' },
      { name: 'resultHash', type: 'bytes32' },
      { name: 'summary', type: 'string' },
    ],
    outputs: [], stateMutability: 'nonpayable' },
  { name: 'getTask', type: 'function',
    inputs: [{ name: 'taskId', type: 'bytes32' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'creator', type: 'address' },
      { name: 'orchestrator', type: 'address' },
      { name: 'status', type: 'uint8' },
      { name: 'deadline', type: 'uint256' },
      { name: 'delegationCount', type: 'uint256' },
      { name: 'deposit', type: 'uint256' },
      { name: 'hasEscrow', type: 'bool' },
      { name: 'intent', type: 'string' },
    ]}],
    stateMutability: 'view' },
] as const;

const DELEGATION_TRACKER = '0xe0585a939E2C128d1Ff8F4C681529A2AB8f9917d';
```

## RPC + Chain + Signing

```
Chain: Base Sepolia (chainId 84532)
RPC: https://base-sepolia.infura.io/v3/44bdf2d1c8594cc9b16832398af754d7
Bundler: https://public.pimlico.io/v2/84532/rpc
USDC Decimals: 6
EOA Private Key: Read from AGENT_PRIVATE_KEY env variable
```

**IMPORTANT: Every agent is an ERC-4337 smart account (HybridDeleGator).** The agent does
NOT send transactions directly. Instead, the EOA signer signs UserOperations, which are
submitted through the Pimlico bundler → EntryPoint → Smart Account → target contract.

All agents were deployed via `@metamask/smart-accounts-kit` using the same EOA signer
with different salts. Use the same pattern for all on-chain writes.

### Agent Smart Account Salts

```
LPAgent:    keccak256(toBytes('agentchain-lp-v2'))
SwapAgent:  keccak256(toBytes('agentchain-swap-v2'))
PriceAgent: keccak256(toBytes('agentchain-price-v2'))
HooksAgent: keccak256(toBytes('agentchain-hooks-v2'))
```

### How to Set Up Clients (MetaMask Smart Accounts Kit)

```typescript
import { createPublicClient, http, keccak256, toBytes } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createBundlerClient } from 'viem/account-abstraction';
import { Implementation, toMetaMaskSmartAccount } from '@metamask/smart-accounts-kit';

// 1. EOA signer (signs UserOperations on behalf of the smart account)
const eoaSigner = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const transport = http('https://base-sepolia.infura.io/v3/44bdf2d1c8594cc9b16832398af754d7');

// 2. Public client (for read calls — no UserOp needed)
const publicClient = createPublicClient({ chain: baseSepolia, transport });

// 3. Bundler client (for sending UserOperations)
const bundlerClient = createBundlerClient({
  client: publicClient,
  transport: http('https://public.pimlico.io/v2/84532/rpc'),
});

// 4. Smart account (replace salt with YOUR agent's salt)
const smartAccount = await toMetaMaskSmartAccount({
  client: publicClient,
  implementation: Implementation.Hybrid,
  deployParams: [eoaSigner.address, [], [], []],
  deploySalt: keccak256(toBytes('agentchain-swap-v2')), // ← your agent's salt
  signer: { account: eoaSigner },
});

console.log('Smart account address:', smartAccount.address);
// This address matches the on-chain deployed address for this salt
```

### How to Send a Transaction (via UserOperation)

**All on-chain writes MUST go through UserOperations.** Do NOT use `walletClient.sendTransaction()`.

```typescript
// Single call
const userOpHash = await bundlerClient.sendUserOperation({
  account: smartAccount,
  calls: [{
    to: targetAddress,
    data: calldata,
    value: 0n,
  }],
});
const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
// receipt.receipt.transactionHash is the on-chain TxID
// receipt.success === true means it worked
```

### How to Batch Multiple Calls in One UserOp

```typescript
// Batch: approve + swap in a single atomic UserOperation
const userOpHash = await bundlerClient.sendUserOperation({
  account: smartAccount,
  calls: [
    {
      to: USDC_ADDRESS,
      data: encodeFunctionData({
        abi: erc20Abi, functionName: 'approve',
        args: [SWAP_ROUTER, amount],
      }),
    },
    {
      to: SWAP_ROUTER,
      data: encodeFunctionData({
        abi: swapRouterAbi, functionName: 'exactInputSingle',
        args: [swapParams],
      }),
    },
  ],
});
const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
```

### How to Read On-Chain Data (no UserOp needed)

Read calls go directly through `publicClient` — no bundler or smart account needed:

```typescript
const balance = await publicClient.readContract({
  address: USDC_ADDRESS,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [smartAccount.address],
});
```

### How to Sign Permit2 Typed Data

When the Uniswap Trading API `/quote` response includes `permitData`, sign it with the EOA:

```typescript
if (quoteResponse.permitData) {
  const signature = await eoaSigner.signTypedData({
    domain: quoteResponse.permitData.domain,
    types: quoteResponse.permitData.types,
    primaryType: Object.keys(quoteResponse.permitData.types).find(k => k !== 'EIP712Domain'),
    message: quoteResponse.permitData.values,
  });
  // Include this signature in the /swap request
}
```

## Uniswap API Key

```
API Key: ROJIY7LJX4Nxxn80pLRzcIxngHX8dl9SRWrFL0qGN7g
Base URL: https://trade-api.gateway.uniswap.org/v1
Required Headers:
  Content-Type: application/json
  x-api-key: ROJIY7LJX4Nxxn80pLRzcIxngHX8dl9SRWrFL0qGN7g
  x-universal-router-version: 2.0
```

## Uniswap V3 Direct Contract Interaction (Base Sepolia)

**IMPORTANT:** The Uniswap Trading API's token list is empty for Base Sepolia, so `/quote`
returns `"No quotes available"` even though pools with real liquidity exist on-chain.
However, `/check_approval` DOES work on Base Sepolia.

### API-First Strategy (ALL agents MUST follow this)

```
1. ALWAYS call /check_approval via Trading API first (works on Base Sepolia — logs API usage)
2. ALWAYS call /quote via Trading API (logs API usage even if it fails)
3. IF /quote succeeds → use the Trading API /swap flow (works on Ethereum Sepolia + mainnets)
4. IF /quote returns "No quotes available" → fall back to direct contract calls below
```

This ensures our Uniswap API key shows real request volume on their servers, while still
getting working swaps via direct contract calls on Base Sepolia.

### Base Sepolia Uniswap V3 Addresses

```
V3Factory:                    0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24
SwapRouter02:                 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4
NonfungiblePositionManager:   0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2
UniversalRouter:              0x050E797f3625EC8785265e1d9BDd4799b97528A1
WETH:                         0x4200000000000000000000000000000000000006
USDC:                         0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

### Known Pools with Liquidity (WETH/USDC)

```
500bp  pool: 0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0  (liquidity: 1.527e11)
3000bp pool: 0x46880b404CD35c165EDdefF7421019F8dD25F4Ad  (liquidity: 1.396e13, BEST)
10000bp pool: 0x4664755562152EDDa3a3073850FB62835451926a (liquidity: 5.773e10)

token0 = USDC (0x036Cb...), token1 = WETH (0x4200...)
```

The **3000bp pool has the deepest liquidity** — use it as the default.

### How to Swap Directly (Base Sepolia) — via UserOperation

All swaps go through the smart account via UserOperations. Use `bundlerClient.sendUserOperation()`.
You can batch wrap + approve + swap in a single atomic UserOp.

```typescript
import { encodeFunctionData, parseEther } from 'viem';

const SWAP_ROUTER = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const swapRouterAbi = [{
  name: 'exactInputSingle', type: 'function',
  inputs: [{ type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' },
    { name: 'tokenOut', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'recipient', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'amountOutMinimum', type: 'uint256' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ]}],
  outputs: [{ type: 'uint256' }], stateMutability: 'payable',
}];

const erc20ApproveAbi = [{ name: 'approve', type: 'function',
  inputs: [{ type: 'address' }, { type: 'uint256' }],
  outputs: [{ type: 'bool' }] }];

// Batch: wrap ETH + approve WETH + swap — all in ONE UserOperation
const userOpHash = await bundlerClient.sendUserOperation({
  account: smartAccount,
  calls: [
    // Step 1: Wrap ETH → WETH (send ETH to WETH contract)
    { to: WETH, value: parseEther('0.001') },
    // Step 2: Approve WETH to SwapRouter02
    {
      to: WETH,
      data: encodeFunctionData({
        abi: erc20ApproveAbi, functionName: 'approve',
        args: [SWAP_ROUTER, parseEther('0.001')],
      }),
    },
    // Step 3: Execute swap
    {
      to: SWAP_ROUTER,
      data: encodeFunctionData({
        abi: swapRouterAbi, functionName: 'exactInputSingle',
        args: [{
          tokenIn: WETH,
          tokenOut: USDC,
          fee: 3000,
          recipient: smartAccount.address,  // tokens go to the smart account
          amountIn: parseEther('0.001'),
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        }],
      }),
    },
  ],
});

const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
// receipt.receipt.transactionHash is the on-chain TxID
// receipt.success === true means swap completed
```

### How to Read Pool Prices Directly (Base Sepolia)

```typescript
const V3_FACTORY = '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';

// Get pool address
const poolAddress = await publicClient.readContract({
  address: V3_FACTORY,
  abi: [{ name: 'getPool', type: 'function',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }],
    outputs: [{ type: 'address' }], stateMutability: 'view' }],
  functionName: 'getPool',
  args: [WETH, USDC, 3000],
});

// Read slot0 for price
const [sqrtPriceX96, tick] = await publicClient.readContract({
  address: poolAddress,
  abi: [{ name: 'slot0', type: 'function', inputs: [],
    outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' },
      { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }],
    stateMutability: 'view' }],
  functionName: 'slot0',
});

// Read liquidity
const liquidity = await publicClient.readContract({
  address: poolAddress,
  abi: [{ name: 'liquidity', type: 'function', inputs: [],
    outputs: [{ type: 'uint128' }], stateMutability: 'view' }],
  functionName: 'liquidity',
});

// Convert sqrtPriceX96 to human price
// token0 = USDC (6 decimals), token1 = WETH (18 decimals)
// price_token1_in_token0 = (sqrtPriceX96 / 2^96)^2 * 10^(6-18)
// This gives WETH price in USDC
```
