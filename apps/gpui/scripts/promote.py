#!/usr/bin/env python3
"""Explicit publication/withdrawal of the GPUI feed, separate from building."""
import argparse
from datetime import datetime, timezone
from email.utils import format_datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

from sparkle import fetch

NS = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
ET.register_namespace('sparkle', NS)


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def verify_feed(sparkle, feed):
    run(sparkle / 'bin/sign_update', '--verify', '--ed-key-file', '-', feed,
        input=os.environ['SPARKLE_PRIVATE_KEY'] + '\n', text=True)


def candidate_dmg_name(manifest, version):
    architecture = manifest.get('architecture', 'universal')
    if architecture not in ('universal', 'arm64'):
        raise ValueError('unsupported candidate architecture')
    expected = f'Type-{version}-{architecture}.dmg'
    if manifest.get('dmg_name', expected) != expected:
        raise ValueError('unexpected candidate DMG name')
    return expected


def validate_candidate(manifest, version, current_hash, dmg, feed, repository):
    if manifest['version'] != version or manifest['bundle_id'] != 'com.digital.type2':
        raise ValueError('candidate provenance does not match')
    if manifest['previous_feed_sha256'] != current_hash:
        raise ValueError('live feed changed since building this draft; build a new candidate version')
    if hashlib.sha256(dmg.read_bytes()).hexdigest() != manifest['dmg_sha256']:
        raise ValueError('candidate DMG checksum mismatch')
    items = ET.parse(feed).findall('channel/item')
    versions = [i.findtext(f'{{{NS}}}version') for i in items]
    if max(tuple(map(int, v.split('.'))) for v in versions) != tuple(map(int, version.split('.'))):
        raise ValueError('candidate would downgrade the native feed')
    selected = [i for i in items if i.findtext(f'{{{NS}}}version') == version]
    if len(selected) != 1:
        raise ValueError('expected exactly one candidate enclosure')
    if manifest.get('architecture') == 'arm64' and selected[0].findtext(f'{{{NS}}}hardwareRequirements') != 'arm64':
        raise ValueError('Apple Silicon candidate must require arm64 hardware')
    enclosure = selected[0].find('enclosure')
    expected = f'https://github.com/{repository}/releases/download/gpui-v{version}/{dmg.name}'
    if enclosure is None or enclosure.get('url') != expected or int(enclosure.get('length', '0')) != dmg.stat().st_size:
        raise ValueError('signed feed does not describe the candidate DMG')
    signature = enclosure.get(f'{{{NS}}}edSignature')
    if not signature:
        raise ValueError('missing candidate archive signature')
    return signature


def edit_feed(feed, version, operation, interval, now=None):
    tree = ET.parse(feed)
    channel = tree.getroot().find('channel')
    if channel is None:
        raise ValueError('missing appcast channel')
    items = channel.findall('item')
    selected = [i for i in items if i.findtext(f'{{{NS}}}version') == version]
    if len(selected) != 1:
        raise ValueError('expected exactly one matching release in the appcast')
    if operation == 'withdraw':
        channel.remove(selected[0])
    else:
        date = selected[0].find('pubDate')
        if date is None:
            date = ET.SubElement(selected[0], 'pubDate')
        date.text = format_datetime(now or datetime.now(timezone.utc))
        phased = selected[0].find(f'{{{NS}}}phasedRolloutInterval')
        if phased is None:
            phased = ET.SubElement(selected[0], f'{{{NS}}}phasedRolloutInterval')
        phased.text = str(interval)
    tree.write(feed, encoding='utf-8', xml_declaration=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--operation', choices=['promote', 'withdraw'], required=True)
    parser.add_argument('--rollout-interval', type=int, default=86400)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', args.version) or args.rollout_interval < 0:
        parser.error('invalid version or rollout interval')
    if not os.environ.get('SPARKLE_PRIVATE_KEY'):
        parser.error('SPARKLE_PRIVATE_KEY is required')
    work = args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=False)
    sparkle = fetch(work / 'sparkle')
    current = work / 'current'
    current.mkdir()
    exists = subprocess.run(['gh', 'release', 'view', 'gpui-updates', '--repo', args.repository],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if exists:
        run('gh', 'release', 'download', 'gpui-updates', '--repo', args.repository,
            '--pattern', 'appcast.xml', '--dir', current)
        verify_feed(sparkle, current / 'appcast.xml')
    if args.operation == 'withdraw':
        if not exists:
            parser.error('there is no live GPUI feed')
        feed = current / 'appcast.xml'
    else:
        tag = f'gpui-v{args.version}'
        details = json.loads(subprocess.check_output(['gh', 'release', 'view', tag, '--repo', args.repository,
                            '--json', 'isDraft,isPrerelease'], text=True))
        if details['isPrerelease']:
            parser.error('promotion requires a stable candidate')
        candidate = work / 'candidate'
        candidate.mkdir()
        run('gh', 'release', 'download', tag, '--repo', args.repository, '--dir', candidate)
        manifest = json.loads((candidate / 'release.json').read_text())
        current_hash = hashlib.sha256((current / 'appcast.xml').read_bytes()).hexdigest() if exists else None
        dmg = candidate / candidate_dmg_name(manifest, args.version)
        run('codesign', '--verify', '--strict', dmg)
        run('xcrun', 'stapler', 'validate', dmg)
        feed = candidate / 'appcast.xml'
        verify_feed(sparkle, feed)
        signature = validate_candidate(manifest, args.version, current_hash, dmg, feed, args.repository)
        run(sparkle / 'bin/sign_update', '--verify', '--ed-key-file', '-', dmg, signature,
            input=os.environ['SPARKLE_PRIVATE_KEY'] + '\n', text=True)
    edit_feed(feed, args.version, args.operation, args.rollout_interval)
    run(sparkle / 'bin/sign_update', '--ed-key-file', '-', feed,
        input=os.environ['SPARKLE_PRIVATE_KEY'] + '\n', text=True)
    verify_feed(sparkle, feed)
    if args.operation == 'promote':
        # Make downloads available first; a failed feed upload is safe to retry
        # manually by uploading the verified feed, never by replacing the DMG.
        run('gh', 'release', 'edit', f'gpui-v{args.version}', '--repo', args.repository,
            '--draft=false', '--latest=false')
    if not exists:
        run('gh', 'release', 'create', 'gpui-updates', feed, '--repo', args.repository,
            '--target', subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
            '--title', 'GPUI update feed', '--notes', 'Signed native macOS update feed. Download installers from gpui-v releases.',
            '--latest=false')
    else:
        run('gh', 'release', 'upload', 'gpui-updates', feed, '--repo', args.repository, '--clobber')


if __name__ == '__main__':
    main()
