module "hello_world_passthrough_workflow" {
  source = "../../tf-modules/workflow"

  prefix          = var.prefix
  name            = "Passthrough"
  workflow_config = module.cumulus.workflow_config
  system_bucket   = var.system_bucket
  tags            = local.tags

  state_machine_definition = templatefile(
    "${path.module}/passthrough_workflow.asl.json",
    {
      hello_world_task_arn: module.cumulus.hello_world_task.task_arn
    }
  )
}
