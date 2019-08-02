resource "aws_cloudwatch_log_group" "async_operation" {
  name = "${var.prefix}-AsyncOperationEcsLogs"
}

resource "aws_ecs_task_definition" "async_operation" {
  family                = "${var.prefix}-async-operation"
  container_definitions = <<EOS
[
  {
    "name": "AsyncOperation",
    "cpu": 400,
    "essential": true,
    "environment": [
      {
        "name": "AWS_REGION",
        "value": "${data.aws_region.current.name}"
      }
    ],
    "image": "cumuluss/async-operation:26",
    "memoryReservation": 700,
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "${aws_cloudwatch_log_group.async_operation.name}",
        "awslogs-region": "${data.aws_region.current.name}"
      }
    }
  }
]
EOS
}
