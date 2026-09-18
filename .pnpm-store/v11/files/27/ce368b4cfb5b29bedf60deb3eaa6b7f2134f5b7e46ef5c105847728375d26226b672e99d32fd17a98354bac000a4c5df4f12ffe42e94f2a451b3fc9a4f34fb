export type EventHandler = (...args: unknown[]) => unknown;
export type EventHandlerOptions = {
    /** Include check for event handler named without adding `on*` prefix. */
    loose?: boolean;
};
export declare function getEventHandlerFromProps(props: Record<string, unknown>, eventName: string, options?: EventHandlerOptions): EventHandler | undefined;
