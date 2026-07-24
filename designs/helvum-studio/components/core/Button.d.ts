export interface ButtonProps {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}
export declare function Button(props: ButtonProps): React.ReactElement;

