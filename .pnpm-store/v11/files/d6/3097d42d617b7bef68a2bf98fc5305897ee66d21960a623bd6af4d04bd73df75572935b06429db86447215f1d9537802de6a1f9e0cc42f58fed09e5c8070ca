import type { AccessibilityRole, AccessibilityState, AccessibilityValue, Role } from 'react-native';
import type { TestInstance } from 'test-renderer';
type IsInaccessibleOptions = {
    cache?: WeakMap<TestInstance, boolean>;
};
export declare const accessibilityStateKeys: (keyof AccessibilityState)[];
export declare const accessibilityValueKeys: (keyof AccessibilityValue)[];
export declare function isHiddenFromAccessibility(instance: TestInstance | null, { cache }?: IsInaccessibleOptions): boolean;
/** RTL-compatibility alias for `isHiddenFromAccessibility` */
export declare const isInaccessible: typeof isHiddenFromAccessibility;
export declare function isAccessibilityElement(instance: TestInstance | null): boolean;
/**
 * Returns the accessibility role for given element. It will return explicit
 * role from either `role` or `accessibilityRole` props if set.
 *
 * If explicit role is not available, it would try to return default element
 * role:
 * - `text` for `Text` elements
 *
 * In all other cases this functions returns `none`.
 *
 * @param instance
 * @returns
 */
export declare function getRole(instance: TestInstance): Role | AccessibilityRole;
/**
 * There are some duplications between (ARIA) `Role` and `AccessibilityRole` types.
 * Resolve them by using ARIA `Role` type where possible.
 *
 * @param role Role to normalize
 * @returns Normalized role
 */
export declare function normalizeRole(role: string): Role | AccessibilityRole;
export declare function computeAriaModal(instance: TestInstance): boolean | undefined;
export declare function computeAriaLabel(instance: TestInstance): string | undefined;
export declare function computeAriaBusy({ props }: TestInstance): boolean;
export declare function computeAriaChecked(instance: TestInstance): AccessibilityState['checked'];
export declare function computeAriaDisabled(instance: TestInstance): boolean;
export declare function computeAriaExpanded({ props }: TestInstance): boolean | undefined;
export declare function computeAriaSelected({ props }: TestInstance): boolean;
export declare function computeAriaValue(instance: TestInstance): AccessibilityValue;
type ComputeAccessibleNameOptions = {
    root?: boolean;
};
export declare function computeAccessibleName(instance: TestInstance, options?: ComputeAccessibleNameOptions): string | undefined;
type RoleSupportMap = Partial<Record<Role | AccessibilityRole, true>>;
export declare const rolesSupportingCheckedState: RoleSupportMap;
export {};
