import { describe, it, expect } from 'vitest';
import { UniswapApiClient } from '../src/api.js';
import { TRADING_API_BASE_URL } from '../src/types.js';

describe('UniswapApiClient', () => {
  it('constructs with API key', () => {
    const client = new UniswapApiClient('test-api-key');
    expect(client).toBeDefined();
  });

  it('builds correct request headers', () => {
    const client = new UniswapApiClient('test-api-key');
    const headers = client.getHeaders();
    expect(headers['x-api-key']).toBe('test-api-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('builds correct URL for endpoints', () => {
    const client = new UniswapApiClient('test-api-key');
    expect(client.url('/quote')).toBe(`${TRADING_API_BASE_URL}/quote`);
    expect(client.url('/check_approval')).toBe(`${TRADING_API_BASE_URL}/check_approval`);
    expect(client.url('/swap')).toBe(`${TRADING_API_BASE_URL}/swap`);
    expect(client.url('/order')).toBe(`${TRADING_API_BASE_URL}/order`);
  });
});
