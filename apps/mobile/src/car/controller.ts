import { type CarCall, type CarNative, native } from '../../modules/wayfinder-car';
import { errorMessage } from '../lib/api';

export type CarHandlers = Record<string, (params: unknown) => Promise<unknown>>;

/**
 * Answers the car screens' requests. Started from the app entry, so it runs even when Android
 * Auto opened Wayfinder with no phone screen showing. Returns a function that stops it.
 */
export function startCarController(handlers: CarHandlers, n: CarNative | null = native): () => void {
  if (!n) return () => undefined;
  const sub = n.addListener('onCall', (call) => void answer(n, handlers, call));
  n.ready();
  return () => sub.remove();
}

async function answer(n: CarNative, handlers: CarHandlers, call: CarCall) {
  const handler = handlers[call.method];
  if (!handler) {
    n.reject(call.id, 'The car asked for something this version can’t do; update Wayfinder on your phone.');
    return;
  }
  try {
    n.resolve(call.id, JSON.stringify(await handler(JSON.parse(call.params))));
  } catch (e) {
    n.reject(call.id, errorMessage(e));
  }
}
