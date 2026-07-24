export interface PortSocketProps {
  name: string;
  id: string | number;
  media?: 'audio' | 'video' | 'midi' | 'unknown';
  direction?: 'input' | 'output';
  selected?: boolean;
  onClick?: () => void;
}
export declare function PortSocket(props: PortSocketProps): React.ReactElement;

