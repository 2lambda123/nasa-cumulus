'use strict';

const get = require('lodash/get');
const cloneDeep = require('lodash/cloneDeep');

const awsServices = require('@cumulus/aws-client/services');
const CloudwatchEvents = require('@cumulus/aws-client/CloudwatchEvents');
const Logger = require('@cumulus/logger');
const {
  RulePgModel,
} = require('@cumulus/db');

const { listRules } = require('@cumulus/api-client/rules');
const { removeNilProperties } = require('@cumulus/common/util');
const { ValidationError } = require('@cumulus/errors');
const { invoke } = require('@cumulus/aws-client/Lambda');
const { sqsQueueExists } = require('@cumulus/aws-client/SQS');

const Logger = require('@cumulus/logger');

const { handleScheduleEvent } = require('../lambdas/sf-scheduler');
const { isResourceNotFoundException, ResourceNotFoundError } = require('./errors');
const Rule = require('../models/rules');

const log = new Logger({ sender: '@cumulus/rulesHelpers' });
/**
 * fetch all rules in the Cumulus API
 *
 * @param {Object} params - function params
 * @param {number} [params.pageNumber] - current page of API results
 * @param {Array<Object>} [params.rules] - partial rules Array
 * @param {Object} [params.queryParams] - API query params, empty query returns all rules
 * @returns {Array<Object>} all matching rules
 */
async function fetchRules({ pageNumber = 1, rules = [], queryParams = {} }) {
  const query = { ...queryParams, page: pageNumber };
  const apiResponse = await listRules({
    prefix: process.env.stackName,
    query,
  });
  const responseBody = JSON.parse(apiResponse.body);
  if (responseBody.results.length > 0) {
    return fetchRules({
      pageNumber: (pageNumber + 1),
      rules: rules.concat(responseBody.results),
      queryParams,
    });
  }
  return rules;
}

async function fetchAllRules() {
  return await fetchRules({});
}

async function fetchEnabledRules() {
  return await fetchRules({ queryParams: { state: 'ENABLED' } });
}

const collectionRuleMatcher = (rule, collection) => {
  // Match as much collection info as we found in the message
  const nameMatch = collection.name
    ? get(rule, 'collection.name') === collection.name
    : true;
  const versionMatch = collection.version
    ? get(rule, 'collection.version') === collection.version
    : true;
  return nameMatch && versionMatch;
};

const filterRulesbyCollection = (rules, collection = {}) => rules.filter(
  (rule) => collectionRuleMatcher(rule, collection)
);

const filterRulesByRuleParams = (rules, ruleParams) => rules.filter(
  (rule) => {
    const typeMatch = ruleParams.type ? get(ruleParams, 'type') === rule.rule.type : true;
    const collectionMatch = collectionRuleMatcher(rule, ruleParams);
    const sourceArnMatch = ruleParams.sourceArn
      ? get(ruleParams, 'sourceArn') === rule.rule.value
      : true;
    return typeMatch && collectionMatch && sourceArnMatch;
  }
);

const getMaxTimeoutForRules = (rules) => rules.reduce(
  (prevMax, rule) => {
    const ruleTimeout = get(rule, 'meta.visibilityTimeout');
    if (!ruleTimeout) return prevMax;
    return Math.max(
      prevMax || 0,
      ruleTimeout
    );
  },
  undefined
);

function lookupCollectionInEvent(eventObject) {
  // standard case (collection object), or CNM case
  return removeNilProperties({
    name: get(eventObject, 'collection.name', get(eventObject, 'collection')),
    version: get(eventObject, 'collection.version', get(eventObject, 'product.dataVersion')),
    dataType: get(eventObject, 'collection.dataType'),
  });
}

/**
 * Queue a workflow message for the kinesis/sqs rule with the message passed
 * to stream/queue as the payload
 *
 * @param {Object} rule - rule to queue the message for
 * @param {Object} eventObject - message passed to stream/queue
 * @param {Object} eventSource - source information of the event
 * @returns {Promise} promise resolved when the message is queued
 */
async function queueMessageForRule(rule, eventObject, eventSource) {
  const collectionInNotification = lookupCollectionInEvent(eventObject);
  const collection = (collectionInNotification.name && collectionInNotification.version)
    ? collectionInNotification
    : rule.collection;
  const item = {
    ...rule,
    collection,
    meta: eventSource ? { ...rule.meta, eventSource } : rule.meta,
    payload: eventObject,
  };

  const payload = await Rule.buildPayload(item);
  return handleScheduleEvent(payload);
}

/**
 * Check if a rule's event source mapping is shared with other rules
 *
 * @param {Knex} knex - DB client
 * @param {Object} rule      - the rule item
 * @param {Object} eventType - the rule's event type
 * @returns {Promise<boolean>} return true if other rules share the same event source mapping
 */
async function isEventSourceMappingShared(knex, rule, eventType) {
  const rulePgModel = new RulePgModel();
  // Query for count of any other rule that has the same type and arn
  const params = {
    type: rule.type,
    ...eventType,
  };
  const [result] = await rulePgModel.count(knex, [[params]]);

  return (result.count > 1);
}

/**
 * Deletes an event source from an event lambda function
 *
 * @param {Knex} knex - DB client
 * @param {Object} rule      - the rule item
 * @param {string} eventType - kinesisSourceEvent type
 * @param {string} id        - event source id
 * @returns {Promise} the response from event source delete
 */
async function deleteKinesisEventSource(knex, rule, eventType, id) {
  if (!(await isEventSourceMappingShared(knex, rule, id))) {
    const params = {
      UUID: id[eventType],
    };
    log.info(`Deleting event source with UUID ${id[eventType]}`);
    return awsServices.lambda().deleteEventSourceMapping(params).promise();
  }
  log.info(`Event source mapping is shared with another rule. Will not delete kinesis event source for ${rule.name}`);
  return undefined;
}

/**
 * Delete event source mappings for all mappings in the kinesisSourceEvents
 * @param {Knex} knex - DB client
 * @param {Object} rule - the rule item
 * @returns {Promise<Array>} array of responses from the event source deletion
 */
async function deleteKinesisEventSources(knex, rule) {
  const kinesisSourceEvents = [
    {
      name: process.env.messageConsumer,
      eventType: 'arn',
      type: {
        arn: rule.arn,
      },
    },
    {
      name: process.env.KinesisInboundEventLogger,
      eventType: 'log_event_arn',
      type: {
        log_event_arn: rule.log_event_arn,
      },
    },
  ];
  const deleteEventPromises = kinesisSourceEvents.map(
    (lambda) => deleteKinesisEventSource(knex, rule, lambda.eventType, lambda.type).catch(
      (error) => {
        log.error(`Error deleting eventSourceMapping for ${rule.name}: ${error}`);
        if (error.code !== 'ResourceNotFoundException') throw error;
      }
    )
  );
  return await Promise.all(deleteEventPromises);
}

/**
 * Delete a rule's SNS trigger
 * @param {Knex} knex - DB client
 * @param {Object} rule - the rule item
 * @returns {Promise} the response from SNS unsubscribe
 */
async function deleteSnsTrigger(knex, rule) {
  // If event source mapping is shared by other rules, don't delete it
  if (await isEventSourceMappingShared(knex, rule, { arn: rule.arn })) {
    log.info(`Event source mapping ${rule} with type 'arn' is shared by multiple rules, so it will not be deleted.`);
    return Promise.resolve();
  }
  // delete permission statement
  const permissionParams = {
    FunctionName: process.env.messageConsumer,
    StatementId: `${rule.name}Permission`,
  };
  try {
    await awsServices.lambda().removePermission(permissionParams).promise();
  } catch (error) {
    if (isResourceNotFoundException(error)) {
      throw new ResourceNotFoundError(error);
    }
    throw error;
  }
  // delete sns subscription
  const subscriptionParams = {
    SubscriptionArn: rule.arn,
  };
  return awsServices.sns().unsubscribe(subscriptionParams).promise();
}

/**
 * Delete rule resources by rule type
 * @param {Knex} knex - DB client
 * @param {Object} rule - Rule
 */
async function deleteRuleResources(knex, rule) {
  const type = rule.type;
  log.info(`Initiating deletion of rule ${JSON.stringify(rule)}`);
  switch (type) {
  case 'scheduled': {
    const targetId = 'lambdaTarget';
    const name = `${process.env.stackName}-custom-${rule.name}`;
    await CloudwatchEvents.deleteTarget(targetId, name);
    await CloudwatchEvents.deleteEvent(name);
    break;
  }
  case 'kinesis': {
    await deleteKinesisEventSources(knex, rule);
    break;
  }
  case 'sns': {
    if (rule.enabled) {
      await deleteSnsTrigger(knex, rule);
    }
    break;
  }
  case 'sqs':
  default:
    break;
  }
}

/**
   * Add CloudWatch event rule and target
   *
   * @param {Object} item    - The rule item
   * @param {Object} payload - The payload input of the CloudWatch event
   * @returns {void}
   */
 async function addRule(item, payload) {
  const name = `${process.env.stackName}-custom-${item.name}`;
  const state = item.enabled ? 'ENABLED' : 'DISABLED';
  await CloudwatchEvents.putEvent(
    name,
    item.value,
    state,
    'Rule created by cumulus-api'
  );
  const targetId = 'lambdaTarget';

  await CloudwatchEvents.putTarget(
    name,
    targetId,
    process.env.invokeArn,
    JSON.stringify(payload)
  );
}

/**
   * Add an event source to a target lambda function
   *
   * @param {Object} item    - The rule item
   * @param {string} lambda  - The name of the target lambda
   * @returns {Promise}      - Updated rule item
   */
async function addKinesisEventSource(item, lambda) {
  // use the existing event source mapping if it already exists and is enabled
  const listParams = {
    FunctionName: lambda.name,
    EventSourceArn: item.value,
  };
  const listData = await awsServices.lambda().listEventSourceMappings(listParams).promise();
  if (listData.EventSourceMappings && listData.EventSourceMappings.length > 0) {
    const currentMapping = listData.EventSourceMappings[0];

    // This is for backwards compatibility. Mappings should no longer be disabled.
    if (currentMapping.State === 'Enabled') {
      return currentMapping;
    }
    return awsServices.lambda().updateEventSourceMapping({
      UUID: currentMapping.UUID,
      Enabled: true,
    }).promise();
  }

  // create event source mapping
  const params = {
    EventSourceArn: item.value,
    FunctionName: lambda.name,
    StartingPosition: 'TRIM_HORIZON',
    Enabled: true,
  };
  return awsServices.lambda().createEventSourceMapping(params).promise();
}

/**
 * Add  event sources for all mappings in the kinesisSourceEvents
 * @param {Object} rule - The rule item
 * @returns {Object}    - Returns updated rule item containing new arn and logEventArn
 */
async function addKinesisEventSources(rule) {
  const kinesisSourceEvents = [
    {
      name: process.env.messageConsumer,
    },
    {
      name: process.env.KinesisInboundEventLogger,
    },
  ];

  const sourceEventPromises = kinesisSourceEvents.map(
    (lambda) => addKinesisEventSource(rule, lambda).catch(
      (error) => {
        log.error(`Error adding eventSourceMapping for ${rule.name}: ${error}`);
        if (error.code !== 'ResourceNotFoundException') throw error;
      }
    )
  );
  const eventAdd = await Promise.all(sourceEventPromises);
  const arn = eventAdd[0].UUID;
  const logEventArn = eventAdd[1].UUID;
  return { arn, logEventArn };
}

/**
 * Update the event source mappings for Kinesis type rules.
 *
 * Avoids object mutation by cloning the original rule item.
 *
 * @param {Object} ruleItem
 *   A rule item
 * @param {Object} ruleArns
 * @param {string} ruleArns.arn
 *   UUID for event source mapping from Kinesis stream for messageConsumer Lambda
 * @param {string} ruleArns.logEventArn
 *   UUID for event source mapping from Kinesis stream to KinesisInboundEventLogger Lambda
 * @returns {Object}
 *   Updated rule item
 */
function updateKinesisRuleArns(ruleItem, ruleArns) {
  const updatedRuleItem = cloneDeep(ruleItem);
  updatedRuleItem.arn = ruleArns.arn;
  updatedRuleItem.log_event_arn = ruleArns.logEventArn;
  return updatedRuleItem;
}

/**
 * Update the event source mappings for SNS type rules.
 *
 * @param {Object} rule - A rule item
 * @returns {Object}    - Updated rule item
 */
async function addSnsTrigger(rule) {
  // check for existing subscription
  let token;
  let subExists = false;
  let subscriptionArn;
  /* eslint-disable no-await-in-loop */
  do {
    const subsResponse = await awsServices.sns().listSubscriptionsByTopic({
      TopicArn: rule.value,
      NextToken: token,
    }).promise();
    token = subsResponse.NextToken;
    if (subsResponse.Subscriptions) {
      /* eslint-disable no-loop-func */
      subsResponse.Subscriptions.forEach((sub) => {
        if (sub.Endpoint === process.env.messageConsumer) {
          subExists = true;
          subscriptionArn = sub.SubscriptionArn;
        }
      });
    }
    /* eslint-enable no-loop-func */
    if (subExists) break;
  }
  while (token);
  /* eslint-enable no-await-in-loop */
  if (!subExists) {
    // create sns subscription
    const subscriptionParams = {
      TopicArn: rule.value,
      Protocol: 'lambda',
      Endpoint: process.env.messageConsumer,
      ReturnSubscriptionArn: true,
    };
    const r = await awsServices.sns().subscribe(subscriptionParams).promise();
    subscriptionArn = r.SubscriptionArn;
  }
  // create permission to invoke lambda
  const permissionParams = {
    Action: 'lambda:InvokeFunction',
    FunctionName: process.env.messageConsumer,
    Principal: 'sns.amazonaws.com',
    SourceArn: rule.value,
    StatementId: `${rule.name}Permission`,
  };
  await awsServices.lambda().addPermission(permissionParams).promise();
  return subscriptionArn;
}

/**
 * Update the event source mapping for SNS type rules.
 *
 * Avoids object mutation by cloning the original rule item.
 *
 * @param {Object} ruleItem
 *   A rule item
 * @param {string} snsSubscriptionArn
 *   UUID for event source mapping from SNS topic to messageConsumer Lambda
 * @returns {Object}
 *   Updated rule item
 */
function updateSnsRuleArn(ruleItem, snsSubscriptionArn) {
  const updatedRuleItem = cloneDeep(ruleItem);
  if (!snsSubscriptionArn) {
    delete updatedRuleItem.arn;
  } else {
    updatedRuleItem.arn = snsSubscriptionArn;
  }
  return updatedRuleItem;
}

/**
 * Validate and update SQS rule with queue property
 *
 * @param {Object} rule - The SQS rule
 * @returns {Object}    - Returns the updated SQS rule
 */
async function validateAndUpdateSqsRule(rule) {
  const ruleToUpdate = rule;
  const queueUrl = rule.value;
  if (!(await sqsQueueExists(queueUrl))) {
    throw new Error(`SQS queue ${queueUrl} does not exist or your account does not have permissions to access it`);
  }

  const qAttrParams = {
    QueueUrl: queueUrl,
    AttributeNames: ['All'],
  };
  const attributes = await awsServices.sqs().getQueueAttributes(qAttrParams).promise();
  if (!attributes.Attributes.RedrivePolicy) {
    throw new Error(`SQS queue ${queueUrl} does not have a dead-letter queue configured`);
  }

  // update rule meta
  if (!rule.meta.visibilityTimeout) {
    ruleToUpdate.meta.visibilityTimeout = Number.parseInt(
      attributes.Attributes.VisibilityTimeout,
      10
    );
  }
  if (!rule.meta.retries) {
    ruleToUpdate.meta.retries = 3;
  }
  return ruleToUpdate;
}

/*
 * Checks if record is valid
 * @param {Object} rule - Rule to check validation
 * @returns {void}      - Returns if record is valid, throws error otherwise
 */
function recordIsValid(rule) {
  const error = new Error('The record has validation errors');
  error.name = 'SchemaValidationError';
  if (!rule.name) {
    error.detail = 'Rule name is undefined.';
    throw error;
  }
  if (!rule.workflow) {
    error.detail = 'Rule workflow is undefined.';
    throw error;
  }
  if (!rule.type) {
    error.detail = 'Rule type is undefined.';
    throw error;
  }
}

/*
 * Creates rule trigger for rule
 * @param {Object} rule - Rule to create trigger for
 * @returns {Object}    - Returns new rule object
 */
async function createRuleTrigger(ruleItem) {
  let newRuleItem = cloneDeep(ruleItem);
  // the default value for enabled is true
  if (ruleItem.enabled === undefined) {
    newRuleItem.enabled = true;
  }

  // make sure the name only has word characters
  const re = /\W/;
  if (re.test(ruleItem.name)) {
    throw new ValidationError('Rule name may only contain letters, numbers, and underscores.');
  }

  // Validate rule before kicking off workflows or adding event source mappings
  recordIsValid(newRuleItem);

  const payload = await Rule.buildPayload(newRuleItem);
  switch (newRuleItem.type) {
  case 'onetime': {
    await invoke(process.env.invoke, payload);
    break;
  }
  case 'scheduled': {
    await addRule(newRuleItem, payload);
    break;
  }
  case 'kinesis': {
    const ruleArns = await addKinesisEventSources(newRuleItem);
    newRuleItem = updateKinesisRuleArns(newRuleItem, ruleArns);
    break;
  }
  case 'sns': {
    if (newRuleItem.enabled) {
      const snsSubscriptionArn = await addSnsTrigger(newRuleItem);
      newRuleItem = updateSnsRuleArn(newRuleItem, snsSubscriptionArn);
    }
    break;
  }
  case 'sqs':
    newRuleItem = await validateAndUpdateSqsRule(newRuleItem);
    break;
  default:
    throw new ValidationError(`Rule type \'${newRuleItem.type}\' not supported.`);
  }
  return newRuleItem;
}

module.exports = {
  createRuleTrigger,
  deleteKinesisEventSource,
  deleteKinesisEventSources,
  deleteRuleResources,
  deleteSnsTrigger,
  fetchAllRules,
  fetchEnabledRules,
  fetchRules,
  filterRulesbyCollection,
  filterRulesByRuleParams,
  getMaxTimeoutForRules,
  isEventSourceMappingShared,
  lookupCollectionInEvent,
  queueMessageForRule,
};
