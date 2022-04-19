#!/bin/bash
set -ex

NONCACHE_WORKING_DIR=$(pwd)

. ./bamboo/use-working-directory.sh
. ./bamboo/set-bamboo-env-variables.sh
. ./bamboo/abort-if-not-pr.sh


echo "***Using NPM VERSION*** $(npm --version)"
npm config set loglevel verbose
npm config set unsafe-perm true

set -o pipefail

CURRENT_WORKING_DIR=$NONCACHE_WORKING_DIR

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  echo "*** Using cached bootstrap build dir"
  CURRENT_WORKING_DIR=/cumulus
  cd $CURRENT_WORKING_DIR
  git fetch --all
  git checkout "$GIT_SHA"
else
  CURRENT_WORKING_DIR=/uncached/cumulus
  npm install
fi

# Bootstrap to install/link packages
npm run ci:bootstrap-no-scripts

# Get a list of TS compiled files
npm run tsc:listEmittedFiles | grep TSFILE | awk '{print $2}' | sed "s,$CURRENT_WORKING_DIR/,,g" >> .ts-build-cache-files
cat .ts-build-cache-files

# Generate TS build cache artifact
tar cf "$TS_BUILD_CACHE_FILE" -T .ts-build-cache-files

if [[ $USE_CACHED_BOOTSTRAP == true ]]; then
  cp "$TS_BUILD_CACHE_FILE" "$NONCACHE_WORKING_DIR"
fi
