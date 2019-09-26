# Data Persistence

This module deploys data persistence resources, including DynamoDB tables and an Elasticsearch instance (which is optional).

## Deployment

1. Copy the .tfvars sample file: `cp terraform.tfvars.sample terraform.tfvars`
2. Populate the sample file with values that apply to your AWS environment (see configuration variables section below).
3. Deploy this module: `terraform apply`

## Included resources

- DynamoDB tables:
  - `AccessTokensTable`
  - `AsyncOperationsTable`
  - `CollectionsTable`
  - `ExecutionsTable`
  - `FilesTable`
  - `GranulesTable`
  - `PdrsTable`
  - `ProvidersTable`
  - `RulesTable`
  - `SemaphoresTable`
  - `UsersTable`
- Elasticsearch domain (with optional VPC configuration)
- Cloudwatch alarm for Elasticsearch node count

**Please note**: All created resource names will be prefixed with the value of your `prefix` variable plus a hyphen (e.g. `prefix-AccessTokensTable`).

## Configuration

Configuration variables are shown in [`terraform.tfvars.sample`](./terraform.tfvars.sample) and are explained below. See [variables.tf](./variables.tf) for default values.

- `prefix` - prefix to use for naming created resources
- `es_trusted_role_arns` - IAM role ARNs that should be trusted for accessing Elasticsearch
- `create_service_linked_role` - Whether to create an IAM service linked role for Elasticsearch. A service linked role is required for deploying Elasticsearch in a VPC. **However, a service linked role can only be created once per account, so you should set this variable to `false` if you already have one deloyed.**
- `include_elasticsearch` - Whether to include Elasticsearch in the deployment. `false` will exclude Elasticsearch from the deployment.
- `elasticsearch_config` - Configuration for the Elasticsearch instance
- `enable_point_in_time_tables` - Names of DynamoDB tables that should have point in time recovery enabled. Any of the table names [listed above](#included-resources) are valid (use the table name without the prefix).
- `subnet_ids` - Subnet IDs that should be used when deploying Elasticsearch inside of a VPC. **If no subnet IDs are provided, Elasticsearch will not be deployed inside of a VPC.**
