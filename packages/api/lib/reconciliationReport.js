'use strict';

const flatten = require('lodash/flatten');
const isNil = require('lodash/isNil');
const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { Granule } = require('../models');
const { deconstructCollectionId } = require('./utils');

/**
 * Prepare a list of collectionIds into an _id__in object
 *
 * @param {Array<string>} collectionIds - Array of collectionIds in the form 'name___ver'
 * @returns {Object} - object that will return the correct terms search when
 *                     passed to the query command.
 */
function searchParamsForCollectionIdArray(collectionIds) {
  return { _id__in: collectionIds.join(',') };
}

/**
 * @param {string} dateable - any input valid for a JS Date contstructor.
 * @returns {number} - primitive value of input date string or undefined, if
 *                     input string not convertable.
 */
function dateToValue(dateable) {
  const primitiveDate = new Date(dateable).valueOf();
  return !Number.isNaN(primitiveDate) ? primitiveDate : undefined;
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch collection search
 */
function convertToESCollectionSearchParams(params) {
  const { collectionIds, startTimestamp, endTimestamp } = params;
  const idsIn = collectionIds
    ? searchParamsForCollectionIdArray(collectionIds)
    : undefined;
  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    ...idsIn,
  };
  return removeNilProperties(searchParams);
}

/**
 *
 * @param {Object} params - request params to convert to database params
 * @returns {Object} object of desired parameters formated for database collection search
 */
function convertToDBCollectionSearchParams(params) {
  const { collectionIds, startTimestamp, endTimestamp } = params;
  // doesn't support search with multiple collections
  const collection = collectionIds && collectionIds.length === 1
    ? deconstructCollectionId(collectionIds[0]) : {};
  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    ...collection,
  };
  return removeNilProperties(searchParams);
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch params
 * @returns {Object} object of desired parameters formated for Elasticsearch.
 */
function convertToESGranuleSearchParams(params) {
  const { collectionIds } = params;
  const collectionIdIn = collectionIds ? collectionIds.join(',') : undefined;
  return removeNilProperties({
    updatedAt__from: dateToValue(params.startTimestamp),
    updatedAt__to: dateToValue(params.endTimestamp),
    collectionId__in: collectionIdIn,
  });
}

/**
 *
 * @param {Object} params - request params to convert to Elasticsearch/DB params
 * @returns {Object} object of desired parameters formated for Elasticsearch/DB
 */
function convertToGranuleSearchParams(params) {
  const {
    collectionId,
    granuleId,
    provider,
    startTimestamp,
    endTimestamp,
  } = params;
  const searchParams = {
    updatedAt__from: dateToValue(startTimestamp),
    updatedAt__to: dateToValue(endTimestamp),
    collectionId,
    granuleId,
    provider,
  };
  return removeNilProperties(searchParams);
}

/**
 * create initial report header
 *
 * @param {Object} recReportParams - params
 * @param {Object} recReportParams.reportType - the report type
 * @param {moment} recReportParams.createStartTime - when the report creation was begun
 * @param {moment} recReportParams.endTimestamp - ending report datetime ISO Timestamp
 * @param {moment} recReportParams.startTimestamp - beginning report datetime ISO timestamp
 * @returns {Object} report header
 */
function initialReportHeader(recReportParams) {
  const {
    reportType,
    createStartTime,
    endTimestamp,
    startTimestamp,
    collectionId,
  } = recReportParams;

  return {
    reportType,
    createStartTime: createStartTime.toISOString(),
    createEndTime: undefined,
    reportStartTime: startTimestamp,
    reportEndTime: endTimestamp,
    status: 'RUNNING',
    error: undefined,
    collectionId,
  };
}

/**
 * filters the returned UMM CMR collections by the desired collectionIds
 *
 * @param {Array<Object>} collections - CMR.searchCollections result
 * @param {Object} recReportParams
 * @param {Array<string>} recReportParams.collectionIds - array of collectionIds to keep
 * @returns {Array<string>} filtered list of collectionIds returned from CMR
 */
function filterCMRCollections(collections, recReportParams) {
  const { collectionIds } = recReportParams;

  const CMRCollectionIds = collections
    .map((item) => constructCollectionId(item.umm.ShortName, item.umm.Version))
    .sort();

  if (!collectionIds) return CMRCollectionIds;

  return CMRCollectionIds.filter((item) => collectionIds.includes(item));
}

/**
 * Class to create granule search queues and iterate the items in the queues, items retrieved
 * are ordered by granuleId.
 *
 * If there are granuleIds in the filter, create search queues for each granuleId in order to
 * 'query' the table, otherwise, create only one queue.  The queue created with the granuleId
 * has 0 or 1 item.
 */
class DbGranuleSearchQueues {
  constructor(collectionId, searchParams) {
    const { granuleIds, queryParams } = searchParams;
    if (granuleIds) {
      this.queues = granuleIds.sort().map((granuleId) => new Granule()
        .searchGranulesForCollection(collectionId, { ...queryParams, granuleId }));
    } else {
      this.queues = [new Granule().searchGranulesForCollection(collectionId, searchParams)];
    }
    this.currentQueue = this.queues.shift();
  }

  /**
   * retrive the queue which has items
   *
   * @returns {Promise<Object>} the granules' queue
   */
  async retrieveQueue() {
    let item = await this.currentQueue.peek();
    while (isNil(item) && this.queues.length > 0) {
      this.currentQueue = this.queues.shift();
      item = await this.currentQueue.peek(); //eslint-disable-line no-await-in-loop
    }
    return this.currentQueue;
  }

  /**
   * view the next item in the queues
   *
   * @returns {Promise<Object>} an item from the table
   */
  async peek() {
    const queue = await this.retrieveQueue();
    return queue ? queue.peek() : undefined;
  }

  /**
   * Remove the next item from the queue
   *
   * @returns {Promise<Object>} an item from the table
   */
  async shift() {
    const queue = await this.retrieveQueue();
    return queue ? queue.shift() : undefined;
  }

  /**
   * Drain all values from the queues
   *
   * @returns {Promise<Array>} array of search results.
   */
  async empty() {
    const items = await Promise.all(this.queues.map((queue) => queue.empty()));
    return flatten(items);
  }
}

module.exports = {
  DbGranuleSearchQueues,
  convertToDBCollectionSearchParams,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  convertToGranuleSearchParams,
  filterCMRCollections,
  initialReportHeader,
  searchParamsForCollectionIdArray,
};
