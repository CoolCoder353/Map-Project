import type { JsonNode, TestInstance } from 'test-renderer';
import type { MapPropsFunction } from './map-props';
export type FormatElementOptions = {
    /** Minimize used space. */
    compact?: boolean;
    /** Highlight the output. */
    highlight?: boolean;
    /** Filter or map props to display. */
    mapProps?: MapPropsFunction | null;
};
/***
 * Format given instance as a pretty-printed string.
 *
 * @param instance Instance to format.
 */
export declare function formatElement(instance: TestInstance | null, { compact, highlight, mapProps }?: FormatElementOptions): string;
export declare function formatElementList(instances: TestInstance[], options?: FormatElementOptions): string;
export declare function formatJson(json: JsonNode | JsonNode[], { compact, highlight, mapProps }?: FormatElementOptions): string;
