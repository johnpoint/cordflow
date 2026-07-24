export interface RouteStage { name: string; role: string }
export interface RouteLaneProps {
  source: string;
  stages: RouteStage[];
  state?: string;
  action?: React.ReactNode;
}
export declare function RouteLane(props: RouteLaneProps): React.ReactElement;

