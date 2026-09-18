"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.formatElement = formatElement;
exports.formatElementList = formatElementList;
exports.formatJson = formatJson;
var _prettyFormat = _interopRequireWildcard(require("pretty-format"));
var _mapProps = require("./map-props");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/***
 * Format given instance as a pretty-printed string.
 *
 * @param instance Instance to format.
 */
function formatElement(instance, {
  compact,
  highlight = true,
  mapProps = _mapProps.defaultMapProps
} = {}) {
  if (instance == null) {
    return '(null)';
  }
  const {
    children,
    ...props
  } = instance.props;
  const childrenToDisplay = typeof children === 'string' ? [children] : undefined;
  return (0, _prettyFormat.default)({
    // This prop is needed persuade the prettyFormat that the element is
    // a JsonNode instance, so it is formatted as JSX.
    $$typeof: Symbol.for('react.test.json'),
    type: `${instance.type}`,
    props: mapProps ? mapProps(props) : props,
    children: childrenToDisplay
  },
  // See: https://www.npmjs.com/package/pretty-format#usage-with-options
  {
    plugins: [_prettyFormat.plugins.ReactTestComponent, _prettyFormat.plugins.ReactElement],
    printFunctionName: false,
    printBasicPrototype: false,
    highlight: highlight,
    min: compact
  });
}
function formatElementList(instances, options) {
  if (instances.length === 0) {
    return '(no elements)';
  }
  return instances.map(instance => formatElement(instance, options)).join('\n');
}
function formatJson(json, {
  compact,
  highlight = true,
  mapProps = _mapProps.defaultMapProps
} = {}) {
  return (0, _prettyFormat.default)(json, {
    plugins: [getElementJsonPlugin(mapProps), _prettyFormat.plugins.ReactElement],
    highlight: highlight,
    printBasicPrototype: false,
    min: compact
  });
}
function getElementJsonPlugin(mapProps) {
  return {
    test: val => _prettyFormat.plugins.ReactTestComponent.test(val),
    serialize: (val, config, indentation, depth, refs, printer) => {
      let newVal = val;
      if (mapProps && val.props) {
        newVal = {
          ...val,
          props: mapProps(val.props)
        };
      }
      return _prettyFormat.plugins.ReactTestComponent.serialize(newVal, config, indentation, depth, refs, printer);
    }
  };
}
//# sourceMappingURL=format-element.js.map