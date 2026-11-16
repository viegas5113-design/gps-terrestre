#!/bin/bash
cd /home/luis/GPS_Terrestre || exit 1
python3 servidor.py "$@"
