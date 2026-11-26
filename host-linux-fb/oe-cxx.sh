#!/bin/sh
# OE gas rejects rustc's -march=armv7-a+fp; keep hard-float via -mfpu.
set -e
out=
for arg in "$@"; do
  case "$arg" in
    -march=armv7-a+fp|-march=armv7-a+*)
      arg="-march=armv7-a"
      ;;
  esac
  out="$out $arg"
done
# shellcheck disable=SC2086
exec arm-oe-linux-musleabi-g++ $out
