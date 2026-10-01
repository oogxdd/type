#!/usr/bin/env python3
"""Fetch the pinned upstream Sparkle distribution, verifying its SHA-256."""
import hashlib
from pathlib import Path
import subprocess
import sys
import tarfile

VERSION = '2.10.0'
SHA256 = 'c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c'
URL = f'https://github.com/sparkle-project/Sparkle/releases/download/{VERSION}/Sparkle-{VERSION}.tar.xz'


def fetch(destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f'Sparkle-{VERSION}.tar.xz'
    if not archive.exists():
        subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--output', str(archive), URL], check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise ValueError('Sparkle distribution checksum mismatch; remove the archive and retry')
    with tarfile.open(archive) as source:
        source.extractall(destination, filter='data')
    return destination


if __name__ == '__main__':
    print(fetch(sys.argv[1]))
