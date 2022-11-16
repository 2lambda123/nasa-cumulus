resource "aws_lambda_function" "post_to_cmr_task" {
  function_name    = "${var.prefix}-PostToCmr"
  filename         = "${path.module}/../../tasks/post-to-cmr/dist/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../tasks/post-to-cmr/dist/lambda.zip")
  handler          = "index.handler"
  role             = var.lambda_processing_role_arn
  runtime          = "nodejs14.x"
  timeout          = lookup(var.lambda_timeouts, "post_to_cmr_task_timeout", 300)
  memory_size      = lookup(var.lambda_memory_sizes, "post_to_cmr_task_memory_size", 512)

  layers = [var.cumulus_message_adapter_lambda_layer_version_arn]

  environment {
    variables = {
      CMR_ENVIRONMENT             = var.cmr_environment
      CMR_HOST                    = var.cmr_custom_host
      stackName                   = var.prefix
      system_bucket               = var.system_bucket
      CUMULUS_MESSAGE_ADAPTER_DIR = "/opt/"
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.lambda_subnet_ids) == 0 ? [] : [1]
    content {
      subnet_ids = var.lambda_subnet_ids
      security_group_ids = [
        aws_security_group.no_ingress_all_egress[0].id
      ]
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "post_to_cmr_task" {
  name = "/aws/lambda/${aws_lambda_function.post_to_cmr_task.function_name}"
  retention_in_days = var.cloudwatch_log_retention_in_days
  tags = var.tags
}
