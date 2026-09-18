// Icons render nothing in screen tests; every named import is a no-op component.
module.exports = new Proxy({ __esModule: true }, { get: (target, key) => (key in target ? target[key] : () => null) });
