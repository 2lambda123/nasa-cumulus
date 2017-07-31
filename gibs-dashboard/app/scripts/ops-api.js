/**
 * Provides functions for accessing the GIBS Ops API.
 */
const { fromJS } = require('immutable');
const rp = require('request-promise');
const canned = require('./ops-api/canned-data');
/**
 * getApiHealth - Gets the health of the Ops API
 *
 * @param  config APP configuration
 * @return A promise delivering the health.
 */
const getApiHealth = (config) => {
  if (config.get('useCannedData')) {
    return { 'ok?': true };
  }
  return rp({ uri: `${config.get('apiBaseUrl')}/health`, json: true });
};

 /**
  * getWorkflowStatus - Fetches the list of workflow status details.
  *
  * @param  config APP configuration
  * @return A promise delivering the list of workflow statuses.
  */
const getWorkflowStatus = async (config) => {
  let workflows;
  if (config.get('useCannedData')) {
    workflows = canned.getWorkflowStatusResp;
  }
  else {
    workflows = await rp(
      { uri: `${config.get('apiBaseUrl')}/workflow_status`, json: true });
  }
  return fromJS(workflows);
};

/**
 * getServiceStatus - Fetches the list of service status details.
 *
 * @param  config APP configuration
 * @return A promise delivering the list of service statuses.
 */
const getServiceStatus = async (config) => {
  let services;
  if (config.get('useCannedData')) {
    services = canned.getServiceStatusResp;
  }
  else {
    services = await rp({ uri: `${config.get('apiBaseUrl')}/service_status`, json: true });
  }
  return fromJS(services);
};

/**
 * getProductStatus - Fetches the list of product status details.
 *
 * @param  config APP configuration
 * @return A promise delivering the list of product statuses.
 */
const getProductStatus = async (config, workflowId, collectionId) => {
  let products;
  if (config.get('useCannedData')) {
    products = canned.getProductStatusResp;
  }
  else {
    products = await rp(
      { uri: `${config.get('apiBaseUrl')}/product_status`,
        qs: {
          stack_name: config.get('stackName'),
          workflow_id: workflowId,
          collection_id: collectionId,
          num_executions: config.get('numExecutions')
        },
        json: true });
  }
  return fromJS(products);
};

/**
 * Submits a request to reingest the granule. Returns a promise with response.
 */
const reingestGranule = (config, collectionId, granuleId) =>
  rp({
    uri: `${config.get('apiBaseUrl')}/reingest_granule`,
    method: 'POST',
    qs: {
      stack_name: config.get('stackName'),
      collection_id: collectionId,
      granule_id: granuleId
    },
    json: true
  }
);

/**
 * Submits a request to reingest granules across multiple collections in a date range. Returns a
 * promise with response.
 */
const reingestGranules = (config, collectionIds, startDate, endDate) =>
  rp({
    uri: `${config.get('apiBaseUrl')}/reingest_granules`,
    method: 'POST',
    qs: {
      stack_name: config.get('stackName'),
      collection_ids: collectionIds.join(','),
      start_date: startDate.valueOf(),
      end_date: endDate.valueOf()
    },
    json: true
  });

module.exports = {
  getApiHealth,
  getWorkflowStatus,
  getServiceStatus,
  getProductStatus,
  reingestGranule,
  reingestGranules
};
