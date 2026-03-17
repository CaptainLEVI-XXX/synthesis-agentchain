import { describe, it, expect } from 'vitest';
import { matchesCapability, matchesAllCapabilities } from '../src/events/filters.js';
import { capToBytes32 } from '../src/core/registry.js';

describe('matchesCapability', () => {
  it('returns true when capability hash is present', () => {
    const caps = [capToBytes32('defi'), capToBytes32('lending')];
    expect(matchesCapability(caps, 'defi')).toBe(true);
  });

  it('returns false when capability hash is absent', () => {
    const caps = [capToBytes32('defi')];
    expect(matchesCapability(caps, 'data')).toBe(false);
  });
});

describe('matchesAllCapabilities', () => {
  it('returns true when all capabilities present', () => {
    const caps = [capToBytes32('defi'), capToBytes32('lending'), capToBytes32('data')];
    expect(matchesAllCapabilities(caps, ['defi', 'lending'])).toBe(true);
  });

  it('returns false when one is missing', () => {
    const caps = [capToBytes32('defi')];
    expect(matchesAllCapabilities(caps, ['defi', 'lending'])).toBe(false);
  });

  it('returns true for empty requirements', () => {
    const caps = [capToBytes32('defi')];
    expect(matchesAllCapabilities(caps, [])).toBe(true);
  });
});
