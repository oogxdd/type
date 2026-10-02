#!/usr/bin/env python3
"""Build a universal, signed and notarized GPUI release. Never publish here."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib

from desktop import ROOT, update_configuration
from sparkle import fetch


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def release_version(value):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', value):
        raise ValueError('release version must be major.minor.patch')
    actual = tomllib.loads((ROOT / 'apps/gpui/Cargo.toml').read_text())['package']['version']
    if actual != value:
        raise ValueError(f'tag version {value} differs from committed GPUI version {actual}')
    return value


def sign_bundle(bundle, identity):
    def sign(path):
        run('codesign', '--force', '--options', 'runtime', '--timestamp', '--sign', identity, path)
    # Sparkle's helpers need OUR Developer ID, including XPC service bundles.
    # Sign inside out; --deep is only appropriate for verification.
    framework = bundle / 'Contents/Frameworks/Sparkle.framework'
    for path in sorted(framework.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        if path.is_symlink():
            continue
        if path.is_file():
            with path.open('rb') as source:
                magic = source.read(4)
            if magic in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'):
                sign(path)
        elif path.suffix in ('.app', '.xpc'):
            sign(path)
    sign(framework)
    sign(bundle)
    run('codesign', '--verify', '--deep', '--strict', '--verbose=2', bundle)


def submit_notarization(path, profile):
    print(f'Uploading {Path(path).name} for notarization (5 minute limit)...', flush=True)
    try:
        result = run('xcrun', 'notarytool', 'submit', path, '--keychain-profile', profile,
                     '--no-s3-acceleration', '--no-wait', '--output-format', 'json',
                     capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError('notarization upload exceeded 5 minutes; check submission history before retrying') from error
    response = json.loads(result.stdout)
    submission = response.get('id')
    status = response.get('status', 'In Progress')
    if not submission:
        raise RuntimeError('notarization upload did not return a submission ID')
    print(f'Notarization submission: {submission}', flush=True)
    deadline = time.monotonic() + 1200
    while status != 'Accepted':
        if status != 'In Progress':
            raise RuntimeError(f'notarization rejected: {submission} ({status}); retrieve its notarytool log')
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError(f'notarization exceeded 20 minutes: {submission}; processing may continue at Apple')
        result = run('xcrun', 'notarytool', 'info', submission, '--keychain-profile', profile,
                     '--output-format', 'json', capture_output=True, text=True,
                     timeout=min(60, remaining))
        status = json.loads(result.stdout).get('status')
        print(f'Notarization {submission}: {status}', flush=True)
        if status == 'In Progress':
            time.sleep(min(30, max(0, deadline - time.monotonic())))
    return submission


def notarize(path, profile):
    submit_notarization(path, profile)
    run('xcrun', 'stapler', 'staple', path)
    run('xcrun', 'stapler', 'validate', path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sparkle-dir', type=Path, required=True)
    parser.add_argument('--notes', type=Path, required=True)
    parser.add_argument('--previous-feed', type=Path)
    options = parser.parse_args()
    version = release_version(options.version)
    if sys.platform != 'darwin':
        parser.error('release packaging requires macOS')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', options.repository):
        parser.error('repository must be owner/name')
    required = ['APPLE_SIGNING_IDENTITY',
                'SPARKLE_PRIVATE_KEY', 'SPARKLE_PUBLIC_KEY']
    if any(not os.environ.get(key) for key in required):
        parser.error('missing required release credentials (see docs/RELEASING.md)')
    if not os.environ.get('APPLE_NOTARIZATION_PROFILE') and any(
            not os.environ.get(key) for key in ('APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID')):
        parser.error('set APPLE_NOTARIZATION_PROFILE or Apple ID/password/team credentials')
    if not os.environ['APPLE_SIGNING_IDENTITY'].startswith('Developer ID Application:'):
        parser.error('distribution requires a Developer ID Application identity')
    feed = f'https://github.com/{options.repository}/releases/download/gpui-updates/appcast.xml'
    sparkle = fetch(options.sparkle_dir)
    update_configuration(sparkle, feed, os.environ['SPARKLE_PUBLIC_KEY'], False)
    output = options.output.resolve()
    if output.exists():
        parser.error('output directory already exists; use a fresh directory')
    output.mkdir(parents=True)
    target = Path(os.environ.get('CARGO_TARGET_DIR', ROOT / 'target'))
    target = (target if target.is_absolute() else ROOT / target).resolve()
    binaries = []
    for arch in ('aarch64', 'x86_64'):
        triple = f'{arch}-apple-darwin'
        run('cargo', 'build', '--locked', '--release', '-p', 'type-gpui', '--target', triple, cwd=ROOT,
            env={**os.environ, 'MACOSX_DEPLOYMENT_TARGET': '12.0'})
        binaries.append(target / triple / 'release/type-gpui')
    universal = output / 'type-gpui-universal'
    run('lipo', '-create', *binaries, '-output', universal)
    run(sys.executable, ROOT / 'apps/gpui/scripts/desktop.py', 'bundle', '--release', '--no-build',
        '--binary', universal, '--sparkle-dir', sparkle, '--feed-url', feed,
        '--public-key', os.environ['SPARKLE_PUBLIC_KEY'], cwd=ROOT)
    bundle = target / 'bundle/Type.app'
    sign_bundle(bundle, os.environ['APPLE_SIGNING_IDENTITY'])
    # Credentials are kept in the build machine's Keychain, never the bundle.
    with tempfile.TemporaryDirectory() as temp:
        keychain_profile = os.environ.get('APPLE_NOTARIZATION_PROFILE') or 'type-gpui-notary'
        if not os.environ.get('APPLE_NOTARIZATION_PROFILE'):
            run('xcrun', 'notarytool', 'store-credentials', keychain_profile,
                '--apple-id', os.environ['APPLE_ID'], '--team-id', os.environ['APPLE_TEAM_ID'],
                '--password', os.environ['APPLE_PASSWORD'])
        zipfile = Path(temp) / 'Type.zip'
        run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zipfile)
        submit_notarization(zipfile, keychain_profile)
        run('xcrun', 'stapler', 'staple', bundle)
        run('xcrun', 'stapler', 'validate', bundle)
        run('spctl', '--assess', '--type', 'execute', '--verbose=2', bundle)
        staging = Path(temp) / 'image'
        staging.mkdir()
        run('ditto', bundle, staging / 'Type.app')
        (staging / 'Applications').symlink_to('/Applications')
        dmg = output / f'Type-{version}-universal.dmg'
        run('hdiutil', 'create', '-volname', 'Type', '-srcfolder', staging, '-format', 'ULFO', '-fs', 'APFS', dmg)
        run('codesign', '--sign', os.environ['APPLE_SIGNING_IDENTITY'], '--timestamp', dmg)
        notarize(dmg, keychain_profile)
    archives = output / 'updates'
    archives.mkdir()
    shutil.copy2(dmg, archives / dmg.name)
    shutil.copy2(options.notes, archives / f'{dmg.stem}.md')
    secret = os.environ['SPARKLE_PRIVATE_KEY'] + '\n'
    if options.previous_feed:
        run(sparkle / 'bin/sign_update', '--verify', '--ed-key-file', '-', options.previous_feed,
            input=secret, text=True)
        shutil.copy2(options.previous_feed, archives / 'appcast.xml')
    run(sparkle / 'bin/generate_appcast', '--ed-key-file', '-', '--maximum-deltas', '0',
        '--embed-release-notes', '--phased-rollout-interval', '86400',
        '--download-url-prefix', f'https://github.com/{options.repository}/releases/download/gpui-v{version}/',
        archives, input=secret, text=True)
    run(sparkle / 'bin/sign_update', '--verify', '--ed-key-file', '-', archives / 'appcast.xml', input=secret, text=True)
    shutil.copy2(archives / 'appcast.xml', output / 'appcast.xml')
    # Public provenance for promotion; no credentials are included.
    manifest = {'version': version, 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'bundle_id': plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())['CFBundleIdentifier'],
                'dmg_sha256': hashlib.sha256(dmg.read_bytes()).hexdigest(),
                'previous_feed_sha256': hashlib.sha256(options.previous_feed.read_bytes()).hexdigest() if options.previous_feed else None}
    (output / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    universal.unlink()
    shutil.rmtree(archives)


if __name__ == '__main__':
    main()
