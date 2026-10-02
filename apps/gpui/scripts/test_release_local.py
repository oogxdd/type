import subprocess
import unittest
from unittest.mock import patch

from release_local import apple_credentials, capture, signing_identity


class LocalReleaseTests(unittest.TestCase):
    def test_identity_rejects_wrong_certificate_ambiguous_selection_and_team(self):
        for environment in (
            {'APPLE_SIGNING_IDENTITY': 'Apple Development: Fixture (TEAM)'},
            {'APPLE_SIGNING_IDENTITY': 'Developer ID Application: Fixture (TEAM)', 'APPLE_TEAM_ID': 'OTHER'},
        ):
            with self.subTest(environment=environment), self.assertRaises(RuntimeError):
                signing_identity(environment)
        with patch('release_local.capture', return_value='0 valid identities found'), self.assertRaises(RuntimeError):
            signing_identity({})
        with patch('release_local.capture', return_value='"Developer ID Application: One (TEAM)" "Developer ID Application: Two (TEAM)"'), self.assertRaises(RuntimeError):
            signing_identity({})

    def test_single_identity_derives_team(self):
        with patch('release_local.capture', return_value='1) HASH "Developer ID Application: Fixture (TEAM123)"'):
            self.assertEqual(signing_identity({}), ('Developer ID Application: Fixture (TEAM123)', 'TEAM123'))

    def test_saved_notary_profile_requires_no_password_export(self):
        environment = {'APPLE_TEAM_ID': 'TEAM123'}
        with patch('release_local.subprocess.run', return_value=subprocess.CompletedProcess([], 0, '{}')) as run:
            apple_credentials(environment, 'fixture-profile')
        self.assertEqual(run.call_count, 1)
        self.assertEqual(environment['APPLE_NOTARIZATION_PROFILE'], 'fixture-profile')
        self.assertNotIn('APPLE_PASSWORD', environment)

    def test_environment_credentials_do_not_read_keychain(self):
        environment = {'APPLE_TEAM_ID': 'TEAM123', 'APPLE_ID': 'fixture@example.com', 'APPLE_PASSWORD': 'fixture-secret'}
        with patch('release_local.subprocess.run') as run:
            apple_credentials(environment, 'fixture-profile')
        run.assert_not_called()

    def test_missing_credentials_fail_before_build_and_hide_subprocess_output(self):
        failure = subprocess.CompletedProcess([], 1, 'fixture-secret', 'fixture-secret')
        with patch('release_local.subprocess.run', return_value=failure):
            with self.assertRaisesRegex(RuntimeError, '--setup'):
                apple_credentials({'APPLE_TEAM_ID': 'TEAM123'}, 'fixture-profile')
            with self.assertRaises(RuntimeError) as error:
                capture('security', 'find-generic-password', '-w')
            self.assertNotIn('fixture-secret', str(error.exception))


if __name__ == '__main__':
    unittest.main()
