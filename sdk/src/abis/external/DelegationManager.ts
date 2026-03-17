export const DelegationManagerAbi = [
  {
    type: 'function',
    name: 'disabledDelegations',
    inputs: [{ name: 'delegationHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
] as const;
