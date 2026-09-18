import * as React from 'react';
import type { RefObject } from './types';
export type RenderHookResult<Result, Props> = {
    result: RefObject<Result>;
    rerender: (props: Props) => Promise<void>;
    unmount: () => Promise<void>;
};
export type RenderHookOptions<Props> = {
    /**
     * The initial props to pass to the hook.
     */
    initialProps?: Props;
    /**
     * Pass a React Component as the wrapper option to have it rendered around the inner element. This is most useful for creating
     * reusable custom render functions for common data providers.
     */
    wrapper?: React.ComponentType<any>;
};
export declare function renderHook<Result, Props>(hookToRender: (props: Props) => Result, options?: RenderHookOptions<NoInfer<Props>>): Promise<RenderHookResult<Result, Props>>;
