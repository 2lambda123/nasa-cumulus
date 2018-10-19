set -e

(
  cd example
  if [ "$USE_NPM_PACKAGES" = "true" ]; then
    yarn
  else
    (cd .. && ./bin/prepare)
  fi

  yarn redeploy-test
)
RESULT="$?"

exit "$RESULT"