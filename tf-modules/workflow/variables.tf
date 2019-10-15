variable "distribution_url" {
  type = string
}

variable "name" {
  type = string
}

variable "prefix" {
  type = string
}

variable "state_machine_definition" {
  type = string
}

variable "state_machine_role_arn" {
  type = string
}

variable "publish_reports_lambda_function_arn" {
  type = string
}

variable "sf_semaphore_down_lambda_function_arn" {
  type = string
}

variable "system_bucket" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = null
}
