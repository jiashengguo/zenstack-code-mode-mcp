import { AsyncLocalStorage } from 'node:async_hooks';

export const userContext = new AsyncLocalStorage<string>();
