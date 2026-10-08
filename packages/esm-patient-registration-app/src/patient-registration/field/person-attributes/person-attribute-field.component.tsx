import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineNotification, TextInputSkeleton } from '@carbon/react';
import { type FieldDefinition } from '../../../config-schema';
import { CodedPersonAttributeField } from './coded-person-attribute-field.component';
import { usePersonAttributeType } from './person-attributes.resource';
import { TextPersonAttributeField } from './text-person-attribute-field.component';
import { LocationPersonAttributeField } from './location-person-attribute-field.component';
import styles from '../field.scss';

export interface PersonAttributeFieldProps {
  fieldDefinition: FieldDefinition;
}

export function PersonAttributeField({ fieldDefinition }: PersonAttributeFieldProps) {
  const { data: personAttributeType, isLoading, error } = usePersonAttributeType(fieldDefinition.uuid);
  const { t } = useTranslation();
  // Labels come from config (in English); translate them where rendered, keyed by the English text.
  const translatedLabel = fieldDefinition?.label
    ? t(fieldDefinition.label, fieldDefinition.label)
    : fieldDefinition?.label;
  const translatedSelectLabel = fieldDefinition?.selectLabel
    ? t(fieldDefinition.selectLabel, fieldDefinition.selectLabel)
    : undefined;

  const personAttributeField = useMemo(() => {
    if (!personAttributeType) {
      return null;
    }
    switch (personAttributeType.format) {
      case 'java.lang.String':
        return (
          <TextPersonAttributeField
            personAttributeType={personAttributeType}
            validationRegex={fieldDefinition.validation?.matches ?? ''}
            label={translatedLabel}
            required={fieldDefinition.validation?.required ?? false}
            hideOptionalLabel={fieldDefinition.hideOptionalLabel}
            maxLength={fieldDefinition.maxLength}
            id={fieldDefinition?.id}
          />
        );
      case 'org.openmrs.Concept':
        return (
          <CodedPersonAttributeField
            personAttributeType={personAttributeType}
            answerConceptSetUuid={fieldDefinition.answerConceptSetUuid}
            label={translatedSelectLabel || translatedLabel}
            id={fieldDefinition?.id}
            customConceptAnswers={fieldDefinition.customConceptAnswers ?? []}
            required={fieldDefinition.validation?.required ?? false}
          />
        );
      case 'org.openmrs.Location':
        return (
          <LocationPersonAttributeField
            personAttributeType={personAttributeType}
            locationTag={fieldDefinition.locationTag}
            label={translatedLabel}
            id={fieldDefinition?.id}
            required={fieldDefinition.validation?.required ?? false}
          />
        );
      default:
        return (
          <InlineNotification kind="error" title="Error">
            {t(
              'unknownPatientAttributeType',
              'Patient attribute type has unknown format {{personAttributeTypeFormat}}',
              {
                personAttributeTypeFormat: personAttributeType.format,
              },
            )}
          </InlineNotification>
        );
    }
  }, [personAttributeType, fieldDefinition, translatedLabel, translatedSelectLabel, t]);

  if (isLoading) {
    return (
      <div>
        {fieldDefinition.showHeading && <h4 className={styles.productiveHeading02Light}>{translatedLabel}</h4>}
        <TextInputSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {fieldDefinition.showHeading && <h4 className={styles.productiveHeading02Light}>{translatedLabel}</h4>}
        <InlineNotification kind="error" title={t('error', 'Error')}>
          {t('unableToFetch', 'Unable to fetch person attribute type - {{personattributetype}}', {
            personattributetype: fieldDefinition?.label ?? fieldDefinition?.id,
          })}
        </InlineNotification>
      </div>
    );
  }

  return (
    <div>
      {fieldDefinition.showHeading && (
        <h4 className={styles.productiveHeading02Light}>
          {translatedLabel ??
            (personAttributeType?.display
              ? t(personAttributeType.display, personAttributeType.display)
              : personAttributeType?.display)}
        </h4>
      )}
      {personAttributeField}
    </div>
  );
}
