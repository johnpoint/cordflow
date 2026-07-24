import { describe, expect, it } from 'vitest';
import type { GraphEnvelope, GraphSnapshot } from '../generated/graph';
import { emptyGraphState, reduceEnvelope } from './reducer';

const snapshot: GraphSnapshot = {
  status: { state: 'connected', detail: null },
  defaultAudioSinkName: 'sink',
  defaultAudioSourceName: 'source',
  nodes: [
    { id: 1, name: 'Source', mediaName: null, kind: 'output' },
    { id: 2, name: 'Sink', mediaName: null, kind: 'input' },
  ],
  ports: [
    { id: 10, nodeId: 1, name: 'out', direction: 'output', mediaType: 'audio' },
    { id: 20, nodeId: 2, name: 'in', direction: 'input', mediaType: 'audio' },
  ],
  links: [{ id: 30, outputPortId: 10, inputPortId: 20, active: true, mediaType: 'audio' }],
};

function envelope(
  sequence: number,
  payload: GraphEnvelope['payload'],
  generation = 1,
): GraphEnvelope {
  return { generation, sequence, payload };
}

describe('reduceEnvelope', () => {
  it('replaces state from a snapshot and merges ordered deltas', () => {
    const initial = reduceEnvelope(
      emptyGraphState(),
      envelope(0, { type: 'snapshot', data: snapshot }),
    ).state;
    const result = reduceEnvelope(
      initial,
      envelope(1, {
        type: 'delta',
        data: {
          type: 'linkAdded',
          data: {
            id: 31,
            outputPortId: 10,
            inputPortId: 20,
            active: false,
            mediaType: 'audio',
          },
        },
      }),
    );

    expect(result.applied).toBe(true);
    expect(result.state.links.map((link) => link.id)).toEqual([30, 31]);
    expect(result.state.sequence).toBe(1);
  });

  it('ignores duplicates and old generations', () => {
    const current = reduceEnvelope(
      emptyGraphState(),
      envelope(4, { type: 'snapshot', data: snapshot }),
    ).state;
    expect(
      reduceEnvelope(current, envelope(4, { type: 'status', data: snapshot.status })).applied,
    ).toBe(false);
    expect(
      reduceEnvelope(current, envelope(99, { type: 'status', data: snapshot.status }, 0)).applied,
    ).toBe(false);
  });

  it('requests a resync for gaps and a new generation without a snapshot', () => {
    const current = reduceEnvelope(
      emptyGraphState(),
      envelope(0, { type: 'snapshot', data: snapshot }),
    ).state;
    expect(
      reduceEnvelope(current, envelope(2, { type: 'status', data: snapshot.status })).needsResync,
    ).toBe(true);
    expect(
      reduceEnvelope(current, envelope(0, { type: 'status', data: snapshot.status }, 2))
        .needsResync,
    ).toBe(true);
  });

  it('cascades node removal to ports and links', () => {
    const current = reduceEnvelope(
      emptyGraphState(),
      envelope(0, { type: 'snapshot', data: snapshot }),
    ).state;
    const result = reduceEnvelope(
      current,
      envelope(1, { type: 'delta', data: { type: 'nodeRemoved', data: { id: 1 } } }),
    );

    expect(result.state.nodes.map((node) => node.id)).toEqual([2]);
    expect(result.state.ports.map((port) => port.id)).toEqual([20]);
    expect(result.state.links).toEqual([]);
  });

  it('tracks the active default audio sink from an ordered delta', () => {
    const current = reduceEnvelope(
      emptyGraphState(),
      envelope(0, { type: 'snapshot', data: snapshot }),
    ).state;
    const result = reduceEnvelope(
      current,
      envelope(1, {
        type: 'delta',
        data: { type: 'defaultAudioSinkChanged', data: { name: 'other-sink' } },
      }),
    );

    expect(result.state.defaultAudioSinkName).toBe('other-sink');
  });

  it('tracks the active default audio source from an ordered delta', () => {
    const current = reduceEnvelope(
      emptyGraphState(),
      envelope(0, { type: 'snapshot', data: snapshot }),
    ).state;
    const result = reduceEnvelope(
      current,
      envelope(1, {
        type: 'delta',
        data: { type: 'defaultAudioSourceChanged', data: { name: 'other-source' } },
      }),
    );

    expect(result.state.defaultAudioSourceName).toBe('other-source');
  });

  it('surfaces operation failures without corrupting graph state', () => {
    const current = reduceEnvelope(
      emptyGraphState(),
      envelope(0, { type: 'snapshot', data: snapshot }),
    ).state;
    const result = reduceEnvelope(
      current,
      envelope(1, {
        type: 'operationFailed',
        data: { operationId: 'op', code: 'backendRejected', message: 'No' },
      }),
    );
    expect(result.operationFailure?.code).toBe('backendRejected');
    expect(result.state.links).toHaveLength(1);
    expect(result.state.sequence).toBe(1);
  });
});
