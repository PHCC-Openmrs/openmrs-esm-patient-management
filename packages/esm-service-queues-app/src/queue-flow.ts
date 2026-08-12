import { type QueueFlowRule } from './types';

/**
 * Finds the configured `queueFlow` rule for a patient currently in `queueUuid`, if any.
 * Returns `undefined` when the queue isn't part of the configured flow, meaning the generic,
 * unrestricted "move" action should be used instead.
 */
export function getQueueFlowRule(queueFlow: Array<QueueFlowRule>, queueUuid: string): QueueFlowRule | undefined {
  return queueFlow.find((rule) => rule.queueUuid === queueUuid && rule.nextQueueUuids.length > 0);
}
