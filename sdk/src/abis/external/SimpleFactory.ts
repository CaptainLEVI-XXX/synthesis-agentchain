export const SimpleFactoryAbi = [
  {
    type: 'function',
    name: 'deploy',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'nonpayable',
  },
] as const;
