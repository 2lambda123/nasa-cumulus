'use strict';

const { removeNilProperties } = require('@cumulus/common/util');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { deconstructCollectionId } = require('./utils');

/**
 * Simple converter from input reportParams to CMR searchCollection params.
 * e.g.:
 * {collectionId: "name__version"} => {short_name: 'name', version: 'version'}
 * @param {Object} reportParams
 * @returns {Object} correct paremeters to call cmr.searchCollection with.
 */
function cmrSearchParams(reportParams) {
  const { collectionId } = reportParams;
  const { name, version } = collectionId
    ? deconstructCollectionId(collectionId)
    : {};
  const collection = { short_name: name, version };
  return removeNilProperties(collection);
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
  const collection =
    collectionIds && collectionIds[0]
      ? deconstructCollectionId(collectionIds[0])
      : {};
  // right now its {name:X,  version:Y}  TODO [MHS, 09/09/2020]  - make different search.
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
  return removeNilProperties({
    updatedAt__from: dateToValue(params.startTimestamp),
    updatedAt__to: dateToValue(params.endTimestamp),
    collectionId: collectionIds && collectionIds[0],
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

module.exports = {
  cmrSearchParams,
  convertToESCollectionSearchParams,
  convertToESGranuleSearchParams,
  convertToGranuleSearchParams,
  filterCMRCollections,
  initialReportHeader,
  searchParamsForCollectionIdArray,
};
