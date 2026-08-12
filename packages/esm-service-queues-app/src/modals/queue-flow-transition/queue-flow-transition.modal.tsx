import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DropdownSkeleton,
  InlineNotification,
  ModalBody,
  ModalFooter,
  ModalHeader,
  RadioButton,
  RadioButtonGroup,
  Stack,
  Tag,
} from '@carbon/react';
import { getCoreTranslation, showSnackbar, useConfig } from '@openmrs/esm-framework';
import { type ConfigObject } from '../../config-schema';
import { useMutateQueueEntries } from '../../hooks/useQueueEntries';
import { useQueueEntry } from '../../hooks/useQueueEntry';
import { useQueues } from '../../hooks/useQueues';
import { useQueueOccupancy } from '../../hooks/useQueueOccupancy';
import { getQueueFlowRule } from '../../queue-flow';
import { type QueueEntry } from '../../types';
import { transitionQueueEntry } from '../queue-entry-actions.resource';
import { getErrorMessage, isAlreadyEndedQueueEntryError } from '../queue-entry-error.utils';
import { selectNextQueue } from './select-next-queue';
import styles from './queue-flow-transition.scss';

interface QueueFlowTransitionModalProps {
  queueEntry: QueueEntry;
  closeModal: () => void;
}

const QueueFlowTransitionModal: React.FC<QueueFlowTransitionModalProps> = ({ queueEntry, closeModal }) => {
  const { t } = useTranslation();
  const { queueFlow } = useConfig<ConfigObject>();
  const { queueEntry: freshEntry, error: entryError, isLoading: entryLoading } = useQueueEntry(queueEntry.uuid);
  const { mutateQueueEntries } = useMutateQueueEntries();
  const { queues } = useQueues();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [manuallySelectedQueueUuid, setManuallySelectedQueueUuid] = useState<string | null>(null);

  const isEnded = !entryLoading && !entryError && (!freshEntry || Boolean(freshEntry.endedAt));
  const rule = getQueueFlowRule(queueFlow, queueEntry.queue.uuid);

  const {
    occupancy,
    isLoading: occupancyLoading,
    error: occupancyError,
    mutate: revalidateOccupancy,
  } = useQueueOccupancy(rule?.autoAssign ? rule.nextQueueUuids : []);

  const modalTitle = t('sendPatient', 'Send {{patient}} to the next step', { patient: queueEntry.display });

  if (entryLoading || (rule?.autoAssign && occupancyLoading)) {
    return (
      <>
        <ModalHeader closeModal={closeModal} title={modalTitle} />
        <ModalBody>
          <DropdownSkeleton data-testid="queue-flow-transition-loading-skeleton" />
        </ModalBody>
      </>
    );
  }

  if (entryError || occupancyError) {
    return (
      <>
        <ModalHeader closeModal={closeModal} title={modalTitle} />
        <ModalBody>
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            title={t('errorLoadingQueueEntry', 'Error loading queue entry')}
            subtitle={(entryError || occupancyError)?.message || t('unexpectedError', 'An unexpected error occurred')}
          />
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={closeModal}>
            {getCoreTranslation('close')}
          </Button>
        </ModalFooter>
      </>
    );
  }

  if (isEnded) {
    return (
      <>
        <ModalHeader closeModal={closeModal} title={modalTitle} />
        <ModalBody>
          <InlineNotification
            hideCloseButton
            kind="warning"
            lowContrast
            title={t('queueEntryAlreadyEnded', 'Queue entry is no longer active')}
            subtitle={t(
              'queueEntryAlreadyEndedMessage',
              'This queue entry has already been completed by another user. The queue has been refreshed.',
            )}
          />
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={closeModal}>
            {getCoreTranslation('close')}
          </Button>
        </ModalFooter>
      </>
    );
  }

  if (!rule) {
    return (
      <>
        <ModalHeader closeModal={closeModal} title={modalTitle} />
        <ModalBody>
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            title={t('noNextStepsConfigured', 'No next step configured')}
            subtitle={t(
              'noNextStepsConfiguredMessage',
              'Ask an administrator to configure the queueFlow setting for the Service queues app.',
            )}
          />
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={closeModal}>
            {getCoreTranslation('close')}
          </Button>
        </ModalFooter>
      </>
    );
  }

  const autoSelection = rule.autoAssign ? selectNextQueue(occupancy) : null;
  const destinationQueues = queues.filter((queue) => rule.nextQueueUuids.includes(queue.uuid));
  const manualTarget = destinationQueues.find((queue) => queue.uuid === manuallySelectedQueueUuid);

  const submit = async () => {
    setIsSubmitting(true);
    setConflictMessage(null);
    try {
      let targetQueueUuid: string;

      if (rule.autoAssign) {
        const freshOccupancy = await revalidateOccupancy();
        const freshSelection = selectNextQueue(freshOccupancy);
        if (!freshSelection || freshSelection.queue.uuid !== autoSelection?.queue.uuid) {
          setConflictMessage(
            t(
              'nextStepChanged',
              'The recommended destination changed since this dialog opened (likely just taken by another patient). Please review and confirm again.',
            ),
          );
          return;
        }
        targetQueueUuid = freshSelection.queue.uuid;
      } else {
        if (!manualTarget) {
          return;
        }
        targetQueueUuid = manualTarget.uuid;
      }

      const response = await transitionQueueEntry({
        queueEntryToTransition: freshEntry.uuid,
        newQueue: targetQueueUuid,
        newStatus: freshEntry.status.uuid,
        newPriority: freshEntry.priority.uuid,
      });

      if (response.ok) {
        const targetDisplay = queues.find((q) => q.uuid === targetQueueUuid)?.display ?? '';
        showSnackbar({
          isLowContrast: true,
          title: t('queueEntryTransitioned', 'Queue entry transitioned'),
          kind: 'success',
          subtitle: t('sentPatientSuccessfully', 'Patient sent to {{queue}}', { queue: targetDisplay }),
        });
        mutateQueueEntries();
        closeModal();
      } else {
        throw { message: t('unexpectedServerResponse', 'Unexpected Server Response') };
      }
    } catch (error) {
      if (isAlreadyEndedQueueEntryError(error)) {
        showSnackbar({
          title: t('queueEntryAlreadyEnded', 'Queue entry is no longer active'),
          kind: 'warning',
          subtitle: t(
            'queueEntryAlreadyEndedMessage',
            'This queue entry has already been completed by another user. The queue has been refreshed.',
          ),
        });
        mutateQueueEntries();
        closeModal();
      } else {
        showSnackbar({
          title: t('queueEntryTransitionFailed', 'Error transitioning queue entry'),
          kind: 'error',
          subtitle: getErrorMessage(error) || t('unknownError', 'An unknown error occurred'),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <ModalHeader closeModal={closeModal} title={modalTitle} />
      <ModalBody>
        <Stack gap={4}>
          {conflictMessage && <InlineNotification hideCloseButton lowContrast kind="warning" title={conflictMessage} />}
          {rule.autoAssign ? (
            <>
              {autoSelection?.isFallback && (
                <InlineNotification
                  hideCloseButton
                  lowContrast
                  kind="warning"
                  title={t('allDestinationsBusy', 'All destinations are currently busy')}
                  subtitle={t(
                    'allDestinationsBusyMessage',
                    'This patient will be sent to {{queue}}, which has the shortest wait.',
                    { queue: autoSelection.queue.display },
                  )}
                />
              )}
              <ul className={styles.occupancyList}>
                {occupancy.map((entry) => (
                  <li
                    key={entry.queue.uuid}
                    className={
                      autoSelection && entry.queue.uuid === autoSelection.queue.uuid
                        ? styles.recommendedQueue
                        : styles.queueRow
                    }>
                    <span>{entry.queue.display}</span>
                    <span className={styles.queueMeta}>
                      <Tag type={entry.isBusy ? 'gray' : 'green'} size="sm">
                        {entry.isBusy ? t('queueBusy', 'Busy') : t('queueFree', 'Free')}
                      </Tag>
                      <span>{t('queueWaitingCount', '{{count}} waiting', { count: entry.totalCount })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <RadioButtonGroup
              legendText={t('destination', 'Destination')}
              className={styles.radioButtonGroup}
              name="destination-queue"
              orientation="vertical"
              valueSelected={manuallySelectedQueueUuid ?? undefined}
              onChange={(uuid) => setManuallySelectedQueueUuid(String(uuid))}>
              {destinationQueues.map((queue) => (
                <RadioButton key={queue.uuid} labelText={queue.display} value={queue.uuid} />
              ))}
            </RadioButtonGroup>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button kind="secondary" onClick={closeModal}>
          {getCoreTranslation('cancel')}
        </Button>
        <Button kind="primary" disabled={isSubmitting || (!rule.autoAssign && !manualTarget)} onClick={submit}>
          {rule.autoAssign && autoSelection
            ? t('sendToQueue', 'Send to {{queue}}', { queue: autoSelection.queue.display })
            : t('move', 'Move')}
        </Button>
      </ModalFooter>
    </>
  );
};

export default QueueFlowTransitionModal;
