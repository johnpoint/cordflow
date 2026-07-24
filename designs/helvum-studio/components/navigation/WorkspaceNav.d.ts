export interface WorkspaceNavItem { id: string; label: string; description: string; icon?: React.ReactNode }
export interface WorkspaceNavProps {
  items: WorkspaceNavItem[];
  activeId: string;
  onChange?: (id: string) => void;
}
export declare function WorkspaceNav(props: WorkspaceNavProps): React.ReactElement;
