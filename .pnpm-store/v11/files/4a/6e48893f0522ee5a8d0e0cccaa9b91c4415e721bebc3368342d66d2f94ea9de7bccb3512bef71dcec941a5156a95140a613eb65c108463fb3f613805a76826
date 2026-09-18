Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let react = require("react");
let react_reconciler_constants_js = require("react-reconciler/constants.js");
let react_reconciler = require("react-reconciler");
react_reconciler = __toESM(react_reconciler);
//#region src/constants.ts
const Tag = {
	Container: "CONTAINER",
	Instance: "INSTANCE",
	Text: "TEXT"
};
//#endregion
//#region src/performance.ts
function mark(name, details) {
	if (!globalThis.TEST_RENDERER_ENABLE_PROFILING) return;
	performance.mark(`test-renderer/${name}`, { detail: details });
}
function measureStart(name) {
	if (!globalThis.TEST_RENDERER_ENABLE_PROFILING) return;
	performance.mark(`test-renderer/${name}:start`);
}
function measureEnd(name, details) {
	if (!globalThis.TEST_RENDERER_ENABLE_PROFILING) return;
	performance.mark(`test-renderer/${name}:end`);
	performance.measure(`test-renderer/${name}`, {
		start: `test-renderer/${name}:start`,
		end: `test-renderer/${name}:end`,
		detail: details
	});
}
//#endregion
//#region src/query-all.ts
/**
* Find all descendant elements matching the predicate.
*
* @param instance - Root TestInstance to search from.
* @param predicate - Function that returns true for matching elements.
* @param options - Optional query configuration.
* @returns Array of matching elements in tree order.
*/
function queryAll(instance, predicate, options) {
	const includeSelf = options?.includeSelf ?? false;
	const matchDeepestOnly = options?.matchDeepestOnly ?? false;
	const results = [];
	const matchingDescendants = [];
	instance.children.forEach((child) => {
		if (typeof child === "string") return;
		matchingDescendants.push(...queryAll(child, predicate, {
			...options,
			includeSelf: true
		}));
	});
	if (includeSelf && (matchingDescendants.length === 0 || !matchDeepestOnly) && predicate(instance)) results.push(instance);
	results.push(...matchingDescendants);
	return results;
}
//#endregion
//#region src/to-json.ts
function containerToJson(container) {
	return {
		type: "",
		props: {},
		children: childrenToJson(container.children),
		$$typeof: Symbol.for("react.test.json")
	};
}
function instanceToJson(instance) {
	const shouldExcludeHidden = instance.rootContainer.config.transformHiddenInstanceProps == null;
	if (instance.isHidden && shouldExcludeHidden) return null;
	const { children: _children, ...restProps } = instance.props;
	return {
		type: instance.type,
		props: restProps,
		children: childrenToJson(instance.children),
		$$typeof: Symbol.for("react.test.json")
	};
}
function textInstanceToJson(instance) {
	const shouldExcludeHidden = instance.rootContainer.config.transformHiddenInstanceProps == null;
	if (instance.isHidden && shouldExcludeHidden) return null;
	return instance.text;
}
function childrenToJson(children) {
	const result = [];
	for (const child of children) if (child.tag === Tag.Instance) {
		const renderedChild = instanceToJson(child);
		if (renderedChild != null) result.push(renderedChild);
	} else {
		const renderedChild = textInstanceToJson(child);
		if (renderedChild != null) result.push(renderedChild);
	}
	return result;
}
//#endregion
//#region src/test-instance.ts
const instanceMap = /* @__PURE__ */ new WeakMap();
/**
* Represents a rendered host element in the test renderer tree.
* Provides a DOM-like API for querying and inspecting rendered components.
*/
var TestInstance = class TestInstance {
	constructor(instance) {
		this.instance = instance;
	}
	/** The element type (e.g., "div", "span"). Empty string for container. */
	get type() {
		return this.instance.tag === Tag.Instance ? this.instance.type : "";
	}
	/** The element's props object. */
	get props() {
		return this.instance.tag === Tag.Instance ? this.instance.props : {};
	}
	/** The parent element, or null if this is the root container. */
	get parent() {
		const parentInstance = this.instance.parent;
		if (parentInstance == null) return null;
		return TestInstance.fromInstance(parentInstance);
	}
	/** Array of child nodes (elements and text strings). Hidden children are excluded by default. */
	get children() {
		const shouldExcludeHiddenChildren = (this.instance.tag === Tag.Container ? this.instance : this.instance.rootContainer).config.transformHiddenInstanceProps == null;
		return this.instance.children.filter((child) => !child.isHidden || !shouldExcludeHiddenChildren).map((child) => getTestNodeForInstance(child));
	}
	/**
	* Access to the underlying React Fiber node. This is an unstable API that exposes
	* internal react-reconciler structures which may change without warning in future
	* React versions. Use with caution and only when absolutely necessary.
	*
	* @returns The Fiber node for this instance, or null if this is a container.
	*/
	get unstable_fiber() {
		return this.instance.tag === Tag.Instance ? this.instance.unstable_fiber : null;
	}
	/**
	* Convert this element to a JSON representation suitable for snapshots.
	*
	* @returns JSON element or null if the element is hidden and hidden nodes are excluded.
	*/
	toJSON() {
		return this.instance.tag === Tag.Container ? containerToJson(this.instance) : instanceToJson(this.instance);
	}
	/**
	* Find all descendant elements matching the predicate.
	*
	* @param predicate - Function that returns true for matching elements.
	* @param options - Optional query configuration.
	* @returns Array of matching elements.
	*/
	queryAll(predicate, options) {
		return queryAll(this, predicate, options);
	}
	/** @internal */
	static fromInstance(instance) {
		const testInstance = instanceMap.get(instance);
		if (testInstance) return testInstance;
		const result = new TestInstance(instance);
		instanceMap.set(instance, result);
		return result;
	}
};
function getTestNodeForInstance(instance) {
	switch (instance.tag) {
		case Tag.Text: return instance.text;
		case Tag.Instance: return TestInstance.fromInstance(instance);
	}
}
//#endregion
//#region src/test-utils/react-constants.ts
const REACT_CONTEXT_TYPE = Symbol.for("react.context");
//#endregion
//#region src/utils.ts
function formatComponentList(names) {
	if (names.length === 0) return "";
	if (names.length === 1) return `<${names[0]}>`;
	if (names.length === 2) return `<${names[0]}> or <${names[1]}>`;
	const allButLast = names.slice(0, -1);
	const last = names[names.length - 1];
	return `${allButLast.map((name) => `<${name}>`).join(", ")}, or <${last}>`;
}
//#endregion
//#region src/reconciler.ts
const nodeToInstanceMap = /* @__PURE__ */ new WeakMap();
let currentUpdatePriority = react_reconciler_constants_js.NoEventPriority;
const hostConfig = {
	supportsMutation: true,
	supportsPersistence: false,
	createInstance(type, props, rootContainer, _hostContext, internalHandle) {
		mark("reconciler/createInstance", { type });
		return {
			tag: Tag.Instance,
			type,
			props,
			propsBeforeHiding: null,
			isHidden: false,
			children: [],
			parent: null,
			rootContainer,
			unstable_fiber: internalHandle
		};
	},
	createTextInstance(text, rootContainer, hostContext, _internalHandle) {
		mark("reconciler/createTextInstance", { text });
		if (rootContainer.config.textComponentTypes && !hostContext.isInsideText) {
			const componentTypes = rootContainer.config.publicTextComponentTypes ?? rootContainer.config.textComponentTypes;
			throw new Error(`Invariant Violation: Text strings must be rendered within a ${formatComponentList(componentTypes)} component. Detected attempt to render "${text}" string within a <${hostContext.type}> component.`);
		}
		return {
			tag: Tag.Text,
			text,
			parent: null,
			rootContainer,
			isHidden: false
		};
	},
	appendInitialChild(parentInstance, child) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/appendInitialChild", {
			parentType: parentInstance.type,
			childType: formatInstanceType(child)
		});
		appendChild(parentInstance, child);
	},
	finalizeInitialChildren(instance, _type, _props, _rootContainer, _hostContext) {
		mark("reconciler/finalizeInitialChildren", { type: instance.type });
		return false;
	},
	shouldSetTextContent(type, _props) {
		mark("reconciler/shouldSetTextContent", {
			type,
			result: false
		});
		return false;
	},
	setCurrentUpdatePriority(priority) {
		mark("reconciler/setCurrentUpdatePriority", { priority });
		currentUpdatePriority = priority;
	},
	getCurrentUpdatePriority() {
		return currentUpdatePriority;
	},
	resolveUpdatePriority() {
		const priority = currentUpdatePriority || react_reconciler_constants_js.DefaultEventPriority;
		mark("reconciler/resolveUpdatePriority", { priority });
		return priority;
	},
	trackSchedulerEvent() {
		mark("reconciler/trackSchedulerEvent");
	},
	resolveEventType() {
		mark("reconciler/resolveEventType");
		return null;
	},
	resolveEventTimeStamp() {
		const timestamp = -1.1;
		mark("reconciler/resolveEventTimeStamp", { timestamp });
		return timestamp;
	},
	shouldAttemptEagerTransition() {
		mark("reconciler/shouldAttemptEagerTransition", { result: false });
		return false;
	},
	getRootHostContext(rootContainer) {
		mark("reconciler/getRootHostContext");
		return {
			type: "ROOT",
			config: rootContainer.config,
			isInsideText: false
		};
	},
	getChildHostContext(parentHostContext, type) {
		mark("reconciler/getChildHostContext", { type });
		const isInsideText = Boolean(parentHostContext.config.textComponentTypes?.includes(type));
		return {
			...parentHostContext,
			type,
			isInsideText
		};
	},
	getPublicInstance(instance) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/getPublicInstance", { type: formatInstanceType(instance) });
		switch (instance.tag) {
			case Tag.Instance: {
				const testInstance = TestInstance.fromInstance(instance);
				nodeToInstanceMap.set(testInstance, instance);
				return testInstance;
			}
			default: return null;
		}
	},
	prepareForCommit(_containerInfo) {
		mark("reconciler/prepareForCommit");
		measureStart("react/commit");
		return null;
	},
	resetAfterCommit(_containerInfo) {
		measureEnd("react/commit");
		mark("reconciler/resetAfterCommit");
	},
	preparePortalMount(_containerInfo) {
		mark("reconciler/preparePortalMount");
	},
	scheduleTimeout(fn, delay) {
		const id = setTimeout(() => {
			mark("reconciler/scheduled timeout:start");
			fn();
			mark("reconciler/scheduled timeout:end");
		}, delay);
		mark("reconciler/scheduleTimeout", { id });
		return id;
	},
	cancelTimeout(id) {
		mark("reconciler/cancelTimeout", { id });
		clearTimeout(id);
	},
	noTimeout: -1,
	supportsMicrotasks: true,
	scheduleMicrotask(fn) {
		mark("reconciler/scheduleMicrotask");
		queueMicrotask(() => {
			mark("reconciler/scheduled microtask:start");
			fn();
			mark("reconciler/scheduled microtask:end");
		});
	},
	isPrimaryRenderer: true,
	warnsIfNotActing: true,
	getInstanceFromNode(node) {
		mark("reconciler/getInstanceFromNode");
		const instance = nodeToInstanceMap.get(node);
		if (instance !== void 0) return instance.unstable_fiber;
		return null;
	},
	beforeActiveInstanceBlur() {
		mark("reconciler/beforeActiveInstanceBlur");
	},
	afterActiveInstanceBlur() {
		mark("reconciler/afterActiveInstanceBlur");
	},
	prepareScopeUpdate(scopeInstance, instance) {
		mark("reconciler/prepareScopeUpdate");
		nodeToInstanceMap.set(scopeInstance, instance);
	},
	getInstanceFromScope(scopeInstance) {
		mark("reconciler/getInstanceFromScope");
		return nodeToInstanceMap.get(scopeInstance) ?? null;
	},
	detachDeletedInstance(_node) {
		mark("reconciler/detachDeletedInstance");
	},
	appendChild(parentInstance, child) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/appendChild", {
			parentType: parentInstance.type,
			childType: formatInstanceType(child)
		});
		appendChild(parentInstance, child);
	},
	appendChildToContainer(container, child) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/appendChildToContainer", { childType: formatInstanceType(child) });
		appendChild(container, child);
	},
	insertBefore(parentInstance, child, beforeChild) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/insertBefore", {
			parentType: parentInstance.type,
			childType: formatInstanceType(child),
			beforeChildType: formatInstanceType(beforeChild)
		});
		insertBefore(parentInstance, child, beforeChild);
	},
	insertInContainerBefore(container, child, beforeChild) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/insertInContainerBefore", {
			childType: formatInstanceType(child),
			beforeChildType: formatInstanceType(beforeChild)
		});
		insertBefore(container, child, beforeChild);
	},
	removeChild(parentInstance, child) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/removeChild", {
			parentType: parentInstance.type,
			childType: formatInstanceType(child)
		});
		removeChild(parentInstance, child);
	},
	removeChildFromContainer(container, child) {
		if (globalThis.TEST_RENDERER_ENABLE_PROFILING) mark("reconciler/removeChildFromContainer", { childType: formatInstanceType(child) });
		removeChild(container, child);
	},
	resetTextContent(instance) {
		mark("reconciler/resetTextContent", { type: instance.type });
	},
	commitTextUpdate(textInstance, oldText, newText) {
		mark("reconciler/commitTextUpdate", {
			oldText,
			newText
		});
		textInstance.text = newText;
	},
	commitMount(_instance, type, _props, _internalHandle) {
		mark("reconciler/commitMount", { type });
	},
	commitUpdate(instance, type, _prevProps, nextProps, internalHandle) {
		mark("reconciler/commitUpdate", { type });
		instance.type = type;
		if (instance.isHidden && instance.rootContainer.config.transformHiddenInstanceProps != null) {
			instance.propsBeforeHiding = nextProps;
			instance.props = instance.rootContainer.config.transformHiddenInstanceProps({
				props: nextProps,
				type: instance.type
			});
		} else {
			instance.props = nextProps;
			instance.propsBeforeHiding = null;
		}
		instance.unstable_fiber = internalHandle;
	},
	hideInstance(instance) {
		mark("reconciler/hideInstance", { type: instance.type });
		if (instance.isHidden) return;
		instance.isHidden = true;
		instance.propsBeforeHiding = instance.props;
		const transformHiddenInstanceProps = instance.rootContainer.config.transformHiddenInstanceProps;
		if (transformHiddenInstanceProps) {
			const { props, type } = instance;
			instance.props = transformHiddenInstanceProps({
				props,
				type
			});
		}
	},
	hideTextInstance(textInstance) {
		mark("reconciler/hideTextInstance", { text: textInstance.text });
		textInstance.isHidden = true;
	},
	unhideInstance(instance, _props) {
		mark("reconciler/unhideInstance", { type: instance.type });
		instance.isHidden = false;
		if (instance.rootContainer.config.transformHiddenInstanceProps && instance.propsBeforeHiding) {
			instance.props = instance.propsBeforeHiding;
			instance.propsBeforeHiding = null;
		}
	},
	unhideTextInstance(textInstance, _text) {
		mark("reconciler/unhideTextInstance", { text: textInstance.text });
		textInstance.isHidden = false;
	},
	clearContainer(container) {
		mark("reconciler/clearContainer");
		container.children.forEach((child) => {
			child.parent = null;
		});
		container.children.splice(0);
	},
	maySuspendCommit(type, _props) {
		mark("reconciler/maySuspendCommit", { type });
		return false;
	},
	preloadInstance(type, _props) {
		mark("reconciler/preloadInstance", { type });
		return true;
	},
	startSuspendingCommit() {
		mark("reconciler/startSuspendingCommit");
	},
	suspendInstance(type, _props) {
		mark("reconciler/suspendInstance", { type });
	},
	waitForCommitToBeReady(_state, _timeoutOffset) {
		mark("reconciler/waitForCommitToBeReady");
		return null;
	},
	supportsHydration: false,
	NotPendingTransition: null,
	HostTransitionContext: {
		$$typeof: REACT_CONTEXT_TYPE,
		Provider: null,
		Consumer: null,
		_currentValue: null,
		_currentValue2: null,
		_threadCount: 0
	},
	resetFormInstance(_form) {
		mark("reconciler/resetFormInstance");
	},
	requestPostPaintCallback(_callback) {
		mark("reconciler/requestPostPaintCallback");
	}
};
const TestReconciler = (0, react_reconciler.default)(hostConfig);
/**
* This method should mutate the `parentInstance` and add the child to its list of children. For example,
* in the DOM this would translate to a `parentInstance.appendChild(child)` call.
*
* Although this method currently runs in the commit phase, you still should not mutate any other nodes
* in it. If you need to do some additional work when a node is definitely connected to the visible tree,
* look at `commitMount`.
*/
function appendChild(parentInstance, child) {
	const index = parentInstance.children.indexOf(child);
	if (index !== -1) parentInstance.children.splice(index, 1);
	child.parent = parentInstance;
	parentInstance.children.push(child);
}
/**
* This method should mutate the `parentInstance` and place the `child` before `beforeChild` in the list
* of its children. For example, in the DOM this would translate to a
* `parentInstance.insertBefore(child, beforeChild)` call.
*
* Note that React uses this method both for insertions and for reordering nodes. Similar to DOM, it is
* expected that you can call `insertBefore` to reposition an existing child. Do not mutate any other parts
* of the tree from it.
*/
function insertBefore(parentInstance, child, beforeChild) {
	const index = parentInstance.children.indexOf(child);
	if (index !== -1) parentInstance.children.splice(index, 1);
	child.parent = parentInstance;
	const beforeIndex = parentInstance.children.indexOf(beforeChild);
	parentInstance.children.splice(beforeIndex, 0, child);
}
/**
* This method should mutate the `parentInstance` to remove the `child` from the list of its children.
*
* React will only call it for the top-level node that is being removed. It is expected that garbage
* collection would take care of the whole subtree. You are not expected to traverse the child tree in it.
*/
function removeChild(parentInstance, child) {
	const index = parentInstance.children.indexOf(child);
	parentInstance.children.splice(index, 1);
	child.parent = null;
}
function formatInstanceType(instance) {
	return instance.tag === Tag.Text ? `text: "${instance.text}"` : instance.type;
}
//#endregion
//#region src/renderer.ts
const defaultOnUncaughtError = (error, errorInfo) => {
	console.error("Uncaught error:", error, errorInfo);
};
const defaultOnCaughtError = (error, errorInfo) => {
	console.error("Caught error:", error, errorInfo);
};
const defaultOnRecoverableError = (error, errorInfo) => {
	console.error("Recoverable error:", error, errorInfo);
};
const defaultOnDefaultTransitionIndicator = () => {};
/**
* Create a new test renderer root instance.
*
* @param options - Optional configuration for the renderer.
* @returns A Root instance with render, unmount, and container properties.
*/
function createRoot(options) {
	measureStart("createRoot");
	let container = {
		tag: Tag.Container,
		parent: null,
		children: [],
		isHidden: false,
		config: {
			textComponentTypes: options?.textComponentTypes,
			publicTextComponentTypes: options?.publicTextComponentTypes,
			transformHiddenInstanceProps: options?.transformHiddenInstanceProps
		}
	};
	let containerFiber = TestReconciler.createContainer(container, react_reconciler_constants_js.ConcurrentRoot, null, options?.isStrictMode ?? false, false, options?.identifierPrefix ?? "", options?.onUncaughtError ?? defaultOnUncaughtError, options?.onCaughtError ?? defaultOnCaughtError, options?.onRecoverableError ?? defaultOnRecoverableError, defaultOnDefaultTransitionIndicator);
	measureEnd("createRoot");
	const render = (element) => {
		if (containerFiber == null) throw new Error("Cannot render after unmount");
		measureStart("render");
		let elementType = "<invalid>";
		try {
			assertValidRootElement(element);
			elementType = String(element.type);
			TestReconciler.updateContainer(element, containerFiber, null, null);
		} finally {
			measureEnd("render", { elementType });
		}
	};
	const unmount = () => {
		if (container == null) return;
		measureStart("unmount");
		try {
			TestReconciler.updateContainer(null, containerFiber, null, null);
		} finally {
			measureEnd("unmount");
		}
		containerFiber = null;
		container = null;
	};
	return {
		render,
		unmount,
		get container() {
			if (container == null) throw new Error("Cannot access .container on unmounted test renderer");
			return TestInstance.fromInstance(container);
		}
	};
}
function assertValidRootElement(element) {
	if ((0, react.isValidElement)(element)) return;
	throw new Error(`root.render(...) expects a React element. Fragments are supported, but received ${formatInvalidRootValue(element)}.`);
}
function formatInvalidRootValue(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "an array";
	switch (typeof value) {
		case "string": return "a string";
		case "number": return "a number";
		case "boolean": return "a boolean";
		case "undefined": return "undefined";
		default: return `a ${typeof value}`;
	}
}
//#endregion
exports.createRoot = createRoot;

//# sourceMappingURL=index.cjs.map