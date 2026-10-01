#!/usr/bin/env python3
"""Build two isolated signed/notarized Sparkle fixtures; never publish here."""
import argparse
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import uuid

from desktop import ROOT, update_configuration
from release import run, sign_bundle
from sparkle import fetch

IDENTIFIER = 'org.oogxdd.type.updater-smoke'
NAME = 'Type Updater Smoke.app'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sparkle-dir', type=Path, required=True)
    options = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', options.repository):
        parser.error('repository must be owner/name')
    if not re.fullmatch(r'gpui-smoke-[0-9]+', options.tag):
        parser.error('fixture tag must be gpui-smoke-NUMBER')
    if options.output.exists():
        parser.error('output must be a fresh directory')
    identity = os.environ.get('APPLE_SIGNING_IDENTITY', '')
    if not identity.startswith('Developer ID Application:'):
        parser.error('requires Developer ID Application identity')
    for key in ('APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'):
        if not os.environ.get(key):
            parser.error('missing Apple notarization credentials')
    sparkle = fetch(options.sparkle_dir)
    options.output.mkdir(parents=True)
    prefix = f'https://github.com/{options.repository}/releases/download/{options.tag}/'
    with tempfile.TemporaryDirectory(prefix='type-updater-fixture-') as temp:
        staging = Path(temp)
        account = 'type-updater-smoke-' + uuid.uuid4().hex
        profile = account + '-notary'
        try:
            # Dedicated disposable fixture key; production signing key is never used.
            run(sparkle / 'bin/generate_keys', '--account', account, capture_output=True)
            public = run(sparkle / 'bin/generate_keys', '--account', account, '-p', capture_output=True, text=True).stdout.strip()
            keyfile = staging / 'private-key'
            run(sparkle / 'bin/generate_keys', '--account', account, '-x', keyfile, capture_output=True)
            keyfile.chmod(0o600)
            secret = keyfile.read_text().strip() + '\n'
            run('xcrun', 'notarytool', 'store-credentials', profile,
                '--apple-id', os.environ['APPLE_ID'], '--team-id', os.environ['APPLE_TEAM_ID'],
                '--password', os.environ['APPLE_PASSWORD'], capture_output=True)
            bridge = staging / 'updater.m'
            source = (ROOT / 'apps/gpui/native/updater.m').read_text()
            assert source.count('isEqualToString:@"com.digital.type2"') == 1
            bridge.write_text(source.replace('isEqualToString:@"com.digital.type2"',
                                            f'isEqualToString:@"{IDENTIFIER}"'))
            architectures = []
            for arch in ('arm64', 'x86_64'):
                executable = staging / arch
                run('clang', '-arch', arch, '-mmacosx-version-min=12.0', '-fobjc-arc', '-fblocks',
                    '-framework', 'Cocoa', ROOT / 'apps/gpui/native/updater_smoke.m', bridge, '-o', executable)
                architectures.append(executable)
            binary = staging / 'fixture'
            run('lipo', '-create', *architectures, '-output', binary)
            bundle = staging / NAME
            contents = bundle / 'Contents'
            (contents / 'MacOS').mkdir(parents=True)
            (contents / 'Frameworks').mkdir()
            shutil.copy2(binary, contents / 'MacOS/fixture')
            shutil.copytree(sparkle / 'Sparkle.framework', contents / 'Frameworks/Sparkle.framework', symlinks=True)
            feed_config = update_configuration(sparkle, prefix + 'appcast.xml', public, False)
            feed_config['SUEnableAutomaticChecks'] = False
            for version in ('0.0.1', '0.0.2'):
                info = dict(CFBundleIdentifier=IDENTIFIER, CFBundleName='Type Updater Smoke',
                            CFBundleExecutable='fixture', CFBundlePackageType='APPL',
                            CFBundleVersion=version, CFBundleShortVersionString=version,
                            LSMinimumSystemVersion='12.0', NSHighResolutionCapable=True, **feed_config)
                (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
                sign_bundle(bundle, identity)
                archive = staging / f'notary-{version}.zip'
                run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive)
                # Notarize zip, then staple its inner app before final archive/signature.
                import json
                response = json.loads(run('xcrun', 'notarytool', 'submit', archive, '--keychain-profile', profile,
                                         '--wait', '--output-format', 'json', capture_output=True, text=True).stdout)
                if response.get('status') != 'Accepted':
                    raise RuntimeError(f'fixture notarization rejected: {response.get("id")}')
                run('xcrun', 'stapler', 'staple', bundle)
                run('xcrun', 'stapler', 'validate', bundle)
                run('spctl', '--assess', '--type', 'execute', '--verbose=2', bundle)
                run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', bundle,
                    options.output / f'Type-Updater-Smoke-{version}.zip')
            run(sparkle / 'bin/generate_appcast', '--ed-key-file', '-', '--maximum-deltas', '0',
                '--download-url-prefix', prefix, options.output, input=secret, text=True)
            run(sparkle / 'bin/sign_update', '--verify', '--ed-key-file', '-', options.output / 'appcast.xml',
                input=secret, text=True)
            # Public provenance only; signatures in feed authenticate both fixtures.
            (options.output / 'fixture-public-key.txt').write_text(public + '\n')
        finally:
            subprocess.run(['security', 'delete-generic-password', '-a', account, '-s', 'https://sparkle-project.org'],
                           capture_output=True, check=False)
            subprocess.run(['security', 'delete-generic-password', '-s', profile], capture_output=True, check=False)


if __name__ == '__main__':
    main()
