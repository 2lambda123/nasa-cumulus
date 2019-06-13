#!/bin/bash
set -e

source .bamboo_env_vars || true
if [[ $GIT_PR != true && $BRANCH != master ]]; then
  >&2 echo "******Branch HEAD is not a github PR targeting a protected branch, and this isn't the master branch, skipping step"
  exit 0
fi
