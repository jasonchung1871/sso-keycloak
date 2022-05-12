terraform {
  required_version = ">= 1.0.7"

  backend "s3" {
    bucket = "sso-ops-tf-state"
    key    = "ocp/gold"
    region = "ca-central-1"
  }
}
