import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../bridge/mock';
import type { PendingLink } from '../graph/connection';
import { selectVisibleTopology } from './selectors';

describe('selectVisibleTopology', () => {
  it('returns the complete graph while the inactive-node filter is off', () => {
    const graph = demoSnapshot();
    const result = selectVisibleTopology(graph, [], false);

    expect(result.nodes).toBe(graph.nodes);
    expect(result.ports).toBe(graph.ports);
    expect(result.links).toBe(graph.links);
  });

  it('keeps only nodes participating in active links', () => {
    const graph = demoSnapshot();
    graph.links.push({
      id: 103,
      outputPortId: 41,
      inputPortId: 42,
      active: false,
      mediaType: 'midi',
    });

    const result = selectVisibleTopology(graph, [], true);

    expect(result.nodes.map((node) => node.id)).toEqual([1, 2, 3]);
    expect(new Set(result.ports.map((port) => port.nodeId))).toEqual(new Set([1, 2, 3]));
    expect(result.links.map((link) => link.id)).toEqual([101, 102]);
  });

  it('keeps both endpoints of a pending connection visible until confirmation', () => {
    const graph = demoSnapshot();
    const pending: PendingLink = {
      operationId: 'pending-midi',
      generation: 1,
      outputPortId: 41,
      inputPortId: 42,
      createdAt: 1_000,
    };

    const result = selectVisibleTopology(graph, [pending], true);

    expect(result.nodes.map((node) => node.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.pendingLinks).toEqual([pending]);
  });
});
