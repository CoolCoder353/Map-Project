import type { TestInstance } from 'test-renderer';
import type { PressOptions } from '../press';
import type { ScrollToOptions } from '../scroll';
import type { TypeOptions } from '../type';
export interface UserEventSetupOptions {
    /**
     * Between some subsequent inputs like typing a series of characters
     * the code execution is delayed per `setTimeout` for (at least) `delay` seconds.
     * This moves the next changes at least to next macro task
     * and allows other (asynchronous) code to run between events.
     *
     * `null` prevents `setTimeout` from being called.
     *
     * @default 0
     */
    delay?: number;
    /**
     * Function to be called to advance fake timers. Setting it is necessary for
     * fake timers to work.
     *
     * @example jest.advanceTimersByTime
     */
    advanceTimers?: (delay: number) => Promise<void> | void;
}
/**
 * Creates a new instance of user event instance with the given options.
 *
 * @param options
 * @returns UserEvent instance
 */
export declare function setup(options?: UserEventSetupOptions): UserEventInstance;
/**
 * Options affecting all user event interactions.
 *
 * @param delay between some subsequent inputs like typing a series of characters
 * @param advanceTimers function to be called to advance fake timers
 */
export interface UserEventConfig {
    delay: number;
    advanceTimers: (delay: number) => Promise<void> | void;
}
/**
 * UserEvent instance used to invoke user interaction functions.
 */
export interface UserEventInstance {
    config: UserEventConfig;
    press: (instance: TestInstance) => Promise<void>;
    longPress: (instance: TestInstance, options?: PressOptions) => Promise<void>;
    /**
     * Simulate user pressing on a given `TextInput` element and typing given text.
     *
     * This method will trigger the events for each character of the text:
     * `keyPress`, `change`, `changeText`, `endEditing`, etc.
     *
     * It will also trigger events connected with entering and leaving the text
     * input.
     *
     * The exact events sent depend on the props of the TextInput (`editable`,
     * `multiline`, etc) and passed options.
     *
     * @param instance TextInput instance to type on
     * @param text Text to type
     * @param options Options affecting typing behavior:
     *  - `skipPress` - if true, `pressIn` and `pressOut` events will not be
     *   triggered.
     * - `submitEditing` - if true, `submitEditing` event will be triggered after
     * typing the text.
     */
    type: (instance: TestInstance, text: string, options?: TypeOptions) => Promise<void>;
    /**
     * Simulate user clearing the text of a given `TextInput` element.
     *
     * This method will simulate:
     * 1. entering TextInput
     * 2. selecting all text
     * 3. pressing backspace to delete all text
     * 4. leaving TextInput
     *
     * @param instance TextInput instance to clear
     */
    clear: (instance: TestInstance) => Promise<void>;
    /**
     * Simulate user pasting the text to a given `TextInput` element.
     *
     * This method will simulate:
     * 1. entering TextInput
     * 2. selecting all text
     * 3. paste the text
     * 4. leaving TextInput
     *
     * @param instance TextInput instance to paste to
     */
    paste: (instance: TestInstance, text: string) => Promise<void>;
    /**
     * Simlate user scorlling a ScrollView element.
     *
     * @param instance ScrollView instance
     * @returns
     */
    scrollTo: (instance: TestInstance, options: ScrollToOptions) => Promise<void>;
}
