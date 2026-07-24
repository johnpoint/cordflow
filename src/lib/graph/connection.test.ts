import { describe, expect, it } from 'vitest';
import type { LinkDto, NodeDto, PortDto } from '../generated/graph';
import {
  bundleStereoConnections,
  classifyNodes,
  compatibleTargetIds,
  connectedChain,
  connectionExists,
  expandStereoConnection,
  findStereoPortPair,
  layoutTopologyColumns,
  nodeDisplayName,
  normalizePorts,
  pendingHasExpired,
  portsAreCompatible,
} from './connection';

const output: PortDto = {
  id: 1,
  nodeId: 10,
  name: 'out',
  direction: 'output',
  mediaType: 'audio',
};
const input: PortDto = {
  id: 2,
  nodeId: 20,
  name: 'in',
  direction: 'input',
  mediaType: 'audio',
};

describe('connection compatibility', () => {
  it('normalizes a drag that starts from either direction', () => {
    expect(normalizePorts(input, output)).toEqual({ output, input });
    expect(normalizePorts(output, input)).toEqual({ output, input });
  });

  it('allows unknown media and rejects known mismatches or equal directions', () => {
    expect(portsAreCompatible(output, { ...input, mediaType: 'unknown' })).toBe(true);
    expect(portsAreCompatible(output, { ...input, mediaType: 'video' })).toBe(false);
    expect(portsAreCompatible(output, { ...input, direction: 'output' })).toBe(false);
  });

  it('recognizes actual and pending duplicates', () => {
    expect(
      connectionExists(
        [{ id: 9, outputPortId: 1, inputPortId: 2, active: true, mediaType: 'audio' }],
        [],
        1,
        2,
      ),
    ).toBe(true);
    expect(
      connectionExists(
        [],
        [{ operationId: 'x', generation: 1, outputPortId: 1, inputPortId: 2, createdAt: 0 }],
        1,
        2,
      ),
    ).toBe(true);
  });

  it('omits existing and pending routes from compatible keyboard targets', () => {
    const alternateInput = { ...input, id: 3 };
    const targets = compatibleTargetIds(
      output,
      [output, input, alternateInput],
      [{ id: 9, outputPortId: 1, inputPortId: 2, active: true, mediaType: 'audio' }],
      [
        {
          operationId: 'pending',
          generation: 1,
          outputPortId: 1,
          inputPortId: 3,
          createdAt: 0,
        },
      ],
    );

    expect([...targets]).toEqual([]);
  });

  it('uses an exact five second pending timeout', () => {
    const pending = {
      operationId: 'x',
      generation: 1,
      outputPortId: 1,
      inputPortId: 2,
      createdAt: 100,
    };
    expect(pendingHasExpired(pending, 5_099)).toBe(false);
    expect(pendingHasExpired(pending, 5_100)).toBe(true);
  });

  it('expands a stereo drag into channel-aligned left and right links', () => {
    const stereoPorts: PortDto[] = [
      {
        ...output,
        id: 11,
        nodeId: 1,
        name: 'output_FL',
        channel: 'FL',
      },
      {
        ...output,
        id: 12,
        nodeId: 1,
        name: 'output_FR',
        channel: 'FR',
      },
      {
        ...input,
        id: 21,
        nodeId: 2,
        name: 'playback_FL',
        channel: 'FL',
      },
      {
        ...input,
        id: 22,
        nodeId: 2,
        name: 'playback_FR',
        channel: 'FR',
      },
    ];

    expect(
      expandStereoConnection({ output: stereoPorts[0], input: stereoPorts[3] }, stereoPorts).map(
        ({ output, input }) => [output.id, input.id],
      ),
    ).toEqual([
      [11, 21],
      [12, 22],
    ]);
  });

  it('falls back to common left/right port names when channel metadata is absent', () => {
    const stereoPorts: PortDto[] = [
      { ...output, id: 11, nodeId: 1, name: 'capture-front-left' },
      { ...output, id: 12, nodeId: 1, name: 'capture-front-right' },
      { ...input, id: 21, nodeId: 2, name: 'playback_L' },
      { ...input, id: 22, nodeId: 2, name: 'playback_R' },
    ];

    expect(findStereoPortPair(stereoPorts[1], stereoPorts)).toEqual({
      left: stereoPorts[0],
      right: stereoPorts[1],
    });
    expect(
      expandStereoConnection({ output: stereoPorts[1], input: stereoPorts[2] }, stereoPorts).map(
        ({ output, input }) => [output.id, input.id],
      ),
    ).toEqual([
      [11, 21],
      [12, 22],
    ]);
  });

  it('keeps a single manual-safe link when a stereo pair is ambiguous or non-audio', () => {
    const ambiguousPorts: PortDto[] = [
      { ...output, id: 11, nodeId: 1, name: 'main_FL' },
      { ...output, id: 12, nodeId: 1, name: 'monitor_FR' },
      { ...input, id: 21, nodeId: 2, name: 'playback_FL' },
      { ...input, id: 22, nodeId: 2, name: 'playback_FR' },
    ];
    const selected = { output: ambiguousPorts[0], input: ambiguousPorts[2] };
    expect(expandStereoConnection(selected, ambiguousPorts)).toEqual([selected]);

    const midiConnection = {
      output: { ...ambiguousPorts[0], mediaType: 'midi' as const },
      input: { ...ambiguousPorts[2], mediaType: 'midi' as const },
    };
    expect(
      expandStereoConnection(midiConnection, [midiConnection.output, midiConnection.input]),
    ).toEqual([midiConnection]);
  });

  it('bundles only complete aligned stereo links for automatic-mode presentation', () => {
    const stereoPorts: PortDto[] = [
      { ...output, id: 11, nodeId: 1, name: 'output_FL', channel: 'FL' },
      { ...output, id: 12, nodeId: 1, name: 'output_FR', channel: 'FR' },
      { ...input, id: 21, nodeId: 2, name: 'input_FL', channel: 'FL' },
      { ...input, id: 22, nodeId: 2, name: 'input_FR', channel: 'FR' },
    ];
    const aligned: LinkDto[] = [
      { id: 101, outputPortId: 11, inputPortId: 21, active: true, mediaType: 'audio' },
      { id: 102, outputPortId: 12, inputPortId: 22, active: true, mediaType: 'audio' },
    ];
    expect(bundleStereoConnections(aligned, stereoPorts)).toEqual([
      { connections: aligned, stereo: true },
    ]);

    const crossed: LinkDto[] = [
      { id: 103, outputPortId: 11, inputPortId: 22, active: true, mediaType: 'audio' },
      { id: 104, outputPortId: 12, inputPortId: 21, active: true, mediaType: 'audio' },
    ];
    expect(bundleStereoConnections(crossed, stereoPorts)).toEqual([
      { connections: [crossed[0]], stereo: false },
      { connections: [crossed[1]], stereo: false },
    ]);
  });
});

describe('connected chain selection', () => {
  it('traces every upstream and downstream link in the connected component', () => {
    const ports: PortDto[] = [
      { ...output, id: 11, nodeId: 1 },
      { ...input, id: 21, nodeId: 2 },
      { ...output, id: 22, nodeId: 2 },
      { ...input, id: 31, nodeId: 3 },
      { ...output, id: 41, nodeId: 4 },
      { ...input, id: 51, nodeId: 5 },
    ];
    const links = [
      { id: 101, outputPortId: 11, inputPortId: 21, active: true, mediaType: 'audio' },
      { id: 102, outputPortId: 22, inputPortId: 31, active: true, mediaType: 'audio' },
      { id: 103, outputPortId: 41, inputPortId: 51, active: true, mediaType: 'audio' },
    ] as const;

    const chain = connectedChain(2, ports, [...links]);

    expect([...chain.nodeIds].sort()).toEqual([1, 2, 3]);
    expect([...chain.portIds].sort()).toEqual([11, 21, 22, 31]);
    expect([...chain.linkIds].sort()).toEqual([101, 102]);
  });

  it('keeps an unconnected node as a selectable one-node chain', () => {
    expect(connectedChain(9, [], [])).toEqual({
      nodeIds: new Set([9]),
      portIds: new Set(),
      linkIds: new Set(),
    });
  });
});

describe('node classification', () => {
  it('never presents a bare runtime node number as the display name', () => {
    expect(
      nodeDisplayName({ id: 65, name: '', mediaName: null, kind: 'unknown' }, '未命名节点'),
    ).toBe('未命名节点 #65');
  });

  it('uses actual port directions and stable display-name ordering', () => {
    const nodes: NodeDto[] = [
      { id: 3, name: 'Zulu', mediaName: null, kind: 'unknown' },
      { id: 1, name: 'Alpha', mediaName: null, kind: 'unknown' },
      { id: 2, name: 'Middle', mediaName: null, kind: 'unknown' },
    ];
    const ports: PortDto[] = [
      { ...output, id: 11, nodeId: 1 },
      { ...input, id: 12, nodeId: 2 },
      { ...input, id: 13, nodeId: 3 },
      { ...output, id: 14, nodeId: 3 },
    ];

    const classified = classifyNodes(nodes, ports);
    expect(classified.sources.map((node) => node.name)).toEqual(['Alpha']);
    expect(classified.destinations.map((node) => node.name)).toEqual(['Middle']);
    expect(classified.duplex.map((node) => node.name)).toEqual(['Zulu']);
  });

  it('uses the numeric node ID as the deterministic display-name tie breaker', () => {
    const nodes: NodeDto[] = [
      { id: 8, name: 'Same', mediaName: null, kind: 'output' },
      { id: 4, name: 'same', mediaName: null, kind: 'output' },
    ];

    expect(classifyNodes(nodes, []).sources.map((node) => node.id)).toEqual([4, 8]);
  });

  it('keeps a known sink in destinations even when it exposes monitor outputs', () => {
    const sink: NodeDto = {
      id: 45,
      name: 'Built-in Audio',
      mediaName: null,
      kind: 'input',
    };
    const ports: PortDto[] = [
      { ...input, id: 110, nodeId: 45, name: 'playback_FL' },
      { ...output, id: 109, nodeId: 45, name: 'monitor_FL' },
    ];

    const classified = classifyNodes([sink], ports);
    expect(classified.destinations).toEqual([sink]);
    expect(classified.duplex).toEqual([]);
  });
});

describe('topology column layout', () => {
  it('uses every signal-flow depth instead of collapsing the graph into three categories', () => {
    const nodes: NodeDto[] = [
      { id: 1, name: 'Player', mediaName: null, kind: 'output' },
      { id: 2, name: 'Input effects', mediaName: null, kind: 'duplex' },
      { id: 3, name: 'Equalizer', mediaName: null, kind: 'duplex' },
      { id: 4, name: 'Limiter', mediaName: null, kind: 'duplex' },
      { id: 5, name: 'Speakers', mediaName: null, kind: 'input' },
    ];
    const chainPorts: PortDto[] = [
      { ...output, id: 11, nodeId: 1 },
      { ...input, id: 21, nodeId: 2 },
      { ...output, id: 22, nodeId: 2 },
      { ...input, id: 31, nodeId: 3 },
      { ...output, id: 32, nodeId: 3 },
      { ...input, id: 41, nodeId: 4 },
      { ...output, id: 42, nodeId: 4 },
      { ...input, id: 51, nodeId: 5 },
    ];
    const columns = layoutTopologyColumns(nodes, chainPorts, [
      { id: 101, outputPortId: 11, inputPortId: 21, active: true, mediaType: 'audio' },
      { id: 102, outputPortId: 22, inputPortId: 31, active: true, mediaType: 'audio' },
      { id: 103, outputPortId: 32, inputPortId: 41, active: true, mediaType: 'audio' },
      { id: 104, outputPortId: 42, inputPortId: 51, active: true, mediaType: 'audio' },
    ]);

    expect(columns.map((column) => column.nodes.map((node) => node.id))).toEqual([
      [1],
      [2],
      [3],
      [4],
      [5],
    ]);
  });

  it('keeps feedback-loop nodes together and places isolated nodes by their role', () => {
    const nodes: NodeDto[] = [
      { id: 1, name: 'Source', mediaName: null, kind: 'output' },
      { id: 2, name: 'Loop A', mediaName: null, kind: 'duplex' },
      { id: 3, name: 'Loop B', mediaName: null, kind: 'duplex' },
      { id: 4, name: 'Sink', mediaName: null, kind: 'input' },
      { id: 5, name: 'Idle source', mediaName: null, kind: 'output' },
      { id: 6, name: 'Idle duplex', mediaName: null, kind: 'duplex' },
      { id: 7, name: 'Idle sink', mediaName: null, kind: 'input' },
    ];
    const graphPorts: PortDto[] = [
      { ...output, id: 11, nodeId: 1 },
      { ...input, id: 21, nodeId: 2 },
      { ...output, id: 22, nodeId: 2 },
      { ...input, id: 23, nodeId: 2 },
      { ...input, id: 31, nodeId: 3 },
      { ...output, id: 32, nodeId: 3 },
      { ...output, id: 33, nodeId: 3 },
      { ...input, id: 41, nodeId: 4 },
    ];
    const columns = layoutTopologyColumns(nodes, graphPorts, [
      { id: 101, outputPortId: 11, inputPortId: 21, active: true, mediaType: 'audio' },
      { id: 102, outputPortId: 22, inputPortId: 31, active: true, mediaType: 'audio' },
      { id: 103, outputPortId: 32, inputPortId: 23, active: true, mediaType: 'audio' },
      { id: 104, outputPortId: 33, inputPortId: 41, active: true, mediaType: 'audio' },
    ]);

    expect(columns).toHaveLength(3);
    expect(columns[0].nodes.map((node) => node.id)).toEqual([1, 5]);
    expect(columns[1].nodes.map((node) => node.id)).toEqual([2, 3, 6]);
    expect(columns[2].nodes.map((node) => node.id)).toEqual([4, 7]);
  });
});
