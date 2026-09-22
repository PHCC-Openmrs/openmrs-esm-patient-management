import { createGlobalStore, useStore } from '@openmrs/esm-framework';

export function updateValueInSessionStorage(key: string, value: string) {
  if (value === undefined || value === null) {
    sessionStorage.removeItem(key);
  } else {
    sessionStorage.setItem(key, value);
  }
}

export function getValueFromSessionStorage(key: string): string | null {
  return sessionStorage.getItem(key);
}

export interface ServiceQueuesState {
  selectedQueueLocationName?: string;
  selectedQueueLocationUuid?: string;
  selectedServiceUuid?: string;
  selectedServiceDisplay?: string;
  selectedProgramUuid?: string;
  selectedProgramDisplay?: string;
  selectedQueueStatusUuid?: string;
  selectedQueueStatusDisplay: string;
  selectedQueueUuid?: string;
  selectedQueueDisplay?: string;
  selectedPriorityUuid?: string;
  selectedPriorityDisplay?: string;
  queueTableSearchTerm?: string;
}

const initialServiceQueuesState: ServiceQueuesState = {
  selectedQueueLocationName: getValueFromSessionStorage('queueLocationName'),
  selectedQueueLocationUuid: getValueFromSessionStorage('queueLocationUuid'),
  selectedServiceUuid: getValueFromSessionStorage('queueServiceUuid'),
  selectedServiceDisplay: getValueFromSessionStorage('queueServiceDisplay'),
  selectedProgramUuid: getValueFromSessionStorage('queueProgramUuid'),
  selectedProgramDisplay: getValueFromSessionStorage('queueProgramDisplay'),
  selectedQueueStatusUuid: getValueFromSessionStorage('queueStatusUuid'),
  selectedQueueStatusDisplay: getValueFromSessionStorage('queueStatusDisplay'),
  selectedQueueUuid: getValueFromSessionStorage('queueUuid'),
  selectedQueueDisplay: getValueFromSessionStorage('queueDisplay'),
  selectedPriorityUuid: getValueFromSessionStorage('queuePriorityUuid'),
  selectedPriorityDisplay: getValueFromSessionStorage('queuePriorityDisplay'),
  // Deliberately not restored from session storage, unlike the dropdown filters: a search term
  // left over from a previous session would silently hide rows on a fresh load, with only a
  // pre-filled box to explain why.
  queueTableSearchTerm: '',
};

const serviceQueuesStore = createGlobalStore<ServiceQueuesState>('serviceQueues', initialServiceQueuesState);

export const updateSelectedService = (currentServiceUuid: string, currentServiceDisplay: string) => {
  updateValueInSessionStorage('queueServiceUuid', currentServiceUuid);
  updateValueInSessionStorage('queueServiceDisplay', currentServiceDisplay);
  serviceQueuesStore.setState({
    selectedServiceUuid: currentServiceUuid,
    selectedServiceDisplay: currentServiceDisplay,
  });
};

export const updateSelectedProgram = (currentProgramUuid: string, currentProgramDisplay: string) => {
  updateValueInSessionStorage('queueProgramUuid', currentProgramUuid);
  updateValueInSessionStorage('queueProgramDisplay', currentProgramDisplay);
  serviceQueuesStore.setState({
    selectedProgramUuid: currentProgramUuid,
    selectedProgramDisplay: currentProgramDisplay,
  });
};

export const updateSelectedQueueLocationName = (currentLocationName: string) => {
  updateValueInSessionStorage('queueLocationName', currentLocationName);
  serviceQueuesStore.setState({ selectedQueueLocationName: currentLocationName });
};

export const updateSelectedQueueLocationUuid = (currentLocationUuid: string) => {
  updateValueInSessionStorage('queueLocationUuid', currentLocationUuid);
  serviceQueuesStore.setState({ selectedQueueLocationUuid: currentLocationUuid });
};

/**
 * Sentinel stored in `selectedQueueStatusUuid` when the user picks "All" in the status dropdown,
 * and the value the dropdown falls back to when nothing has been picked yet. It is never a real
 * status concept uuid, so consumers have to treat it as "don't filter by status" rather than pass
 * it on as a status to match - see useCurrentQueueEntries.
 */
export const ALL_QUEUE_STATUSES_UUID = 'all';

export const updateSelectedQueueStatus = (currentQueueStatusUuid: string, currentQueueStatusDisplay: string) => {
  updateValueInSessionStorage('queueStatusUuid', currentQueueStatusUuid);
  updateValueInSessionStorage('queueStatusDisplay', currentQueueStatusDisplay);
  serviceQueuesStore.setState({
    selectedQueueStatusUuid: currentQueueStatusUuid,
    selectedQueueStatusDisplay: currentQueueStatusDisplay,
  });
};

export const updateSelectedQueue = (currentQueueUuid: string, currentQueueDisplay: string) => {
  updateValueInSessionStorage('queueUuid', currentQueueUuid);
  updateValueInSessionStorage('queueDisplay', currentQueueDisplay);
  serviceQueuesStore.setState({
    selectedQueueUuid: currentQueueUuid,
    selectedQueueDisplay: currentQueueDisplay,
  });
};

export const updateSelectedPriority = (currentPriorityUuid: string, currentPriorityDisplay: string) => {
  updateValueInSessionStorage('queuePriorityUuid', currentPriorityUuid);
  updateValueInSessionStorage('queuePriorityDisplay', currentPriorityDisplay);
  serviceQueuesStore.setState({
    selectedPriorityUuid: currentPriorityUuid,
    selectedPriorityDisplay: currentPriorityDisplay,
  });
};

/**
 * The queue table's free-text search lives in the store rather than in the table's own state
 * because the metrics cards above the table count the same population and have to narrow with it.
 */
export const updateQueueTableSearchTerm = (searchTerm: string) => {
  serviceQueuesStore.setState({ queueTableSearchTerm: searchTerm });
};

export function useServiceQueuesStore() {
  return useStore(serviceQueuesStore);
}
