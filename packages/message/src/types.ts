import { Message } from '@cumulus/types';

export interface WorkflowMessageTemplateCumulusMeta {
  queueExecutionLimits: Message.QueueExecutionLimits
}

// Minimal type to define the shape of the template
// used to prepare workflow messages
export interface WorkflowMessageTemplate {
  cumulus_meta: WorkflowMessageTemplateCumulusMeta
  meta: object
}

export interface Workflow {
  arn: string
  name: string
}
