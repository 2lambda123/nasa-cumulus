resource "aws_security_group" "no_ingress_all_egress" {
  name   = "${var.prefix}-cumulus-no-ingress-all-egress"
  vpc_id = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.default_tags
}
