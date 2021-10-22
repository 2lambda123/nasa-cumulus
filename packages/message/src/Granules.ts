'use strict';

/**
 * Utility functions for parsing granule information from a Cumulus message
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/message/Granules');
 */

import isInteger from 'lodash/isInteger';
import isNil from 'lodash/isNil';
import mapValues from 'lodash/mapValues';
import omitBy from 'lodash/omitBy';

import { CumulusMessageError } from '@cumulus/errors';
import { Message } from '@cumulus/types';
import { ExecutionProcessingTimes } from '@cumulus/types/api/executions';
import {
  ApiGranule,
  GranuleStatus,
  GranuleTemporalInfo,
  MessageGranule,
} from '@cumulus/types/api/granules';
import { ApiFile } from '@cumulus/types/api/files';

import { CmrUtilsClass } from './types';

interface MetaWithGranuleQueryFields extends Message.Meta {
  granule?: {
    queryFields?: unknown
  }
}

interface MessageWithGranules extends Message.CumulusMessage {
  meta: MetaWithGranuleQueryFields,
  payload: {
    granules?: object[]
  }
}

/**
 * Get granules from payload?.granules of a workflow message.
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {Array<Object>|undefined} An array of granule objects, or
 *   undefined if `message.payload.granules` is not set
 *
 * @alias module:Granules
 */
export const getMessageGranules = (
  message: MessageWithGranules
): unknown[] => message.payload?.granules ?? [];

/**
 * Determine if message has a granules object.
 *
 * @param {MessageWithOptionalGranules} message - A workflow message object
 * @returns {boolean} true if message has a granules object
 *
 * @alias module:Granules
 */
export const messageHasGranules = (
  message: MessageWithGranules
): boolean => getMessageGranules(message).length !== 0;

/**
 * Determine the status of a granule.
 *
 * @param {string} workflowStatus - The workflow status
 * @param {MessageGranule} granule - A granule record
 * @returns {string} The granule status
 *
 * @alias module:Granules
 */
export const getGranuleStatus = (
  workflowStatus: Message.WorkflowStatus,
  granule: MessageGranule
): Message.WorkflowStatus | GranuleStatus => workflowStatus || granule.status;

/**
 * Get the query fields of a granule, if any
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {unknown|undefined} The granule query fields, if any
 *
 * @alias module:Granules
 */
export const getGranuleQueryFields = (
  message: MessageWithGranules
) => message.meta?.granule?.queryFields;

/**
 * Calculate granule product volume, which is the sum of the file
 * sizes in bytes
 *
 * @param {Array<Object>} granuleFiles - array of granule files
 * @returns {Integer} - sum of granule file sizes in bytes
 */
export const getGranuleProductVolume = (granuleFiles: ApiFile[] = []): number => {
  if (granuleFiles.length === 0) return 0;
  return granuleFiles
    .map((f) => f.size ?? 0)
    .filter(isInteger)
    .reduce((x, y) => x + y, 0);
};

export const getGranuleTimeToPreprocess = ({
  sync_granule_duration = 0,
} = {}) => sync_granule_duration / 1000;

export const getGranuleTimeToArchive = ({
  post_to_cmr_duration = 0,
} = {}) => post_to_cmr_duration / 1000;

/**
 * Convert date string to standard ISO format.
 *
 * @param {string} date - Date string, possibly in multiple formats
 * @returns {string} Standardized ISO date string
 */
const convertDateToISOString = (date: string) => new Date(date).toISOString();

function isProcessingTimeInfo(
  info: ExecutionProcessingTimes | {} = {}
): info is ExecutionProcessingTimes {
  return (info as ExecutionProcessingTimes)?.processingStartDateTime !== undefined
    && (info as ExecutionProcessingTimes)?.processingEndDateTime !== undefined;
}

/**
 * Convert granule processing timestamps to a standardized ISO string
 * format for compatibility across database systems.
 *
 * @param {ExecutionProcessingTimes} [processingTimeInfo]
 *   Granule processing time info, if any
 * @returns {Promise<ExecutionProcessingTimes | undefined>}
 */
export const getGranuleProcessingTimeInfo = (
  processingTimeInfo?: ExecutionProcessingTimes
): ExecutionProcessingTimes | {} => {
  const updatedProcessingTimeInfo = isProcessingTimeInfo(processingTimeInfo)
    ? { ...processingTimeInfo }
    : {};
  return mapValues(
    updatedProcessingTimeInfo,
    convertDateToISOString
  );
};

function isGranuleTemporalInfo(
  info: GranuleTemporalInfo | {} = {}
): info is GranuleTemporalInfo {
  return (info as GranuleTemporalInfo)?.beginningDateTime !== undefined
    && (info as GranuleTemporalInfo)?.endingDateTime !== undefined
    && (info as GranuleTemporalInfo)?.productionDateTime !== undefined
    && (info as GranuleTemporalInfo)?.lastUpdateDateTime !== undefined;
}

/**
 * Get granule temporal information from argument or directly from CMR.
 *
 * Converts temporal information timestamps to a standardized ISO string
 * format for compatibility across database systems.
 *
 * @param {Object} params
 * @param {MessageGranule} params.granule - Granule from workflow message
 * @param {Object} [params.cmrTemporalInfo] - CMR temporal info, if any
 * @param {CmrUtilsClass} params.cmrUtils - CMR utilities object
 * @returns {Promise<GranuleTemporalInfo | undefined>}
 */
export const getGranuleCmrTemporalInfo = async ({
  granule,
  cmrTemporalInfo,
  cmrUtils,
}: {
  granule: MessageGranule,
  cmrTemporalInfo?: GranuleTemporalInfo,
  cmrUtils: CmrUtilsClass
}): Promise<GranuleTemporalInfo | {}> => {
  // Get CMR temporalInfo (beginningDateTime, endingDateTime,
  // productionDateTime, lastUpdateDateTime)
  const temporalInfo = isGranuleTemporalInfo(cmrTemporalInfo)
    ? { ...cmrTemporalInfo }
    : await cmrUtils.getGranuleTemporalInfo(granule);
  return mapValues(
    temporalInfo,
    convertDateToISOString
  );
};

/**
 * Generate an API granule record
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {Promise<ApiGranule>} The granule API record
 *
 * @alias module:Granules
 */
export const generateGranuleApiRecord = async ({
  granule,
  executionUrl,
  collectionId,
  provider,
  workflowStartTime,
  error,
  pdrName,
  status,
  queryFields,
  updatedAt,
  files,
  processingTimeInfo,
  cmrUtils,
  timestamp,
  duration,
  productVolume,
  timeToPreprocess,
  timeToArchive,
  cmrTemporalInfo,
}: {
  granule: MessageGranule,
  executionUrl?: string,
  collectionId: string,
  provider?: string,
  workflowStartTime: number,
  error?: Object,
  pdrName?: string,
  status: GranuleStatus,
  queryFields?: Object,
  updatedAt: number,
  processingTimeInfo?: ExecutionProcessingTimes,
  files?: ApiFile[],
  timestamp: number,
  cmrUtils: CmrUtilsClass
  cmrTemporalInfo?: GranuleTemporalInfo,
  duration: number,
  productVolume: number,
  timeToPreprocess: number,
  timeToArchive: number,
}): Promise<ApiGranule> => {
  if (!granule.granuleId) throw new CumulusMessageError(`Could not create granule record, invalid granuleId: ${granule.granuleId}`);

  if (!collectionId) {
    throw new CumulusMessageError('collectionId required to generate a granule record');
  }

  const {
    granuleId,
    cmrLink,
    published = false,
  } = granule;

  // Get CMR temporalInfo
  const temporalInfo = await getGranuleCmrTemporalInfo({
    granule,
    cmrTemporalInfo,
    cmrUtils,
  });
  const updatedProcessingTimeInfo = getGranuleProcessingTimeInfo(processingTimeInfo);

  const record = {
    granuleId,
    pdrName,
    collectionId,
    status,
    provider,
    execution: executionUrl,
    cmrLink,
    files,
    error,
    published,
    createdAt: workflowStartTime,
    timestamp,
    updatedAt,
    duration,
    productVolume,
    timeToPreprocess,
    timeToArchive,
    ...updatedProcessingTimeInfo,
    ...temporalInfo,
    queryFields,
  };

  return <ApiGranule>omitBy(record, isNil);
};
