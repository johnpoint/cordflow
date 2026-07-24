export interface ModeSwitchProps {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
  onChange?: (checked: boolean) => void;
}
export declare function ModeSwitch(props: ModeSwitchProps): React.ReactElement;
