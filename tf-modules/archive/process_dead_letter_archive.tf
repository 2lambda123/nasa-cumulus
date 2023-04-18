resource "aws_iam_role" "process_dead_letter_archive_role" {
  name                 = "${var.prefix}_process_dead_letter_archive_role"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_lambda_function" "process_dead_letter_archive" {
  depends_on       = [aws_cloudwatch_log_group.process_dead_letter_archive]
  filename         = "${path.module}/../../packages/api/dist/processDeadLetterArchive/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/processDeadLetterArchive/lambda.zip")
  function_name    = "${var.prefix}-processDeadLetterArchive"
  role             = var.lambda_processing_role_arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = 300
  memory_size      = 512

  environment {
    variables = {
      acquireTimeoutMillis           = var.rds_connection_timing_configuration.acquireTimeoutMillis
      createRetryIntervalMillis      = var.rds_connection_timing_configuration.createRetryIntervalMillis
      createTimeoutMillis            = var.rds_connection_timing_configuration.createTimeoutMillis
      databaseCredentialSecretArn    = var.rds_user_access_secret_arn
      execution_sns_topic_arn        = aws_sns_topic.report_executions_topic.arn
      granule_sns_topic_arn          = aws_sns_topic.report_granules_topic.arn
      idleTimeoutMillis              = var.rds_connection_timing_configuration.idleTimeoutMillis
      pdr_sns_topic_arn              = aws_sns_topic.report_pdrs_topic.arn
      reapIntervalMillis             = var.rds_connection_timing_configuration.reapIntervalMillis
      stackName                      = var.prefix
      system_bucket                  = var.system_bucket
      RDS_DEPLOYMENT_CUMULUS_VERSION = "9.0.0"
      ES_HOST                        = var.elasticsearch_hostname
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = compact([
        aws_security_group.no_ingress_all_egress[0].id,
        var.rds_security_group
      ])
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "process_dead_letter_archive" {
  name = "/aws/lambda/${var.prefix}-processDeadLetterArchive"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "processDeadLetterArchive", var.default_log_retention_days)
  tags = var.tags
}
