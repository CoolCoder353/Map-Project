"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.mapJsonProps = mapJsonProps;
function mapJsonProps(node, mapper) {
  if (Array.isArray(node)) {
    return node.map(e => mapJsonProps(e, mapper));
  }
  if (!node || typeof node === 'string') {
    return node;
  }
  const resultProps = {
    ...node.props
  };
  Object.keys(mapper).forEach(key => {
    if (key in node.props) {
      resultProps[key] = mapper[key];
    }
  });

  // @ts-expect-error: TODO fix type
  const resultElement = {
    ...node,
    props: resultProps
  };
  Object.defineProperty(resultElement, '$$typeof', {
    value: Symbol.for('react.test.json')
  });
  return resultElement;
}
//# sourceMappingURL=json.js.map