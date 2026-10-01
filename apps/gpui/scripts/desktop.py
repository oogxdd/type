#!/usr/bin/env python3
"""Build/launch the native shell and bundle a macOS app, optionally with Sparkle."""
import argparse
import base64
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tomllib
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]


def update_configuration(framework, feed, public_key, dev):
    if not any((framework, feed, public_key)):
        return {}
    if dev or not all((framework, feed, public_key)):
        raise ValueError('updater requires a release bundle, Sparkle directory, HTTPS feed and public key')
    url = urlparse(feed)
    if url.scheme != 'https' or not url.netloc or url.username or url.password:
        raise ValueError('update feed must be an HTTPS URL without credentials')
    if len(base64.b64decode(public_key, validate=True)) != 32:
        raise ValueError('Sparkle public key must encode 32 bytes')
    if not (Path(framework) / 'Sparkle.framework/Sparkle').is_file():
        raise ValueError('Sparkle.framework is missing from the distribution directory')
    return {
        'SUFeedURL': feed, 'SUPublicEDKey': public_key,
        'SUVerifyUpdateBeforeExtraction': True, 'SURequireSignedFeed': True,
        'SUAllowsAutomaticUpdates': False, 'SUEnableAutomaticChecks': True,
        'SUSendProfileInfo': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['dev', 'bundle'])
    parser.add_argument('--release', action='store_true')
    parser.add_argument('--no-build', action='store_true')
    parser.add_argument('--test-support', action='store_true', help='reuse artifacts from native UI tests')
    parser.add_argument('--binary', type=Path, help='prebuilt binary (requires --no-build)')
    parser.add_argument('--sparkle-dir', type=Path)
    parser.add_argument('--feed-url')
    parser.add_argument('--public-key')
    options, app_args = parser.parse_known_args()
    if options.command == 'bundle' and app_args:
        parser.error(f'unrecognized bundle arguments: {app_args}')
    if options.binary and not options.no_build:
        parser.error('--binary requires --no-build')
    dev = options.command == 'dev' or not options.release
    try:
        update_info = update_configuration(options.sparkle_dir, options.feed_url, options.public_key, dev)
    except ValueError as error:
        parser.error(str(error))
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
    binary = options.binary or target / ('release' if options.release else 'debug') / ('type-gpui.exe' if sys.platform == 'win32' else 'type-gpui')
    if not binary.is_file():
        parser.error(f'binary not found: {binary}')
    if sys.platform != 'darwin':
        if options.command == 'bundle':
            parser.error('app bundling is currently supported on macOS only')
        subprocess.run([str(binary), '--dev', *app_args], cwd=ROOT, check=True)
        return
    name = 'Type GPUI Dev' if dev else 'Type'
    bundle = target / 'bundle' / f'{name}.app'
    macos = bundle / 'Contents' / 'MacOS'
    resources = bundle / 'Contents' / 'Resources'
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(exist_ok=True)
    frameworks = bundle / 'Contents/Frameworks'
    # A reused bundle must never retain stale updater configuration/code or an
    # invalid signature from a previous build.
    shutil.rmtree(bundle / 'Contents/_CodeSignature', ignore_errors=True)
    shutil.rmtree(frameworks, ignore_errors=True)
    if update_info:
        frameworks.mkdir()
        shutil.copytree(options.sparkle_dir / 'Sparkle.framework', frameworks / 'Sparkle.framework', symlinks=True)
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
    info.update(update_info)
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
