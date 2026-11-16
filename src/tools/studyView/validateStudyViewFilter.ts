/**
 * Validator for the legacy filterAttributeId + filterValues StudyView filter.
 *
 * The study page applies this filter only when the attribute exists in the
 * study, and a categorical filter only matches the values the attribute
 * actually holds. A link with an unknown attribute shows a "not available"
 * message, and one with unknown values shows an empty cohort, so check both
 * before generating the URL.
 *
 * Matching follows the frontend (StudyViewQueryExtractor): attribute IDs are
 * compared case-insensitively, and categorical values are split on commas
 * that are not escaped as "\,". Values are compared case-insensitively, as
 * the API matches them. Values of NUMBER attributes are ranges and are not
 * checked.
 *
 * Error handling:
 * If the API calls fail, the filter is allowed, as in validateStudyViewTab,
 * so that an API problem does not block navigation.
 *
 * @packageDocumentation
 */

import { studyViewDataClient } from './studyViewDataClient.js';

/** Most valid values to list in an error. */
const MAX_LISTED_VALUES = 50;

export type FilterValidationResult =
    | { valid: true }
    | {
          valid: false;
          reason: string;
          details: Record<string, unknown>;
      };

/**
 * Split categorical filter values the way the study page does.
 * @param filterValues - Comma-separated values, with "\," for a literal comma
 * @returns The individual values
 */
export function splitFilterValues(filterValues: string): string[] {
    return filterValues
        .replace(/\\,/g, '$@$')
        .split(',')
        .map((value) => value.trim().replace(/\$@\$/g, ','));
}

/**
 * Check that a legacy filter refers to a clinical attribute of the studies
 * and, for a categorical attribute, to values that attribute holds.
 * @param studyIds - The studies the URL opens
 * @param filterAttributeId - The clinical attribute ID to filter on
 * @param filterValues - The comma-separated values to filter on
 * @returns Whether the filter is valid, with the reason and the valid options if not
 */
export async function validateStudyViewFilter(
    studyIds: string[],
    filterAttributeId: string,
    filterValues: string
): Promise<FilterValidationResult> {
    try {
        const attributes =
            await studyViewDataClient.getClinicalAttributes(studyIds);
        const attribute = attributes.find(
            (attr) =>
                attr.clinicalAttributeId.toUpperCase() ===
                filterAttributeId.toUpperCase()
        );

        if (!attribute) {
            return {
                valid: false,
                reason: `Clinical attribute "${filterAttributeId}" is not available in ${studyIds.join(', ')}`,
                details: {
                    filterAttributeId,
                    studyIds,
                    suggestion:
                        'Use a clinicalAttributeId from resolve_and_route metadata, or call get_studyviewfilter_options to find the attribute and its values.',
                },
            };
        }

        if (attribute.datatype === 'NUMBER') {
            return { valid: true };
        }

        const availableValues = await studyViewDataClient.getClinicalDataValues(
            studyIds,
            attribute.clinicalAttributeId
        );
        const known = new Set(availableValues.map((v) => v.toUpperCase()));
        const unknownValues = splitFilterValues(filterValues).filter(
            (value) => !known.has(value.toUpperCase())
        );

        if (unknownValues.length > 0) {
            // A value with a comma, like "Breast Invasive Carcinoma, NOS",
            // has to be written with "\," or it is split in two.
            const unescapedValues = availableValues.filter(
                (value) =>
                    value.includes(',') &&
                    filterValues.toUpperCase().includes(value.toUpperCase())
            );
            return {
                valid: false,
                reason: `Clinical attribute "${attribute.clinicalAttributeId}" has no value ${unknownValues
                    .map((v) => `"${v}"`)
                    .join(', ')} in ${studyIds.join(', ')}`,
                details: {
                    filterAttributeId: attribute.clinicalAttributeId,
                    unknownValues,
                    availableValues: availableValues.slice(
                        0,
                        MAX_LISTED_VALUES
                    ),
                    ...(availableValues.length > MAX_LISTED_VALUES && {
                        availableValueCount: availableValues.length,
                    }),
                    suggestion:
                        unescapedValues.length > 0
                            ? `Escape the commas inside a value as "\\,", e.g. "${unescapedValues[0].replace(/,/g, '\\,')}".`
                            : 'Use values from availableValues, or a different attribute if none of them matches the question.',
                },
            };
        }

        return { valid: true };
    } catch (error) {
        console.error(
            `Error validating filter ${filterAttributeId} for ${studyIds.join(', ')}:`,
            error
        );
        return { valid: true };
    }
}
