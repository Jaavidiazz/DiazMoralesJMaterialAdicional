#!/bin/bash
# Lanza el entrenamiento y lo reinicia automáticamente con --resume si se
# cae por cualquier motivo (p.ej. una desconexión momentánea del disco
# externo), en vez de quedarse parado sin que nadie se dé cuenta.
cd /Volumes/DiscoExterno/TFG-FINAL/breast_cancer_detection

while true; do
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') — arrancando/reanudando entrenamiento ===" >> /tmp/retrain_aug.log
  python3 detectron.py -c train --no-fast --max-iter 6000 --resume >> /tmp/retrain_aug.log 2>&1
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') — entrenamiento terminado correctamente (exit 0) ===" >> /tmp/retrain_aug.log
    break
  fi

  echo "=== $(date '+%Y-%m-%d %H:%M:%S') — se cayó (exit $EXIT_CODE), esperando 30s antes de reintentar ===" >> /tmp/retrain_aug.log
  sleep 30
done
