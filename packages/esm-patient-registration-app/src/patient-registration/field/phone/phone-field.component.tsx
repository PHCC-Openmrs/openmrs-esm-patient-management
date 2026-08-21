import React from 'react';
import { PersonAttributeField } from '../person-attributes/person-attribute-field.component';
import { useConfig } from '@openmrs/esm-framework';
import { type RegistrationConfig } from '../../../config-schema';

// Enforced unconditionally, independently of config, since the maxLength attribute alone only
// caps the length while typing and doesn't stop a shorter (e.g. 9-digit) number from being
// submitted. Kept out of `validation.matches` (which config can fully replace) so that no
// config value — including one that predates this fix or is set later via an admin UI — can
// ever disable this check. Config's own `matches`, if set, still applies as an additional,
// narrower restriction on top of this one.
const mandatoryPhoneNumberRegex = '^\\d{10}$';

export function PhoneField() {
  const config = useConfig<RegistrationConfig>();

  const fieldDefinition = {
    id: 'phone',
    type: 'person attribute',
    uuid: config.fieldConfigurations.phone.personAttributeUuid,
    validation: config.fieldConfigurations.phone.validation,
    mandatoryMatches: mandatoryPhoneNumberRegex,
    showHeading: false,
    hideOptionalLabel: true,
    maxLength: 10,
  };
  return <PersonAttributeField fieldDefinition={fieldDefinition} />;
}
