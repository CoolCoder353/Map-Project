"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.render = render;
var React = _interopRequireWildcard(require("react"));
var _testRenderer = require("test-renderer");
var _act = require("./act");
var _cleanup = require("./cleanup");
var _config = require("./config");
var _debug = require("./helpers/debug");
var _hostComponentNames = require("./helpers/host-component-names");
var _validateOptions = require("./helpers/validate-options");
var _screen = require("./screen");
var _within = require("./within");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/**
 * Renders test component deeply using Test Renderer and exposes helpers
 * to assert on the output.
 */
async function render(element, options = {}) {
  const {
    wrapper: Wrapper,
    ...rest
  } = options || {};
  (0, _validateOptions.validateOptions)('render', rest, render);
  const rendererOptions = {
    textComponentTypes: _hostComponentNames.HOST_TEXT_NAMES,
    publicTextComponentTypes: ['Text'],
    transformHiddenInstanceProps: ({
      props
    }) => ({
      ...props,
      style: withHiddenStyle(props.style)
    })
  };
  const wrap = element => Wrapper ? /*#__PURE__*/React.createElement(Wrapper, null, element) : element;
  const renderer = (0, _testRenderer.createRoot)(rendererOptions);
  await (0, _act.act)(() => {
    renderer.render(wrap(element));
  });
  const container = renderer.container;
  const rerender = async component => {
    await (0, _act.act)(() => {
      renderer.render(wrap(component));
    });
  };
  const unmount = async () => {
    await (0, _act.act)(() => {
      renderer.unmount();
    });
  };
  const toJSON = () => {
    const json = renderer.container.toJSON();
    if (json?.children.length === 0) {
      return null;
    }
    if (json?.children.length === 1 && typeof json.children[0] !== 'string') {
      return json.children[0];
    }
    return json;
  };
  (0, _cleanup.addToCleanupQueue)(unmount);
  const result = {
    ...(0, _within.getQueriesForInstance)(renderer.container),
    rerender,
    unmount,
    toJSON,
    debug: makeDebug(renderer),
    get container() {
      return renderer.container;
    },
    get root() {
      const firstChild = container.children[0];
      if (typeof firstChild === 'string') {
        /* istanbul ignore next */
        throw new Error('Invariant Violation: Root element must be a host element. Detected attempt to render a string within the root element.');
      }
      return firstChild;
    }
  };
  (0, _screen.setRenderResult)(result);
  return result;
}
function makeDebug(renderer) {
  function debugImpl(options) {
    const {
      defaultDebugOptions
    } = (0, _config.getConfig)();
    const debugOptions = {
      ...defaultDebugOptions,
      ...options
    };
    const json = renderer.container.toJSON();
    if (json) {
      return (0, _debug.debug)(json, debugOptions);
    }
  }
  return debugImpl;
}
function withHiddenStyle(style) {
  if (style == null) {
    return {
      display: 'none'
    };
  }
  return [style, {
    display: 'none'
  }];
}
//# sourceMappingURL=render.js.map