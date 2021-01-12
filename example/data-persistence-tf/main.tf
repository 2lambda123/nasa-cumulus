terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 3.14.1"
    }
  }
}

provider "aws" {
  region = var.aws_region

  ignore_tags {
    key_prefixes = ["gsfc-ngap"]
  }
}

module "data_persistence" {
  source                      = "../../tf-modules/data-persistence"
  prefix                      = var.prefix
  subnet_ids                  = var.subnet_ids
  enable_point_in_time_tables = var.enable_point_in_time_tables

  elasticsearch_config = var.elasticsearch_config

  tags = merge(var.tags, { Deployment = var.prefix })
}
