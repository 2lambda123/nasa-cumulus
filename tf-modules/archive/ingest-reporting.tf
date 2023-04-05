# Report executions

resource "aws_iam_role" "publish_executions_lambda_role" {
  name                 = "${var.prefix}-PublishExecutionsLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn
  tags                 = var.tags
}

resource "aws_sqs_queue" "publish_executions_dead_letter_queue" {
  name                       = "${var.prefix}-publishExecutionsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = var.tags
}

resource "aws_lambda_function" "publish_executions" {
  depends_on = [aws_cloudwatch_log_group.publish_executions_logs]

  filename         = "${path.module}/../../packages/api/dist/publishExecutions/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/publishExecutions/lambda.zip")
  function_name    = "${var.prefix}-publishExecutions"
  role             = aws_iam_role.publish_executions_lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = 30
  memory_size      = 128


  dead_letter_config {
    target_arn = aws_sqs_queue.publish_executions_dead_letter_queue.arn
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

  environment {
    variables = {
      execution_sns_topic_arn = aws_sns_topic.report_executions_topic.arn
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "publish_executions_logs" {
  name              = "/aws/lambda/${var.prefix}-publishExecutions"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "archive_publish_executions_log_retention", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_sns_topic" "report_executions_topic" {
  name = "${var.prefix}-report-executions-topic"
  tags = var.tags
}

# Report granules
resource "aws_iam_role" "publish_granules_lambda_role" {
  name                 = "${var.prefix}-PublishGranulesLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

resource "aws_sqs_queue" "publish_granules_dead_letter_queue" {
  name                       = "${var.prefix}-publishGranulesDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = var.tags
}
resource "aws_lambda_function" "publish_granules" {
  filename         = "${path.module}/../../packages/api/dist/publishGranules/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/publishGranules/lambda.zip")
  function_name    = "${var.prefix}-publishGranules"
  role             = aws_iam_role.publish_granules_lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = 30
  memory_size      = 128

  dead_letter_config {
    target_arn = aws_sqs_queue.publish_granules_dead_letter_queue.arn
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

  environment {
    variables = {
      granule_sns_topic_arn = aws_sns_topic.report_granules_topic.arn
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "publish_granules_logs" {
  name              = "/aws/lambda/${aws_lambda_function.publish_granules.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "archive_publish_granule_log_retention", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_sns_topic" "report_granules_topic" {
  name = "${var.prefix}-report-granules-topic"
  tags = var.tags
}

# Report PDRs

resource "aws_iam_role" "publish_pdrs_lambda_role" {
  name                 = "${var.prefix}-PublishPdrsLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}

data "aws_iam_policy_document" "publish_pdrs_policy_document" {
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.report_pdrs_topic.arn]
  }
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = ["*"]
  }
  statement {
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }
  statement {
    actions = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.publish_pdrs_dead_letter_queue.arn]
  }
}

resource "aws_iam_role_policy" "publish_pdrs_lambda_role_policy" {
  name   = "${var.prefix}_publish_pdrs_lambda_role_policy"
  role   = aws_iam_role.publish_pdrs_lambda_role.id
  policy = data.aws_iam_policy_document.publish_pdrs_policy_document.json
}

resource "aws_sqs_queue" "publish_pdrs_dead_letter_queue" {
  name                       = "${var.prefix}-publishPdrsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = var.tags
}

resource "aws_lambda_function" "publish_pdrs" {
  filename         = "${path.module}/../../packages/api/dist/publishPdrs/lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../packages/api/dist/publishPdrs/lambda.zip")
  function_name    = "${var.prefix}-publishPdrs"
  role             = aws_iam_role.publish_pdrs_lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"
  timeout          = 30
  memory_size      = 128

  dead_letter_config {
    target_arn = aws_sqs_queue.publish_pdrs_dead_letter_queue.arn
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

  environment {
    variables = {
      pdr_sns_topic_arn = aws_sns_topic.report_pdrs_topic.arn
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "publish_pdrs_logs" {
  name              = "/aws/lambda/${aws_lambda_function.publish_pdrs.function_name}"
  retention_in_days = lookup(var.cloudwatch_log_retention_periods, "archive_publish_pdrs_log_retention", var.default_log_retention_days)
  tags              = var.tags
}

resource "aws_sns_topic" "report_pdrs_topic" {
  name = "${var.prefix}-report-pdrs-topic"
  tags = var.tags
}

# Report collections

resource "aws_iam_role" "publish_collections_lambda_role" {
  name                 = "${var.prefix}-PublishCollectionsLambda"
  assume_role_policy   = data.aws_iam_policy_document.lambda_assume_role_policy.json
  permissions_boundary = var.permissions_boundary_arn

  tags = var.tags
}


resource "aws_sqs_queue" "publish_collections_dead_letter_queue" {
  name                       = "${var.prefix}-publishCollectionsDeadLetterQueue"
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
  tags                       = var.tags
}

resource "aws_sns_topic" "report_collections_topic" {
  name = "${var.prefix}-report-collections-topic"
  tags = var.tags
}

