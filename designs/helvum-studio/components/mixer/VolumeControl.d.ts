export interface VolumeControlProps {
  name: string;
  detail: string;
  value: number;
  level?: number;
  muted?: boolean;
  onChange?: (value: number) => void;
  onMute?: (muted: boolean) => void;
}
export declare function VolumeControl(props: VolumeControlProps): React.ReactElement;
