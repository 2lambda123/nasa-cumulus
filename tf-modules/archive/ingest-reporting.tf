# Report executions
resource "aws_sns_topic" "report_executions_topic" {
  name = "${var.prefix}-report-executions-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_executions_topic_policy" {
  count = var.add_report_topic_policy ? 1 : 0

  arn = aws_sns_topic.report_executions_topic.arn
  policy = data.aws_iam_policy_document.report_execution_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_execution_sns_topic_policy" {
  statement {
    actions = [
      "sns:Subscribe",
    ]
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = distinct(compact(var.metrics_account_id))
    }

    resources = [
      aws_sns_topic.report_executions_topic.arn,
    ]
  }

  statement {
    actions = [
      "SNS:Subscribe",
      "SNS:SetTopicAttributes",
      "SNS:RemovePermission",
      "SNS:Receive",
      "SNS:Publish",
      "SNS:ListSubscriptionsByTopic",
      "SNS:GetTopicAttributes",
      "SNS:DeleteTopic",
      "SNS:AddPermission",
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_executions_topic.arn,
    ]

    sid = "__default_statement_ID"
  }
}

# Report granules
resource "aws_sns_topic" "report_granules_topic" {
  name = "${var.prefix}-report-granules-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_granules_topic_policy" {
  count = var.add_report_topic_policy ? 1 : 0

  arn = aws_sns_topic.report_granules_topic.arn
  policy = data.aws_iam_policy_document.report_granules_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_granules_sns_topic_policy" {
  statement {
    actions = [
      "sns:Subscribe",
    ]
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = distinct(compact(var.metrics_account_id))
    }

    resources = [
      aws_sns_topic.report_granules_topic.arn,
    ]
  }
  policy_id = "__default_policy_ID"

  statement {
    actions = [
      "SNS:Subscribe",
      "SNS:SetTopicAttributes",
      "SNS:RemovePermission",
      "SNS:Receive",
      "SNS:Publish",
      "SNS:ListSubscriptionsByTopic",
      "SNS:GetTopicAttributes",
      "SNS:DeleteTopic",
      "SNS:AddPermission",
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_granules_topic.arn,
    ]

    sid = "__default_statement_ID"
  }
}

# Report PDRs
resource "aws_sns_topic" "report_pdrs_topic" {
  name = "${var.prefix}-report-pdrs-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_pdrs_topic_policy" {
  count = var.add_report_topic_policy ? 1 : 0

  arn = aws_sns_topic.report_pdrs_topic.arn
  policy = data.aws_iam_policy_document.report_pdrs_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_pdrs_sns_topic_policy" {
  statement {
    actions = [
      "sns:Subscribe",
    ]
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = distinct(compact(var.metrics_account_id))
    }

    resources = [
      aws_sns_topic.report_pdrs_topic.arn,
    ]
  }
  policy_id = "__default_policy_ID"

  statement {
    actions = [
      "SNS:Subscribe",
      "SNS:SetTopicAttributes",
      "SNS:RemovePermission",
      "SNS:Receive",
      "SNS:Publish",
      "SNS:ListSubscriptionsByTopic",
      "SNS:GetTopicAttributes",
      "SNS:DeleteTopic",
      "SNS:AddPermission",
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_pdrs_topic.arn,
    ]

    sid = "__default_statement_ID"
  }
}
# Report collections
resource "aws_sns_topic" "report_collections_topic" {
  name = "${var.prefix}-report-collections-topic"
  tags = var.tags
}

resource "aws_sns_topic_policy" "report_collections_topic_policy" {
  count = var.add_report_topic_policy ? 1 : 0

  arn = aws_sns_topic.report_collections_topic.arn
  policy = data.aws_iam_policy_document.report_collections_sns_topic_policy.json
}

data "aws_iam_policy_document" "report_collections_sns_topic_policy" {
  statement {
    actions = [
      "sns:Subscribe",
    ]
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = distinct(compact(var.metrics_account_id))
    }

    resources = [
      aws_sns_topic.report_collections_topic.arn,
    ]
  }
  policy_id = "__default_policy_ID"

  statement {
    actions = [
      "SNS:Subscribe",
      "SNS:SetTopicAttributes",
      "SNS:RemovePermission",
      "SNS:Receive",
      "SNS:Publish",
      "SNS:ListSubscriptionsByTopic",
      "SNS:GetTopicAttributes",
      "SNS:DeleteTopic",
      "SNS:AddPermission",
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"

      values = [
        data.aws_caller_identity.current.account_id,
      ]
    }

    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    resources = [
      aws_sns_topic.report_collections_topic.arn,
    ]

    sid = "__default_statement_ID"
  }
}
