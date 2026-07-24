export interface IconButtonProps {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}
export declare function IconButton(props: IconButtonProps): React.ReactElement;

