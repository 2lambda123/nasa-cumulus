'use strict';

/**
 * Utility functions for parsing granule information from a Cumulus message
 * @module Granules
 *
 * @example
 * const Granules = require('@cumulus/message/Granules');
 */

import { Message } from '@cumulus/types';
import { ApiGranule, GranuleStatus } from '@cumulus/types/api/granules';

import { getMetaStatus } from './workflows';

interface MessageWithGranules extends Message.CumulusMessage {
  payload: {
    granules?: object[]
  }
}

/**
 * Get granules from a workflow message.
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {Array<Object>|undefined} An array of granule objects, or
 *   undefined if `message.payload.granules` is not set
 *
 * @alias module:Granules
 */
export const getMessageGranules = (
  message: MessageWithGranules
): unknown[] | undefined => message.payload?.granules;

/**
 * Determine whether workflow message has granules.
 *
 * @param {MessageWithGranules} message - A workflow message
 * @returns {boolean} true if message has granules
 *
 * @alias module:Granules
 */
export const messageHasGranules = (
  message: MessageWithGranules
): boolean => getMessageGranules(message) !== undefined;

/**
 * Determine the status of a granule.
 *
 * @param {Message.CumulusMessage } message - A workflow message
 * @param {ApiGranule} granule - A granule record
 * @returns {string} The granule status
 *
 * @alias module:Granules
 */
export const getGranuleStatus = (
  message: Message.CumulusMessage,
  granule: ApiGranule
): Message.WorkflowStatus | GranuleStatus => getMetaStatus(message) || granule.status;
