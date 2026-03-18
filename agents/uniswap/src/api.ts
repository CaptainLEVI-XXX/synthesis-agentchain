import { TRADING_API_BASE_URL } from './types.js';

export class UniswapApiClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  getHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  url(path: string): string {
    return `${TRADING_API_BASE_URL}${path}`;
  }

  async post<T>(path: string, body: object): Promise<T> {
    const response = await fetch(this.url(path), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Uniswap API ${path} failed (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const searchParams = params ? '?' + new URLSearchParams(params).toString() : '';
    const response = await fetch(this.url(path) + searchParams, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Uniswap API ${path} failed (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }
}
