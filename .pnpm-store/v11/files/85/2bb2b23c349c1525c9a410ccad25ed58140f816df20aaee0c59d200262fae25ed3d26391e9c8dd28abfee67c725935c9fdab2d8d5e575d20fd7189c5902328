import type { TestInstance } from 'test-renderer';
import type { UserEventConfig, UserEventInstance } from '../setup';
export interface TypeOptions {
    skipPress?: boolean;
    submitEditing?: boolean;
    skipBlur?: boolean;
}
export declare function type(this: UserEventInstance, instance: TestInstance, text: string, options?: TypeOptions): Promise<void>;
type EmitTypingEventsContext = {
    config: UserEventConfig;
    key: string;
    text: string;
    isAccepted?: boolean;
};
export declare function emitTypingEvents(instance: TestInstance, { config, key, text, isAccepted }: EmitTypingEventsContext): Promise<void>;
export {};
