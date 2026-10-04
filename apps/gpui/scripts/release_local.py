#!/usr/bin/env python3
"""Prepare/check this Mac, or build a signed local candidate without publishing."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from desktop import ROOT
from release import release_version
from sparkle import fetch


def capture(*args, env=None):
    # Never include command output or arguments in errors: some contain secrets.
    result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env,
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1] if len(args) > 1 else ""} failed; check local access/configuration')
    return result.stdout.strip()


def signing_identity(environment):
    identity = environment.get('APPLE_SIGNING_IDENTITY')
    if not identity:
        identities = re.findall(r'"(Developer ID Application: [^"\n]+)"',
                                capture('security', 'find-identity', '-v', '-p', 'codesigning'))
        if len(identities) != 1:
            raise RuntimeError('need exactly one Developer ID identity, or set APPLE_SIGNING_IDENTITY')
        identity = identities[0]
    team = re.search(r'\(([A-Z0-9]+)\)$', identity)
    if not identity.startswith('Developer ID Application:') or not team:
        raise RuntimeError('a Developer ID Application identity with a Team ID is required')
    if environment.get('APPLE_TEAM_ID') not in (None, '', team[1]):
        raise RuntimeError('APPLE_TEAM_ID differs from the signing identity')
    return identity, team[1]


def apple_credentials(environment, profile):
    # Explicit environment credentials win; otherwise prefer an existing profile.
    if all(environment.get(k) for k in ('APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID')):
        return
    result = subprocess.run(['xcrun', 'notarytool', 'history', '--keychain-profile', profile,
                             '--output-format', 'json'], capture_output=True, text=True)
    if result.returncode == 0:
        environment['APPLE_NOTARIZATION_PROFILE'] = profile
        return
    for variable, service in (('APPLE_ID', 'type-apple-id'), ('APPLE_PASSWORD', 'type-apple-app-password')):
        if not environment.get(variable):
            result = subprocess.run(['security', 'find-generic-password', '-s', service, '-w'],
                                    capture_output=True, text=True)
            if result.returncode == 0:
                environment[variable] = result.stdout.strip()
    if not all(environment.get(k) for k in ('APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID')):
        raise RuntimeError('Apple notarization credentials unavailable. Run desktop:release:local -- --setup in your local Terminal')


def build_candidate(options, environment, sparkle):
    version = release_version(options.version)
    if capture('git', 'status', '--porcelain'):
        raise RuntimeError('commit changes first: local packaging requires a clean checkout')
    notes = ROOT / f'docs/releases/gpui-v{version}.md'
    if not notes.is_file():
        raise RuntimeError('committed release notes are missing')
    output = (options.output or Path(f'/private/tmp/type-release-{version}')).resolve()
    if output.exists():
        raise RuntimeError('output already exists; choose a fresh --output directory')
    for command in (['cargo', 'test', '--locked', '-p', 'type-gpui', '--', '--test-threads=1'],
                    ['cargo', 'test', '--locked', '-p', 'type-core', '--lib'],
                    [sys.executable, '-m', 'unittest', 'discover', '-s', 'apps/gpui/scripts', '-p', 'test_*.py']):
        subprocess.run(command, cwd=ROOT, env=environment, check=True)
    with tempfile.TemporaryDirectory(prefix='type-sparkle-key-', dir='/private/tmp') as temp:
        temp = Path(temp)
        if not environment.get('SPARKLE_PRIVATE_KEY'):
            key = temp / 'key'
            capture(sparkle / 'bin/generate_keys', '--account', 'type-gpui', '-x', key)
            key.chmod(0o600)
            environment['SPARKLE_PRIVATE_KEY'] = key.read_text().strip()
        # Preserve the live feed; network/authentication failures abort the build.
        subprocess.run(['gh', 'release', 'download', 'gpui-updates', '--repo', options.repository,
                        '--pattern', 'appcast.xml', '--dir', str(temp)], cwd=ROOT, check=True)
        subprocess.run([sys.executable, str(ROOT / 'apps/gpui/scripts/release.py'),
                        '--version', version, '--repository', options.repository,
                        '--architecture', options.architecture,
                        '--output', str(output), '--sparkle-dir', str(sparkle),
                        '--notes', str(notes), '--previous-feed', str(temp / 'appcast.xml')],
                       cwd=ROOT, env=environment, check=True)
    print(f'Candidate ready: {output}. Follow docs/RELEASING.md to upload, verify and promote.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version', nargs='?')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--setup', action='store_true', help='interactive notarytool Keychain setup; run in your Terminal')
    parser.add_argument('--apple-id', help='prefill Apple ID during interactive --setup')
    parser.add_argument('--profile', default=os.environ.get('APPLE_NOTARIZATION_PROFILE', 'type-gpui-notary'))
    parser.add_argument('--sparkle-dir', type=Path, default=Path('/private/tmp/type-sparkle'))
    parser.add_argument('--target-dir', type=Path, help='reuse an existing Cargo cache; otherwise respects CARGO_TARGET_DIR')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--architecture', choices=['universal', 'arm64'], default='universal')
    parser.add_argument('--repository', default='oogxdd/type')
    options = parser.parse_args()
    try:
        if sys.platform != 'darwin':
            raise RuntimeError('local distribution packaging requires macOS')
        if not (options.check or options.setup or options.version):
            parser.error('provide a version, --check, or --setup')
        environment = os.environ.copy()
        environment['APPLE_SIGNING_IDENTITY'], environment['APPLE_TEAM_ID'] = signing_identity(environment)
        if options.setup:
            if not sys.stdin.isatty():
                raise RuntimeError('--setup requires your interactive Terminal; credentials are entered there')
            arguments = ['xcrun', 'notarytool', 'store-credentials', options.profile,
                         '--team-id', environment['APPLE_TEAM_ID']]
            if options.apple_id:
                arguments.extend(['--apple-id', options.apple_id])
            subprocess.run(arguments, check=True)
            print('Notarization credentials saved in Keychain. Run --check next.')
            return
        for command in ('cargo', 'rustup', 'gh'):
            if not shutil.which(command):
                raise RuntimeError(f'{command} missing; reconnect the toolchain volume or install the pinned tools')
        capture('gh', 'auth', 'status')
        targets = capture('rustup', 'target', 'list', '--installed').splitlines()
        required_targets = {'aarch64-apple-darwin'}
        if options.architecture == 'universal':
            required_targets.add('x86_64-apple-darwin')
        missing = sorted(required_targets - set(targets))
        if missing:
            raise RuntimeError('install missing targets: rustup target add ' + ' '.join(missing))
        apple_credentials(environment, options.profile)
        sparkle = fetch(options.sparkle_dir)
        environment['SPARKLE_PUBLIC_KEY'] = capture(sparkle / 'bin/generate_keys', '--account', 'type-gpui', '-p')
        configured_key = capture('gh', 'api', f'repos/{options.repository}/actions/variables/SPARKLE_PUBLIC_KEY', '--jq', '.value')
        if environment['SPARKLE_PUBLIC_KEY'] != configured_key:
            raise RuntimeError('local Sparkle key differs from the production public key; restore the existing key')
        if options.target_dir:
            environment['CARGO_TARGET_DIR'] = str(options.target_dir.resolve())
        print('Developer ID, Apple notarization, Sparkle, GitHub and selected Rust targets are available.')
        if not options.check:
            build_candidate(options, environment, sparkle)
    except (RuntimeError, ValueError):
        print(str(sys.exception()), file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError:
        print('Release command failed; candidate was not published.', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
