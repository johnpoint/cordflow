import type { LinkDto, NodeDto, PortDto } from '../generated/graph';
import { effectiveMediaType, stableNodeSort } from './connection';

export interface AudioFlowHop {
  fromNodeId: number;
  toNodeId: number;
  links: LinkDto[];
  active: boolean;
}

export interface AudioFlowPath {
  id: string;
  nodes: NodeDto[];
  hops: AudioFlowHop[];
  loop: boolean;
}

export interface AudioFlowModule {
  source: NodeDto;
  paths: AudioFlowPath[];
  nodeIds: Set<number>;
  portIds: Set<number>;
  linkIds: Set<number>;
  truncated: boolean;
}

interface MutableHop {
  fromNodeId: number;
  toNodeId: number;
  links: LinkDto[];
}

/**
 * Projects the backend graph into independent, source-centred audio flows.
 * Shared processors and destinations intentionally appear in every source module
 * that can reach them. A source is shown only after PipeWire confirms at least one
 * audio output link; unrouted output ports remain available in Port topology.
 */
export function buildAudioFlowModules(
  nodes: NodeDto[],
  ports: PortDto[],
  links: LinkDto[],
): AudioFlowModule[] {
  const orderedNodes = [...nodes].sort(stableNodeSort);
  const nodeById = new Map(orderedNodes.map((node) => [node.id, node]));
  const portById = new Map(ports.map((port) => [port.id, port]));
  const audioOutputPortIds = new Set<number>();
  const groupedHops = new Map<string, MutableHop>();

  for (const link of links) {
    if (effectiveMediaType(link, ports) !== 'audio') continue;
    const output = portById.get(link.outputPortId);
    const input = portById.get(link.inputPortId);
    if (!output || !input || !nodeById.has(output.nodeId) || !nodeById.has(input.nodeId)) {
      continue;
    }

    audioOutputPortIds.add(output.id);
    const key = `${output.nodeId}:${input.nodeId}`;
    const hop = groupedHops.get(key) ?? {
      fromNodeId: output.nodeId,
      toNodeId: input.nodeId,
      links: [],
    };
    hop.links.push(link);
    groupedHops.set(key, hop);
  }

  const outgoing = new Map<number, AudioFlowHop[]>();
  const incomingNodeIds = new Set<number>();
  for (const hop of groupedHops.values()) {
    const normalized: AudioFlowHop = {
      ...hop,
      links: [...hop.links].sort((left, right) => left.id - right.id),
      active: hop.links.every((link) => link.active),
    };
    const nodeHops = outgoing.get(hop.fromNodeId) ?? [];
    nodeHops.push(normalized);
    outgoing.set(hop.fromNodeId, nodeHops);
    incomingNodeIds.add(hop.toNodeId);
  }

  const compareHops = (left: AudioFlowHop, right: AudioFlowHop): number =>
    stableNodeSort(nodeById.get(left.toNodeId)!, nodeById.get(right.toNodeId)!) ||
    left.links[0].id - right.links[0].id;
  for (const nodeHops of outgoing.values()) nodeHops.sort(compareHops);

  const audioOutputNodeIds = new Set(
    ports.filter((port) => audioOutputPortIds.has(port.id)).map((port) => port.nodeId),
  );
  const naturalSources = orderedNodes.filter(
    (node) => audioOutputNodeIds.has(node.id) && !incomingNodeIds.has(node.id),
  );
  const modules: AudioFlowModule[] = [];
  const coveredNodeIds = new Set<number>();

  const addModule = (source: NodeDto): void => {
    const module = buildModule(source, nodeById, outgoing);
    modules.push(module);
    for (const nodeId of module.nodeIds) coveredNodeIds.add(nodeId);
  };

  for (const source of naturalSources) addModule(source);

  // A component made only from feedback loops has no natural root. Give it one
  // deterministic representative so it remains visible without recursing forever.
  for (const node of orderedNodes) {
    if (audioOutputNodeIds.has(node.id) && !coveredNodeIds.has(node.id)) addModule(node);
  }

  return modules.sort((left, right) => stableNodeSort(left.source, right.source));
}

function buildModule(
  source: NodeDto,
  nodeById: Map<number, NodeDto>,
  outgoing: Map<number, AudioFlowHop[]>,
): AudioFlowModule {
  const nodeIds = new Set<number>([source.id]);
  const portIds = new Set<number>();
  const linkIds = new Set<number>();
  const reachableQueue = [source.id];

  for (let index = 0; index < reachableQueue.length; index += 1) {
    for (const hop of outgoing.get(reachableQueue[index]) ?? []) {
      for (const link of hop.links) {
        linkIds.add(link.id);
        portIds.add(link.outputPortId);
        portIds.add(link.inputPortId);
      }
      if (!nodeIds.has(hop.toNodeId)) {
        nodeIds.add(hop.toNodeId);
        reachableQueue.push(hop.toNodeId);
      }
    }
  }

  const paths: AudioFlowPath[] = [];
  const maximumPaths = Math.max(64, nodeById.size * 2);
  let truncated = false;

  const recordPath = (pathNodeIds: number[], hops: AudioFlowHop[], loop: boolean): void => {
    if (paths.length >= maximumPaths) {
      truncated = true;
      return;
    }
    const pathNodes = pathNodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is NodeDto => node !== undefined);
    paths.push({
      id: `${source.id}:${pathNodeIds.join('-')}:${hops
        .flatMap((hop) => hop.links.map((link) => link.id))
        .join('-')}`,
      nodes: pathNodes,
      hops: [...hops],
      loop,
    });
  };

  const visit = (nodeId: number, pathNodeIds: number[], hops: AudioFlowHop[]): void => {
    if (paths.length >= maximumPaths) {
      truncated = true;
      return;
    }
    const nextHops = outgoing.get(nodeId) ?? [];
    if (nextHops.length === 0) {
      recordPath(pathNodeIds, hops, false);
      return;
    }

    for (const hop of nextHops) {
      if (pathNodeIds.includes(hop.toNodeId)) {
        recordPath([...pathNodeIds, hop.toNodeId], [...hops, hop], true);
      } else {
        visit(hop.toNodeId, [...pathNodeIds, hop.toNodeId], [...hops, hop]);
      }
    }
  };

  visit(source.id, [source.id], []);

  return { source, paths, nodeIds, portIds, linkIds, truncated };
}
