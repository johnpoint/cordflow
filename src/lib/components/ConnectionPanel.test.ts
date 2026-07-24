import { fireEvent, render, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { MessageKey } from '../i18n';
import ConnectionPanel from './ConnectionPanel.svelte';

const messages: Partial<Record<MessageKey, string>> = {
  active: 'Active',
  audio: 'Audio',
  connections: 'Connections',
  collapseConnections: 'Hide connection details',
  disconnect: 'Disconnect',
  expandConnections: 'Show connection details',
  pending: 'Pending confirmation',
  routes: 'Routes',
};
const t = (key: MessageKey) => messages[key] ?? key;

describe('ConnectionPanel', () => {
  it('exposes a readable route and independent select and disconnect controls', async () => {
    const onSelectLink = vi.fn();
    const onRemoveLink = vi.fn();
    const { getByRole, getByText } = render(ConnectionPanel, {
      props: {
        links: [
          {
            id: 30,
            outputPortId: 10,
            inputPortId: 20,
            active: true,
            mediaType: 'audio',
          },
        ],
        ports: [],
        pendingLinks: [],
        removingLinkIds: new Set<number>(),
        selectedLinkId: null,
        focusedLinkIds: new Set([30]),
        focusActive: true,
        expanded: true,
        autoStereoMatch: false,
        t,
        describeLink: () => ({ from: 'Source · out', to: 'Destination · in', mediaType: 'audio' }),
        onSelectLink,
        onRemoveLink,
        onExpandedChange: vi.fn(),
      },
    });

    expect(getByText('Source · out')).toBeTruthy();
    expect(getByText('Destination · in')).toBeTruthy();
    await fireEvent.click(getByRole('button', { name: /Source · out/ }));
    await fireEvent.click(getByRole('button', { name: 'Disconnect' }));

    expect(onSelectLink).toHaveBeenCalledWith(30);
    expect(onRemoveLink).toHaveBeenCalledWith(30);
  });

  it('renders a compact collapsed bar and requests expansion accessibly', async () => {
    const onExpandedChange = vi.fn();
    const { container } = render(ConnectionPanel, {
      props: {
        links: [],
        ports: [],
        pendingLinks: [],
        removingLinkIds: new Set<number>(),
        selectedLinkId: null,
        focusedLinkIds: new Set<number>(),
        focusActive: false,
        expanded: false,
        autoStereoMatch: false,
        t,
        describeLink: () => ({ from: '', to: '', mediaType: 'unknown' }),
        onSelectLink: vi.fn(),
        onRemoveLink: vi.fn(),
        onExpandedChange,
      },
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="connection-panel-toggle"]',
    );
    if (!toggle) throw new Error('connection panel toggle was not rendered');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="connection-list"]')).toBeNull();
    await fireEvent.click(toggle);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('presents and disconnects an aligned stereo pair as one automatic connection', async () => {
    const onRemoveLink = vi.fn();
    const { getByTestId, queryByTestId } = render(ConnectionPanel, {
      props: {
        links: [
          {
            id: 31,
            outputPortId: 11,
            inputPortId: 21,
            active: true,
            mediaType: 'audio',
          },
          {
            id: 32,
            outputPortId: 12,
            inputPortId: 22,
            active: true,
            mediaType: 'audio',
          },
        ],
        ports: [
          {
            id: 11,
            nodeId: 1,
            name: 'output_FL',
            channel: 'FL',
            direction: 'output',
            mediaType: 'audio',
          },
          {
            id: 12,
            nodeId: 1,
            name: 'output_FR',
            channel: 'FR',
            direction: 'output',
            mediaType: 'audio',
          },
          {
            id: 21,
            nodeId: 2,
            name: 'input_FL',
            channel: 'FL',
            direction: 'input',
            mediaType: 'audio',
          },
          {
            id: 22,
            nodeId: 2,
            name: 'input_FR',
            channel: 'FR',
            direction: 'input',
            mediaType: 'audio',
          },
        ],
        pendingLinks: [],
        removingLinkIds: new Set<number>(),
        selectedLinkId: 32,
        focusedLinkIds: new Set<number>(),
        focusActive: false,
        expanded: true,
        autoStereoMatch: true,
        t,
        describeLink: (_link, nodeOnly) => ({
          from: nodeOnly ? 'Source' : 'Source · output_FL',
          to: nodeOnly ? 'Destination' : 'Destination · input_FL',
          mediaType: 'audio',
        }),
        onSelectLink: vi.fn(),
        onRemoveLink,
        onExpandedChange: vi.fn(),
      },
    });

    const connection = getByTestId('connection-31');
    expect(connection.getAttribute('data-connection-link-ids')).toBe('31,32');
    expect(connection.textContent).toContain('automaticStereoConnection');
    expect(connection.textContent).not.toContain('output_FL');
    expect(queryByTestId('connection-32')).toBeNull();

    await fireEvent.click(within(connection).getByRole('button', { name: 'Disconnect' }));
    expect(onRemoveLink).toHaveBeenCalledWith(31);
  });
});
