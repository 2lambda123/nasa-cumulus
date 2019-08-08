# Required

variable "log_api_gateway_to_cloudwatch" {
  type        = bool
  default     = false
  description = "Enable logging of API Gateway activity to CloudWatch."
}

variable "log_destination_arn" {
  type        = string
  default     = null
  description = "Remote kinesis/destination arn for delivering logs. Requires log_api_gateway_to_cloudwatch set to true."
}

variable "s3_replicator_source_bucket" {
  type        = string
  default     = null
  description = "Used with the s3-replicator module. Source bucket from which new objects will be replicated."
}

variable "s3_replicator_source_prefix" {
  type        = string
  default     = null
  description = "Used with the s3-replicator module. Any new objects in source_bucket that start with this prefix will be replicated."
}

variable "s3_replicator_target_bucket" {
  type        = string
  default     = null
  description = "Used with the s3-replicator module. Target bucket to which new objects will be replicated."
}

variable "s3_replicator_target_prefix" {
  type        = string
  default     = null
  description = "Used with the s3-replicator module. New objects will be replicated with this prefix to the target_bucket."
}

variable "prefix" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "system_bucket" {
  type = string
}

variable "urs_client_id" {
  type = string
}

variable "urs_client_password" {
  type = string
}

variable "vpc_id" {
  type = string
}

# Optional

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "protected_buckets" {
  type    = list(string)
  default = []
}

variable "public_buckets" {
  type    = list(string)
  default = []
}

variable "permissions_boundary_arn" {
  type    = string
  default = null
}

variable "distribution_url" {
  type    = string
  default = null
}

variable "aws_profile" {
  type = string
  default = null
}
