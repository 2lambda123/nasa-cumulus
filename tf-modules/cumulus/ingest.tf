module "ingest" {
  source = "../ingest"

  prefix = var.prefix

  # Buckets config
  system_bucket = var.system_bucket

  # VPC config
  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  # IAM config
  permissions_boundary_arn   = var.permissions_boundary_arn
  lambda_processing_role_arn = aws_iam_role.lambda_processing.arn

  # CMR config
  cmr_environment = var.cmr_environment

  # DB config
  dynamo_tables = var.dynamo_tables
}
