resource "aws_lambda_function" "cnm_response_task" {
  function_name = "${var.prefix}-CnmResponse"
  s3_bucket     = "cumulus-data-shared"
  s3_key        = "daacs/podaac/cnmPreReleases/cnmResponse-1.0.6-cma1.3.0-c.zip"
  handler       = "gov.nasa.cumulus.CNMResponse::handleRequestStreams"
  role          = module.cumulus.lambda_processing_role_arn
  runtime       = "java8"
  timeout       = 300
  memory_size   = 256

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
      stackName                   = var.prefix
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [aws_security_group.no_ingress_all_egress.id]
    }
  }

  tags = local.tags
}
