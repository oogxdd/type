require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# Local Expo module that owns the app-side ActivityKit bridge. Only the app
# target's Swift (ios/*.swift — the module, the shared attributes, and the
# intent) is compiled here; the WidgetKit extension's own sources live under
# widget/ and are compiled by the widget target created by the config plugin.
Pod::Spec.new do |s|
  s.name           = 'RecordingActivity'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'Type'
  s.homepage       = 'https://github.com/oogxdd/type'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = 'ios/**/*.{h,m,mm,swift,hpp,cpp}'
end
