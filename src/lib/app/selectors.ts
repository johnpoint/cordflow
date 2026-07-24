import type { NodeDto } from '../generated/graph';
import type { AudioFlowModule } from '../graph/audioFlow';
import { connectedChain, nodeDisplayName } from '../graph/connection';
import type { GraphViewState } from '../graph/reducer';

export interface GraphSelection {
  selectedLinkId: number | null;
  selectedNodeId: number | null;
  selectedFlowSourceId: number | null;
}

export interface GraphFocus {
  focusedLinkIds: Set<number>;
  focusedPortIds: Set<number>;
  focusedNodeIds: Set<number>;
  active: boolean;
}

export function selectDefaultAudioSinks(
  graph: GraphViewState,
  unnamedNode: string,
  locale: string,
): NodeDto[] {
  return graph.nodes
    .filter(
      (node) =>
        node.objectName &&
        graph.ports.some(
          (port) =>
            port.nodeId === node.id && port.direction === 'input' && port.mediaType === 'audio',
        ),
    )
    .sort((left, right) =>
      nodeDisplayName(left, unnamedNode).localeCompare(nodeDisplayName(right, unnamedNode), locale),
    );
}

export function selectDefaultAudioSources(
  graph: GraphViewState,
  unnamedNode: string,
  locale: string,
): NodeDto[] {
  return graph.nodes
    .filter(
      (node) =>
        node.objectName &&
        (node.mediaClass === 'Audio/Source' || node.mediaClass?.startsWith('Audio/Source/')) &&
        graph.ports.some(
          (port) =>
            port.nodeId === node.id && port.direction === 'output' && port.mediaType === 'audio',
        ),
    )
    .sort((left, right) =>
      nodeDisplayName(left, unnamedNode).localeCompare(nodeDisplayName(right, unnamedNode), locale),
    );
}

export function selectOutputVolumeNodes(
  graph: GraphViewState,
  unnamedNode: string,
  locale: string,
): NodeDto[] {
  return graph.nodes
    .filter(
      (node) =>
        node.objectName &&
        (node.mediaClass === 'Audio/Sink' || node.mediaClass?.startsWith('Audio/Sink/')) &&
        graph.ports.some(
          (port) =>
            port.nodeId === node.id && port.direction === 'input' && port.mediaType === 'audio',
        ),
    )
    .sort((left, right) =>
      nodeDisplayName(left, unnamedNode).localeCompare(nodeDisplayName(right, unnamedNode), locale),
    );
}

export function selectActiveDefaultDevice(
  nodes: NodeDto[],
  objectName: string | null,
): NodeDto | null {
  return nodes.find((node) => node.objectName === objectName) ?? null;
}

export function selectDisplayedDefaultDevice(
  nodes: NodeDto[],
  active: NodeDto | null,
  pendingNodeId: number | null,
): NodeDto | null {
  return nodes.find((node) => node.id === pendingNodeId) ?? active;
}

export function selectGraphFocus(
  graph: Pick<GraphViewState, 'ports' | 'links'>,
  modules: AudioFlowModule[],
  selection: GraphSelection,
): GraphFocus {
  const selectedFlow =
    modules.find((module) => module.source.id === selection.selectedFlowSourceId) ?? null;
  const selectedLink = graph.links.find((link) => link.id === selection.selectedLinkId) ?? null;
  const selectedChain =
    selection.selectedNodeId === null
      ? emptyFocus()
      : connectedChain(selection.selectedNodeId, graph.ports, graph.links);
  const selectedLinkPortIds = new Set(
    selectedLink ? [selectedLink.outputPortId, selectedLink.inputPortId] : [],
  );
  const selectedLinkNodeIds = new Set(
    graph.ports.filter((port) => selectedLinkPortIds.has(port.id)).map((port) => port.nodeId),
  );

  return {
    focusedLinkIds: selectedFlow
      ? selectedFlow.linkIds
      : selection.selectedNodeId === null
        ? new Set(selectedLink ? [selectedLink.id] : [])
        : selectedChain.linkIds,
    focusedPortIds: selectedFlow
      ? selectedFlow.portIds
      : selection.selectedNodeId === null
        ? selectedLinkPortIds
        : selectedChain.portIds,
    focusedNodeIds: selectedFlow
      ? selectedFlow.nodeIds
      : selection.selectedNodeId === null
        ? selectedLinkNodeIds
        : selectedChain.nodeIds,
    active: selectedFlow !== null || selection.selectedNodeId !== null || selectedLink !== null,
  };
}

function emptyFocus(): {
  nodeIds: Set<number>;
  portIds: Set<number>;
  linkIds: Set<number>;
} {
  return {
    nodeIds: new Set<number>(),
    portIds: new Set<number>(),
    linkIds: new Set<number>(),
  };
}
