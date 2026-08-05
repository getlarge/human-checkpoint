export type SupportRequestStatus = 'open' | 'pending-review' | 'closed';

export interface SupportRequest {
  id: string;
  customerId: string;
  customerName: string;
  siteName: string;
  assetId: string;
  assetName: string;
  assetModel: string;
  summary: string;
  priority: 'routine' | 'urgent';
  status: SupportRequestStatus;
  openedAt: string;
  closedAt: string | null;
  assignedRole: string | null;
  assignedShift: string | null;
  confirmedResolution: string | null;
  approvedForReuse: boolean;
  manualId: string;
  manualRevision: string;
}

export type WorkflowState =
  | 'preparing'
  | 'waiting-for-public-source-approval'
  | 'researching'
  | 'brief-ready'
  | 'waiting-for-release-approval'
  | 'released'
  | 'failed'
  | 'cancelled';

export interface WorkflowInstance {
  id: string;
  supportRequestId: string;
  state: WorkflowState;
  currentStep: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

export interface WorkflowStep {
  workflowId: string;
  stepKey: string;
  status: 'running' | 'completed' | 'failed';
  attemptCount: number;
  inputHash: string;
  result: unknown;
  startedAt: string;
  completedAt: string | null;
  lastError: string | null;
}

export interface WorkflowEvent {
  sequence: number;
  workflowId: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface MoltNetTaskLink {
  workflowId: string;
  taskRole: 'request-review' | 'technician-brief';
  taskId: string;
  attempt: number;
  status: string;
  outputRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SigningRequestLink {
  workflowId: string;
  decision: 'public-source-check' | 'work-order-release';
  signingRequestId: string;
  status: string;
  messageHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSnapshot {
  workflow: WorkflowInstance;
  request: SupportRequest;
  steps: WorkflowStep[];
  tasks: MoltNetTaskLink[];
  approvals: SigningRequestLink[];
  events: WorkflowEvent[];
}
