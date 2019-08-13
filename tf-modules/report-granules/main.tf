data "archive_file" "report_granules_package" {
  type        = "zip"
  source_file = "dist/index.js"
  output_path = "build/report_granules.zip"
}

resource "aws_lambda_function" "report_granules" {
  filename         = "build/report_granules.zip"
  function_name    = "${var.prefix}-report-granules"
  role             = "${aws_iam_role.report_granules_lambda_role.arn}"
  handler          = "index.handler"
  runtime          = "nodejs8.10"
  timeout          = 300
  memory_size      = 256

  source_code_hash = "${data.archive_file.report_granules_package.output_base64sha256}"
  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }
  environment {
    variables = {
      GranulesTable = var.granules_table
    }
  }
}

resource "aws_cloudwatch_log_group" "report_granules_logs" {
  name              = "/aws/lambda/${aws_lambda_function.report_granules.function_name}"
  retention_in_days = 14
}

resource "aws_sns_topic" "report_granules_topic" {
  name = "${var.prefix}-report-granules-topic"
}

resource "aws_sns_topic_subscription" "report_granules_trigger" {
  topic_arn = aws_sns_topic.report_granules_topic.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.report_granules.arn
}

resource "aws_lambda_permission" "report_granules_permission" {
  action        = "lambda:InvokeFunction"
  function_name = "${aws_lambda_function.report_granules.function_name}"
  principal     = "sns.amazonaws.com"
  source_arn    = "${aws_sns_topic.report_granules_topic.arn}"
}
