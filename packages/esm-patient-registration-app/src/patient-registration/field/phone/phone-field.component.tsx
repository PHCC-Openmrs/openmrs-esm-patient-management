import React from 'react';
import { PersonAttributeField } from '../person-attributes/person-attribute-field.component';
import { useConfig } from '@openmrs/esm-framework';
import { type RegistrationConfig } from '../../../config-schema';

// Falls back to requiring exactly 10 digits when no custom `matches` regex is configured,
// since the maxLength attribute alone only caps the length and doesn't stop shorter
// (e.g. 9-digit) numbers from being submitted.
const defaultPhoneNumberRegex = '^\\d{10}$';

export function PhoneField() {
  const config = useConfig<RegistrationConfig>();

  const fieldDefinition = {
    id: 'phone',
    type: 'person attribute',
    uuid: config.fieldConfigurations.phone.personAttributeUuid,
    validation: {
      ...config.fieldConfigurations.phone.validation,
      matches: config.fieldConfigurations.phone.validation?.matches || defaultPhoneNumberRegex,
    },
    showHeading: false,
    hideOptionalLabel: true,
    maxLength: 10,
  };
  return <PersonAttributeField fieldDefinition={fieldDefinition} />;
}
