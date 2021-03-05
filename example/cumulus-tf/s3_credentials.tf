data "aws_lambda_function" "sts_credentials" {
  function_name = "gsfc-ngap-sh-s3-sts-get-keys"
}

module "s3_credentials" {
  source = "../../tf-modules/s3-credentials"

  prefix = var.prefix

  permissions_boundary_arn = var.permissions_boundary_arn

  public_buckets = local.public_bucket_names

  sts_credentials_lambda_function_arn = data.aws_lambda_function.sts_credentials.arn

  # Thin Egress App settings
  # must match stage_name variable for thin-egress-app module
  api_gateway_stage = local.tea_stage_name

  rest_api_id               = module.thin_egress_app.rest_api.id
  rest_api_root_resource_id = module.thin_egress_app.rest_api.root_resource_id
  external_api_endpoint     = module.thin_egress_app.api_endpoint

  urs_url             = var.urs_url
  urs_client_id       = var.urs_client_id
  urs_client_password = var.urs_client_password

  vpc_id            = var.vpc_id
  lambda_subnet_ids = var.lambda_subnet_ids

  tags = local.tags
}
