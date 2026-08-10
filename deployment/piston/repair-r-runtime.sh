#!/bin/sh
set -eu

for runtime in /piston/packages/rscript/*; do
  [ -d "$runtime/bin" ] || continue
  if [ -e "$runtime/bin/Rscript" ] && [ ! -L "$runtime/bin/Rscript" ]; then
    mv "$runtime/bin/Rscript" "$runtime/bin/Rscript.incompatible"
  fi
  ln -sfn /usr/bin/Rscript "$runtime/bin/Rscript"
  chown -h piston:piston "$runtime/bin/Rscript"
done

exec /piston_api/src/docker-entrypoint.sh
