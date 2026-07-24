import { describe, expect, it } from 'vitest';
import type { LinkDto, NodeDto, PortDto } from '../generated/graph';
import { buildAudioFlowModules } from './audioFlow';

const nodes: NodeDto[] = [
  { id: 1, name: 'Player', mediaName: null, kind: 'output' },
  { id: 2, name: 'Effects', mediaName: null, kind: 'duplex' },
  { id: 3, name: 'Speakers', mediaName: null, kind: 'input' },
];
const ports: PortDto[] = [
  { id: 11, nodeId: 1, name: 'out_FL', direction: 'output', mediaType: 'audio' },
  { id: 12, nodeId: 1, name: 'out_FR', direction: 'output', mediaType: 'audio' },
  { id: 21, nodeId: 2, name: 'in_FL', direction: 'input', mediaType: 'audio' },
  { id: 22, nodeId: 2, name: 'in_FR', direction: 'input', mediaType: 'audio' },
  { id: 23, nodeId: 2, name: 'out_FL', direction: 'output', mediaType: 'audio' },
  { id: 24, nodeId: 2, name: 'out_FR', direction: 'output', mediaType: 'audio' },
  { id: 31, nodeId: 3, name: 'playback_FL', direction: 'input', mediaType: 'audio' },
  { id: 32, nodeId: 3, name: 'playback_FR', direction: 'input', mediaType: 'audio' },
];
const links: LinkDto[] = [
  { id: 101, outputPortId: 11, inputPortId: 21, active: true, mediaType: 'audio' },
  { id: 102, outputPortId: 12, inputPortId: 22, active: true, mediaType: 'audio' },
  { id: 103, outputPortId: 23, inputPortId: 31, active: true, mediaType: 'audio' },
  { id: 104, outputPortId: 24, inputPortId: 32, active: true, mediaType: 'audio' },
];

describe('source-centred audio flow projection', () => {
  it('collapses parallel channel links into one readable end-to-end route', () => {
    const modules = buildAudioFlowModules(nodes, ports, links);

    expect(modules).toHaveLength(1);
    expect(modules[0].source.id).toBe(1);
    expect(modules[0].paths).toHaveLength(1);
    expect(modules[0].paths[0].nodes.map((node) => node.id)).toEqual([1, 2, 3]);
    expect(modules[0].paths[0].hops.map((hop) => hop.links.map((link) => link.id))).toEqual([
      [101, 102],
      [103, 104],
    ]);
    expect(modules[0].linkIds).toEqual(new Set([101, 102, 103, 104]));
    expect(modules[0].portIds).toEqual(new Set([11, 21, 12, 22, 23, 31, 24, 32]));
  });

  it('duplicates shared downstream stages into each independent source module', () => {
    const secondSource: NodeDto = {
      id: 4,
      name: 'Browser',
      mediaName: null,
      kind: 'output',
    };
    const secondPort: PortDto = {
      id: 41,
      nodeId: 4,
      name: 'out',
      direction: 'output',
      mediaType: 'audio',
    };
    const modules = buildAudioFlowModules(
      [...nodes, secondSource],
      [...ports, secondPort],
      [...links, { id: 105, outputPortId: 41, inputPortId: 21, active: true, mediaType: 'audio' }],
    );

    expect(modules.map((module) => module.source.id)).toEqual([4, 1]);
    expect(modules.map((module) => module.paths[0].nodes.map((node) => node.id))).toEqual([
      [4, 2, 3],
      [1, 2, 3],
    ]);
    expect(modules.every((module) => module.linkIds.has(103))).toBe(true);
  });

  it('keeps one processing chain and projects each downstream device as its own route', () => {
    const headphones: NodeDto = {
      id: 4,
      name: 'Headphones',
      mediaName: null,
      kind: 'input',
    };
    const headphonePorts: PortDto[] = [
      {
        id: 41,
        nodeId: 4,
        name: 'playback_FL',
        direction: 'input',
        mediaType: 'audio',
      },
      {
        id: 42,
        nodeId: 4,
        name: 'playback_FR',
        direction: 'input',
        mediaType: 'audio',
      },
    ];
    const modules = buildAudioFlowModules(
      [...nodes, headphones],
      [...ports, ...headphonePorts],
      [
        ...links,
        { id: 105, outputPortId: 23, inputPortId: 41, active: true, mediaType: 'audio' },
        { id: 106, outputPortId: 24, inputPortId: 42, active: true, mediaType: 'audio' },
      ],
    );

    expect(modules).toHaveLength(1);
    expect(modules[0].paths.map((path) => path.nodes.map((node) => node.id))).toEqual([
      [1, 2, 4],
      [1, 2, 3],
    ]);
    expect(modules[0].paths.every((path) => path.nodes[1].id === 2)).toBe(true);
  });

  it('excludes unrouted output ports and stops feedback loops deterministically', () => {
    const idle: NodeDto = { id: 4, name: 'Idle', mediaName: null, kind: 'output' };
    const cycleA: NodeDto = { id: 5, name: 'Loop A', mediaName: null, kind: 'duplex' };
    const cycleB: NodeDto = { id: 6, name: 'Loop B', mediaName: null, kind: 'duplex' };
    const extraPorts: PortDto[] = [
      { id: 41, nodeId: 4, name: 'out', direction: 'output', mediaType: 'audio' },
      { id: 51, nodeId: 5, name: 'in', direction: 'input', mediaType: 'audio' },
      { id: 52, nodeId: 5, name: 'out', direction: 'output', mediaType: 'audio' },
      { id: 61, nodeId: 6, name: 'in', direction: 'input', mediaType: 'audio' },
      { id: 62, nodeId: 6, name: 'out', direction: 'output', mediaType: 'audio' },
    ];
    const modules = buildAudioFlowModules([idle, cycleA, cycleB], extraPorts, [
      { id: 201, outputPortId: 52, inputPortId: 61, active: true, mediaType: 'audio' },
      { id: 202, outputPortId: 62, inputPortId: 51, active: true, mediaType: 'audio' },
    ]);

    expect(modules.map((module) => module.source.id)).toEqual([5]);
    expect(modules[0].paths[0].nodes.map((node) => node.id)).toEqual([5, 6, 5]);
    expect(modules[0].paths[0].loop).toBe(true);
  });

  it('does not turn MIDI or video outputs into audio flow modules', () => {
    const mediaNodes: NodeDto[] = [
      { id: 1, name: 'MIDI', mediaName: null, kind: 'output' },
      { id: 2, name: 'Camera', mediaName: null, kind: 'output' },
    ];
    const mediaPorts: PortDto[] = [
      { id: 11, nodeId: 1, name: 'out', direction: 'output', mediaType: 'midi' },
      { id: 21, nodeId: 2, name: 'out', direction: 'output', mediaType: 'video' },
    ];

    expect(buildAudioFlowModules(mediaNodes, mediaPorts, [])).toEqual([]);
  });
});
