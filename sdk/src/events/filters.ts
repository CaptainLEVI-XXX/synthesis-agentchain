import type { Hex } from 'viem';
import { capToBytes32 } from '../core/registry.js';

export function matchesCapability(
  agentCaps: Hex[],
  requiredCapability: string,
): boolean {
  const targetHash = capToBytes32(requiredCapability);
  return agentCaps.includes(targetHash);
}

export function matchesAllCapabilities(
  agentCaps: Hex[],
  requiredCapabilities: string[],
): boolean {
  return requiredCapabilities.every((cap) =>
    matchesCapability(agentCaps, cap),
  );
}
