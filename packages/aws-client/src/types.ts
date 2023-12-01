import * as AWS from 'aws-sdk';

import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { CloudWatchEvents } from '@aws-sdk/client-cloudwatch-events';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDB, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Lambda } from '@aws-sdk/client-lambda';
import { S3 } from '@aws-sdk/client-s3';
import { SNS } from '@aws-sdk/client-sns';
import { SQS } from '@aws-sdk/client-sqs';

export type AWSClientTypes = APIGatewayClient | DynamoDB | CloudWatchEvents
| DynamoDBClient | DynamoDBStreamsClient | Lambda | S3 | SNS | SQS
| AWS.Service | AWS.DynamoDB.DocumentClient;
