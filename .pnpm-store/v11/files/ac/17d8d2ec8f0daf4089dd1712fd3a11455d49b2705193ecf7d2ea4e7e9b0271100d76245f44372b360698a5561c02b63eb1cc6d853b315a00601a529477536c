import { ErrorWithStack } from './helpers/errors';
export type WaitForOptions = {
    timeout?: number;
    interval?: number;
    stackTraceError?: ErrorWithStack;
    onTimeout?: (error: Error) => Error;
};
export declare function waitFor<T>(expectation: () => T, options?: WaitForOptions): Promise<T>;
