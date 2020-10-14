# Required

variable "permissions_boundary_arn" {
  type    = string
}

variable "prefix" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "vpc_id" {
  type = string
}

# Optional

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "elasticsearch_config" {
  description = "Configuration object for Elasticsearch"
  type = object({
    domain_name    = string
    instance_count = number
    instance_type  = string
    version        = string
    volume_size    = number
  })
  default = {
    domain_name    = "es"
    instance_count = 1
    instance_type  = "t2.small.elasticsearch"
    version        = "5.3"
    volume_size    = 10
  }
}

variable "enable_point_in_time_tables" {
  description = "DynamoDB table names that should have point in time recovery enabled"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags to be applied to Cumulus resources that support tags"
  type        = map(string)
  default     = {}
}
