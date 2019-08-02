locals {
  deploy_to_vpc  = length(var.subnet_ids) > 0 ? true : false
  es_domain_name = "${var.prefix}-${var.elasticsearch_config.domain_name}"
}

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "es_access_policy" {
  statement {
    actions = [
      "es:*"
    ]

    principals {
      type        = "AWS"
      identifiers = var.es_trusted_role_arns
    }

    resources = [
      "arn:aws:es:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:domain/${local.es_domain_name}/*"
    ]
  }
}

resource "aws_iam_service_linked_role" "es" {
  count            = var.include_elasticsearch && local.deploy_to_vpc && var.create_service_linked_role ? 1 : 0
  aws_service_name = "es.amazonaws.com"
}

resource "aws_elasticsearch_domain" "es" {
  count                 = var.include_elasticsearch && local.deploy_to_vpc == false ? 1 : 0
  domain_name           = local.es_domain_name
  elasticsearch_version = var.elasticsearch_config.version

  cluster_config {
    instance_count = var.elasticsearch_config.instance_count
    instance_type  = var.elasticsearch_config.instance_type
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp2"
    volume_size = var.elasticsearch_config.volume_size
  }

  advanced_options = {
    "rest.action.multi.allow_explicit_index" = "true"
  }

  snapshot_options {
    automated_snapshot_start_hour = 0
  }
}

resource "aws_elasticsearch_domain_policy" "es_domain_policy" {
  count           = var.include_elasticsearch && local.deploy_to_vpc == false ? 1 : 0
  domain_name     = aws_elasticsearch_domain.es[0].domain_name
  access_policies = data.aws_iam_policy_document.es_access_policy.json
  depends_on      = ["aws_elasticsearch_domain.es"]
}

resource "aws_elasticsearch_domain" "es_vpc" {
  count                 = var.include_elasticsearch && local.deploy_to_vpc ? 1 : 0
  domain_name           = "${local.es_domain_name}-vpc"
  elasticsearch_version = var.elasticsearch_config.version

  cluster_config {
    instance_count = var.elasticsearch_config.instance_count
    instance_type  = var.elasticsearch_config.instance_type
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp2"
    volume_size = var.elasticsearch_config.volume_size
  }

  advanced_options = {
    "rest.action.multi.allow_explicit_index" = "true"
  }

  vpc_options {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_groups
  }

  snapshot_options {
    automated_snapshot_start_hour = 0
  }

  depends_on = [
    "aws_iam_service_linked_role.es"
  ]
}

resource "aws_elasticsearch_domain_policy" "es_vpc_domain_policy" {
  count           = var.include_elasticsearch && local.deploy_to_vpc ? 1 : 0
  domain_name     = aws_elasticsearch_domain.es_vpc[0].domain_name
  access_policies = data.aws_iam_policy_document.es_access_policy.json
  depends_on      = ["aws_elasticsearch_domain.es_vpc"]
}
