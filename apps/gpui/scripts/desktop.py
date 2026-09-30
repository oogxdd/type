#!/usr/bin/env python3
"""Build and launch the native desktop shell; package an unsigned macOS .app."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['dev', 'bundle'])
    parser.add_argument('--release', action='store_true')
    parser.add_argument('--no-build', action='store_true')
    parser.add_argument('--test-support', action='store_true', help='reuse artifacts from native UI tests')
    options, app_args = parser.parse_known_args()
    if app_args[:1] == ['--']:
        app_args = app_args[1:]
    env = os.environ.copy()
    # Keep compiler temporary files on the same volume as this checkout.
    tmp = ROOT / '.tmp'
    tmp.mkdir(exist_ok=True)
    env.setdefault('TMPDIR', str(tmp))
    if not options.no_build:
        cmd = ['cargo', 'build', '-p', 'type-gpui']
        if options.release:
            cmd.append('--release')
        if options.test_support:
            cmd.extend(['--features', 'gpui-kit/test-support'])
        subprocess.run(cmd, cwd=ROOT, env=env, check=True)
    target = Path(env.get('CARGO_TARGET_DIR', str(ROOT / 'target')))
    if not target.is_absolute():
        target = ROOT / target
    binary = target / ('release' if options.release else 'debug') / ('type-gpui.exe' if sys.platform == 'win32' else 'type-gpui')
    if not binary.is_file():
        parser.error(f'binary not found: {binary}')
    if sys.platform != 'darwin':
        if options.command == 'bundle':
            parser.error('app bundling is currently supported on macOS only')
        subprocess.run([str(binary), '--dev', *app_args], cwd=ROOT, check=True)
        return
    dev = options.command == 'dev' or not options.release
    name = 'Type GPUI Dev' if dev else 'Type'
    bundle = target / 'bundle' / f'{name}.app'
    macos = bundle / 'Contents' / 'MacOS'
    resources = bundle / 'Contents' / 'Resources'
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(exist_ok=True)
    # Atomic replacement leaves an already running process on its original
    # executable instead of modifying the mapped file in place.
    replacement = macos / 'type-gpui.new'
    shutil.copy2(binary, replacement)
    replacement.replace(macos / 'type-gpui')
    version = tomllib.loads((ROOT / 'apps/gpui/Cargo.toml').read_text())['package']['version']
    info = {
        'CFBundleExecutable': 'type-gpui',
        'CFBundleIdentifier': 'com.digital.type2.gpui.dev' if dev else 'com.digital.type2',
        'CFBundleName': name, 'CFBundleDisplayName': name,
        'CFBundleVersion': version, 'CFBundleShortVersionString': version,
        'CFBundlePackageType': 'APPL', 'NSHighResolutionCapable': True,
        'NSMicrophoneUsageDescription': 'Record audio notes in Type.',
        'LSMinimumSystemVersion': '12.0',
    }
    icon = ROOT / 'apps/desktop/src-tauri/icons/icon.icns'
    if icon.is_file():
        shutil.copy2(icon, resources / 'Type.icns')
        info['CFBundleIconFile'] = 'Type.icns'
    with (bundle / 'Contents/Info.plist').open('wb') as f:
        plistlib.dump(info, f)
    print(bundle, flush=True)
    if options.command == 'dev':
        subprocess.run(['open', '-n', str(bundle), '--args', '--dev', *app_args], check=True)


if __name__ == '__main__':
    main()
