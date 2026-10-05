// Reapply after Expo prebuild. Keeps the ordinary Type scheme and identity.
const fs = require("node:fs");
const path = require("node:path");
const xcode = require("xcode");
const ios = path.resolve(__dirname, "../ios");
const projectPath = path.join(ios, "Type.xcodeproj/project.pbxproj");
const project = xcode.project(projectPath);
project.parseSync();
const targets = project.pbxNativeTargetSection();
const app = Object.entries(targets).find(([, value]) => value?.name === "Type");
if (!app) throw new Error("Type target missing; run Expo prebuild first.");
let test = Object.entries(targets).find(([, value]) => value?.name === "TypeUITests" || value?.name === '"TypeUITests"');
if (!test) {
  const added = project.addTarget("TypeUITests", "unit_test_bundle", "TypeUITests", "com.typenotes.mobile.dev.uitests");
  added.pbxNativeTarget.productType = '"com.apple.product-type.bundle.ui-testing"';
  // addTarget assumes extensions and makes the app depend on the new target.
  // UI tests have the reverse dependency.
  const dependencies = project.hash.project.objects.PBXTargetDependency;
  app[1].dependencies = app[1].dependencies.filter((ref) => dependencies[ref.value]?.target !== added.uuid);
  project.addTargetDependency(added.uuid, [app[0]]);
  project.addBuildPhase(["TypeUITests/ResponsivenessTests.swift"], "PBXSourcesBuildPhase", "Sources", added.uuid);
  test = [added.uuid, added.pbxNativeTarget];
}
const configs = project.pbxXCBuildConfigurationSection();
const list = project.pbxXCConfigurationList()[test[1].buildConfigurationList];
for (const ref of list.buildConfigurations) {
  const settings = configs[ref.value].buildSettings;
  delete settings.INFOPLIST_FILE;
  Object.assign(settings, { GENERATE_INFOPLIST_FILE: "YES", PRODUCT_BUNDLE_IDENTIFIER: "com.typenotes.mobile.dev.uitests", TEST_TARGET_NAME: "Type", SWIFT_VERSION: "5.9", IPHONEOS_DEPLOYMENT_TARGET: "16.4", TARGETED_DEVICE_FAMILY: '"1,2"', CODE_SIGN_STYLE: "Automatic" });
}
for (const value of Object.values(configs)) {
  const settings = value?.buildSettings;
  if (!settings?.PRODUCT_BUNDLE_IDENTIFIER) continue;
  if (settings.PRODUCT_BUNDLE_IDENTIFIER === "com.typenotes.mobile" || settings.PRODUCT_BUNDLE_IDENTIFIER === '"$(TYPE_APP_BUNDLE_IDENTIFIER)"') {
    settings.TYPE_APP_BUNDLE_IDENTIFIER = "com.typenotes.mobile";
    settings.PRODUCT_BUNDLE_IDENTIFIER = '"$(TYPE_APP_BUNDLE_IDENTIFIER)"';
  } else if (settings.PRODUCT_BUNDLE_IDENTIFIER === "com.typenotes.mobile.RecordingWidget") {
    settings.TYPE_APP_BUNDLE_IDENTIFIER = "com.typenotes.mobile";
    settings.PRODUCT_BUNDLE_IDENTIFIER = '"$(TYPE_APP_BUNDLE_IDENTIFIER).RecordingWidget"';
  }
}
fs.writeFileSync(projectPath, project.writeSync());
const reference = (id, name, product) => `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id}" BuildableName="${product}" BlueprintName="${name}" ReferencedContainer="container:Type.xcodeproj"/>`;
const appRef = reference(app[0], "Type", "Type.app");
const testRef = reference(test[0], "TypeUITests", "TypeUITests.xctest");
fs.writeFileSync(path.join(ios, "Type.xcodeproj/xcshareddata/xcschemes/TypeResponsiveness.xcscheme"), `<?xml version="1.0" encoding="UTF-8"?>
<Scheme version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="NO" buildForAnalyzing="YES">${appRef}</BuildActionEntry>
<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${testRef}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${testRef}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Release"><BuildableProductRunnable runnableDebuggingMode="0">${appRef}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release"><BuildableProductRunnable runnableDebuggingMode="0">${appRef}</BuildableProductRunnable></ProfileAction>
</Scheme>
`);
