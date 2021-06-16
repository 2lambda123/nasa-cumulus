import { ExecutionRecord } from '@cumulus/types/api/executions';
import { invokeApi } from './cumulusApiClient';
import { ApiGatewayLambdaHttpProxyResponse, InvokeApiFunction } from './types';

/**
 * Fetch an execution from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution fetched by the API
 */
export const getExecution = async (params: {
  prefix: string,
  arn: string,
  callback?: InvokeApiFunction
}): Promise<ExecutionRecord> => {
  const { prefix, arn, callback = invokeApi } = params;

  const response = await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/${arn}`,
    },
  });

  return JSON.parse(response.body);
};

/**
 * Fetch a list of executions from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution list fetched by the API
 */
export const getExecutions = async (params: {
  prefix: string,
  query?: {
    fields?: string[] | string
    [key: string]: string | string[] | undefined
  },
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, query, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: '/executions',
      queryStringParameters: query,
    },
  });
};

/**
 * get execution status from the Cumulus API
 *
 * @param {Object} params            - params
 * @param {string} params.prefix     - the prefix configured for the stack
 * @param {string} params.arn        - an execution arn
 * @param {Function} params.callback - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}        - the execution status fetched by the API
 */
export const getExecutionStatus = async (params: {
  prefix: string,
  arn: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, arn, callback = invokeApi } = params;

  return await callback({
    prefix: prefix,
    payload: {
      httpMethod: 'GET',
      resource: '/{proxy+}',
      path: `/executions/status/${arn}`,
    },
  });
};

/**
 * DELETE /executions/{executionArn}
 *
 * @param {Object} params              - params
 * @param {string} params.prefix       - the prefix configured for the stack
 * @param {Object} params.executionArn - the execution ARN
 * @param {Function} params.callback   - async function to invoke the api lambda
 *                                     that takes a prefix / user payload.  Defaults
 *                                     to cumulusApiClient.invokeApi
 * @returns {Promise<Object>}          - the response from the callback
 */
export const deleteExecution = async (params: {
  prefix: string,
  executionArn: string,
  callback?: InvokeApiFunction
}): Promise<ApiGatewayLambdaHttpProxyResponse> => {
  const { prefix, executionArn, callback = invokeApi } = params;

  return await callback({
    prefix,
    payload: {
      httpMethod: 'DELETE',
      resource: '/{proxy+}',
      path: `/executions/${executionArn}`,
    },
  });
};
