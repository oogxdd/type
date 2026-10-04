import base64
import hashlib
from datetime import datetime, timezone
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import desktop
from promote import NS, edit_feed, validate_candidate, candidate_dmg_name
from release import release_version, notarize, submit_notarization, restrict_hardware


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sparkle = self.root / 'sparkle'
        framework = self.sparkle / 'Sparkle.framework'
        (framework / 'Versions/B').mkdir(parents=True)
        (framework / 'Versions/B/Sparkle').write_bytes(b'fixture')
        (framework / 'Versions/Current').symlink_to('B')
        (framework / 'Sparkle').symlink_to('Versions/Current/Sparkle')
        self.key = base64.b64encode(bytes(32)).decode()

    def tearDown(self):
        self.temp.cleanup()

    def test_configuration_rejects_dev_http_bad_keys_and_partial_config(self):
        for changes in [{'dev': True}, {'feed': 'http://example.com/feed'},
                        {'feed': 'https://user:password@example.com/feed'},
                        {'public_key': base64.b64encode(bytes(31)).decode()},
                        {'public_key': 'invalid'}, {'framework': None}]:
            values = dict(framework=self.sparkle, feed='https://example.com/feed', public_key=self.key, dev=False)
            values.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                desktop.update_configuration(**values)
        config = desktop.update_configuration(self.sparkle, 'https://example.com/feed', self.key, False)
        self.assertTrue(config['SURequireSignedFeed'])
        self.assertFalse(config['SUAllowsAutomaticUpdates'])
        self.assertEqual(desktop.update_configuration(None, None, None, True), {})

    def test_bundle_keeps_symlinks_and_removes_stale_updater(self):
        binary = self.root / 'binary'
        binary.write_bytes(b'fixture executable')
        args = ['desktop.py', 'bundle', '--release', '--no-build', '--binary', str(binary)]
        with patch.dict(os.environ, {'CARGO_TARGET_DIR': str(self.root / 'target')}), patch.object(sys, 'platform', 'darwin'):
            with patch.object(sys, 'argv', args + ['--sparkle-dir', str(self.sparkle), '--feed-url', 'https://example.com/feed', '--public-key', self.key]):
                desktop.main()
            bundle = self.root / 'target/bundle/Type.app'
            link = bundle / 'Contents/Frameworks/Sparkle.framework/Sparkle'
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.read_bytes(), b'fixture')
            info = plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())
            self.assertEqual(info['SUPublicEDKey'], self.key)
            self.assertEqual(info['CFBundleIdentifier'], 'com.digital.type2')
            with patch.object(sys, 'argv', args):
                desktop.main()
            self.assertFalse((bundle / 'Contents/Frameworks').exists())
            self.assertNotIn('SUFeedURL', plistlib.loads((bundle / 'Contents/Info.plist').read_bytes()))

    def feed(self):
        feed = self.root / 'appcast.xml'
        feed.write_text(f'''<rss xmlns:sparkle="{NS}"><channel>
          <item><sparkle:version>0.4.6</sparkle:version><pubDate>old date</pubDate>
          <sparkle:phasedRolloutInterval>0</sparkle:phasedRolloutInterval>
          <enclosure url="https://example.com/new.dmg" sparkle:edSignature="signature" length="123"/></item>
          <item><sparkle:version>0.4.5</sparkle:version><description>previous release</description></item>
        </channel></rss>''')
        return feed

    def test_promotion_starts_rollout_now_and_preserves_signature_and_history(self):
        feed = self.feed()
        edit_feed(feed, '0.4.6', 'promote', 86400, datetime(2026, 10, 1, tzinfo=timezone.utc))
        items = ET.parse(feed).findall('channel/item')
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].findtext('pubDate'), 'Thu, 01 Oct 2026 00:00:00 +0000')
        self.assertEqual(items[0].findtext(f'{{{NS}}}phasedRolloutInterval'), '86400')
        self.assertEqual(items[0].find('enclosure').get(f'{{{NS}}}edSignature'), 'signature')
        self.assertEqual(items[1].findtext('description'), 'previous release')

    def test_withdraw_keeps_previous_version(self):
        feed = self.feed()
        edit_feed(feed, '0.4.6', 'withdraw', 86400)
        self.assertEqual([i.findtext(f'{{{NS}}}version') for i in ET.parse(feed).findall('channel/item')], ['0.4.5'])
        with self.assertRaises(ValueError):
            edit_feed(feed, '0.4.6', 'withdraw', 86400)

    def test_promotion_rejects_stale_feed_tampered_dmg_and_wrong_download(self):
        dmg = self.root / 'Type-0.4.6-universal.dmg'
        dmg.write_bytes(b'fixture')
        feed = self.feed()
        text = feed.read_text().replace('https://example.com/new.dmg',
            'https://github.com/fixture/repo/releases/download/gpui-v0.4.6/Type-0.4.6-universal.dmg').replace('length="123"', 'length="7"')
        feed.write_text(text)
        manifest = dict(version='0.4.6', bundle_id='com.digital.type2', previous_feed_sha256='baseline',
                        dmg_sha256=hashlib.sha256(dmg.read_bytes()).hexdigest())
        self.assertEqual(validate_candidate(manifest, '0.4.6', 'baseline', dmg, feed, 'fixture/repo'), 'signature')
        with self.assertRaisesRegex(ValueError, 'live feed changed'):
            validate_candidate(manifest, '0.4.6', 'new baseline', dmg, feed, 'fixture/repo')
        with self.assertRaisesRegex(ValueError, 'does not describe'):
            validate_candidate(manifest, '0.4.6', 'baseline', dmg, feed, 'different/repo')
        dmg.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            validate_candidate(manifest, '0.4.6', 'baseline', dmg, feed, 'fixture/repo')

    @unittest.skipUnless(sys.platform == 'darwin', 'uses macOS system Bash')
    def test_candidate_packaging_arguments_with_and_without_previous_feed(self):
        workflow = (desktop.ROOT / '.github/workflows/gpui-release.yml').read_text()
        step = workflow.split('      - name: Build signed and notarized universal candidate\n', 1)[1]
        script = step.split('        run: |\n', 1)[1].split('      - name:', 1)[0]
        script = '\n'.join(line[10:] for line in script.splitlines())
        shim = self.root / 'bin'
        shim.mkdir()
        fake_python = shim / 'python3'
        fake_python.write_text('#!' + sys.executable + '\nimport json,os,sys\n'
                               'open(os.environ["CAPTURE"],"w").write(json.dumps(sys.argv[1:]))\n')
        fake_python.chmod(0o700)
        captured = self.root / 'arguments.json'
        version = desktop.tomllib.loads((desktop.ROOT / 'apps/gpui/Cargo.toml').read_text())['package']['version']
        previous = self.root / 'previous/appcast.xml'
        previous.parent.mkdir()
        for has_previous in (False, True):
            with self.subTest(previous_feed=has_previous):
                if has_previous:
                    previous.write_text('fixture')
                environment = {**os.environ, 'PATH': str(shim) + ':' + os.environ['PATH'],
                               'RUNNER_TEMP': str(self.root), 'RELEASE_TAG': 'gpui-v' + version,
                               'GITHUB_REPOSITORY': 'fixture/repo', 'CAPTURE': str(captured)}
                subprocess.run(['/bin/bash', '--noprofile', '--norc', '-c', script],
                               cwd=desktop.ROOT, env=environment, check=True)
                import json
                expected = ['apps/gpui/scripts/release.py', '--version', version,
                            '--repository', 'fixture/repo', '--output', str(self.root / 'release'),
                            '--sparkle-dir', str(self.root / 'sparkle'), '--notes',
                            'docs/releases/gpui-v' + version + '.md']
                if has_previous:
                    expected += ['--previous-feed', str(previous)]
                self.assertEqual(json.loads(captured.read_text()), expected)

    def test_arm64_candidate_requires_hardware_and_keeps_previous_item(self):
        dmg = self.root / 'Type-0.4.6-arm64.dmg'
        dmg.write_bytes(b'fixture')
        feed = self.feed()
        feed.write_text(feed.read_text().replace('https://example.com/new.dmg',
            'https://github.com/fixture/repo/releases/download/gpui-v0.4.6/' + dmg.name).replace('length="123"', 'length="7"'))
        manifest = dict(version='0.4.6', architecture='arm64', dmg_name=dmg.name,
                        bundle_id='com.digital.type2', previous_feed_sha256='baseline',
                        dmg_sha256=hashlib.sha256(dmg.read_bytes()).hexdigest())
        with self.assertRaisesRegex(ValueError, 'require arm64'):
            validate_candidate(manifest, '0.4.6', 'baseline', dmg, feed, 'fixture/repo')
        restrict_hardware(feed, '0.4.6')
        self.assertEqual(validate_candidate(manifest, '0.4.6', 'baseline', dmg, feed, 'fixture/repo'), 'signature')
        edit_feed(feed, '0.4.6', 'promote', 0)
        items = ET.parse(feed).findall('channel/item')
        self.assertEqual(items[0].findtext(f'{{{NS}}}hardwareRequirements'), 'arm64')
        self.assertEqual(items[1].findtext('description'), 'previous release')
        self.assertIsNone(items[1].find(f'{{{NS}}}hardwareRequirements'))
        with self.assertRaises(ValueError):
            restrict_hardware(feed, '9.9.9')

    def test_candidate_filename_accepts_old_manifests_and_rejects_untrusted_paths(self):
        self.assertEqual(candidate_dmg_name({}, '0.4.6'), 'Type-0.4.6-universal.dmg')
        self.assertEqual(candidate_dmg_name({'architecture': 'arm64'}, '0.4.6'), 'Type-0.4.6-arm64.dmg')
        for manifest in ({'architecture': 'intel'}, {'dmg_name': '../other.dmg'},
                         {'architecture': 'arm64', 'dmg_name': 'Type-0.4.6-universal.dmg'}):
            with self.subTest(manifest=manifest), self.assertRaises(ValueError):
                candidate_dmg_name(manifest, '0.4.6')

    def test_version_must_match_source(self):
        actual = desktop.tomllib.loads((desktop.ROOT / 'apps/gpui/Cargo.toml').read_text())['package']['version']
        self.assertEqual(release_version(actual), actual)
        for version in ['1.2.3-beta', '1.2', '999.0.0', '1.2.3; touch /tmp/pwn']:
            with self.subTest(version=version), self.assertRaises(ValueError):
                release_version(version)

    def test_notarization_rejection_stops_before_stapling(self):
        with patch('release.run', return_value=subprocess.CompletedProcess([], 0, '{"status":"Invalid","id":"fixture"}')) as run:
            with self.assertRaises(RuntimeError):
                notarize(self.root / 'fixture.dmg', 'fixture-profile')
            self.assertEqual(run.call_count, 1)

    def test_notarization_upload_is_bounded_before_stapling(self):
        with patch('release.run', side_effect=subprocess.TimeoutExpired('notarytool', 300)) as run:
            with self.assertRaisesRegex(RuntimeError, 'upload exceeded 5 minutes'):
                notarize(self.root / 'fixture.dmg', 'fixture-profile')
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.kwargs['timeout'], 300)
            self.assertIn('--no-s3-acceleration', run.call_args.args)

    def test_notarization_reports_submission_and_polls_until_accepted(self):
        responses = [subprocess.CompletedProcess([], 0, response) for response in (
            '{"id":"fixture-id"}', '{"status":"In Progress"}', '{"status":"Accepted"}')]
        with patch('release.run', side_effect=responses) as run, patch('release.time.sleep'), patch('release.time.monotonic', return_value=0):
            self.assertEqual(submit_notarization(self.root / 'fixture.dmg', 'fixture-profile'), 'fixture-id')
            self.assertEqual(run.call_count, 3)
            self.assertIn('info', run.call_args.args)

    def test_notarization_processing_limit_keeps_submission_id(self):
        response = subprocess.CompletedProcess([], 0, '{"id":"fixture-id"}')
        with patch('release.run', return_value=response) as run, patch('release.time.monotonic', side_effect=[0, 1201]):
            with self.assertRaisesRegex(RuntimeError, 'exceeded 20 minutes: fixture-id'):
                submit_notarization(self.root / 'fixture.dmg', 'fixture-profile')
            self.assertEqual(run.call_count, 1)

    @unittest.skipUnless(sys.platform == 'darwin', 'native bridge requires macOS')
    def test_native_failed_save_and_retry(self):
        binary = self.root / 'native-test'
        subprocess.run(['clang', '-fobjc-arc', '-fblocks', '-framework', 'Foundation',
                        str(desktop.ROOT / 'apps/gpui/native/updater_test.m'), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
        # Compile the isolated fixture against the exact production bridge.
        subprocess.run(['clang', '-fobjc-arc', '-fblocks', '-framework', 'Cocoa',
                        str(desktop.ROOT / 'apps/gpui/native/updater_smoke.m'),
                        str(desktop.ROOT / 'apps/gpui/native/updater.m'),
                        '-o', str(self.root / 'smoke-fixture')], check=True)



if __name__ == '__main__':
    unittest.main()
