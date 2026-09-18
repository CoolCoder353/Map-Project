import { describe, expect, it } from 'vitest';
import { GraphHopperClient } from '../src/lib/graphhopper.js';
import { AppError } from '../src/lib/errors.js';

const ghFailing = (status: number, message: string) =>
  new GraphHopperClient('http://gh', (async () => new Response(JSON.stringify({ message }), { status })) as typeof fetch);

async function failure(client: GraphHopperClient, points = 2) {
  const pts = Array.from({ length: points }, (_, i) => [151 + i / 100, -33.8] as [number, number]);
  return client.route({ points: pts, profile: 'car' }).then(
    () => expect.fail('expected an error'),
    (e: unknown) => e as AppError,
  );
}

describe('GraphHopper errors shown to people', () => {
  it('names the start, a stop or the destination when a point is off the road network', async () => {
    expect((await failure(ghFailing(400, 'Cannot find point 0: -33.788,151.4217'))).message).toBe(
      'There is no road or path near your start. Try moving it closer to one.',
    );
    expect((await failure(ghFailing(400, 'Cannot find point 1: -33.788,151.4217'))).message).toBe(
      'There is no road or path near your destination. Try moving it closer to one.',
    );
    expect((await failure(ghFailing(400, 'Cannot find point 1: -33.788,151.4217'), 3)).message).toBe(
      'There is no road or path near one of your stops. Try moving it closer to one.',
    );
  });

  it('explains unconnected places and keeps the 422 no_route code', async () => {
    const e = await failure(ghFailing(400, 'Connection between locations not found'));
    expect(e).toMatchObject({ statusCode: 422, code: 'no_route' });
    expect(e.message).toBe('These places are not connected by roads or paths for this mode of travel.');
  });

  it('never leaks raw coordinates for other 400s', async () => {
    const e = await failure(ghFailing(400, 'Point 0 -33.1,151.2 is out of bounds'));
    expect(e.message).toBe('No route could be found between these places.');
  });
});
