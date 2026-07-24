export interface DialogProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
}
export declare function Dialog(props: DialogProps): React.ReactElement;

