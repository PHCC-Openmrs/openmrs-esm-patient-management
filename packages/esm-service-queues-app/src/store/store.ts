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

export function useServiceQueuesStore() {
  return useStore(serviceQueuesStore);
}
