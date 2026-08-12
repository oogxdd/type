const {
  withInfoPlist,
  withPodfile,
  withXcodeProject,
  withDangerousMod,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Name of the WidgetKit extension target / product and the folder it is copied
// into under ios/ at prebuild time.
const WIDGET_NAME = "RecordingWidget";
// Widget-only SwiftUI sources.
const WIDGET_FILES = [
  "RecordingActivityWidgetBundle.swift",
  "RecordingLiveActivityWidget.swift",
];
// Sources shared with the app target (also compiled into the app via the pod);
// the widget target needs its own copies compiled in.
const SHARED_FILES = ["RecordingActivityAttributes.swift", "StopRecordingIntent.swift"];
const SWIFT_FILES = [...WIDGET_FILES, ...SHARED_FILES];
const RUST_LINKER_MARKER = "# @typenotes/link-rust-system-libraries";

const widgetDir = () => path.join(__dirname, "..", "widget");
const sharedDir = () => path.join(__dirname, "..", "ios");

/** Advertise Live Activity support on the app so ActivityKit can be authorized. */
const withLiveActivitiesEnabled = (config) =>
  withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    return config;
  });

/**
 * Copy the widget's Swift sources + Info.plist into ios/<WIDGET_NAME>/ every
 * prebuild (the module folder is the source of truth; `expo prebuild --clean`
 * wipes ios/, so this re-materializes them).
 */
const withWidgetSourcesCopied = (config) =>
  withDangerousMod(config, [
    "ios",
    async (config) => {
      const destDir = path.join(config.modRequest.platformProjectRoot, WIDGET_NAME);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of WIDGET_FILES) {
        fs.copyFileSync(path.join(widgetDir(), file), path.join(destDir, file));
      }
      for (const file of SHARED_FILES) {
        fs.copyFileSync(path.join(sharedDir(), file), path.join(destDir, file));
      }
      fs.copyFileSync(
        path.join(widgetDir(), "Info.plist"),
        path.join(destDir, "Info.plist")
      );
      return config;
    },
  ]);

/**
 * Keep the system-library flags required by TypeCore across Expo prebuilds.
 * The generated TypeCore podspec vendors a Rust static library containing
 * libgit2, whose zlib/iconv references must be resolved by the app target.
 * The Iroh sync transport also pulls in hickory-resolver and netdev, which
 * reference SCDynamicStore, SCNetworkInterface and SCPreferences APIs on
 * Apple platforms (SystemConfiguration.framework) for the same reason.
 */
const addRustCoreLinkerFlagsToPodfile = (contents) => {
  if (contents.includes(RUST_LINKER_MARKER)) return contents;

  const anchor = [
    "      :ccache_enabled => ccache_enabled?(podfile_properties),",
    "    )",
  ].join("\n");
  if (!contents.includes(anchor)) {
    throw new Error("Could not find react_native_post_install in the generated Podfile");
  }

  const linkerPatch = [
    "",
    `    ${RUST_LINKER_MARKER}`,
    "    Dir.glob(File.join(__dir__, 'Pods', 'Target Support Files', 'Pods-Type', 'Pods-Type.*.xcconfig')).each do |xcconfig_path|",
    "      contents = File.read(xcconfig_path)",
    "      additions = ['-lz', '-liconv', '-framework SystemConfiguration'].reject { |flag| contents.include?(flag) }",
    "      next if additions.empty?",
    "      contents = contents.gsub(/^(OTHER_LDFLAGS = .*)$/) { \"#{$1} #{additions.join(' ')}\" }",
    "      File.write(xcconfig_path, contents)",
    "    end",
  ].join("\n");

  return contents.replace(anchor, `${anchor}${linkerPatch}`);
};

const withRustCoreLinkerFlags = (config) =>
  withPodfile(config, (config) => {
    config.modResults.contents = addRustCoreLinkerFlagsToPodfile(
      config.modResults.contents
    );
    return config;
  });

/**
 * Add + embed the WidgetKit extension target into a parsed `xcode` project.
 *
 * Extracted (and exported) so it can be exercised against the real pbxproj
 * without a full prebuild. Idempotent: returns false if the target already
 * exists, true if it added one. Follows the canonical `xcode`-library pattern.
 */
// pbxproj values for simple identifiers may or may not be wrapped in quotes
// (e.g. addTarget stores name as `"RecordingWidget"`); compare unquoted.
const unquote = (value) =>
  typeof value === "string" ? value.replace(/^"(.*)"$/, "$1") : value;

const addWidgetTarget = (proj, appBundleId) => {
  const widgetBundleId = `${appBundleId}.${WIDGET_NAME}`;

  // Idempotency: do nothing if the target already exists.
  const nativeTargets = proj.pbxNativeTargetSection();
  for (const key of Object.keys(nativeTargets)) {
    const value = nativeTargets[key];
    if (value && unquote(value.name) === WIDGET_NAME) {
      return false;
    }
  }

  // Group holding the widget's files, hung off the project's main group.
  const group = proj.addPbxGroup([...SWIFT_FILES, "Info.plist"], WIDGET_NAME, WIDGET_NAME);
  const mainGroupId = proj.getFirstProject().firstProject.mainGroup;
  proj.addToPbxGroup(group.uuid, mainGroupId);

  // The base Expo project has no target-dependency sections yet; xcode's
  // addTargetDependency (which addTarget calls internally for app_extension)
  // silently no-ops unless these sections already exist. Seed them so the app
  // gets a real dependency on the widget.
  const objects = proj.hash.project.objects;
  objects.PBXTargetDependency = objects.PBXTargetDependency || {};
  objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

  // App-extension native target. addTarget also (a) puts the product in the
  // Products group, (b) creates the embed "Copy Files" phase on the app target
  // containing RecordingWidget.appex (dstSubfolderSpec 13 = PlugIns), and
  // (c) adds the app -> widget target dependency.
  const target = proj.addTarget(WIDGET_NAME, "app_extension", WIDGET_NAME, widgetBundleId);

  // Build phases for the widget target.
  proj.addBuildPhase(SWIFT_FILES, "PBXSourcesBuildPhase", "Sources", target.uuid);
  proj.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  proj.addBuildPhase(
    ["SwiftUI.framework", "WidgetKit.framework"],
    "PBXFrameworksBuildPhase",
    "Frameworks",
    target.uuid
  );

  // Build settings on the widget target's own Debug + Release configs.
  const nativeTarget = proj.pbxNativeTargetSection()[target.uuid];
  const configListId = nativeTarget.buildConfigurationList;
  const configList = proj.pbxXCConfigurationList()[configListId];
  const xcConfigs = proj.pbxXCBuildConfigurationSection();
  for (const ref of configList.buildConfigurations) {
    const settings = xcConfigs[ref.value].buildSettings;
    settings.INFOPLIST_FILE = `"${WIDGET_NAME}/Info.plist"`;
    settings.PRODUCT_BUNDLE_IDENTIFIER = `"${widgetBundleId}"`;
    settings.PRODUCT_NAME = `"${WIDGET_NAME}"`;
    settings.IPHONEOS_DEPLOYMENT_TARGET = "16.4";
    settings.TARGETED_DEVICE_FAMILY = `"1,2"`;
    settings.SWIFT_VERSION = "5.9";
    settings.SWIFT_EMIT_LOC_STRINGS = "YES";
    settings.GENERATE_INFOPLIST_FILE = "YES";
    settings.CURRENT_PROJECT_VERSION = `"1"`;
    settings.MARKETING_VERSION = `"1.0"`;
    settings.SKIP_INSTALL = "NO";
    settings.CODE_SIGN_STYLE = "Automatic";
    settings.LD_RUNPATH_SEARCH_PATHS = `"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"`;
  }

  return true;
};

/**
 * Create + embed the WidgetKit extension target in the Xcode project.
 *
 * NOTE: this pbxproj mutation is materialized by `expo prebuild` on macOS and
 * should be verified in Xcode (see the module README). The mutation itself is
 * validated against the real project.pbxproj by
 * plugin/__tests__/add-widget-target.test.cjs — but signing (a real dev team)
 * and the on-device build only happen on a Mac.
 */
const withWidgetXcodeTarget = (config) =>
  withXcodeProject(config, (config) => {
    addWidgetTarget(config.modResults, config.ios.bundleIdentifier);
    return config;
  });

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withRecordingActivity = (config) => {
  config = withLiveActivitiesEnabled(config);
  config = withRustCoreLinkerFlags(config);
  config = withWidgetSourcesCopied(config);
  config = withWidgetXcodeTarget(config);
  return config;
};

module.exports = withRecordingActivity;
// Exposed for the pbxproj mutation test (plugin/__tests__/add-widget-target.test.cjs).
module.exports.addWidgetTarget = addWidgetTarget;
module.exports.addRustCoreLinkerFlagsToPodfile = addRustCoreLinkerFlagsToPodfile;
module.exports.WIDGET_NAME = WIDGET_NAME;
module.exports.SWIFT_FILES = SWIFT_FILES;
