import type { PressableProps, ScrollViewProps, TextInputProps, TextProps, ViewProps } from 'react-native';
import type { TestInstance } from 'test-renderer';
import type { StringWithAutocomplete } from './types';
type EventNameExtractor<T> = keyof {
    [K in keyof T as K extends `on${infer Rest}` ? Uncapitalize<Rest> : never]: T[K];
};
type EventName = StringWithAutocomplete<EventNameExtractor<ViewProps> | EventNameExtractor<TextProps> | EventNameExtractor<TextInputProps> | EventNameExtractor<PressableProps> | EventNameExtractor<ScrollViewProps>>;
declare function fireEvent(instance: TestInstance, eventName: EventName, ...data: unknown[]): Promise<undefined>;
declare namespace fireEvent {
    var changeText: (instance: TestInstance, text: string) => Promise<undefined>;
    var press: (instance: TestInstance, eventProps?: EventProps) => Promise<void>;
    var scroll: (instance: TestInstance, eventProps?: EventProps) => Promise<void>;
}
type EventProps = Record<string, unknown>;
export { fireEvent };
