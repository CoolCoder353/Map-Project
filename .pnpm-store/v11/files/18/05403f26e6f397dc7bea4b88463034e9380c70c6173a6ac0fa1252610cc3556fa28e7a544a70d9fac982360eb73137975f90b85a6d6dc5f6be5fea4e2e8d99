import type { TestInstance } from 'test-renderer';
import type { PressOptions } from './press';
import type { ScrollToOptions } from './scroll';
import { setup } from './setup';
import type { TypeOptions } from './type';
export { UserEventConfig } from './setup';
export declare const userEvent: {
    setup: typeof setup;
    press: (instance: TestInstance) => Promise<void>;
    longPress: (instance: TestInstance, options?: PressOptions) => Promise<void>;
    type: (instance: TestInstance, text: string, options?: TypeOptions) => Promise<void>;
    clear: (instance: TestInstance) => Promise<void>;
    paste: (instance: TestInstance, text: string) => Promise<void>;
    scrollTo: (instance: TestInstance, options: ScrollToOptions) => Promise<void>;
};
