
resource "aws_lambda_function" "discover_granules_task" {
  function_name    = "${var.prefix}-DiscoverGranules"
  filename         = "${path.module}/../../tasks/discover-granules/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/discover-granules/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs10.x"
  timeout          = 300
  memory_size      = 512

  layers = [var.cumulus_message_adapter_lambda_layer_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT               = var.cmr_environment
      stackName                     = var.prefix
      system_bucket                 = var.system_bucket
      GranulesTable                 = var.dynamo_tables.granules.name
      AuthTokensTable               = var.dynamo_tables.auth_tokens.name
      oauth_provider                = var.oauth_provider
      oauth_user_group              = var.oauth_user_group
      launchpad_api                 = var.launchpad_api
      launchpad_certificate         = var.launchpad_certificate
      launchpadPassphraseSecretName = length(var.launchpad_passphrase) == 0 ? "" : aws_secretsmanager_secret.message_template_launchpad_passphrase.name
      urs_id                        = var.urs_id
      urs_password_secret_name      = length(var.urs_password) == 0 ? null : aws_secretsmanager_secret.ingest_urs_password.name
      urs_url                       = var.urs_url
      archive_api_uri               = var.archive_api_uri
      auth_kms_key_id               = aws_kms_key.lambda_processing_authentication_key.key_id

      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
    }
  }

  vpc_config {
    subnet_ids         = var.lambda_subnet_ids
    security_group_ids = var.lambda_subnet_ids == null ? null : [aws_security_group.no_ingress_all_egress[0].id]
  }

  tags = var.tags
}
