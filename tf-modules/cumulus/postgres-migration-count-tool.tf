module "postgres_migration_count_tool" {
  source = "../../lambdas/postgres-migration-count-tool"

  buckets                    = var.buckets
  prefix                     = var.prefix
  permissions_boundary_arn   = var.permissions_boundary_arn

  vpc_id                     = var.vpc_id
  lambda_subnet_ids          = var.lambda_subnet_ids

  dynamo_tables              = var.dynamo_tables
  rds_security_group_id      = var.rds_security_group
  rds_user_access_secret_arn = var.rds_user_access_secret_arn
  rds_connection_heartbeat   = var.rds_connection_heartbeat

  system_bucket              = var.system_bucket

  tags = var.tags
}
