prefix            = "lf-test-tf"
system_bucket     = "lf-internal"
buckets = {
  internal = {
    name = "lf-internal"
    type = "internal"
  }
  private = {
    name = "lf-private"
    type = "private"
  }
  protected = {
    name = "lf-protected"
    type = "protected"
  }
  protected-2 = {
    name = "lf-protected-2"
    type = "protected"
  }
  public = {
    name = "lf-cumulus-public"
    type = "public"
  }
  glacier = {
    name = "lf-internal"
    type = "orca"
  }
}
key_name         = "lauren"
archive_api_port = 8000
orca_default_bucket = "lf-internal"
