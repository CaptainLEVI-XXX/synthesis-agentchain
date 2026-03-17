export const AgentChainArbiterAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_tracker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_delegationManager",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_reputation",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_agentRegistry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "agentRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IAgentRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "checkStatement",
    "inputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Attestation",
        "components": [
          {
            "name": "uid",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "schema",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "time",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expirationTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "revocationTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "refUID",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "attester",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "recipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "revocable",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "data",
            "type": "bytes",
            "internalType": "bytes"
          }
        ]
      },
      {
        "name": "demand",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "delegationManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IDelegationManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "disputeAgent",
    "inputs": [
      {
        "name": "taskId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "agentAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "feedbackURI",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "feedbackHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "reputation",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IReputationRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settleAndRate",
    "inputs": [
      {
        "name": "taskId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "rating",
        "type": "int128",
        "internalType": "int128"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tracker",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IDelegationTracker"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ReputationSubmitted",
    "inputs": [
      {
        "name": "taskId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "agentCount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "rating",
        "type": "int128",
        "indexed": false,
        "internalType": "int128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TaskVerified",
    "inputs": [
      {
        "name": "taskId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "workRecordCount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "stakeWeightedScore",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "allDelegationsIntact",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "InvalidRating",
    "inputs": [
      {
        "name": "value",
        "type": "int128",
        "internalType": "int128"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidThreshold",
    "inputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotTaskCreator",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TaskNotAccepted",
    "inputs": [
      {
        "name": "taskId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  }
] as const;
