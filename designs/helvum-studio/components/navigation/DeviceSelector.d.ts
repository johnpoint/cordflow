export interface DeviceOption { value: string; label: string }
export interface DeviceSelectorProps {
  label: string;
  value: string;
  options: DeviceOption[];
  disabled?: boolean;
  onChange?: (value: string) => void;
}
export declare function DeviceSelector(props: DeviceSelectorProps): React.ReactElement;

