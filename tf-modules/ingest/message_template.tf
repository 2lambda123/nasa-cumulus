locals {
  message_template_key = "${var.prefix}/workflows/template.json"

  message_template = jsonencode({
    cumulus_meta = {
      message_source      = "sfn"
      system_bucket       = var.system_bucket
      state_machine       = null
      execution_name      = null
      workflow_start_time = null
    }
    meta = {
      workflow_name  = null
      workflow_tasks = {}
      stack          = var.prefix
      buckets        = var.buckets
      cmr = {
        oauthProvider  = var.cmr_oauth_provider
        username       = var.cmr_username
        provider       = var.cmr_provider
        clientId       = var.cmr_client_id
        password       = var.cmr_password
        cmrEnvironment = var.cmr_environment
        cmrLimit       = var.cmr_limit
        cmrPageSize    = var.cmr_page_size
      }
      launchpad = {
        api         = var.launchpad_api
        certificate = var.launchpad_certificate
        passphrase  = var.launchpad_passphrase
      }
      distribution_endpoint = var.distribution_url
      topic_arn             = var.sftracker_sns_topic_arn
      collection            = {}
      provider              = {}
      template              = "s3://${var.system_bucket}/${local.message_template_key}"
      queues = {
        triggerLambdaFailure      = aws_sqs_queue.trigger_lambda_failure.id
        startSF                   = aws_sqs_queue.start_sf.id
        backgroundProcessing      = aws_sqs_queue.background_processing.id
        kinesisFailure            = aws_sqs_queue.kinesis_failure.id
        ScheduleSFDeadLetterQueue = aws_sqs_queue.schedule_sf_dead_letter_queue.id
      }
      queueExecutionLimits = var.queue_execution_limits
    }
    payload   = {}
    exception = null
  })
}

resource "aws_s3_bucket_object" "message_template" {
  bucket  = var.system_bucket
  key     = local.message_template_key
  content = local.message_template
  etag    = md5(local.message_template)
}
