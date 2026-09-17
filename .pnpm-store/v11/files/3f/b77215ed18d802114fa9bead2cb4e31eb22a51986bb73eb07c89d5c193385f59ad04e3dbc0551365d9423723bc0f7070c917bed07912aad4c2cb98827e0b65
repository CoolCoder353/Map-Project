/**
 * @license lucide-react-native v1.47.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */

'use strict';

var react = require('react');

const LucideContext = react.createContext({
  size: 24,
  color: "currentColor",
  strokeWidth: 2,
  absoluteStrokeWidth: false,
  nonScalingStroke: false
});
function LucideProvider({
  children,
  size,
  color,
  strokeWidth,
  absoluteStrokeWidth,
  nonScalingStroke
}) {
  const value = react.useMemo(
    () => ({
      size,
      color,
      strokeWidth,
      absoluteStrokeWidth,
      nonScalingStroke
    }),
    [size, color, strokeWidth, absoluteStrokeWidth, nonScalingStroke]
  );
  return react.createElement(LucideContext.Provider, { value }, children);
}
const useLucideContext = () => react.useContext(LucideContext);

exports.LucideProvider = LucideProvider;
exports.useLucideContext = useLucideContext;
//# sourceMappingURL=context.js.map
