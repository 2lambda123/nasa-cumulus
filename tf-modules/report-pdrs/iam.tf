data "aws_caller_identity" "current" { }

data "aws_iam_policy_document" "assume_lambda_role" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions   = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "report_pdrs_lambda_role" {
  name                 = "${var.prefix}_report_pdrs_lambda_role"
  assume_role_policy   = data.aws_iam_policy_document.assume_lambda_role.json
  permissions_boundary = var.permissions_boundary
}

data "aws_dynamodb_table" "pdrs_table" {
  name = var.pdrs_table
}

data "aws_iam_policy_document" "report_pdrs_policy_document" {
  statement {
    actions = [
      "dynamoDb:getItem",
      "dynamoDb:putItem"
    ]
    resources = [
      data.aws_dynamodb_table.pdrs_table.arn
    ]
  }
  statement {
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface"
    ]
    resources = [
      "*"
    ]
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
}

resource "aws_iam_role_policy" "report_pdrs_lambda_role_policy" {
  name   = "${var.prefix}_report_pdrs_lambda_role_policy"
  role   = aws_iam_role.report_pdrs_lambda_role.id
  policy = data.aws_iam_policy_document.report_pdrs_policy_document.json
}
